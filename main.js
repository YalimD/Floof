// floof: main process.
// Owns the transparent overlay window, the tray menu, the settings window, notifications,
// and the ways agents reach their pets (local bridge, cloud relay). Pets live in renderer/.
const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, shell, dialog, Notification } = require('electron');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const { Settings } = require('./src/settings');
const { startBridge, Answers, normalizeEvent } = require('./src/bridge');
const { claudeCodeEvent, HOOK_EVENTS, isFloofHook, upgradeHooks } = require('./src/claude-code');
const { Relay } = require('./src/relay');
const { startWindowWatcher } = require('./src/windows');
const { SpritePacks } = require('./src/sprites');
const { runDemo } = require('./src/demo');
const { runBench, benchTable } = require('./src/bench');
const { getFortune } = require('./src/fortune');
const { History } = require('./src/history');
const { Subagents, startsTurn } = require('./src/subagents');
const { createTour } = require('./src/tour');

const BUILTIN_CRITTERS = ['cat', 'dog', 'bird', 'sheep', 'llama'];
const log = (msg) => console.log(`[floof] ${msg}`);
// FLOOF_* settings for tests and scripts
const env = (name) => process.env[`FLOOF_${name}`];
// --render-docs=<folder>: draw the README pictures from the real code into <folder>, then quit.
// It uses its own throwaway settings folder, so it runs beside your floof and shows none of your data.
const RENDER_DOCS = (process.argv.find((a) => a.startsWith('--render-docs=')) || '').slice('--render-docs='.length);
if (RENDER_DOCS) app.setPath('userData', path.join(app.getPath('temp'), 'floof-render-docs'));
const DEBUG = process.argv.includes('--log-pets'); // log where every pet is, every few seconds
const BENCH = process.argv.includes('--bench'); // run the load test (src/bench.js) and log its results

let overlays = []; // one overlay window per "island": monitors that share a scaling level and sit side by side
let settingsWin = null;
let tray = null;
let settings;
let packs;
let bridge = null;
let watcher = null;
let lastRawWindows = [];
const answers = new Answers();
const relay = new Relay({
  onEvent: (ev, { test } = {}) => (test ? cloudTestPet(ev) : onAgentEvent(ev)),
  log,
  onStatus: (s) => settingsWin && !settingsWin.isDestroyed() && settingsWin.webContents.send('relay:status', s),
});
const lastSeen = new Map(); // agent id -> {state, text}, to decide when to notify
const lastEvent = new Map(); // agent id -> its latest event, to bring pets back after the monitors change
const owner = new Map(); // pet id -> key of the overlay it is on

const alive = (o) => o && o.win && !o.win.isDestroyed();
const home = () => overlays.find((o) => o.home) || overlays[0];
const byKey = (key) => overlays.find((o) => o.key === key);
const bySender = (wc) => overlays.find((o) => alive(o) && o.win.webContents === wc);
const sendTo = (o, channel, payload) => alive(o) && o.win.webContents.send(channel, payload);
const send = (channel, payload) => overlays.forEach((o) => sendTo(o, channel, payload));

// ---------- overlay windows ----------

// FLOOF_FAKE_DISPLAYS lets the tests pretend to have monitors with different scaling
function allDisplays() {
  if (env('FAKE_DISPLAYS')) return JSON.parse(env('FAKE_DISPLAYS'));
  return screen.getAllDisplays();
}
function primaryDisplayInfo() {
  if (env('FAKE_DISPLAYS')) return allDisplays()[0];
  return screen.getPrimaryDisplay();
}

// Each overlay covers the work area (screen minus taskbar) of its monitors, so pets walk on
// top of each taskbar. Monitors with the same scaling share one overlay; a monitor with a
// different scaling gets its own, and pets walk from one overlay to the next at the shared edge.
// Which screens pets may use (Settings > Pets > Screens pets can use; none ticked = all). A
// screen is remembered by its id, and by its name and size as well, since ids can change after a
// reboot or a dock change.
const sizeOf = (d) => d.size || d.bounds;
const describeScreen = (d, i) => ({
  id: String(d.id),
  label: d.label || `Screen ${i + 1}`,
  w: Math.round(sizeOf(d).width * d.scaleFactor),
  h: Math.round(sizeOf(d).height * d.scaleFactor),
});
function allowedDisplays(all, primary) {
  const picked = settings.get().screens;
  if (!picked.length) return all;
  const ok = all.filter((d, i) => {
    const s = describeScreen(d, i);
    return picked.some((p) => p.id === s.id || (p.label === s.label && p.w === s.w && p.h === s.h));
  });
  return ok.length ? ok : [primary]; // none of yours is connected: the main screen
}

// Which side of a screen its taskbar is on, from the screen against its work area: 'bottom',
// 'top', 'left', 'right', or 'none' (auto-hidden, or no taskbar on that screen: pets use the bottom).
function taskbarEdge(d) {
  const [b, w] = [d.bounds, d.workArea];
  if (w.y > b.y + 1) return 'top';
  if (w.x > b.x + 1) return 'left';
  if (w.x + w.width < b.x + b.width - 1) return 'right';
  if (w.y + w.height < b.y + b.height - 1) return 'bottom';
  return 'none';
}

function computeLayouts() {
  const primary = primaryDisplayInfo();
  const all = allDisplays();
  const list = allowedDisplays(all, primary);
  const offIds = all.filter((d) => !list.includes(d)).map((d) => String(d.id)); // screens pets keep off
  const split = process.argv.includes('--split-monitors') || !list.every((d) => d.scaleFactor === list[0].scaleFactor);
  const groups = split ? list.map((d) => [d]) : [list];
  const islands = groups.map((group) => {
    const x = Math.min(...group.map((d) => d.workArea.x));
    const y = Math.min(...group.map((d) => d.workArea.y));
    const right = Math.max(...group.map((d) => d.workArea.x + d.workArea.width));
    const bottom = Math.max(...group.map((d) => d.workArea.y + d.workArea.height));
    return {
      key: group.map((d) => d.id).join('+'),
      home: group.some((d) => d.id === primary.id),
      bounds: { x, y, width: right - x, height: bottom - y },
      origin: { x, y },
      scaleFactor: group[0].scaleFactor,
      outer: group.map((d) => d.bounds), // whole monitors, to find which overlays touch
      displays: group.map((d) => ({ x: d.workArea.x - x, y: d.workArea.y - y, w: d.workArea.width, h: d.workArea.height, primary: d.id === primary.id, edge: taskbarEdge(d) })),
      exits: { left: null, right: null },
      offIds,
    };
  });
  if (!islands.some((o) => o.home)) islands[0].home = true; // the main screen is unticked: the first one you picked
  // an overlay whose monitor shares a vertical edge with another overlay's monitor has an exit there
  const overlapY = (a, b) => Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 50;
  for (const a of islands) {
    for (const b of islands) {
      if (a === b) continue;
      for (const da of a.outer) {
        for (const db of b.outer) {
          if (!overlapY(da, db)) continue;
          if (Math.abs(da.x + da.width - db.x) <= 8) a.exits.right = b.key;
          if (Math.abs(db.x + db.width - da.x) <= 8) a.exits.left = b.key;
        }
      }
    }
  }
  return islands;
}

