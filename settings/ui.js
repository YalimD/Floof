// floof settings window
const api = window.floofSettings;
const $ = (id) => document.getElementById(id);
let current = null;

const get = (obj, key) => key.split('.').reduce((o, k) => o[k], obj);
function patchFor(key, value) {
  const parts = key.split('.');
  const patch = {};
  let o = patch;
  parts.forEach((k, i) => (o = o[k] = i === parts.length - 1 ? value : {}));
  return patch;
}

function render() {
  for (const el of document.querySelectorAll('input[id]')) {
    if (['frames', 'packName', 'newApp', 'newHomeApp'].includes(el.id) || el.dataset.app || el.dataset.custom) continue;
    const v = get(current, el.id);
    if (el.type === 'checkbox') el.checked = !!v;
    else if (document.activeElement !== el) el.value = v;
  }
  $('providerWear').value = current.providerWear;
  $('interactOn').checked = !!current.interactKeys;
  if (current.interactKeys) $('interactCombo').value = current.interactKeys;
  $('interactCombo').disabled = !current.interactKeys;
  for (const r of document.querySelectorAll('input[name="roam"]')) r.checked = r.value === current.roam;
  $('homeAppsPart').style.display = current.roam === 'apps' ? '' : 'none';
  $('boxesPart').style.display = current.roam === 'boxes' ? '' : 'none';
  const n = current.boxes.length;
  renderBoxList();
  $('boxCount').textContent =n ? `${n} box${n === 1 ? '' : 'es'} on screen. Drag a box by its title bar, resize it from the corner, × removes it.` : 'No boxes yet.';
  $('localUrl').textContent = `http://127.0.0.1:${current.port}/event`;
  const base = relayBase();
  $('relayUrl').textContent = `Send events to:   ${base}\nRead answers at:  ${base}-answers/json?poll=1`;
  $('relayHook').textContent = hookCommand();
}

const relayBase = () => `${current.relay.server.replace(/\/+$/, '')}/${current.relay.topic}`;
// a cloud Claude Code session's hook: pipe the hook's input to the topic as is, and never hold Claude up
const hookCommand = () => `curl -s -m 5 --data-binary @- ${relayBase()} > /dev/null || true`;

const RELAY_STATES = { off: 'Off', connecting: 'Connecting…', connected: 'Connected', reconnecting: 'Reconnecting…', error: 'Not connected' };
function renderRelayStatus(s) {
  $('relayState').textContent = RELAY_STATES[s.state] || s.state;
  $('relayState').className = s.state === 'connected' ? 'ok' : s.state === 'error' ? 'bad' : '';
  const last = s.lastEvent ? `last event ${new Date(s.lastEvent).toLocaleTimeString()}` : '';
  $('relayWhy').textContent = [s.reason, s.state === 'connected' ? last : ''].filter(Boolean).join(' · ');
  $('testRelay').disabled = s.state === 'off';
  // the last message floof couldn't read, usually a curl line whose quotes the shell ate
  const bad = s.ignored;
  $('relayIgnored').style.display = bad ? '' : 'none';
  if (bad) {
    const hint = /^'/.test(bad.body) ? " Windows' cmd keeps single quotes and drops double ones: see the README for cmd and PowerShell versions." : '';
    $('relayIgnored').textContent = `⚠ At ${new Date(bad.at).toLocaleTimeString()} a message couldn't be read: ${bad.body}${hint}`;
  }
}

async function save(key, value) {
  current = await api.update(patchFor(key, value));
  render();
}

// Window rules (windows pets keep off, windows pets live on): an app, and optionally text its
// title contains. The list shows your rules, plus the apps open right now so you can tick them.
const appKey = (a) => String(a).toLowerCase().replace(/\.exe$/, '');
const ruleKey = (r) => `${appKey(r.app)}|${String(r.title || '').toLowerCase()}`;