const describe = (o) =>
  log(`overlay ${o.key}${o.home ? ' (main)' : ''} ${JSON.stringify(o.bounds)} covers ${o.displays.length} monitor(s) at ${Math.round(o.scaleFactor * 100)}% scaling, exits ${JSON.stringify(o.exits)}: ${JSON.stringify(o.displays)}`);

const displayInfo = (o) => ({ displays: o.displays, exits: o.exits, home: o.home, key: o.key, keys: overlays.map((x) => x.key), offIds: o.offIds || [], askRoute: env('ASK_ROUTE') || null }); // FLOOF_ASK_ROUTE=tray|curtain|balloon: for the tests

// Settings: the connected screens, and which ones pets may use
function screenList() {
  const all = allDisplays();
  const primary = primaryDisplayInfo();
  const allowed = allowedDisplays(all, primary);
  const where = (d) => {
    if (d.id === primary.id) return 'main';
    const [a, p] = [d.bounds, primary.bounds];
    if (a.x + a.width <= p.x) return 'left';
    if (a.x >= p.x + p.width) return 'right';
    return a.y < p.y ? 'above' : 'below';
  };
  return all.map((d, i) => ({
    ...describeScreen(d, i),
    ...(RENDER_DOCS ? { label: d.id === primary.id ? 'Desk monitor 4K' : 'Laptop display' } : {}), // README pictures don't show your monitors' names
    number: i + 1,
    scale: Math.round(d.scaleFactor * 100),
    where: where(d),
    on: allowed.includes(d),
  }));
}
ipcMain.handle('screens:list', () => screenList());

// "Identify screens": a big number on each screen for a few seconds
ipcMain.handle('screens:identify', () => {
  allDisplays().forEach((d, i) => {
    const size = 220;
    const w = new BrowserWindow({
      x: Math.round(d.bounds.x + (d.bounds.width - size) / 2),
      y: Math.round(d.bounds.y + (d.bounds.height - size) / 2),
      width: size,
      height: size,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      resizable: false,
      show: false,
    });
    const html = `<body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:rgba(30,30,30,.82);color:#ffd76b;font:bold 150px 'Segoe UI',sans-serif;border-radius:28px">${i + 1}</body>`;
    w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    w.once('ready-to-show', () => w.showInactive());
    setTimeout(() => !w.isDestroyed() && w.destroy(), 3000);
  });
});

function createOverlayWindow(island) {
  const w = new BrowserWindow({
    ...island.bounds,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // keep pets moving while other apps have focus
    },
  });
  w.setAlwaysOnTop(true, 'screen-saver');
  // Clicks pass through to the desktop except where a pet, balloon or curtain is.
  w.setIgnoreMouseEvents(true, { forward: true });
  w.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  w.webContents.on('did-finish-load', sendWindows);
  w.once('ready-to-show', () => {
    w.setBounds(island.bounds); // Windows can adjust bounds that cross monitors with different scaling
    w.showInactive();
  });
  return w;
}

// (Re)build the overlays. When the monitors change the same way the overlays just move;
// when the set of overlays changes they are rebuilt and agents' pets come back on the main one.
function relayout() {
  const next = computeLayouts();
  const same = next.length === overlays.length && next.every((n, i) => n.key === overlays[i].key);
  if (same) {
    next.forEach((n, i) => {
      Object.assign(overlays[i], n);
      if (alive(overlays[i])) overlays[i].win.setBounds(n.bounds);
      sendTo(overlays[i], 'displays', displayInfo(overlays[i]));
      describe(overlays[i]);
    });
  } else {
    const old = overlays;
    overlays = next.map((island) => ({ ...island, win: createOverlayWindow(island) }));
    overlays.forEach(describe);
    owner.clear();
    for (const o of old) if (alive(o)) o.win.destroy();
    if (old.length) {
      home().win.webContents.once('did-finish-load', () => {
        for (const ev of lastEvent.values()) routeEvent(ev);
      });
    }
  }
  sendWindows();
}

ipcMain.on('set-interactive', (e, on) => {
  const o = bySender(e.sender);
  if (!o) return;
  if (on) o.win.setIgnoreMouseEvents(false);
  else o.win.setIgnoreMouseEvents(true, { forward: true });
});

// the overlay with the window you're using
function focusOverlay() {
  const fg = lastRawWindows.find((w) => w.fg);
  if (!fg) return null;
  return overlays.find((o) => {
    const r = toOverlay(o, fg);
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    return o.displays.some((d) => cx >= d.x && cx < d.x + d.w && cy >= d.y && cy < d.y + d.h + 60);
  });
}

// a pet walked off the side of its overlay, or has a question and you're looking at
// another monitor: it carries on in the other overlay
ipcMain.on('handoff', (e, { side, pet }) => {
  const from = bySender(e.sender);
  const to = from && (side === 'focus' ? focusOverlay() : byKey(from.exits[side]));
  if (!pet || !alive(to) || to === from) return sendTo(from, 'adopt', { side: null, pet }); // nowhere to go: keep it
  owner.set(pet.id, to.key);
  if (DEBUG) log(`pet ${pet.id} walks ${side} from overlay ${from.key} to ${to.key}`);
  sendTo(to, 'adopt', { side, pet });
});

// an agent event reached an overlay its pet had just left
ipcMain.on('reroute', (_e, ev) => routeEvent(ev));

ipcMain.on('answer', (_e, { id, text }) => {
  if (!id || typeof text !== 'string' || !text.trim()) return;
  answers.push(answerTarget(id), text.trim());
  relay.sendAnswer(answerTarget(id), text.trim());
});