function ruleRow(key, rule, on) {
  const li = document.createElement('li');
  const label = document.createElement('label');
  label.className = 'check';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.dataset.app = rule.app;
  box.checked = on;
  box.addEventListener('change', () => setRule(key, rule, box.checked));
  label.append(box, ` ${rule.app}`);
  li.append(label);
  if (rule.title) {
    // only its windows whose title has this text; edit it in place, × removes the rule
    const title = document.createElement('input');
    title.className = 'title';
    title.value = rule.title;
    title.title = 'Title contains';
    title.addEventListener('change', () => editRule(key, rule, title.value.trim()));
    const del = document.createElement('button');
    del.className = 'link';
    del.type = 'button';
    del.textContent = '×';
    del.title = 'Remove this rule';
    del.addEventListener('click', () => setRule(key, rule, false));
    li.append(' title has ', title, del);
  }
  return li;
}

async function renderAppList(key, listId) {
  const open = await api.openApps();
  const rules = current[key];
  const rows = rules.map((r) => ruleRow(key, r, true));
  for (const a of open) if (!rules.some((r) => !r.title && appKey(r.app) === appKey(a))) rows.push(ruleRow(key, { app: a, title: '' }, false));
  $(listId).replaceChildren(...rows);
}

// "Pick an open window": fills in a rule for that app with (part of) its title
async function renderPicker(key, id) {
  const wins = await api.openWindows();
  const el = $(id);
  el.innerHTML =
    '<select><option value="">Pick an open window…</option></select> <label class="inline">title has <input class="title" /></label> <button type="button">Add</button>';
  const [select, title, add] = [el.querySelector('select'), el.querySelector('input'), el.querySelector('button')];
  wins.forEach((w, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = `${w.app}: ${w.title.length > 60 ? `${w.title.slice(0, 59)}…` : w.title}`;
    select.append(o);
  });
  select.addEventListener('change', () => (title.value = select.value ? wins[Number(select.value)].title : ''));
  add.addEventListener('click', () => {
    if (!select.value) return;
    setRule(key, { app: wins[Number(select.value)].app, title: title.value.trim() }, true);
  });
}

function renderApps() {
  renderAppList('keepOff', 'apps');
  renderAppList('homeApps', 'homeApps');
  renderPicker('keepOff', 'keepOffPicker');
  renderPicker('homeApps', 'homePicker');
}
async function setRule(key, rule, on) {
  const list = current[key].filter((r) => ruleKey(r) !== ruleKey(rule));
  if (on) list.push(rule);
  current = await api.update({ [key]: list });
  render();
  renderApps();
}
async function editRule(key, rule, title) {
  current = await api.update({ [key]: current[key].map((r) => (ruleKey(r) === ruleKey(rule) ? { ...r, title } : r)) });
  render();
  renderApps();
}
function addTyped(inputId, key) {
  const name = $(inputId).value.trim();
  if (!name) return;
  $(inputId).value = '';
  setRule(key, { app: name, title: '' }, true);
}
$('addApp').addEventListener('click', () => addTyped('newApp', 'keepOff'));
$('addHomeApp').addEventListener('click', () => addTyped('newHomeApp', 'homeApps'));

// Screens pets can use: a box per connected screen (all ticked = all of them)
async function renderScreens(note) {
  const list = await api.listScreens();
  $('screens').replaceChildren(
    ...list.map((s) => {
      const li = document.createElement('li');
      const label = document.createElement('label');
      label.className = 'check';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = s.on;
      box.dataset.screen = s.id;
      box.addEventListener('change', () => setScreens(list));
      const where = s.where === 'main' ? 'main screen' : s.where;
      label.append(box, ` ${s.number}. ${s.label}, ${s.w}×${s.h}, ${s.scale}%, ${where}`);
      li.append(label);
      return li;
    })
  );
  $('screensNote').textContent = note || '';
}
async function setScreens(list) {
  const ticked = list.filter((s) => document.querySelector(`input[data-screen="${CSS.escape(s.id)}"]`).checked);
  if (!ticked.length) return renderScreens('Pets need at least one screen.');
  const screens = ticked.length === list.length ? [] : ticked.map(({ id, label, w, h }) => ({ id, label, w, h }));
  current = await api.update({ screens });
  render();
  renderScreens();
}
$('identify').addEventListener('click', () => api.identifyScreens());

// keys to hold to click or drag pets ('' = pets are always clickable)
$('interactOn').addEventListener('change', () => save('interactKeys', $('interactOn').checked ? $('interactCombo').value : ''));
$('interactCombo').addEventListener('change', () => $('interactOn').checked && save('interactKeys', $('interactCombo').value));