ipcMain.handle('sprite-packs', () => packs.list());
ipcMain.handle('get-settings', () => settings.get());
ipcMain.handle('get-displays', (e) => {
  const o = bySender(e.sender);
  return o ? displayInfo(o) : null;
});
ipcMain.handle('is-debug', () => DEBUG || BENCH); // the overlays report frame timing
ipcMain.handle('fortune', () => getFortune());
// pet boxes: dropped from the tray or Settings, moved and resized on the overlay
function addBox() {
  const o = home();
  if (!o) return;
  const d = o.displays.find((x) => x.primary) || o.displays[0];
  const n = settings.get().boxes.length;
  const { bg, shelfColor, gravity } = settings.get().boxDefaults;
  const box = { id: `box-${Date.now()}`, display: o.key, w: 360, h: 220, bg: { ...bg }, shelves: [{ id: 'shelf1', x: 0.08, y: 0.42, w: 0.42 }], shelfColor, gravity };
  box.x = Math.max(d.x, d.x + d.w - box.w - 40 - n * 30);
  box.y = Math.max(d.y, d.y + d.h - box.h - 20 - n * 30);
  if (bg.picture) box.bg.picture = copyPicture(bg.picture, box.id) || ''; // each box has its own copy
  settings.update({ roam: 'boxes', boxes: [...settings.get().boxes, box] });
}
ipcMain.handle('boxes:add', () => addBox());
// a box moved, resized or rearranged on the overlay: keep the rest of it (background, ...)
ipcMain.on('save-box', (_e, box) => {
  const list = settings.get().boxes;
  const i = list.findIndex((b) => b.id === box.id);
  if (i >= 0) list[i] = { ...list[i], ...box };
  else list.push(box);
  settings.update({ boxes: list });
});
ipcMain.on('remove-box', (_e, id) => settings.update({ boxes: settings.get().boxes.filter((b) => b.id !== id) }));
ipcMain.on('box-settings', (_e, id) => openSettings(id));