// Claude Code: connect floof's hooks, with or without each step
async function renderClaude(message) {
  const s = await api.claudeStatus();
  $('claudeFile').textContent = s.file;
  $('claudeSteps').checked = !!current.claudeSteps;
  $('claudeConnect').textContent = s.connected ? 'Disconnect Claude Code' : 'Connect Claude Code';
  let state = s.connected ? `Connected${s.steps ? ', showing each step' : ''}.` : 'Not connected.';
  if (!s.exe) state = 'The hook program tools/claude-code-hook.exe is missing; build it with tools/build-hook.ps1.';
  if (s.error) state = s.error;
  $('claudeState').textContent = message || state;
}
$('claudeConnect').addEventListener('click', async () => {
  const s = await api.claudeStatus();
  const r = await api.claudeSet({ connect: !s.connected, steps: !!current.claudeSteps });
  renderClaude(r.ok ? null : `Couldn't change it: ${r.error}`);
});
$('claudeSteps').addEventListener('change', async () => {
  await save('claudeSteps', $('claudeSteps').checked);
  const s = await api.claudeStatus();
  const r = s.connected ? await api.claudeSet({ connect: true, steps: !!current.claudeSteps }) : { ok: true };
  renderClaude(r.ok ? null : `Couldn't change it: ${r.error}`);
});

// pet boxes: background (none, a colour or a picture) and shelf colour, per box and for new boxes
function boxControls(id, title, spec, removable) {
  const row = document.createElement('div');
  row.className = 'boxrow';
  row.dataset.id = id;
  const bg = spec.bg;
  const pictureName = bg.picture ? bg.picture.split(/[\\/]/).pop() : 'none chosen';
  row.innerHTML = `
    <h3></h3>
    <div class="line">
      <label class="inline">Background
        <select class="type"><option value="none">None</option><option value="color">Colour</option><option value="picture">Picture</option></select></label>
      <input class="color" type="color" title="Background colour" />
      <span class="pic"><button class="choose" type="button">Choose picture…</button> <span class="muted name"></span>
        <select class="fit"><option value="fill">Fill</option><option value="fit">Fit</option><option value="tile">Tile</option></select></span>
      <label class="inline opac">Opacity <input class="opacity" type="range" min="10" max="100" step="5" /></label>
    </div>
    <div class="line">
      <label class="inline">Shelves <input class="shelf" type="color" title="Shelf colour" /></label>
      <button class="wood link" type="button">Wooden shelves</button>
      <label class="inline"><input class="gravity" type="checkbox" /> Gravity (off: pets float wherever you leave them)</label>
      ${removable ? '<button class="remove link" type="button">Remove this box</button>' : ''}
    </div>`;
  row.querySelector('h3').textContent = title;
  const $r = (sel) => row.querySelector(sel);
  $r('.type').value = bg.type;
  $r('.color').value = bg.color;
  $r('.fit').value = bg.fit;
  $r('.opacity').value = Math.round(bg.opacity * 100);
  $r('.name').textContent = pictureName;
  $r('.shelf').value = spec.shelfColor || '#a8743f';
  $r('.wood').style.display = spec.shelfColor ? '' : 'none';
  $r('.color').style.display = bg.type === 'color' ? '' : 'none';
  $r('.pic').style.display = bg.type === 'picture' ? '' : 'none';
  $r('.opac').style.display = bg.type === 'none' ? 'none' : '';
  const setBg = (patch) => setBox(id, { bg: { ...bg, ...patch } });
  $r('.type').addEventListener('change', () => setBg({ type: $r('.type').value }));
  $r('.color').addEventListener('change', () => setBg({ color: $r('.color').value }));
  $r('.fit').addEventListener('change', () => setBg({ fit: $r('.fit').value }));
  $r('.opacity').addEventListener('change', () => setBg({ opacity: Number($r('.opacity').value) / 100 }));
  $r('.choose').addEventListener('click', async () => {
    current = await api.pickBoxPicture(id);
    render();
  });
  $r('.shelf').addEventListener('change', () => setBox(id, { shelfColor: $r('.shelf').value }));
  $r('.wood').addEventListener('click', () => setBox(id, { shelfColor: '' }));
  $r('.gravity').checked = spec.gravity !== false;
  $r('.gravity').addEventListener('change', () => setBox(id, { gravity: $r('.gravity').checked }));
  if (removable) $r('.remove').addEventListener('click', () => api.update({ boxes: current.boxes.filter((b) => b.id !== id) }).then((s) => ((current = s), render())));
  return row;
}

async function setBox(id, patch) {
  if (id === 'default') current = await api.update({ boxDefaults: { ...current.boxDefaults, ...patch } });
  else current = await api.update({ boxes: current.boxes.map((b) => (b.id === id ? { ...b, ...patch } : b)) });
  render();
}

function renderBoxList() {
  const rows = current.boxes.map((b, i) => boxControls(b.id, `Box ${i + 1} (${Math.round(b.w)}×${Math.round(b.h)}, ${b.shelves.length} shel${b.shelves.length === 1 ? 'f' : 'ves'})`, b, true));
  rows.push(boxControls('default', 'For new boxes', current.boxDefaults, false));
  $('boxList').replaceChildren(...rows);
}

// ⚙ on a box: show its settings
api.onFocusBox((id) => {
  const row = document.querySelector(`.boxrow[data-id="${CSS.escape(id)}"]`);
  if (!row) return;
  row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  row.classList.add('found');
  setTimeout(() => row.classList.remove('found'), 2500);
});

$('startTour').addEventListener('click', () => api.startTour());
$('providerWear').addEventListener('change', () => save('providerWear', $('providerWear').value));

// where pets live
for (const r of document.querySelectorAll('input[name="roam"]')) r.addEventListener('change', () => r.checked && save('roam', r.value));
$('addBox').addEventListener('click', async () => {
  await api.addBox();
  current = (await api.get()).settings;
  render();
});

for (const el of document.querySelectorAll('input[id]')) {
  if (['frames', 'packName', 'newApp', 'newHomeApp'].includes(el.id) || el.dataset.custom) continue;
  el.addEventListener('change', () => {
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (el.type === 'number' || el.type === 'range') v = Number(v);
    save(el.id, v);
  });
}

for (const b of document.querySelectorAll('[data-test]')) b.addEventListener('click', () => api.testEvent(b.dataset.test));

$('copyRelay').addEventListener('click', () => navigator.clipboard.writeText(relayBase())); // just the address, ready for curl
$('copyHook').addEventListener('click', () => navigator.clipboard.writeText(hookCommand()));
$('testRelay').addEventListener('click', async () => {
  $('relayTestNote').textContent = 'Sending…';
  const r = await api.relayTest();
  $('relayTestNote').textContent = r.ok ? '✓ It went to the topic and came back: say hi to the "Cloud test" pet. Cloud agents can reach your pets.' : `✗ ${r.why}`;
});
api.onRelayStatus(renderRelayStatus);
api.relayStatus().then(renderRelayStatus);
$('newTopic').addEventListener('click', async () => {
  current = await api.newRelayTopic();
  render();
});
$('openFolder').addEventListener('click', () => api.openSpritesFolder());

async function renderPacks() {
  const list = await api.listPacks();
  $('packs').replaceChildren(
    ...list.map((p) => {
      const li = document.createElement('li');
      const img = document.createElement('img');
      img.src = p.sheetUrl;
      const name = document.createElement('span');
      name.textContent = p.own ? p.name : `${p.name} (built in)`;
      li.append(img, name);
      if (p.own) {
        const rm = document.createElement('button');
        rm.textContent = '✕';
        rm.title = 'Remove';
        rm.addEventListener('click', async () => {
          await api.removePack(p.folder);
          renderPacks();
        });
        li.append(rm);
      }
      return li;
    })
  );
}

async function afterImport(result) {
  if (result.ok) $('packMsg').textContent = `Added "${result.folder}". It will drop onto your desktop now.`;
  else if (result.error) $('packMsg').textContent = `Couldn't add it: ${result.error}`;
  renderPacks();
}
$('importStrip').addEventListener('click', async () => afterImport(await api.importStrip(Number($('frames').value), $('packName').value)));
$('importFolder').addEventListener('click', async () => afterImport(await api.importFolder()));

(async () => {
  const r = await api.get();
  current = r.settings;
  $('version').textContent = `v${r.version}`;
  render();
  renderPacks();
  renderApps();
  renderClaude();
  renderScreens();
})();