// box pictures are copied into floof's own folder, so moving or deleting the original doesn't matter
const picturesDir = () => path.join(app.getPath('userData'), 'boxes');
function copyPicture(from, name) {
  try {
    fs.mkdirSync(picturesDir(), { recursive: true });
    const to = path.join(picturesDir(), `${name}-${Date.now()}${path.extname(from).toLowerCase()}`);
    fs.copyFileSync(from, to);
    return to;
  } catch (err) {
    log(`couldn't copy box picture: ${err.message}`);
    return null;
  }
}
// delete copies no box (or the new-box default) uses any more
function cleanPictures() {
  const { boxes, boxDefaults } = settings.get();
  const used = new Set([...boxes.map((b) => b.bg.picture), boxDefaults.bg.picture].filter(Boolean).map((p) => path.resolve(p)));
  let files = [];
  try {
    files = fs.readdirSync(picturesDir());
  } catch {
    return;
  }
  for (const f of files) {
    const full = path.resolve(picturesDir(), f);
    if (!used.has(full)) fs.rm(full, { force: true }, () => {});
  }
}
// "Choose picture…" in Settings, for a box or ('default') for new boxes
ipcMain.handle('boxes:pick-picture', async (_e, id) => {
  const r = await dialog.showOpenDialog(settingsWin, {
    title: 'Choose a picture for the pet box',
    properties: ['openFile'],
    filters: [{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
  });
  if (r.canceled || !r.filePaths[0]) return settings.get();
  const copy = copyPicture(r.filePaths[0], id === 'default' ? 'default' : id);
  if (!copy) return settings.get();
  if (id === 'default') {
    const d = settings.get().boxDefaults;
    return settings.update({ boxDefaults: { ...d, bg: { ...d.bg, type: 'picture', picture: copy } } });
  }
  return settings.update({ boxes: settings.get().boxes.map((b) => (b.id === id ? { ...b, bg: { ...b.bg, type: 'picture', picture: copy } } : b)) });
});
ipcMain.on('debug-report',(e, report) => {
  const key = (bySender(e.sender) || {}).key;
  if (BENCH && report.frame) frameReports.push({ key, at: Date.now(), ...report.frame, minis: report.minis || 0 });
  if (DEBUG || report.error) log(`pets on ${key} ${JSON.stringify(report)}`);
});

// ---------- --bench ----------

const frameReports = []; // {key, at, avg, max, fps, minis}: what the overlays reported, every 3 s

// one phase of the load test: floof's CPU (all its processes, % of one core) and the overlays' frame work.
// Electron counts CPU as a share of all the cores, so it's scaled up to one core.
async function benchSample(seconds = 20) {
  app.getAppMetrics(); // CPU use is counted from here
  const from = Date.now();
  await new Promise((r) => setTimeout(r, seconds * 1000));
  const cpu = app.getAppMetrics().reduce((n, m) => n + m.cpu.percentCPUUsage, 0) * require('os').cpus().length;
  const reports = frameReports.filter((r) => r.at >= from);
  const byOverlay = new Map();
  for (const r of reports) byOverlay.set(r.key, [...(byOverlay.get(r.key) || []), r]);
  const mean = (list, k) => list.reduce((n, r) => n + r[k], 0) / Math.max(1, list.length);
  const per = [...byOverlay.values()];
  // the busiest overlay's work, the slowest one's fps
  return {
    cpu,
    avg: Math.max(0, ...per.map((l) => mean(l, 'avg'))),
    max: Math.max(0, ...reports.map((r) => r.max)),
    fps: per.length ? Math.min(...per.map((l) => mean(l, 'fps'))) : 0,
    minis: per.reduce((n, l) => n + Math.max(...l.map((r) => r.minis)), 0),
  };
}

async function startBench() {
  const screens = screen.getAllDisplays().map((d) => `${Math.round(d.size.width * d.scaleFactor)}x${Math.round(d.size.height * d.scaleFactor)} at ${Math.round(d.scaleFactor * 100)}%`);
  log(`benchmark started, about 90 s (screens: ${screens.join(', ')}; cpu is % of one core)`);
  // its pets stay off the finished list, like Send test event's
  const emit = (ev) => {
    if (!ev.parent) testPets.add(ev.id);
    onAgentEvent(ev);
  };
  const results = await runBench({ emit, sample: () => benchSample() });
  log(`benchmark results:
${benchTable(results)}`);
}

// ---------- agents ----------

// an agent's pet lives on one overlay; new pets start on the main monitor
function routeEvent(ev) {
  const o = byKey(owner.get(ev.id)) || home();
  if (!o) return;
  owner.set(ev.id, o.key);
  sendTo(o, 'agent-event', withSubagents(ev));
  if (ev.state === 'bye') owner.delete(ev.id);
}

// subagents: the pet gets its whole turn's list with every event, and asks a subagent's question for it
const subagents = new Subagents();

function withSubagents(ev) {
  if (ev.state === 'bye') return ev;
  const out = { ...ev, subagents: subagents.list(ev.id) };
  const sub = subagents.asking(ev.id);
  if (sub) Object.assign(out, { state: 'question', text: `${sub.name}: ${sub.text || 'needs your attention'}` });
  return out;
}

// typed answers go to the subagent when the pet is asking its question
const answerTarget = (id) => (subagents.asking(id) || { id }).id;

function onSubagentEvent(ev) {
  const parent = agentInfo.get(ev.parent);
  if (!subagents.apply(ev, !!parent && !parent.finished)) return; // waits for its parent's first event
  const last = lastEvent.get(ev.parent);
  if (last) routeEvent(last);
  sendList();
}

// turn: {newTurn, marksTurns} from agents that mark their own turns (Claude Code)
function onAgentEvent(ev, turn = {}) {
  if (ev.parent) return onSubagentEvent(ev);
  const before = agentInfo.get(ev.id);
  if (!before || before.finished) subagents.parentArrived(ev.id);
  // a new turn, with no subagents yet
  else if (startsTurn(before.state, { ...ev, newTurn: turn.newTurn }, turn)) subagents.newTurn(ev.id);
  if (ev.state === 'bye') subagents.end(ev.id);
  trackAgent(ev);
  if (ev.state === 'bye') lastEvent.delete(ev.id);
  else lastEvent.set(ev.id, ev);
  routeEvent(ev);
  notifyIfNeeded(ev);
}

// ---------- the guide sheep's tour ----------

let tour = null;
function startTour() {
  if (!tour) {
    tour = createTour({
      emit: onAgentEvent,
      answers,
      getFortune,
      interactKeys: () => settings.get().interactKeys,
      openSettings: () => openSettings(),
      openList: () => openList(),
      onEnd: () => settings.get().tourDone || settings.update({ tourDone: true }),
      log: DEBUG ? log : undefined,
    });
  }
  tour.start();
  // for testing: press Next every few seconds (and answer the question)
  if (process.argv.includes('--tour-auto')) {
    const timer = setInterval(() => {
      if (!tour.running) return clearInterval(timer);
      answers.push('floof-guide', 'auto test');
      tour.action('next');
    }, 9000);
  }
}
ipcMain.on('tour', (_e, action) => tour && tour.action(action));
ipcMain.handle('tour:start', () => startTour());

// ---------- pet list: who's on screen, and agents that finished or left ----------

const agentInfo = new Map(); // agent id -> {name, provider, critter, state, text, started, since}
const reports = new Map(); // overlay key -> {at, pets} as the overlay last reported them
const lastOnScreen = new Map(); // agent id -> when an overlay last reported its pet
let listWin = null;
let history = null;

function trackAgent(ev) {
  if ('tour' in ev) return; // the guide sheep isn't a real agent: no history
  const now = Date.now();
  const a = agentInfo.get(ev.id) || { started: now, since: now };
  if (ev.state === 'bye') return finishAgent(ev.id);
  if (a.finished) Object.assign(a, { started: now, finished: false }); // back for another run
  if (a.state !== ev.state) a.since = now;
  Object.assign(a, { state: ev.state, name: ev.name || a.name || ev.id, provider: ev.provider || a.provider || '', critter: ev.critter || a.critter });
  if (ev.pids) a.pids = ev.pids; // where "Take me there" goes
  if (ev.url) a.url = ev.url;
  if (ev.text) a.text = ev.text;
  agentInfo.set(ev.id, a);
}

// Settings > Send test event came back through the topic: its pet shows up on the screen you're using (the one with
// Settings), says hello in its balloon, then finishes and leaves; it isn't kept on the finished list
const testPets = new Set();
const testTimers = [];
function cloudTestPet(ev) {
  testTimers.splice(0).forEach(clearTimeout); // a second click starts it over
  testPets.add(ev.id);
  const o = focusOverlay();
  if (o && !owner.has(ev.id)) owner.set(ev.id, o.key);
  onAgentEvent(ev);
  const where = () => byKey(owner.get(ev.id)) || home();
  testTimers.push(
    setTimeout(() => sendTo(where(), 'focus-pet', ev.id), 1500),
    setTimeout(() => onAgentEvent({ ...ev, state: 'done', text: 'Cloud test finished: cloud agents can reach your pets.' }), 10000),
    setTimeout(() => onAgentEvent({ id: ev.id, state: 'bye' }), 15000)
  );
}

// the agent's session ended, or its pet left the screen: it goes on the finished list
function finishAgent(id) {
  const a = agentInfo.get(id);
  lastOnScreen.delete(id);
  if (!a || a.finished) return;
  a.finished = true;
  if (testPets.delete(id)) return sendList(); // Send test event's pet
  const result = a.state === 'done' || a.state === 'error' ? a.state : 'left';
  history.add({ id, name: a.name, provider: a.provider, critter: a.critter, result, text: a.text || '', started: a.started, ended: Date.now() });
  sendList();
}

const screenName = (o, i) => (o.displays.length > 1 ? `${o.home ? 'main' : 'other'} screen ${i + 1}` : o.home ? 'main screen' : 'other screen');

ipcMain.on('pets-report', (e, pets) => {
  const o = bySender(e.sender);
  if (!o || !Array.isArray(pets)) return;
  const now = Date.now();
  reports.set(o.key, { at: now, pets: pets.map((p) => ({ ...p, screen: screenName(o, p.monitor) })) });
  for (const p of pets) if (p.agent) lastOnScreen.set(p.id, now);
  // gone from every overlay for a while (a walk to the next monitor takes a moment): it left
  for (const [id, at] of lastOnScreen) if (now - at > 6000) finishAgent(id);
  sendList();
});

function listData() {
  const now = Date.now();
  const pets = [];
  for (const [key, r] of reports) if (now - r.at < 8000 && byKey(key)) pets.push(...r.pets);
  return {
    now,
    agents: pets.filter((p) => p.agent).map((p) => ({ ...p, subagents: subagents.list(p.id), ...(agentInfo.get(p.id) ? { since: agentInfo.get(p.id).since, started: agentInfo.get(p.id).started } : {}) })),
    critters: pets.filter((p) => !p.agent),
    finished: history.list(),
  };
}

function sendList() {
  if (listWin && !listWin.isDestroyed()) listWin.webContents.send('list:update', listData());
}

function openList() {
  if (listWin && !listWin.isDestroyed()) return listWin.focus();
  listWin = new BrowserWindow({
    width: 620,
    height: 640,
    title: 'floof pet list',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'list', 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  listWin.loadFile(path.join(__dirname, 'list', 'index.html'));
}

ipcMain.handle('list:get', () => listData());
ipcMain.handle('list:clear', () => {
  history.clear();
  sendList();
});
// one row of the finished list
ipcMain.handle('list:forget', (_e, { id, ended }) => {
  history.remove(id, ended);
  sendList();
});
// a pet's × in the list: a free critter is sent away (its kind stays away), an agent's pet is dismissed
ipcMain.handle('list:remove', (_e, id) => send('remove-pet', id));
ipcMain.handle('list:remove-critters', () => removeAllCritters());

// every free critter leaves, and none come back when floof starts (until you tick free critters again)
function removeAllCritters() {
  send('remove-critters');
  if (settings.get().wildCritters) settings.update({ wildCritters: false });
}
ipcMain.on('send-away', (_e, kind) => {
  const away = settings.get().sentAway || [];
  if (typeof kind === 'string' && !away.includes(kind)) settings.update({ sentAway: [...away, kind] });
});
// your own letter for one agent's cap or shirt ('' = back to the usual one)
ipcMain.handle('list:badge', (_e, { id, badge }) => {
  const list = settings.get().badges.filter((b) => b.id !== id);
  const letter = String(badge || '').trim().slice(0, 2);
  if (letter) list.push({ id, badge: letter });
  settings.update({ badges: list });
});
ipcMain.handle('list:control',(_e, { id, kind, text }) => addControl(id, kind, text));
// make a pet hop and flash so you can spot it
ipcMain.handle('list:find', (_e, id) => send('find-pet', id));
// answer a pet's question from the list
ipcMain.handle('list:answer', (_e, { id, text }) => {
  if (!id || typeof text !== 'string' || !text.trim()) return;
  answers.push(answerTarget(id), text.trim());
  relay.sendAnswer(answerTarget(id), text.trim());
  send('answered', { id, text: text.trim() });
});

function notifyIfNeeded(ev) {
  if ('tour' in ev) return; // no Windows notifications for the tour
  const prev = lastSeen.get(ev.id) || {};
  if (ev.state === 'bye') return lastSeen.delete(ev.id);
  lastSeen.set(ev.id, { state: ev.state, text: ev.text });
  const isNew = prev.state !== ev.state || (ev.text && prev.text !== ev.text);
  if (!isNew || !Notification.isSupported()) return;
  const n = settings.get().notify;
  const who = ev.name || ev.id;
  let title = null;
  if (ev.state === 'question' && n.questions) title = `${who} needs you`;
  else if (ev.state === 'done' && n.done && prev.state !== 'done') title = `${who} is done`;
  else if (ev.state === 'error' && n.errors && prev.state !== 'error') title = `${who} hit a problem`;
  if (!title) return;
  const note = new Notification({ title, body: ev.text || '', icon: path.join(__dirname, 'assets', 'icon.png'), silent: ev.state === 'done' });
  note.on('click', () => sendTo(byKey(owner.get(ev.id)) || home(), 'focus-pet', ev.id));
  note.show();
}

function restartBridge() {
  if (bridge) bridge.close();
  bridge = startBridge({ port: settings.get().port, answers, onEvent: onAgentEvent, onClaudeHook, takeControl, addControl, log });
}

// ---------- messages and Stop from a pet's balloon (or the pet list) ----------

// agent id -> {messages: [...], stop: bool, claude: bool}, waiting for the agent to pick them up
const controls = new Map();
const controlOf = (id) => controls.get(id) || controls.set(id, { messages: [], stop: false }).get(id);
// tell the overlays (the balloon) and the list how it's going
const controlStatus = (id, status) => send('control-status', { id, ...status });

function addControl(id, kind, text) {
  if (!id || !['message', 'stop'].includes(kind)) return;
  const msg = kind === 'message' ? String(text || '').trim().slice(0, 4000) : '';
  if (kind === 'message' && !msg) return;
  // cloud agents get it on their answers topic straight away
  if (relay.has(id)) {
    relay.sendControl(id, kind, msg).then((ok) => controlStatus(id, { [kind]: ok ? 'sent' : 'failed' }));
    return;
  }
  const c = controlOf(id);
  if (kind === 'stop') c.stop = true;
  else c.messages.push(msg);
  controlStatus(id, { [kind]: 'queued' });
}
// "Take me there": bring a local agent's window to the front, or open a cloud agent's page
function goTo(id) {
  const a = agentInfo.get(id);
  if (!a) return Promise.resolve({ ok: false, why: "floof doesn't know where this agent is" });
  if (a.pids && a.pids.length) {
    return new Promise((resolve) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'src', 'focus.ps1'), '-Pids', a.pids.join(',')],
        { windowsHide: true, timeout: 8000 },
        (err, stdout) => {
          const out = String(stdout || '').trim();
          if (out.startsWith('ok ')) return resolve({ ok: true, how: `window of ${out.split(' ')[2] || 'the agent'}` });
          if (a.url) return shell.openExternal(a.url).then(() => resolve({ ok: true, how: 'page' }));
          resolve({ ok: false, why: err ? err.message : "its window isn't open any more" });
        }
      );
    });
  }
  if (a.url && /^https?:\/\//i.test(a.url)) return shell.openExternal(a.url).then(() => ({ ok: true, how: 'page' }));
  return Promise.resolve({ ok: false, why: "floof doesn't know where this agent is" });
}
ipcMain.handle('go-to', (_e, id) => goTo(id));
ipcMain.handle('list:go-to', (_e, id) => goTo(id));

ipcMain.on('agent-control',(_e, { id, kind, text }) => addControl(id, kind, text));

// GET /control/<id>: agents that poll for messages and Stop (floof-run, your own scripts)
function takeControl(id) {
  const c = controls.get(id);
  if (!c) return { messages: [], stop: false };
  controls.delete(id);
  if (c.messages.length) controlStatus(id, { message: 'delivered' });
  if (c.stop) controlStatus(id, { stop: 'delivered' });
  return { messages: c.messages, stop: c.stop };
}

// A Claude Code hook call: show it on the pet, and hand over whatever is waiting for that session.
// Stop: {"continue": false} on its next step. A message: "additionalContext" on its next step, or,
// once it has finished, a "block" on its Stop hook so it carries on with your message.
function onClaudeHook(raw, { pids = [] } = {}) {
  const ev = claudeCodeEvent(raw);
  const id = `claude-${(raw && raw.session_id) || 'session'}`;
  if (ev && ev.parent) onAgentEvent(normalizeEvent(ev)); // a subagent's mini
  // a new prompt starts a turn (the last one's subagents go); idle after compacting mid-turn doesn't
  else if (ev) onAgentEvent(normalizeEvent({ ...ev, pids, controls: settings.get().claudeSteps ? ['message', 'stop'] : ['message'] }), { newTurn: !!ev.newTurn, marksTurns: true });
  const hook = raw && raw.hook_event_name;
  const c = controls.get(id);
  if (!c) return null;
  if (hook === 'SessionEnd') {
    controls.delete(id);
    return null;
  }
  const running = ['PreToolUse', 'PostToolUse', 'UserPromptSubmit'].includes(hook);
  if (c.stop && running) {
    c.stop = false;
    c.messages = [];
    controlStatus(id, { stop: 'delivered' });
    return { continue: false, stopReason: 'Stopped from floof.' };
  }
  if (c.stop && hook === 'Stop') {
    c.stop = false; // it finished anyway
    controlStatus(id, { stop: 'delivered' });
  }
  if (c.messages.length && (running || hook === 'Stop')) {
    const text = `Message from the user, sent from floof: ${c.messages.splice(0).join('\n\n')}`.slice(0, 9500);
    controlStatus(id, { message: 'delivered' });
    if (hook === 'Stop') return { decision: 'block', reason: text };
    return { hookSpecificOutput: { hookEventName: hook, additionalContext: text } };
  }
  return null;
}

// window rectangles arrive in physical pixels; each overlay gets them in its own coordinates
function toOverlay(o, w) {
  const r =
    process.platform === 'win32' && !env('FAKE_DISPLAYS')
      ? screen.screenToDipRect(null, { x: w.x, y: w.y, width: w.w, height: w.h })
      : { x: w.x / o.scaleFactor, y: w.y / o.scaleFactor, width: w.w / o.scaleFactor, height: w.h / o.scaleFactor };
  return { id: String(w.id), x: r.x - o.origin.x, y: r.y - o.origin.y, w: r.width, h: r.height, fg: w.fg, app: w.app || '', title: w.title || '' };
}

function sendWindows() {
  for (const o of overlays) sendTo(o, 'windows', lastRawWindows.map((w) => toOverlay(o, w)));
}

// Keys held, cursor and caret: with "Hold keys to interact" on, pets keep out of your way
// unless the key combination is held.
function sendInput(i) {
  const combo = settings.get().interactKeys.split('+').filter(Boolean);
  const held = combo.length > 0 && combo.every((k) => i.keys.includes(k));
  for (const o of overlays) {
    const c = toOverlay(o, { id: 0, x: i.cursor[0], y: i.cursor[1], w: 1, h: 1 });
    const caret = i.caret ? toOverlay(o, { id: 0, x: i.caret[0], y: i.caret[1], w: i.caret[2], h: i.caret[3] }) : null;
    sendTo(o, 'input', { held, cursor: { x: c.x, y: c.y }, caret: caret && { x: caret.x, y: caret.y, w: caret.w, h: caret.h } });
  }
}

function restartWatcher() {
  if (watcher) watcher.stop();
  watcher = null;
  lastRawWindows = [];
  sendWindows();
  const { walkOnWindows, interactKeys } = settings.get();
  if (!walkOnWindows && !interactKeys) return;
  watcher = startWindowWatcher({
    onWindows: (list) => {
      lastRawWindows = list;
      sendWindows();
    },
    onInput: sendInput,
    input: !!interactKeys,
    log,
  });
}

// ---------- Claude Code hooks ----------

// "Connect Claude Code" in Settings adds floof's hook (tools/claude-code-hook.exe) to the user's
// Claude Code settings, keeping everything else there and a backup next to it.
const CLAUDE_SETTINGS = env('CLAUDE_SETTINGS') || path.join(require('os').homedir(), '.claude', 'settings.json'); // the env var is for the tests
const HOOK_EXE = path.join(__dirname, 'tools', 'claude-code-hook.exe');

function readClaudeSettings() {
  try {
    return JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw new Error(`${CLAUDE_SETTINGS} isn't valid JSON, so floof leaves it alone (${err.message})`);
  }
}

function claudeStatus() {
  if (RENDER_DOCS) return { file: 'C:\\Users\\you\\.claude\\settings.json', exe: true, connected: false, steps: false }; // README pictures don't show your path or hooks
  const status = { file: CLAUDE_SETTINGS, exe: fs.existsSync(HOOK_EXE), connected: false, steps: false };
  try {
    const hooks = readClaudeSettings().hooks || {};
    const has = (ev) => Array.isArray(hooks[ev]) && hooks[ev].some(isFloofHook);
    status.connected = HOOK_EVENTS.some(has);
    status.steps = has('PreToolUse');
  } catch (err) {
    status.error = err.message;
  }
  return status;
}

// connect: floof's hooks on or off; steps: include PreToolUse (each tool call shows in the balloon)
function setClaudeHooks({ connect, steps }) {
  try {
    if (connect && !fs.existsSync(HOOK_EXE)) throw new Error('tools/claude-code-hook.exe is missing; build it with tools/build-hook.ps1');
    const s = readClaudeSettings();
    // the backup from before floof's first change
    const backup = `${CLAUDE_SETTINGS}.bak-floof`;
    if (fs.existsSync(CLAUDE_SETTINGS) && !fs.existsSync(backup)) fs.copyFileSync(CLAUDE_SETTINGS, backup);
    const hooks = s.hooks && typeof s.hooks === 'object' ? s.hooks : {};
    const command = `"${HOOK_EXE.replace(/\\/g, '/')}"`;
    for (const ev of HOOK_EVENTS) {
      const list = (Array.isArray(hooks[ev]) ? hooks[ev] : []).filter((e) => !isFloofHook(e));
      if (connect && (ev !== 'PreToolUse' || steps)) list.push({ hooks: [{ type: 'command', command }] });
      if (list.length) hooks[ev] = list;
      else delete hooks[ev];
    }
    if (Object.keys(hooks).length) s.hooks = hooks;
    else delete s.hooks;
    fs.mkdirSync(path.dirname(CLAUDE_SETTINGS), { recursive: true });
    fs.writeFileSync(CLAUDE_SETTINGS, `${JSON.stringify(s, null, 2)}\n`);
    log(`Claude Code hooks ${connect ? `connected${steps ? ' with each step' : ''}` : 'disconnected'} in ${CLAUDE_SETTINGS}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// connected by an older floof: add the hooks it didn't have yet (subagents), at start, so they just work
function upgradeClaudeHooks() {
  try {
    const s = readClaudeSettings();
    const hooks = upgradeHooks(s.hooks);
    if (!hooks) return;
    fs.writeFileSync(CLAUDE_SETTINGS, `${JSON.stringify({ ...s, hooks }, null, 2)}\n`);
    log(`added the new Claude Code hooks (subagents) in ${CLAUDE_SETTINGS}`);
  } catch (err) {
    log(`couldn't update the Claude Code hooks: ${err.message}`);
  }
}

ipcMain.handle('claude:status', () => claudeStatus());
ipcMain.handle('claude:set', (_e, opts) => setClaudeHooks(opts || {}));

// ---------- settings window ----------

// boxId: open at that pet box's settings (the ⚙ on a box). Menu and tray clicks pass other things.
function openSettings(boxId) {
  const box = typeof boxId === 'string' ? boxId : null;
  if (settingsWin && !settingsWin.isDestroyed()) {
    if (box) settingsWin.webContents.send('settings:focus-box', box);
    return settingsWin.focus();
  }
  settingsWin = new BrowserWindow({
    width: 1040,
    height: 760,
    minWidth: 520,
    title: 'floof settings',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'settings', 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  settingsWin.loadFile(path.join(__dirname, 'settings', 'index.html'));
  if (box) settingsWin.webContents.once('did-finish-load', () => setTimeout(() => settingsWin.webContents.send('settings:focus-box', box), 300));
}

ipcMain.handle('settings:get', () => ({ settings: settings.get(), version: app.getVersion() }));
// ticking free critters again brings back the whole flock, including kinds you sent away
ipcMain.handle('settings:update', (_e, patch) => settings.update(patch && patch.wildCritters === true ? { ...patch, sentAway: [] } : patch));
ipcMain.handle('relay:new-topic', () => settings.newRelayTopic());
ipcMain.handle('relay:status', () => relay.getStatus());
ipcMain.handle('relay:test', () => relay.test());
// "Pick an open window": the windows open right now, app and title
ipcMain.handle('settings:open-windows', () =>
  lastRawWindows
    .filter((w) => w.app && w.title && !/^(explorer|ApplicationFrameHost|TextInputHost|SystemSettings|floof)$/i.test(w.app))
    .map((w) => ({ app: w.app, title: w.title }))
);
ipcMain.handle('settings:open-apps', () =>
  [...new Set(lastRawWindows.map((w) => w.app).filter((a) => a && !/^(explorer|ApplicationFrameHost|TextInputHost|SystemSettings)$/i.test(a)))].sort((a, b) => a.localeCompare(b))
);
ipcMain.handle('packs:list', () => packs.list().map(({ name, folder, own, sheetUrl }) => ({ name, folder, own, sheetUrl })));
ipcMain.handle('packs:remove', (_e, folder) => {
  packs.remove(folder);
  send('reload-packs');
});
ipcMain.handle('packs:import-folder', async () => {
  const r = await dialog.showOpenDialog(settingsWin, { title: 'Choose a sprite pack folder (with sprite.json)', properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return { ok: false };
  try {
    const folder = packs.importFolder(r.filePaths[0]);
    send('reload-packs');
    return { ok: true, folder };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
ipcMain.handle('packs:import-strip', async (_e, { frames, name }) => {
  const r = await dialog.showOpenDialog(settingsWin, { title: 'Choose a PNG strip', properties: ['openFile'], filters: [{ name: 'PNG', extensions: ['png'] }] });
  if (r.canceled || !r.filePaths[0]) return { ok: false };
  try {
    const folder = packs.importStrip(r.filePaths[0], frames, name);
    send('reload-packs');
    return { ok: true, folder };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
ipcMain.handle('open-sprites-folder', () => {
  fs.mkdirSync(packs.userDir, { recursive: true });
  shell.openPath(packs.userDir);
});
ipcMain.handle('test-event', (_e, state) => {
  const texts = { working: 'Testing, testing', question: 'Is this a good test question?', done: 'Test finished', error: 'Pretend something broke' };
  onAgentEvent({ id: 'settings-test', name: 'test-agent', provider: 'floof', state, text: texts[state] || state });
});

function applySettings(next, before) {
  send('settings', next);
  cleanPictures();
  if (!before || before.port !== next.port) restartBridge();
  if (before && JSON.stringify(before.screens) !== JSON.stringify(next.screens)) relayout();
  else if (!before || before.walkOnWindows !== next.walkOnWindows || !before.interactKeys !== !next.interactKeys) restartWatcher();
  relay.configure(next.relay);
  if (app.isPackaged && (!before || before.startAtLogin !== next.startAtLogin)) {
    app.setLoginItemSettings({ openAtLogin: next.startAtLogin });
  }
}

// ---------- tray ----------

function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png')));
  tray.setToolTip('floof');
  const spawn = (kind) => () => {
    sendTo(home(), 'spawn', kind);
    const away = settings.get().sentAway || [];
    if (away.includes(kind)) settings.update({ sentAway: away.filter((k) => k !== kind) }); // welcome back
  };
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Add a critter', submenu: BUILTIN_CRITTERS.map((k) => ({ label: k, click: spawn(k) })) },
      { label: 'Remove all free critters', click: removeAllCritters },
      { label: 'Show me around', click: () => startTour() },
      { label: 'Pet list…', click: openList },
      { label: 'Add a pet box', click: addBox },
      { label: 'Run demo agents',click: () => runDemo({ emit: onAgentEvent, answers }) },
      { label: 'Settings…', click: openSettings },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ])
  );
  tray.on('double-click', openSettings);
}

// for the tests, which have no Windows window watcher
module.exports = {
  setWindowsForTest(list) {
    lastRawWindows = list;
    sendWindows();
  },
};

// ---------- README pictures (--render-docs=<folder>) ----------

// Draws docs/gallery.html's sheets and the real pet list and Settings windows, each offscreen at the screen's scaling,
// into PNGs. No overlay, tray, bridge or window watcher: nothing appears on screen, and the pet
// list shows made-up agents, not yours.
async function renderDocs(outDir) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  fs.mkdirSync(outDir, { recursive: true });
  const offscreen = (w, h, preload) =>
    new BrowserWindow({
      show: false,
      width: w,
      height: h,
      transparent: true,
      frame: false,
      webPreferences: { offscreen: true, preload, contextIsolation: true, nodeIntegration: false },
    });
  const shoot = async (win, file, w, h) => {
    const img = await win.webContents.capturePage({ x: 0, y: 0, width: Math.ceil(w), height: Math.ceil(h) }); // at the screen's scaling (175% here)
    fs.writeFileSync(path.join(outDir, file), img.toPNG());
    log(`docs picture ${file} (${img.getSize().width}x${img.getSize().height})`);
  };
  try {
    // 1. the sheets drawn with floof's own critters and styles
    const g = offscreen(1100, 700);
    await g.loadFile(path.join(__dirname, 'docs', 'gallery.html'));
    g.webContents.setZoomFactor(1); // Chromium remembers a page's zoom; start from 1
    for (const id of ['logo', 'critters', 'states', 'outfits', 'plungers', 'question', 'curtain', 'box']) {
      const size = await g.webContents.executeJavaScript(`showSheet(${JSON.stringify(id)})`);
      await wait(1300); // let the curtain finish opening
      await shoot(g, `${id}.png`, size.width, size.height);
    }
    g.destroy();

    // 2. the pet list, with made-up agents
    overlays = [{ key: 'docs', home: true, displays: [], exits: {} }];
    const now = Date.now();
    const sample = [
      { id: 'a1', kind: 'cat', name: 'refactor-api', provider: 'claude-code', state: 'question', mode: 'wave', text: 'Should I also update the tests?', asking: true, controls: ['message', 'stop'], canGo: true },
      { id: 'a2', kind: 'llama', name: 'docs-writer', provider: 'ollama', model: 'qwen2.5-coder:7b', state: 'working', mode: 'work', text: 'Writing the API reference', controls: [], canGo: true },
      { id: 'a3', kind: 'dog', name: 'fix-login-bug', provider: 'codex', state: 'working', mode: 'walk', text: 'Running the test suite', controls: ['stop'], canGo: true },
      { id: 'a4', kind: 'bird', name: 'translate', provider: 'gemini', state: 'idle', mode: 'sleep', text: 'Waiting for the next batch' },
    ].map((p) => ({ ...p, agent: true, screen: 'main screen' }));
    const critters = [
      { id: 'w1', kind: 'sheep', agent: false, mode: 'sleep', screen: 'main screen' },
      { id: 'w2', kind: 'cat', agent: false, mode: 'walk', screen: 'laptop' },
    ];
    reports.set('docs', { at: now + 3600e3, pets: [...sample, ...critters] });
    sample.forEach((p, i) => agentInfo.set(p.id, { state: p.state, since: now - (i + 1) * 97e3, started: now - (i + 2) * 600e3 }));
    history.add({ id: 'h1', name: 'release-notes', provider: 'claude-code', critter: 'sheep', result: 'done', text: 'Release notes written, 3 files changed', started: now - 3600e3, ended: now - 1800e3 });
    history.add({ id: 'h2', name: 'flaky-test', provider: 'codex', critter: 'dog', result: 'error', text: 'Gave up: the test needs a database', started: now - 900e3, ended: now - 600e3 });
    const list = offscreen(620, 760, path.join(__dirname, 'list', 'preload.js'));
    await list.loadFile(path.join(__dirname, 'list', 'index.html'));
    list.webContents.setZoomFactor(1);
    await wait(1500);
    await shoot(list, 'pet-list.png', 620, 760);
    list.destroy();

    // 3. the Settings window (fresh settings: no topic, paths or apps of yours)
    const s = offscreen(1040, 760, path.join(__dirname, 'settings', 'preload.js'));
    await s.loadFile(path.join(__dirname, 'settings', 'index.html'));
    s.webContents.setZoomFactor(1);
    await wait(1500);
    await shoot(s, 'settings.png', 1040, 760);
    s.destroy();
  } catch (err) {
    log(`docs pictures failed: ${err.stack || err.message}`);
  }
  app.exit(0);
}

// ---------- app lifecycle ----------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => openSettings());
  app.whenReady().then(() => {
    if (process.platform === 'win32') app.setAppUserModelId('com.floof.app');
    settings = new Settings(app.getPath('userData'));
    history = new History(app.getPath('userData'));
    upgradeClaudeHooks();
    // "Let pets roam across all my monitors" off (up to 0.15) becomes "only the main screen"
    if (settings.get().allMonitors === false && !settings.get().screens.length) {
      const all = allDisplays();
      const primary = primaryDisplayInfo();
      settings.update({ screens: [describeScreen(primary, all.findIndex((d) => d.id === primary.id))], allMonitors: true });
    }
    packs = new SpritePacks({ builtinDir: path.join(__dirname, 'sprites'), userDir: path.join(app.getPath('userData'), 'sprites'), log });
    if (RENDER_DOCS) return renderDocs(RENDER_DOCS);
    if (env('TEST_CLAUDE_HOOKS')) {
      // for the tests: connect / steps / disconnect the hooks in FLOOF_CLAUDE_SETTINGS, then report
      const [connect, steps] = { connect: [true, true], nosteps: [true, false], disconnect: [false, false] }[env('TEST_CLAUDE_HOOKS')] || [];
      log(`claude hooks test: ${JSON.stringify(setClaudeHooks({ connect, steps }))} ${JSON.stringify(claudeStatus())}`);
    }
    relayout();
    for (const ev of ['display-metrics-changed', 'display-added', 'display-removed']) screen.on(ev, () => setTimeout(relayout, 300));
    createTray();
    home().win.webContents.once('did-finish-load', () => {
      applySettings(settings.get(), null);
      if (process.argv.includes('--demo')) setTimeout(() => runDemo({ emit: onAgentEvent, answers }), 1500);
      if (BENCH) setTimeout(startBench, 3000);
      if (process.argv.includes('--open-list')) openList();
      // the first time floof runs (or --tour), the guide sheep shows you around
      if (process.argv.includes('--tour') || (!settings.get().tourDone && !process.argv.includes('--demo'))) setTimeout(startTour, 2500);
    });
    settings.on('change', applySettings);
  });
  app.on('window-all-closed', () => {}); // keep running in the tray when settings closes
  app.on('before-quit', () => {
    if (watcher) watcher.stop();
    relay.stop();
  });
}
