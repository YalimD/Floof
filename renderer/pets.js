// floof: the pets. One pet per agent, plus a few free-roaming critters.
// Pets walk on the taskbar and on top of open windows and chat when they meet. When an
// agent needs you, a pet you can see asks in its own balloon; one you can't see climbs to
// the corner of your active window and pulls it open like a curtain, or, if that window is
// one pets must keep off, pops up from the taskbar next to the clock to ask.
// This page is one overlay; with monitors at different scaling each has its own overlay,
// and a pet walking off the shared edge carries on in the next one.
(function () {
  const api = window.floof;
  // a script error in the overlay goes to floof's log (with --log-pets), where it can be seen
  window.addEventListener('error', (e) => api.debugReport({ error: String(e.message), at: `${String(e.filename).split('/').pop()}:${e.lineno}` }));
  const stage = document.getElementById('stage');
  const GRAVITY = 1600;
  const SQUISH_SECONDS = 0.35; // a landing's squash and springy wobble back
  const CARD_W = 300;
  const IDLE_LEAVE = 10 * 60; // seconds a finished or quiet agent's pet stays around
  const BADGES = { working: '⚙️', question: '❓', done: '✅', error: '🌧️' };
  const POSE_FALLBACK = {
    drag: 'fall', fall: 'idle', fly: 'walk', chat: 'idle', sad: 'idle',
    celebrate: 'idle', wave: 'idle', work: 'idle', sleep: 'idle', pull: 'wave',
  };
  const SMALL_TALK = ['👋 hi!', '🌿 nice day', '🐾', '🍪?', '😺 meow?', '🐑 baa', '🦴 woof', '🎶'];

  let cfg = { scale: 3, wildCritters: true, walkOnWindows: true, curtain: true, keepOff: [], keepOffFullscreen: true, askTimeout: 5, balloonSeconds: 20, roam: 'everywhere', homeApps: [], boxes: [], idleSleep: true, interactKeys: 'ctrl+alt', providerWear: 'cap' };
  const pets = new Map();
  let packs = {}; // name -> { img, manifest }
  let wildCount = 0;
  let windows = []; // open windows, topmost first: {id, x, y, w, h, fg}
  let windowsById = new Map();
  let lastWindowList = []; // as the window watcher sent it
  let segments = []; // visible top edges of windows pets can stand on: {id, y, x1, x2}
  let zones = []; // windows pets must keep off (apps in the keep-off list, full-screen windows)
  // monitors (their work areas) in overlay coordinates; the overlay spans all of them
  let displays = [{ x: 0, y: 0, w: innerWidth, h: innerHeight, primary: true }];
  let exits = { left: null, right: null }; // sides where another overlay carries on
  let isHome = true; // this overlay has the main monitor: new pets start here
  const departed = new Map(); // pet id -> when it walked over to another overlay
  let overlayKey = null; // which overlay this is, to find the pet boxes that belong here
  let overlayKeys = []; // every overlay's key: boxes on a monitor that's gone show up on the main one
  let offIds = []; // screens you've unticked in Settings: their boxes stay hidden
  let forcedRoute = null; // FLOOF_ASK_ROUTE, for the tests: how every question is asked
  let boxes = []; // pet boxes on this overlay: {id, x, y, w, h, el}
  // keys held, cursor and typing spot (overlay coordinates), from the window watcher
  let input = { held: false, cursor: null, caret: null };
  const holdKeys = () => !!cfg.interactKeys; // "Hold keys to interact with pets" is on
  const canTouch = () => !holdKeys() || input.held;

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const short = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  function hash(s) {
    let h = 0;
    for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
    return Math.abs(h);
  }
  function div(cls, parent) {
    const d = document.createElement('div');
    d.className = cls;
    if (parent) parent.appendChild(d);
    return d;
  }

  // a few pixels of dust kicked up by a hard landing, at the feet
  function dustPuff(cx, feet, w, k) {
    for (let i = 0; i < (k > 0.75 ? 3 : 2); i++) {
      const side = i % 2 ? 1 : -1;
      const d = div('dust', stage);
      d.style.left = `${Math.round(cx + side * w * (0.2 + 0.12 * i))}px`;
      d.style.top = `${Math.round(feet - 3)}px`;
      d.style.setProperty('--dx', `${side * Math.round(8 + 10 * k + 4 * i)}px`);
      d.addEventListener('animationend', () => d.remove());
    }
  }

  // ---------- sprite packs ----------

  async function loadPacks() {
    const next = {};
    const list = await api.getSpritePacks();
    await Promise.all(
      list.map(
        (p) =>
          new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
              next[p.name] = { img, manifest: p.manifest };
              resolve();
            };
            img.onerror = () => {
              console.warn(`sprite pack ${p.name}: could not load sheet`);
              resolve();
            };
            img.src = p.sheetUrl;
          })
      )
    );
    packs = next;
  }

  // Where a pack's critter has its head and chest, for caps and T-shirts (frame pixels, facing as
  // drawn): "hat" and "body" from sprite.json, else found from the idle frame's opaque pixels,
  // else a fair guess.
  function packAnchors(pack) {
    if (pack.anchors) return pack.anchors;
    const m = pack.manifest;
    const fw = m.frameWidth;
    const fh = m.frameHeight;
    let found = null;
    if (!m.hat || !m.body) {
      try {
        const anim = (m.animations || {}).idle || (m.animations || {}).walk || { row: 0 };
        const c = document.createElement('canvas');
        c.width = fw;
        c.height = fh;
        const g = c.getContext('2d');
        g.drawImage(pack.img, 0, (anim.row || 0) * fh, fw, fh, 0, 0, fw, fh);
        const d = g.getImageData(0, 0, fw, fh).data;
        const solid = (x, y) => d[(y * fw + x) * 4 + 3] > 40;
        let top = -1;
        let [minX, maxX, maxY] = [fw, -1, -1];
        for (let y = 0; y < fh; y++) {
          for (let x = 0; x < fw; x++) {
            if (!solid(x, y)) continue;
            if (top < 0) top = y;
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            maxY = y;
          }
        }
        if (top >= 0) {
          let sum = 0;
          let n = 0;
          for (let y = top; y < Math.min(fh, top + 3); y++) for (let x = 0; x < fw; x++) if (solid(x, y)) (sum += x), n++;
          found = {
            hat: { x: Math.round(sum / n), y: Math.max(top + 1, 4) },
            body: { x: Math.round((minX + maxX) / 2), y: Math.round(top + (maxY - top) * 0.62) },
          };
        }
      } catch {
        // the sheet can't be read back (it counts as another origin): guess below
      }
    }
    const guess = { hat: { x: Math.round(fw * 0.6), y: 4 }, body: { x: Math.round(fw / 2), y: Math.round(fh * 0.62) } };
    pack.anchors = { hat: m.hat || (found || guess).hat, body: m.body || (found || guess).body, found: !!found };
    return pack.anchors;
  }

  function resolveKind(critter, id) {
    if (critter && (Critters.kinds.includes(critter) || packs[critter])) return critter;
    const all = [...Critters.kinds, ...Object.keys(packs)];
    return all[hash(id) % all.length];
  }

  // ---------- monitors ----------

  const spanX = () => [Math.min(...displays.map((d) => d.x)), Math.max(...displays.map((d) => d.x + d.w))];
  const primaryDisplay = () => displays.find((d) => d.primary) || displays[0];

  // the monitor under x (nearest one if x is in a gap); with stacked monitors, the one at height y
  function displayAt(x, y) {
    const under = displays.filter((d) => x >= d.x && x < d.x + d.w);
    if (!under.length) return displays.reduce((a, d) => (Math.abs(d.x + d.w / 2 - x) < Math.abs(a.x + a.w / 2 - x) ? d : a));
    if (y != null) {
      const at = under.find((d) => y >= d.y - 2 && y <= d.y + d.h + 2);
      if (at) return at;
    }
    return under.reduce((a, d) => (d.y + d.h > a.y + a.h ? d : a));
  }

  // the taskbar line pets stand on at x
  const groundAt = (x, feet) => {
    const d = displayAt(x, feet);
    return d.y + d.h;
  };

  const onAnyDisplay = (x) => displays.some((d) => x >= d.x && x < d.x + d.w);

  function setDisplays(info) {
    const list = info && info.displays;
    displays = list && list.length ? list : [{ x: 0, y: 0, w: innerWidth, h: innerHeight, primary: true }];
    exits = (info && info.exits) || { left: null, right: null };
    isHome = !info || info.home !== false;
    overlayKey = (info && info.key) || null;
    overlayKeys = (info && info.keys) || [];
    offIds = (info && info.offIds) || [];
    forcedRoute = (info && info.askRoute) || null;
  }

  // ---------- windows pets keep off ----------

  const appName = (s) => String(s || '').toLowerCase().replace(/\.exe$/, '').trim();

  // a window rule: an app, and optionally text its title contains (plain app names work too)
  const matches = (rule, w) => {
    const r = typeof rule === 'string' ? { app: rule, title: '' } : rule || {};
    if (!w.app || appName(r.app) !== appName(w.app)) return false;
    return !r.title || String(w.title || '').toLowerCase().includes(String(r.title).toLowerCase());
  };

  function isKeepOff(w) {
    if ((cfg.keepOff || []).some((r) => matches(r, w))) return true;
    if (!cfg.keepOffFullscreen) return false;
    // full screen: covers its whole monitor, taskbar included
    const d = displayAt(w.x + w.w / 2, w.y + w.h / 2);
    return w.x <= d.x + 1 && w.y <= d.y + 1 && w.x + w.w >= d.x + d.w - 1 && w.y + w.h > d.y + d.h + 4;
  }

  const overlaps = (x, y, w, h, z) => x < z.x + z.w && x + w > z.x && y < z.y + z.h && y + h > z.y;
  const zoneAt = (x, y, w, h) => zones.find((z) => overlaps(x, y, w, h, z));

  // ---------- where pets live: everywhere, on the apps you pick, or in pet boxes ----------

  const roam = () => (cfg.roam === 'boxes' && boxes.length ? 'boxes' : cfg.roam === 'apps' ? 'apps' : 'everywhere');
  const isHomeApp = (w) => (cfg.homeApps || []).some((r) => matches(r, w));
  const BOX_BAR = 24; // the box's title bar
  const BOX_EDGE = 3;
  const boxFloor = (b) => b.y + b.h - BOX_EDGE;

  // the pet box with the fewest pets, for a pet that needs a home
  function pickBox() {
    if (roam() !== 'boxes') return null;
    const count = (b) => [...pets.values()].filter((p) => p.box === b).length;
    return boxes.reduce((a, b) => (count(b) < count(a) ? b : a));
  }

  const boxAt = (x, y) => boxes.find((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h);

  // keep a box on this overlay's monitors (the window itself may still be settling its size)
  function fitBox(r) {
    const [minX, maxX] = spanX();
    const top = Math.min(...displays.map((d) => d.y));
    const bottom = Math.max(...displays.map((d) => d.y + d.h));
    const w = clamp(r.w, 180, maxX - minX);
    const h = clamp(r.h, 150, bottom - top);
    return { x: clamp(r.x, minX, maxX - w), y: clamp(r.y, top, bottom - h), w, h };
  }

  function makeBox(id) {
    const el = document.createElement('div');
    el.className = 'petbox';
    stage.insertBefore(el, stage.firstChild); // behind the pets
    el.innerHTML =
      '<div class="petbox-bg"></div><div class="petbox-shelves"></div>' +
      '<div class="petbox-bar"><span>pet box</span><span class="petbox-tools">' +
      '<button class="petbox-add" type="button" title="Add a shelf">+ shelf</button>' +
      '<button class="petbox-edit" type="button" title="Arrange shelves">✎</button>' +
      '<button class="petbox-gear" type="button" title="Background and shelf colour">⚙</button>' +
      '<button class="petbox-close" type="button" title="Remove this box">×</button></span></div>' +
      '<div class="petbox-grip" title="Drag to resize"></div>';
    const b = { id, el, shelves: [], editing: false };
    el.querySelector('.petbox-close').addEventListener('click', () => api.removeBox(id));
    el.querySelector('.petbox-gear').addEventListener('click', () => api.boxSettings(id));
    el.querySelector('.petbox-edit').addEventListener('click', () => setEditing(b, !b.editing));
    el.querySelector('.petbox-add').addEventListener('click', () => addShelf(b));
    el.querySelector('.petbox-bar').addEventListener('pointerdown', (e) => startBoxDrag(b, e, 'move'));
    el.querySelector('.petbox-grip').addEventListener('pointerdown', (e) => startBoxDrag(b, e, 'size'));
    return b;
  }

  function placeBox(b) {
    b.el.style.transform = `translate(${Math.round(b.x)}px, ${Math.round(b.y)}px)`;
    b.el.style.width = `${Math.round(b.w)}px`;
    b.el.style.height = `${Math.round(b.h)}px`;
    placeShelves(b);
  }

  const fileUrl = (p) => encodeURI(`file:///${String(p).replace(/\\/g, '/')}`);

  // background: none, a colour or a picture (set once; the browser keeps it, nothing per frame)
  function styleBox(b, spec) {
    const bg = spec.bg || { type: 'none' };
    const key = JSON.stringify([bg, spec.shelfColor]);
    if (b.styleKey === key) return;
    b.styleKey = key;
    const el = b.el.querySelector('.petbox-bg');
    el.style.opacity = bg.type === 'none' ? '0' : String(bg.opacity == null ? 0.5 : bg.opacity);
    el.style.backgroundColor = bg.type === 'color' ? bg.color : 'transparent';
    el.style.backgroundImage = bg.type === 'picture' && bg.picture ? `url("${fileUrl(bg.picture)}")` : 'none';
    el.style.backgroundSize = bg.fit === 'fit' ? 'contain' : bg.fit === 'tile' ? 'auto' : 'cover';
    el.style.backgroundRepeat = bg.fit === 'tile' ? 'repeat' : 'no-repeat';
    b.shelfColor = spec.shelfColor || '';
    b.el.style.setProperty('--shelf', b.shelfColor || '#a8743f');
  }

  // ---------- shelves: platforms inside a box, kept as fractions of its inside ----------

  const SHELF_MIN = 100; // px: at least as wide as a pet
  const inside = (b) => ({ left: b.x + BOX_EDGE, top: b.y + BOX_BAR, w: b.w - 2 * BOX_EDGE, h: boxFloor(b) - (b.y + BOX_BAR) });

  function shelfRect(b, s) {
    const r = inside(b);
    return { x1: r.left + s.x * r.w, x2: r.left + (s.x + s.w) * r.w, y: r.top + s.y * r.h };
  }

  function placeShelves(b) {
    const wrap = b.el.querySelector('.petbox-shelves');
    const els = [...wrap.children];
    b.shelves.forEach((s, i) => {
      let el = els.find((x) => x.dataset.id === s.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'petbox-shelf';
        el.dataset.id = s.id;
        el.innerHTML = '<span class="end left"></span><button class="del" type="button" title="Remove this shelf">×</button><span class="end right"></span>';
        el.addEventListener('pointerdown', (e) => startShelfDrag(b, s.id, e));
        el.querySelector('.del').addEventListener('pointerdown', (e) => e.stopPropagation());
        el.querySelector('.del').addEventListener('click', () => removeShelf(b, s.id));
        wrap.append(el);
      }
      const r = shelfRect(b, s);
      el.style.transform = `translate(${Math.round(r.x1 - b.x)}px, ${Math.round(r.y - b.y)}px)`;
      el.style.width = `${Math.round(r.x2 - r.x1)}px`;
    });
    for (const el of els) if (!b.shelves.some((s) => s.id === el.dataset.id)) el.remove();
  }

  // shelves as surfaces pets stand on, like window tops
  function shelfSegments() {
    const out = [];
    for (const b of boxes) for (const s of b.shelves) out.push({ id: `shelf:${b.id}:${s.id}`, shelf: true, box: b, ...shelfRect(b, s) });
    return out;
  }

  function saveShelves(b) {
    api.saveBox({ id: b.id, shelves: b.shelves.map(({ id, x, y, w }) => ({ id, x, y, w })) });
  }

  function addShelf(b) {
    const r = inside(b);
    const w = Math.min(1, Math.max(SHELF_MIN / r.w, 0.4));
    const taken = b.shelves.map((s) => s.y);
    const y = [0.45, 0.25, 0.65, 0.35, 0.55].find((v) => !taken.some((t) => Math.abs(t - v) < 0.08)) || 0.45;
    b.shelves.push({ id: Math.random().toString(36).slice(2, 8), x: (1 - w) / 2, y, w });
    placeShelves(b);
    computeSegments();
    saveShelves(b);
  }

  function removeShelf(b, id) {
    b.shelves = b.shelves.filter((s) => s.id !== id);
    placeShelves(b);
    computeSegments(); // pets on it lose their footing and fall
    saveShelves(b);
  }

  // ✎: while arranging, the box takes clicks; ✎ again or Esc goes back to letting them through
  function setEditing(b, on) {
    b.editing = on;
    b.el.classList.toggle('editing', on);
    if (!on) saveShelves(b);
    updateInteractive();
  }

  // draw the pet boxes that belong to this overlay; pets in a box that's gone move to another one
  function renderBoxes() {
    // a box on a screen you've unticked stays hidden until you tick it again
    const off = (b) => String(b.display).split('+').every((id) => offIds.includes(id));
    const mine = (b) => !off(b) && (b.display === overlayKey || (isHome && !overlayKeys.includes(b.display)));
    const want = cfg.roam === 'boxes' ? (cfg.boxes || []).filter(mine) : [];
    const next = [];
    for (const spec of want) {
      const b = boxes.find((o) => o.id === spec.id) || makeBox(spec.id);
      const busy = (boxDrag && boxDrag.b === b) || (shelfDrag && shelfDrag.b === b);
      if (!busy) {
        Object.assign(b, fitBox(spec));
        b.shelves = (spec.shelves || []).map((s) => ({ ...s }));
      }
      b.gravity = spec.gravity !== false;
      styleBox(b, spec);
      placeBox(b);
      next.push(b);
    }
    for (const b of boxes) if (!next.includes(b)) b.el.remove();
    boxes = next;
    computeSegments();
    for (const p of pets.values()) {
      if (p.box && !boxes.includes(p.box)) p.box = null;
      if (p.box) p.fitInBox();
      else if (!p.leaving) p.moveIntoBox(pickBox());
    }
  }

  // ---------- windows as platforms ----------

  // subtract interval [a, b] from a list of intervals
  function subtract(list, a, b) {
    const out = [];
    for (const [x1, x2] of list) {
      if (b <= x1 || a >= x2) out.push([x1, x2]);
      else {
        if (a > x1) out.push([x1, a]);
        if (b < x2) out.push([b, x2]);
      }
    }
    return out;
  }

  function computeSegments() {
    segments = [];
    zones = windows.filter((w) => w.keepOff);
    windows.forEach((w, i) => {
      if (w.keepOff) return; // pets don't climb these
      if (roam() === 'boxes' || (roam() === 'apps' && !isHomeApp(w))) return; // pets live somewhere else
      const d = displayAt(w.x + w.w / 2, w.y);
      if (w.y < d.y + 24 || w.y > d.y + d.h - 24) return; // no room above it, or below the screen
      const [minX, maxX] = spanX();
      let parts = [[Math.max(minX, w.x), Math.min(maxX, w.x + w.w)]];
      for (let j = 0; j < i; j++) {
        const o = windows[j]; // a window above this one hides the part of the edge it covers
        if (o.y <= w.y + 2 && o.y + o.h > w.y) parts = subtract(parts, o.x, o.x + o.w);
      }
      for (const [x1, x2] of parts) if (x2 - x1 >= 40) segments.push({ id: w.id, y: w.y, x1, x2 });
    });
    if (roam() === 'boxes') segments.push(...shelfSegments());
    // pets on a shelf ride along when it moves; one whose shelf is gone (or slid away) falls
    for (const p of pets.values()) {
      if (!p.platform || !p.platform.shelf) continue;
      const s = segments.find((x) => x.id === p.platform.id);
      const cx = p.x + p.w / 2;
      if (s && cx >= s.x1 && cx <= s.x2) {
        p.platform = s;
        p.y = s.y - p.h;
      } else {
        p.platform = null;
        if (!['drag', 'peek', 'sink', 'hidden'].includes(p.mode)) p.setMode('fall', 0);
      }
    }
  }

  function setWindows(list) {
    const old = windowsById;
    lastWindowList = list;
    windows = list.map((w) => ({ ...w, keepOff: isKeepOff(w) }));
    if (!cfg.walkOnWindows) windows = windows.filter((w) => w.keepOff || w.fg); // still avoid those, and know the active one
    windowsById = new Map(windows.map((w) => [w.id, w]));
    computeSegments();
    for (const p of pets.values()) p.onWindowsChanged(old);
  }

  // the window you're using, if it's on this overlay
  function activeWindow() {
    const fg = windows.find((w) => w.fg && w.w > 0);
    return fg ? { w: fg, here: onAnyDisplay(fg.x + fg.w / 2) } : null;
  }

  // the monitor you're looking at: the active window's, else the main one
  function focusDisplay() {
    const a = activeWindow();
    return a && a.here ? displayAt(a.w.x + a.w.w / 2, a.w.y + a.w.h / 2) : primaryDisplay();
  }

  // Where a pet goes to pull a curtain: the top-right corner of the active window, if
  // there's room above it and pets may cover it.
  function cornerTarget(p) {
    const a = activeWindow();
    if (!a || !a.here) return null;
    const fg = a.w;
    if (fg.keepOff || fg.w < CARD_W + 40 || fg.h < 200) return null;
    const right = fg.x + fg.w;
    const seg = segments.find((s) => s.id === fg.id && Math.abs(s.x2 - right) < 2 && s.y >= p.h + 8 && s.x2 - s.x1 >= p.w + 24);
    return seg ? { kind: 'window', win: fg.id, standX: seg.x2 - p.w - 6, feetY: seg.y } : null;
  }

  // Can you see this pet right now? It has to be out in the open on the monitor you're using.
  function inSight(p) {
    if (p.hidden || p.leaving || p.y + p.h < 0 || p.mode === 'peek') return false;
    const a = activeWindow();
    if (a && !a.here) return false; // you're working on another overlay's monitor
    return displayAt(p.x + p.w / 2, p.feet) === focusDisplay();
  }

  // How a pet with a question gets your attention.
  function askRoute(p) {
    if (forcedRoute) return forcedRoute;
    if (inSight(p) && !p.cameToAsk) return 'balloon';
    const a = activeWindow();
    if (a && !a.here && !(p.stayUntil > p.t)) return 'elsewhere'; // go to the overlay you're looking at first
    if (cfg.curtain && cornerTarget(p)) return 'curtain';
    return 'tray';
  }

  // ---------- the curtain ----------

  class Curtain {
    constructor(pet, target) {
      this.pet = pet;
      this.target = target;
      this.el = div(`curtain ${target.kind === 'window' ? 'corner-tr' : 'corner-bl'}`, stage);
      this.el.innerHTML =
        '<div class="note"><div class="who"></div><div class="text"></div>' +
        '<form class="ask"><input placeholder="Type your answer…" /><button type="submit">Send</button></form>' +
        '<button class="later" type="button">Later</button></div>' +
        '<div class="drape"></div><div class="tie"></div>';
      this.el.querySelector('.who').textContent = `${pet.name}${pet.provider ? ' · ' + pet.provider : ''} needs you`;
      this.el.querySelector('.text').textContent = pet.text || 'Waiting for you';
      const form = this.el.querySelector('.ask');
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = form.querySelector('input');
        if (!input.value.trim()) return;
        pet.sendAnswer(input.value.trim());
        this.close();
      });
      this.el.querySelector('.later').addEventListener('click', () => this.close());
      this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
      this.reposition();
      requestAnimationFrame(() => {
        this.el.classList.add('show');
        setTimeout(() => this.el.classList.add('open'), 350);
      });
    }

    reposition() {
      let left;
      let top;
      if (this.target.kind === 'window') {
        const w = windowsById.get(this.target.win);
        if (!w) {
          // the window closed or got minimized: pull back and look for a new corner
          this.close();
          this.pet.wantsCurtain = true;
          return;
        }
        left = w.x + w.w - CARD_W - 8;
        top = w.y + 8;
      } else {
        const d = this.target.display || primaryDisplay();
        left = d.x + d.w - CARD_W - 12;
        top = d.y + d.h - this.el.offsetHeight - 10;
      }
      this.el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    }

    close() {
      if (this.closed) return;
      this.closed = true;
      this.el.classList.remove('open');
      setTimeout(() => this.el.classList.remove('show'), 500);
      setTimeout(() => this.el.remove(), 900);
      if (this.pet.curtain === this) {
        this.pet.curtain = null;
        if (this.pet.mode === 'curtain') this.pet.setMode('idle', 0.8);
      }
    }
  }

  // ---------- pet ----------

  class Pet {
    constructor({ id, kind, name, provider, agent }) {
      this.id = id;
      this.kind = kind;
      this.name = name || kind;
      this.provider = provider || '';
      this.agent = !!agent;
      this.pack = packs[kind] || null;
      this.measure();
      const home = primaryDisplay();
      this.x = rand(home.x, home.x + home.w - this.w);
      this.y = -this.h; // drop in from the top
      this.vx = 0;
      this.vy = 0;
      this.platform = null; // window segment it stands on; null = the taskbar
      this.facingLeft = Math.random() < 0.5;
      this.mode = 'fall';
      this.modeLeft = 0;
      this.speed = 70;
      this.t = 0;
      this.chatCooldown = 3;
      this.sayAt = this.sayUntil = -1;

      this.state = null; // agent state
      this.text = '';
      this.progress = null;
      this.log = [];
      this.leaving = false;
      this.balloonOpen = false;
      this.curtain = null;
      this.wantsCurtain = false; // has a question you haven't seen yet
      this.hidden = false; // tucked away because a keep-off window covers its spot
      this.box = null; // the pet box it lives in, when pets live in boxes
      this.subagents = []; // its agent's subagents this turn, newest first
      this.minis = new Map(); // subagent id -> its Mini, for the few on screen
      this.buildDom();
      if (roam() === 'boxes') this.moveIntoBox(pickBox());
    }

    // pet boxes: the box floor is the ground and its sides are walls
    moveIntoBox(box) {
      this.box = box;
      if (!box) return;
      this.platform = null;
      // drop onto the box floor or, now and then, onto a shelf with room for it
      const shelves = segments.filter((s) => s.box === box && s.x2 - s.x1 >= this.w + 4 && s.y - (box.y + BOX_BAR) >= this.h);
      const s = shelves.length && Math.random() < 0.5 ? pick(shelves) : null;
      this.x = s ? rand(s.x1, s.x2 - this.w) : rand(box.x + BOX_EDGE, Math.max(box.x + BOX_EDGE, box.x + box.w - BOX_EDGE - this.w));
      // without gravity it stays wherever it starts, so pick a height too
      const floating = box.gravity === false ? rand(box.y + BOX_BAR, Math.max(box.y + BOX_BAR, boxFloor(box) - this.h)) : box.y + BOX_BAR;
      this.y = s ? s.y - this.h - 2 : floating;
      this.vx = this.vy = 0;
      if (!['peek', 'sink', 'drag', 'hidden'].includes(this.mode)) this.setMode('fall', 0);
    }

    fitInBox() {
      const b = this.box;
      this.x = clamp(this.x, b.x + BOX_EDGE, Math.max(b.x + BOX_EDGE, b.x + b.w - BOX_EDGE - this.w));
      if (this.y < b.y + BOX_BAR) this.y = b.y + BOX_BAR;
      if (this.feet > boxFloor(b)) this.y = boxFloor(b) - this.h;
    }

    measure() {
      if (this.pack) {
        const m = this.pack.manifest;
        const s = m.scale || cfg.scale;
        this.w = m.frameWidth * s;
        this.h = m.frameHeight * s;
      } else {
        this.w = this.h = Critters.size * cfg.scale;
      }
    }

    resize() {
      const feet = this.feet;
      this.measure();
      this.canvas.width = this.w;
      this.canvas.height = this.h;
      this.lastDraw = null;
      this.y = feet - this.h;
    }

    get feet() {
      return this.y + this.h;
    }
    get floorY() {
      if (this.platform) return this.platform.y; // a window top or a shelf
      if (this.box) return this.box.gravity === false ? this.feet : boxFloor(this.box); // no gravity: it floats where it is
      return groundAt(this.x + this.w / 2, this.feet);
    }
    get airborne() {
      if (this.stick) return false; // holding on to a taskbar
      return this.feet < this.floorY - 0.5 || this.vy < 0;
    }

    buildDom() {
      this.el = div('pet', stage);
      this.canvas = document.createElement('canvas');
      this.canvas.width = this.w;
      this.canvas.height = this.h;
      this.ctx = this.canvas.getContext('2d');
      this.el.appendChild(this.canvas);
      this.badge = div('badge', this.el);
      this.tag = div('tag', this.el);
      this.dizzy = div('dizzy', this.el);
      this.dizzy.innerHTML = '<span><i>✦</i></span><span><i>✧</i></span><span><i>✦</i></span>';
      this.bar = div('bar', this.el);
      this.barFill = div('', this.bar);
      this.el.addEventListener('pointerdown', (e) => startDrag(this, e));

      this.balloon = div('balloon', stage);
      this.balloon.innerHTML =
        '<button class="pin" type="button"></button><div class="who"></div><div class="now"></div><div class="fortune"></div><div class="tourbar"></div>' +
        '<form class="cmd"><input placeholder="Message…" /><button type="submit">Send</button><button class="stop" type="button">■ Stop</button></form><div class="cmdnote"></div>' +
        '<button class="goto" type="button">↗ Take me there</button>' +
        '<button class="dismiss" type="button"></button>' +
        '<div class="progress"><div></div></div><ul class="log"></ul>' +
        '<form class="ask"><input placeholder="Type an answer…" /><button type="submit">Send</button></form>';
      this.bWho = this.balloon.querySelector('.who');
      this.bNow = this.balloon.querySelector('.now');
      this.bFortune = this.balloon.querySelector('.fortune');
      this.bTour = this.balloon.querySelector('.tourbar');
      this.bProg = this.balloon.querySelector('.progress');
      this.bLog = this.balloon.querySelector('.log');
      this.bAsk = this.balloon.querySelector('.ask');
      this.bAsk.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = this.bAsk.querySelector('input');
        if (!input.value.trim()) return;
        this.sendAnswer(input.value.trim());
        input.value = '';
      });
      this.balloon.addEventListener('pointerdown', (e) => e.stopPropagation());
      // the balloon closes by itself after a while, unless it's pinned or you're using it
      this.bPin = this.balloon.querySelector('.pin');
      this.bPin.addEventListener('click', () => {
        this.keepOpen = !this.keepOpen;
        this.renderBalloon();
      });
      this.balloon.addEventListener('pointerenter', () => (this.balloonHover = true));
      this.balloon.addEventListener('pointerleave', () => {
        this.balloonHover = false;
        this.balloonOpenedAt = this.t; // a fresh while after you move away
      });
      this.balloon.addEventListener('input', () => (this.balloonOpenedAt = this.t));
      // typing in the balloon: it keeps taking keys and clicks after you let go of the interact keys
      this.balloon.addEventListener('focusin', () => this.balloon.classList.add('typing'));
      this.balloon.addEventListener('focusout', () => this.balloon.classList.remove('typing'));

      // send the agent a message, or tell it to stop
      this.bCmd = this.balloon.querySelector('.cmd');
      this.bCmdNote = this.balloon.querySelector('.cmdnote');
      this.bStop = this.bCmd.querySelector('.stop');
      this.bCmd.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = this.bCmd.querySelector('input');
        if (!input.value.trim()) return;
        api.control(this.id, 'message', input.value.trim());
        this.addLog(`You: ${input.value.trim()}`);
        input.value = '';
      });
      // to the agent's window, or its page for a cloud agent
      this.bGo = this.balloon.querySelector('.goto');
      this.bGo.addEventListener('click', async () => {
        const r = await api.goTo(this.id);
        this.controlNote = r && r.ok ? '' : `Couldn't take you there: ${(r && r.why) || 'unknown'}`;
        if (this.balloonOpen) this.renderBalloon();
      });
      // send a free critter away (it stays away), or dismiss an agent's pet that will never hear from its agent again
      this.bDismiss = this.balloon.querySelector('.dismiss');
      this.bDismiss.addEventListener('click', () => removePet(this.id));
      this.bStop.addEventListener('click', () => {
        if (!this.stopArmed) {
          this.stopArmed = true; // a second click to be sure
          this.renderBalloon();
          setTimeout(() => {
            this.stopArmed = false;
            if (this.balloonOpen) this.renderBalloon();
          }, 3000);
          return;
        }
        this.stopArmed = false;
        api.control(this.id, 'stop');
      });

      this.chatter = div('chatter', stage);
      this.renderTag();
    }

    renderTag() {
      this.tag.textContent = this.provider ? `${this.name} · ${this.provider}` : this.name;
    }

    addLog(line) {
      const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      this.log.push(`${time}  ${line}`);
      if (this.log.length > 30) this.log.shift();
    }

    sendAnswer(text) {
      api.answer(this.id, text);
      this.markAnswered(text);
    }

    // answered here or from the pet list
    markAnswered(text) {
      this.addLog(`You: ${text}`);
      this.answered = true;
      this.wantsCurtain = false;
      if (this.curtain) this.curtain.close();
      if (this.balloonOpen) this.renderBalloon();
      if (this.mode === 'peek') this.setMode('sink', 0);
    }

    // what decides the letter on its cap or shirt: your letter for this agent (pet list), then the
    // agent's own, then (for OpenAI-compatible agents) the one in Settings; Ollama's comes from the model
    styleExtra() {
      const mine = (cfg.badges || []).find((b) => b.id === this.id);
      return { model: this.model, badge: (mine && mine.badge) || this.capLetter, compat: cfg.compatLetter };
    }

    applyEvent(ev) {
      if (ev.name) this.name = ev.name;
      if (ev.provider) this.provider = ev.provider;
      if (ev.model) this.model = ev.model;
      if (ev.pids) this.pids = ev.pids;
      if (ev.url) this.url = ev.url;
      if (ev.badge) this.capLetter = ev.badge;
      this.renderTag();
      const newText = ev.text && ev.text !== this.text;
      const newState = ev.state !== this.state;
      if (newState) {
        this.state = ev.state;
        this.celebrated = false;
        this.drooped = false;
        this.answered = false;
        if (!['drag', 'fall', 'jump'].includes(this.mode)) this.modeLeft = 0; // react right away
      }
      if (newText) {
        this.text = ev.text;
        this.addLog(ev.text);
      }
      if (ev.progress != null) this.progress = ev.progress;
      this.lastEventAt = this.t;
      if (this.state === 'question') {
        if (newState || newText) {
          if (this.curtain) this.curtain.close(); // a new question: ask again with the new text
          this.answered = false;
          this.snoozed = false;
          this.askedAt = this.t;
          this.wantsCurtain = true;
        }
      } else {
        this.wantsCurtain = false;
        if (this.curtain) this.curtain.close();
        if (this.mode === 'peek') this.setMode('sink', 0);
      }
      if ('tour' in ev) this.applyTour(ev.tour);
      if (ev.controls) this.controls = ev.controls;
      if (ev.subagents) {
        this.subagents = ev.subagents;
        this.syncMinis();
      }
      if (this.balloonOpen) this.renderBalloon();
    }

    // the guide sheep's tour step: keep the balloon open with its buttons, and act out demos
    applyTour(tour) {
      this.tour = tour || null;
      if (!tour) return;
      if (tour.demo === 'away') {
        // what a pet you can't see does with a question: a curtain on your window, or a peek from the taskbar
        this.wantsCurtain = false;
        this.toggleBalloon(false);
        const T = cfg.curtain ? cornerTarget(this) : null;
        if (T) {
          this.platform = segments.find((s) => s.id === T.win && T.standX + this.w / 2 <= s.x2) || null;
          this.x = T.standX;
          this.y = T.feetY - this.h;
          this.vx = this.vy = 0;
          this.openCurtain(T);
        } else {
          this.peekFromTray();
        }
        return;
      }
      if (tour.open && !this.curtain && this.mode !== 'peek') {
        this.keepOpen = true;
        this.toggleBalloon(true);
        this.keepOpen = true; // toggleBalloon doesn't unpin while opening, but be sure
      }
      if (tour.nap) this.setMode('sleep', 30);
      else if (this.mode === 'sleep') this.setMode('idle', 2);
    }

    toggleBalloon(force) {
      const wasOpen = this.balloonOpen;
      this.balloonOpen = force != null ? force : !this.balloonOpen;
      this.balloon.classList.toggle('open', this.balloonOpen);
      if (this.balloonOpen && !wasOpen) {
        this.balloonOpenedAt = this.t;
        this.pickFortune();
        // a click wakes a napping pet for a while
        this.awakeUntil = this.t + 20;
        if (this.mode === 'sleep') this.setMode('idle', 1);
      }
      if (!this.balloonOpen) {
        this.keepOpen = false;
        this.balloonHover = false;
        if (this.awakeUntil > this.t + 2) this.awakeUntil = this.t + 2; // back to sleep soon
      }
      if (this.balloonOpen) this.renderBalloon();
    }

    // A critter with no agent shares a fortune now and then; an idle agent's pet always has one.
    pickFortune() {
      this.fortune = null;
      if (cfg.fortunes === false || this.tour) return;
      const idle = this.agent && this.state === 'idle';
      if (!idle && (this.agent || Math.random() > 0.5)) return;
      const ask = (this.fortuneAsk = (this.fortuneAsk || 0) + 1);
      api.getFortune().then((text) => {
        if (ask !== this.fortuneAsk || !this.balloonOpen || !text) return;
        this.fortune = text;
        this.renderBalloon();
      });
    }

    renderBalloon() {
      this.bPin.textContent = this.keepOpen ? '📌 Pinned' : '📌 Keep open';
      this.bPin.classList.toggle('on', !!this.keepOpen);
      this.bPin.style.display = this.tour ? 'none' : '';
      this.bWho.textContent = this.name;
      if (this.provider) {
        const small = document.createElement('small');
        small.textContent = this.model ? `${this.provider} · ${this.model}` : this.provider;
        this.bWho.appendChild(small);
      }
      // its subagents this turn: running / all
      const chip = Minis.subagentChip(this.subagents);
      if (chip) {
        const subs = document.createElement('span');
        subs.className = 'subs';
        subs.textContent = chip;
        subs.title = Minis.subagentTitle(this.subagents);
        this.bWho.appendChild(subs);
      }
      const idle = this.agent && this.state === 'idle' && !this.tour; // the guide just says its line
      if (!this.agent) {
        this.bNow.textContent = this.fortune ? '' : `Just a fluffy ${this.kind} enjoying your desktop.`;
      } else if (idle) {
        this.bNow.textContent = `Idle at the moment${this.text ? ` (${this.text})` : ''}.`;
      } else if (this.state === 'question' && this.answered) {
        this.bNow.textContent = `${this.text} (answer sent)`;
      } else {
        this.bNow.textContent = this.text || this.state || '';
      }
      const showFortune = !!this.fortune && (!this.agent || idle);
      this.bFortune.style.display = showFortune ? 'block' : 'none';
      this.bFortune.textContent = showFortune ? `🔮 ${this.fortune}` : '';
      const showProg = this.agent && this.progress != null && (!this.tour || this.state === 'working');
      this.bProg.style.display = showProg ? 'block' : 'none';
      if (showProg) this.bProg.firstChild.style.width = `${Math.round(this.progress * 100)}%`;
      this.bLog.replaceChildren(
        ...this.log.slice(-6, -1).reverse().map((l) => {
          const li = document.createElement('li');
          li.textContent = l;
          return li;
        })
      );
      this.bLog.style.display = this.log.length > 1 && !this.tour ? 'block' : 'none';
      const asking = this.state === 'question' && !this.answered;
      this.bAsk.style.display = asking && !(this.tour && this.tour.demo) ? 'flex' : 'none';
      // a message box and Stop, for agents that can take them (and not while they ask you something)
      const can = (this.agent && !this.tour && !asking && this.state !== 'bye' && this.controls) || [];
      this.bCmd.style.display = can.length ? 'flex' : 'none';
      this.bCmd.querySelector('input').style.display = can.includes('message') ? '' : 'none';
      this.bCmd.querySelector('button[type=submit]').style.display = can.includes('message') ? '' : 'none';
      this.bStop.style.display = can.includes('stop') && ['working', 'question'].includes(this.state) ? '' : 'none';
      this.bStop.textContent = this.stopArmed ? 'Really stop?' : '■ Stop';
      this.bStop.classList.toggle('armed', !!this.stopArmed);
      // "Take me there", when floof knows the agent's window or page (a link's site in the tooltip)
      const canGo = this.agent && !this.tour && ((this.pids && this.pids.length) || this.url);
      this.bGo.style.display = canGo ? '' : 'none';
      let site = '';
      try {
        site = this.url ? new URL(this.url).host : '';
      } catch {
        site = '';
      }
      this.bGo.title = this.pids && this.pids.length ? "Bring this agent's window to the front" : site ? `Open ${site}` : '';
      this.bDismiss.style.display = this.tour ? 'none' : '';
      this.bDismiss.textContent = this.agent ? '× Dismiss pet' : '× Send away';
      this.bDismiss.title = this.agent ? 'It comes back if its agent sends anything new' : `No ${this.kind} when floof starts, until you add one or turn free critters back on`;
      this.bCmdNote.textContent = this.controlNote || '';
      this.bCmdNote.style.display = this.controlNote ? 'block' : 'none';
      this.balloon.classList.toggle('asking', this.state === 'question' && !this.answered); // clickable without the keys
      // the guide's tour buttons
      const TOUR_LABELS = { next: 'Next', skip: 'Skip tour', settings: 'Open Settings', list: 'Open the pet list', done: 'Thanks!' };
      const buttons = (this.tour && this.tour.buttons) || [];
      this.balloon.classList.toggle('touring', buttons.length > 0);
      const tourKey = buttons.join();
      if (this.bTour.dataset.key !== tourKey) {
        this.bTour.dataset.key = tourKey;
        this.bTour.replaceChildren(
          ...buttons.map((a) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = a === 'skip' ? 'link' : '';
            b.textContent = TOUR_LABELS[a] || a;
            b.addEventListener('click', () => api.tour(a));
            return b;
          })
        );
      }
      this.bTour.style.display = buttons.length ? 'flex' : 'none';
    }

    setMode(mode, seconds) {
      this.mode = mode;
      this.modeLeft = seconds;
    }

    walk(seconds, speed) {
      if (Math.random() < 0.4) this.facingLeft = !this.facingLeft;
      this.speed = speed || rand(55, 90);
      this.edgeChoice = null;
      this.setMode('walk', seconds);
    }

    fly() {
      this.platform = null;
      const d = displayAt(this.x + this.w / 2, this.feet);
      const b = this.box;
      this.flyY = b ? rand(b.y + BOX_BAR + 4, Math.max(b.y + BOX_BAR + 4, boxFloor(b) - this.h - 20)) : rand(d.y + d.h * 0.3, d.y + d.h - this.h - 120);
      this.setMode('fly', rand(4, 8));
    }

    // Jump so the feet land on (tx, feetY). Used to hop onto windows and to reach a corner.
    jumpTo(tx, feetY) {
      const apex = Math.min(this.feet, feetY) - 60;
      const up = this.feet - apex;
      const down = feetY - apex;
      const time = Math.sqrt((2 * up) / GRAVITY) + Math.sqrt((2 * down) / GRAVITY);
      this.platform = null;
      this.vy = -Math.sqrt(2 * GRAVITY * up);
      this.vx = (tx - this.x) / time;
      this.facingLeft = this.vx < 0;
    }

    climb() {
      const cx = this.x + this.w / 2;
      const options = segments.filter(
        (s) =>
          s !== this.platform &&
          s.y >= this.h + 8 &&
          s.x2 - s.x1 >= this.w + 10 &&
          Math.abs((s.x1 + s.x2) / 2 - cx) < 600 &&
          (s.box || null) === this.box && // in a box: only its own shelves
          (!s.box || s.y - (s.box.y + BOX_BAR) >= this.h) // room above the shelf
      );
      if (!options.length) return false;
      const s = pick(options);
      this.jumpTo(rand(s.x1, s.x2 - this.w), s.y);
      this.setMode('jump', 0);
      return true;
    }

    // get the question in front of you, the way askRoute picks
    ask() {
      const route = askRoute(this);
      if (route !== 'balloon') this.unstick(); // off the taskbar to go and ask
      if (route === 'elsewhere') return handoff(this, 'focus');
      this.wantsCurtain = false;
      this.cameToAsk = false;
      if (route === 'balloon') {
        this.toggleBalloon(true);
        this.facingLeft = false;
        return this.setMode('wave', 4);
      }
      if (route === 'curtain') {
        this.seekStart = this.t;
        return this.setMode('seek', 0);
      }
      this.peekFromTray();
    }

    // rise from behind the taskbar next to the clock, with the question in a balloon. A taskbar at
    // the top or side: it comes out of that edge, holding on with its plungers.
    peekFromTray() {
      const d = focusDisplay();
      if (this.curtain) this.curtain.close();
      this.unhide();
      this.unstick();
      this.platform = null;
      this.vx = this.vy = 0;
      // line up next to any other pet already popping up there
      const others = [...pets.values()].filter((q) => q !== this && ['peek', 'sink'].includes(q.mode)).length;
      const along = others * (this.w + 12);
      const edge = ['top', 'left', 'right'].includes(d.edge) ? d.edge : 'bottom';
      const right = Math.max(d.x, d.x + d.w - this.w - 24 - along);
      const low = Math.max(d.y, d.y + d.h - this.h - 24 - along); // the clock sits low on a side taskbar
      const spots = {
        bottom: { from: [right, d.y + d.h], to: [right, d.y + d.h - this.h] },
        top: { from: [right, d.y - this.h], to: [right, d.y] },
        left: { from: [d.x - this.w, low], to: [d.x, low] },
        right: { from: [d.x + d.w, low], to: [d.x + d.w - this.w, low] },
      };
      this.peekFrom = spots[edge].from;
      this.peekTo = spots[edge].to;
      [this.x, this.y] = this.peekFrom; // just past the edge of the overlay, out of sight
      if (edge !== 'bottom') this.stick = { edge, d, peeking: true };
      this.facingLeft = true;
      this.setMode('peek', 0);
      this.toggleBalloon(true);
    }

    // ---------- holding on to a taskbar at the top or side of a screen, with plungers ----------

    // the edge it can hold on to here, if this screen's taskbar is at the top or a side
    stickEdge() {
      if (this.box || roam() !== 'everywhere' || this.hidden || this.leaving) return null;
      const d = displayAt(this.x + this.w / 2, this.feet);
      return ['top', 'left', 'right'].includes(d.edge) ? { edge: d.edge, d } : null;
    }

    stickTo(s) {
      const { edge, d } = s;
      this.stick = { edge, d };
      this.platform = null;
      this.vx = this.vy = 0;
      if (edge === 'top') {
        this.x = clamp(this.x, d.x, d.x + d.w - this.w);
        this.y = d.y;
      } else {
        this.x = edge === 'left' ? d.x : d.x + d.w - this.w;
        this.y = clamp(this.y, d.y, d.y + d.h - this.h);
      }
    }

    unstick() {
      if (!this.stick) return;
      this.stick = null;
      if (!['peek', 'sink', 'drag', 'hidden'].includes(this.mode)) this.setMode('fall', 0);
    }

    // walking along a top taskbar upside down, or up and down a side one
    stuckStep(dt) {
      const { edge, d } = this.stick;
      if (this.agent && ['done', 'error', 'idle'].includes(this.state) && this.t - this.lastEventAt > IDLE_LEAVE) return this.leave();
      if (this.mode === 'walk' || this.mode === 'mope') {
        const v = (this.mode === 'mope' ? 22 : this.speed) * dt * (this.facingLeft ? -1 : 1);
        const [key, lo, hi] = edge === 'top' ? ['x', d.x, d.x + d.w - this.w] : ['y', d.y, d.y + d.h - this.h];
        this[key] += v;
        if (this[key] < lo || this[key] > hi) {
          this[key] = clamp(this[key], lo, hi);
          this.facingLeft = !this.facingLeft;
        }
      }
      this.modeLeft -= dt;
      if (this.modeLeft <= 0) this.chooseNext();
    }

    // you didn't answer for a while: put the question away and go back to wandering.
    // The ❓ stays, and clicking the pet shows the question again.
    snooze() {
      this.snoozed = true;
      this.wantsCurtain = false;
      if (this.curtain) this.curtain.close();
      if (this.balloonOpen) this.toggleBalloon(false);
      if (this.mode === 'peek') this.setMode('sink', 0);
      else if (['wave', 'seek', 'curtain'].includes(this.mode)) this.setMode('idle', 0.5);
    }

    hide() {
      if (this.hidden) return;
      this.hidden = true;
      this.el.style.visibility = 'hidden';
      this.toggleBalloon(false);
      this.setMode('hidden', 0);
    }

    unhide() {
      if (!this.hidden) return;
      this.hidden = false;
      this.el.style.visibility = '';
    }

    // a keep-off window covers this pet: walk out of it, or tuck away if there's nowhere to go
    escapeZone(z) {
      if (this.box) return this.hide(); // a keep-off window covers the box: wait until it's gone
      const d = displayAt(this.x + this.w / 2, this.feet);
      const ground = d.y + d.h;
      const spots = [z.x - this.w - 4, z.x + z.w + 4].filter(
        (x) => x >= d.x && x + this.w <= d.x + d.w && !zoneAt(x, ground - this.h, this.w, this.h)
      );
      if (!spots.length) return this.hide();
      const cx = this.x;
      this.escapeTo = spots.reduce((a, b) => (Math.abs(b - cx) < Math.abs(a - cx) ? b : a));
      this.platform = null;
      this.y = Math.max(this.y, ground - this.h); // drop to the taskbar behind the window
      this.vx = this.vy = 0;
      this.setMode('escape', 0);
    }

    // come back out once a keep-off window no longer covers the whole monitor
    tryUnhide() {
      if (this.box) {
        const b = this.box;
        if (zoneAt(b.x, b.y, b.w, b.h)) return false;
        this.unhide();
        this.moveIntoBox(b);
        return true;
      }
      if (roam() === 'apps') {
        // drop onto one of the windows pets may live on, if one is open
        const s = segments.length ? pick(segments) : null;
        if (!s) {
          // none on this overlay's monitors: now and then, try the monitor next door, still tucked away
          const side = exits.left && exits.right ? pick(['left', 'right']) : exits.left ? 'left' : exits.right ? 'right' : null;
          if (side && Math.random() < 0.2) handoff(this, side);
          return false;
        }
        if (s.x2 - s.x1 < this.w) return false;
        this.x = rand(s.x1, s.x2 - this.w);
        this.y = s.y - this.h - 30;
        this.platform = null;
        this.vx = this.vy = 0;
        this.unhide();
        this.setMode('fall', 0);
        return true;
      }
      const d = displayAt(this.x + this.w / 2, this.feet);
      const ground = d.y + d.h;
      for (let i = 0; i < 12; i++) {
        const x = rand(d.x, d.x + d.w - this.w);
        if (!zoneAt(x, ground - this.h, this.w, this.h) && !zoneAt(x, 0, this.w, ground)) {
          this.x = x;
          this.y = -this.h;
          this.unhide();
          this.setMode('fall', 0);
          return true;
        }
      }
      return false;
    }

    openCurtain(target) {
      if (!target) return this.peekFromTray();
      this.facingLeft = false;
      const curtain = new Curtain(this, target);
      this.curtain = curtain.closed ? null : curtain;
      this.curtainAt = this.t;
      this.wantsCurtain = false;
      if (this.balloonOpen) this.toggleBalloon(false);
      this.setMode('curtain', 0);
    }

    leave() {
      this.unstick();
      this.leaving = true;
      this.wantsCurtain = false;
      if (this.curtain) this.curtain.close();
      this.toggleBalloon(false);
      if (this.box || this.hidden) {
        // out of a pet box, or from where it's tucked away: just slip off
        this.hide();
        this.modeLeft = 0.2;
        return;
      }
      const [minX, maxX] = spanX();
      this.facingLeft = this.x + this.w / 2 < (minX + maxX) / 2;
      this.speed = 140;
      this.mode = 'walk';
    }

    say(text, delay, duration) {
      this.sayText = text;
      this.sayAt = this.t + delay;
      this.sayUntil = this.sayAt + duration;
    }

    // which way to move (-1 left, 1 right) to get out of the way of your cursor or typing spot; 0 if they're far enough
    awayFrom() {
      const R = 120;
      const cx = this.x + this.w / 2;
      const cy = this.y + this.h / 2;
      const near = (r) =>
        r && cx > r.x - R - this.w / 2 && cx < r.x + r.w + R + this.w / 2 && cy > r.y - R - this.h / 2 && cy < r.y + r.h + R + this.h / 2;
      const cursor = input.cursor && { x: input.cursor.x, y: input.cursor.y, w: 0, h: 0 };
      const from = near(cursor) ? cursor : near(input.caret) ? input.caret : null;
      if (!from) return 0;
      const mid = from.x + from.w / 2;
      return cx === mid ? pick([-1, 1]) : Math.sign(cx - mid);
    }

    chooseNext() {
      this.fleeing = false;
      const r = Math.random();
      const s = this.state;
      if (s === 'question' && !this.snoozed) {
        if (this.wantsCurtain && !this.curtain && !this.answered) return this.ask();
        return this.setMode('wave', 4);
      }
      if (s === 'error' && cfg.idleSleep === false) return r < 0.7 ? this.setMode('sad', rand(3, 6)) : this.setMode('mope', rand(2, 4));
      if (s === 'error' && !this.drooped) {
        this.drooped = true; // a little sad, then a nap
        return this.setMode('sad', rand(3, 5));
      }
      if (s === 'done' && !this.celebrated) {
        this.celebrated = true;
        this.jumps = 3;
        return this.setMode('celebrate', 2.5);
      }
      // a taskbar at the top or side of this screen: pets hold on to it with plungers now and then
      const grab = !this.stick && this.stickEdge();
      if (s === 'working') {
        if (this.stick && r < 0.1) return this.unstick(); // lets go
        if (grab && r < 0.12) {
          this.stickTo(grab);
          return this.walk(rand(2, 4));
        }
        if (r < 0.12 && this.box && this.climb()) return; // up onto a shelf now and then
        return r < 0.6 ? this.setMode('work', rand(3, 7)) : this.walk(rand(2, 4));
      }
      // a question you put off: still waiting, so it moves about, slowly
      if (s === 'question') return r < 0.5 ? this.walk(rand(2, 4), rand(30, 40)) : this.setMode('idle', rand(2, 4));
      if (cfg.idleSleep !== false) {
        // nothing to do: nap where it is, unless a click woke it up
        const touring = this.tour && !this.tour.nap; // the guide stays awake while it talks you through
        if (!(this.awakeUntil > this.t) && !touring) {
          if (grab && Math.random() < 0.3) this.stickTo(grab); // a nap hanging on to the taskbar
          return this.setMode('sleep', rand(8, 16));
        }
        return r < 0.4 ? this.walk(rand(1, 2), rand(35, 50)) : this.setMode('idle', rand(2, 4));
      }
      // free time
      if (this.stick && r < 0.15) return this.unstick();
      if (grab && r < 0.15) {
        this.stickTo(grab);
        return this.walk(rand(2, 5));
      }
      if (this.stick) return r < 0.6 ? this.walk(rand(2, 5)) : this.setMode('idle', rand(1.5, 4));
      if (r < 0.1 && this.climb()) return;
      if (this.kind === 'bird' && r < 0.3) return this.fly();
      if (r < 0.5) return this.walk(rand(2, 5));
      if (r < 0.82) return this.setMode('idle', rand(1.5, 4));
      return this.setMode('sleep', rand(6, 14));
    }

    onWindowsChanged(old) {
      if (this.platform && this.mode !== 'drag' && !this.platform.shelf) {
        const before = old.get(this.platform.id);
        const now = windowsById.get(this.platform.id);
        if (now && before) {
          this.x += now.x - before.x; // ride along when the window moves
          this.y += now.y - before.y;
        }
        const cx = this.x + this.w / 2;
        const seg = now && segments.find((s) => s.id === now.id && cx >= s.x1 && cx <= s.x2);
        if (seg) {
          this.platform = seg;
          this.y = seg.y - this.h;
        } else {
          this.platform = null; // window closed or covered: fall
          if (!['seek', 'curtain', 'drag', 'peek', 'sink', 'escape', 'hidden'].includes(this.mode)) this.setMode('fall', 0);
        }
      }
      if (this.curtain) this.curtain.reposition();
    }

    keepOnScreen() {
      if (this.leaving) return;
      if (this.box) {
        // the box's sides are walls
        const b = this.box;
        const min = b.x + BOX_EDGE;
        const max = Math.max(min, b.x + b.w - BOX_EDGE - this.w);
        if (this.x < min || this.x > max) {
          const left = this.x < min;
          this.x = left ? min : max;
          this.facingLeft = !left;
          this.vx = (left ? 1 : -1) * Math.abs(this.vx) * 0.5;
          if (this.fleeing && this.mode === 'walk') this.setMode('idle', 1.5); // backed into the wall: as far as it goes
        }
        if (this.y < b.y + BOX_BAR) {
          this.y = b.y + BOX_BAR;
          if (this.vy < 0) this.vy = 0;
        }
        if (this.feet > boxFloor(b)) this.y = boxFloor(b) - this.h; // never through the floor
        return;
      }
      const [minX, maxX] = spanX();
      const cx0 = this.x + this.w / 2;
      // walking off a side where another overlay carries on
      if (exits.left && cx0 < minX && this.mode !== 'drag') return handoff(this, 'left');
      if (exits.right && cx0 >= maxX && this.mode !== 'drag') return handoff(this, 'right');
      const min = exits.left ? minX - this.w : minX;
      const max = exits.right ? maxX : maxX - this.w;
      if (this.x < min) {
        this.x = min;
        this.facingLeft = false;
        this.vx = Math.abs(this.vx) * 0.5;
      } else if (this.x > max) {
        this.x = max;
        this.facingLeft = true;
        this.vx = -Math.abs(this.vx) * 0.5;
      }
      // a gap between monitors is a wall too
      const cx = this.x + this.w / 2;
      if (cx >= minX && cx < maxX && !onAnyDisplay(cx)) {
        const d = displayAt(cx);
        const right = cx < d.x;
        this.x = right ? d.x - this.w / 2 + 1 : d.x + d.w - this.w / 2 - 1;
        this.facingLeft = !right;
        this.vx = (right ? 1 : -1) * Math.abs(this.vx) * 0.5;
      }
    }

    // gravity, and landing on window tops or the taskbar
    fallStep(dt) {
      const prevFeet = this.feet;
      if (this.fallTop == null || prevFeet < this.fallTop) this.fallTop = prevFeet; // the top of this fall, for the squish
      this.vy += GRAVITY * dt;
      this.y += this.vy * dt;
      this.x += this.vx * dt;
      this.keepOnScreen();
      if (this.gone || this.vy < 0) return;
      if (this.box && this.box.gravity === false && !this.platform) {
        // a box without gravity: once it stops rising (or you let go of it), it floats right there
        this.vx = this.vy = 0;
        this.fallTop = null;
        if (this.mode === 'fall' || this.mode === 'jump') this.setMode('idle', 0.5);
        return;
      }
      const cx = this.x + this.w / 2;
      let land = null;
      for (const s of segments) {
        if ((s.box || null) !== this.box) continue; // in a box, only its own shelves; outside, no shelves
        if (cx >= s.x1 && cx <= s.x2 && prevFeet <= s.y + 1 && this.feet >= s.y && s.y >= this.h && (!land || s.y < land.y)) land = s;
      }
      const ground = this.box ? boxFloor(this.box) : groundAt(cx, prevFeet);
      if (land || this.feet >= ground) {
        this.platform = land;
        this.y = (land ? land.y : ground) - this.h;
        this.vy = 0;
        this.vx = 0;
        const dizzy = this.squishOnLanding(this.feet - this.fallTop);
        this.fallTop = null;
        if (this.mode === 'fall' || this.mode === 'jump') this.setMode('idle', dizzy ? 1.2 : 0.5);
      }
    }

    // a cartoon landing: squash flat and wide, then spring back; a big drop also kicks up dust and,
    // now and then, leaves it dizzy for a second. Drops of a few pixels get nothing. Returns whether it's dizzy.
    squishOnLanding(drop) {
      const k = clamp((drop - 24) / 300, 0, 1);
      if (cfg.squishy === false || !(k > 0)) return false;
      const dizzy = k > 0.7 && Math.random() < 1 / 6;
      this.squish = { at: this.t, k };
      if (k > 0.4) dustPuff(this.x + this.w / 2, this.feet, this.w, k);
      if (dizzy) {
        const head = this.headPoint();
        this.dizzy.style.left = `${Math.round(head.x)}px`;
        this.dizzy.style.top = `${Math.round(head.y) - 7}px`; // above a cap
        this.dizzy.classList.add('on');
        clearTimeout(this.dizzyTimer);
        this.dizzyTimer = setTimeout(() => this.dizzy.classList.remove('on'), 1100);
      }
      return dizzy;
    }

    // the top centre of its head on the canvas, as last drawn
    headPoint() {
      const [a, size] = this.pack ? [packAnchors(this.pack).hat, this.pack.manifest.frameWidth] : [this.lastHead || { x: 16, y: 8 }, Critters.size];
      const u = this.w / size;
      return { x: (this.facingLeft ? size - a.x : a.x) * u, y: a.y * u };
    }

    // [x scale, y scale] for the squish right now, or null: stretched thin while falling fast,
    // squashed on landing, then a wobble past round and back
    squishScale() {
      if (cfg.squishy === false || this.stick) return null;
      if (this.squish) {
        const u = (this.t - this.squish.at) / SQUISH_SECONDS;
        if (u < 1) {
          const f = this.squish.k * Math.exp(-3 * u) * Math.cos(2.5 * Math.PI * u);
          return [1 + 0.35 * f, 1 - 0.4 * f];
        }
        this.squish = null;
      }
      if (this.mode === 'drag' || this.fallTop == null || this.vy < 300) return null;
      const s = clamp((this.vy - 300) / 900, 0, 1);
      return [1 - 0.08 * s, 1 + 0.1 * s];
    }

    // move along the current surface; returns false if it walked off a window edge
    stepAlong(dir, speed, dt, mayFall) {
      this.facingLeft = dir < 0;
      const before = this.x;
      const wasIn = zoneAt(this.x, this.y, this.w, this.h);
      this.x += dir * speed * dt;
      this.keepOnScreen();
      if (this.gone) return true;
      if (!wasIn && zoneAt(this.x, this.y, this.w, this.h)) {
        // a window pets keep off: it's a wall
        this.x = before;
        this.facingLeft = !this.facingLeft;
        return 'wall';
      }
      if (!this.platform) {
        if (this.box) return true;
        // onto a monitor whose taskbar sits higher: step up (lower ones make it fall)
        const ground = groundAt(this.x + this.w / 2, this.feet);
        if (ground < this.feet - 1) this.y = ground - this.h;
        return true;
      }
      const cx = this.x + this.w / 2;
      if (cx >= this.platform.x1 && cx <= this.platform.x2) return true;
      if (!mayFall) {
        if (this.edgeChoice == null) this.edgeChoice = Math.random() < 0.35 ? 'jump' : 'turn';
        if (this.edgeChoice === 'turn') {
          this.x -= dir * speed * dt;
          this.facingLeft = !this.facingLeft;
          this.edgeChoice = null;
          return true;
        }
      }
      this.platform = null; // off the edge
      return false;
    }

    seekStep(dt) {
      const T = cornerTarget(this);
      if (!T) return this.ask(); // the window went away or pets must keep off it now
      const dx = T.standX - this.x;
      const onRightSurface = this.platform && this.platform.id === T.win;
      if (this.t - this.seekStart > 15 || this.hitWall) {
        // taking too long, or a keep-off window is in the way: pop straight into place
        this.hitWall = false;
        this.unhide();
        this.platform = T.kind === 'window' ? segments.find((s) => s.id === T.win && T.standX + this.w / 2 <= s.x2) || null : null;
        this.x = T.standX;
        this.y = T.feetY - this.h;
        this.vx = this.vy = 0;
        return this.openCurtain(T);
      }
      if (onRightSurface) {
        if (Math.abs(dx) < 4) {
          this.x = T.standX;
          return this.openCurtain(T);
        }
        if (this.stepAlong(Math.sign(dx), Math.min(170, Math.abs(dx) / dt), dt, false) === 'wall') this.hitWall = true;
      } else if (Math.abs(dx) < 240 && !this.hidden) {
        this.jumpTo(T.standX, T.feetY);
      } else if (this.hidden || this.stepAlong(Math.sign(dx), 170, dt, true) === 'wall') {
        this.hitWall = true;
      }
    }

    update(dt) {
      this.t += dt;
      this.chatCooldown -= dt;
      if (this.mode === 'drag') return;
      const shut = cfg.balloonSeconds == null ? 20 : cfg.balloonSeconds;
      const asking = this.state === 'question' && !this.answered && !this.snoozed; // the question timeout handles those
      if (this.balloonOpen && !this.keepOpen && !this.balloonHover && !asking && shut > 0 && this.t - this.balloonOpenedAt > shut) {
        this.toggleBalloon(false);
      }
      const waitLimit = (cfg.askTimeout || 0) * 60;
      if (this.state === 'question' && !this.answered && !this.snoozed && waitLimit > 0 && this.t - (this.askedAt || 0) > waitLimit) this.snooze();

      if (this.mode === 'peek' || this.mode === 'sink') {
        // out of the taskbar's edge (peek), and back behind it (sink)
        const [tx, ty] = this.mode === 'peek' ? this.peekTo : this.peekFrom;
        const step = 260 * dt;
        this.x += clamp(tx - this.x, -step, step);
        this.y += clamp(ty - this.y, -step, step);
        if (this.mode === 'peek' && (this.state !== 'question' || this.answered || this.snoozed)) this.setMode('sink', 0);
        if (this.mode === 'sink' && this.x === tx && this.y === ty) {
          // back behind the taskbar; come out again unless a keep-off window covers the spot
          [this.x, this.y] = this.peekTo;
          if (this.stick) {
            this.stick.peeking = false; // and keep holding on to it
            return this.setMode('idle', 1);
          }
          if (this.box) this.moveIntoBox(this.box); // home to its box
          else if (zoneAt(this.x, this.y, this.w, this.h)) this.hide();
          else this.setMode('idle', 1);
        }
        return;
      }
      if (this.stick && this.mode !== 'hidden') return this.stuckStep(dt);
      if (this.mode === 'hidden') {
        if (this.wantsCurtain && this.state === 'question' && !this.answered && !this.snoozed) return this.ask();
        this.modeLeft -= dt;
        if (this.modeLeft <= 0) {
          this.modeLeft = 1;
          if (this.leaving) this.remove();
          else this.tryUnhide();
        }
        return;
      }
      if (this.mode === 'escape') {
        const dx = this.escapeTo - this.x;
        this.facingLeft = dx < 0;
        this.x += Math.sign(dx) * Math.min(Math.abs(dx), 220 * dt);
        if (Math.abs(dx) < 1) this.setMode('idle', 0.5);
        return;
      }
      if (!['seek', 'curtain'].includes(this.mode)) {
        const z = zoneAt(this.x, this.y, this.w, this.h);
        if (z) return this.escapeZone(z);
      }
      // living on the windows of the apps you picked: off the taskbar and onto one of them, or tuck away
      if (roam() === 'apps' && !this.platform && !this.airborne && !this.leaving && !['seek', 'curtain', 'fly'].includes(this.mode)) {
        const cx = this.x + this.w / 2;
        const fits = segments.filter((s) => s.x2 - s.x1 >= this.w + 4 && s.y >= this.h + 8);
        if (!fits.length) return this.hide();
        const s = fits.reduce((a, b) => (Math.abs((b.x1 + b.x2) / 2 - cx) < Math.abs((a.x1 + a.x2) / 2 - cx) ? b : a));
        this.jumpTo(clamp(this.x, s.x1, s.x2 - this.w), s.y);
        return this.setMode('jump', 0);
      }
      // keys not held: hurry out of the way of the cursor and of where you're typing
      if (holdKeys() && !input.held && !this.balloonOpen && !this.airborne && !this.leaving && !this.fleeing && !['seek', 'curtain', 'fly'].includes(this.mode)) {
        const away = this.awayFrom();
        if (away) {
          this.fleeing = true;
          this.facingLeft = away < 0;
          this.speed = 170;
          this.edgeChoice = null;
          this.setMode('walk', rand(0.8, 1.3));
        }
      }
      if (this.agent && !this.leaving && ['done', 'error', 'idle'].includes(this.state) && this.t - this.lastEventAt > IDLE_LEAVE) {
        this.leave(); // its agent went quiet: wander off (it comes back with the next event)
      }

      if (this.mode === 'fly') {
        const fx = this.x;
        this.x += (this.facingLeft ? -1 : 1) * 130 * dt;
        if (zoneAt(this.x, this.y, this.w, this.h)) {
          this.x = fx; // don't fly into a keep-off window
          this.facingLeft = !this.facingLeft;
        }
        this.y += (this.flyY + Math.sin(this.t * 4) * 12 - this.y) * Math.min(1, dt * 2);
        this.keepOnScreen();
        if (this.gone) return;
        this.modeLeft -= dt;
        if (this.modeLeft <= 0) {
          this.vy = 0;
          this.setMode('fall', 0);
        }
        return;
      }

      if (this.airborne) {
        this.fallStep(dt);
        if (this.airborne || this.mode === 'idle') return;
      }

      if (this.leaving) {
        if (this.mode !== 'walk') this.mode = 'walk';
        if (this.stepAlong(this.facingLeft ? -1 : 1, this.speed, dt, true) === 'wall') return this.remove();
        const [minX, maxX] = spanX();
        if (this.x < minX - this.w - 10 || this.x > maxX + 10) this.remove();
        return;
      }

      switch (this.mode) {
        case 'seek':
          return this.seekStep(dt);
        case 'curtain':
          return;
        case 'walk':
          this.stepAlong(this.facingLeft ? -1 : 1, this.speed, dt, false);
          break;
        case 'mope':
          this.stepAlong(this.facingLeft ? -1 : 1, 22, dt, false);
          break;
        case 'celebrate':
          if (this.jumps > 0) {
            this.jumps--;
            this.vy = -480;
          }
          break;
      }

      this.modeLeft -= dt;
      if (this.modeLeft <= 0) this.chooseNext();
    }

    pose() {
      switch (this.mode) {
        case 'drag':
          return 'drag';
        case 'fly':
          return 'fly';
        case 'mope':
        case 'sad':
          return 'sad';
        case 'curtain':
          return this.t - this.curtainAt < 1.6 ? 'pull' : 'idle';
        case 'peek':
        case 'sink':
          return 'wave';
        case 'escape':
          return 'walk';
        case 'hidden':
          return 'idle';
      }
      if (this.airborne && this.mode !== 'celebrate') return this.kind === 'bird' ? 'fly' : 'fall';
      if (this.mode === 'seek') return 'walk';
      return this.mode === 'jump' ? 'idle' : this.mode;
    }

    drawPack(pose, hat, wear) {
      const { img, manifest: m } = this.pack;
      const anims = m.animations || {};
      let a = null;
      for (const k of [pose, POSE_FALLBACK[pose], 'idle', 'walk']) {
        if (k && anims[k]) {
          a = anims[k];
          break;
        }
      }
      a = a || { row: 0, frames: 1, fps: 1 };
      const frame = Math.floor(this.t * (a.fps || 6)) % (a.frames || 1);
      const flip = m.facing === 'left' ? !this.facingLeft : this.facingLeft;
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.w, this.h);
      ctx.imageSmoothingEnabled = false;
      ctx.save();
      if (flip) {
        ctx.translate(this.w, 0);
        ctx.scale(-1, 1);
      }
      if (pose === 'sad' && !anims.sad) {
        // no sad frames in the pack: droop a little instead
        ctx.translate(0, this.h * 0.06);
        ctx.filter = 'saturate(0.55) brightness(0.92)';
      }
      ctx.drawImage(img, frame * m.frameWidth, (a.row || 0) * m.frameHeight, m.frameWidth, m.frameHeight, 0, 0, this.w, this.h);
      ctx.restore();
      // a pack can say where the top of its critter's head is ("hat": {x, y} in frame pixels, facing right)
      // and where its chest is ("body": {x, y}); without them floof finds them from the sprite itself
      if (hat) {
        const u = this.w / m.frameWidth;
        const facesLeft = m.facing === 'left' ? !flip : flip;
        const at = (a) => [facesLeft ? m.frameWidth - a.x : a.x, a.y];
        const { hat: head, body } = packAnchors(this.pack);
        if (wear === 'tshirt' || wear === 'both') Critters.drawShirtPatch(ctx, ...at(body), u, hat, facesLeft);
        if (wear !== 'tshirt') Critters.drawCap(ctx, ...at(head), u, hat, facesLeft);
      }
    }

    render() {
      // only touch the canvas and the DOM when something visible changed: on a 4K screen
      // redrawing every pet every frame keeps the GPU busy for nothing
      const pose = this.pose();
      const frame = this.pack ? Math.floor(this.t * 12) : Critters.frameOf(pose, this.t);
      // agents wear a cap in their provider's colour, with its initial
      const wear = cfg.providerWear || 'cap'; // cap, tshirt, both or none
      const hat = this.agent && wear !== 'none' ? Critters.providerStyle(this.provider, this.styleExtra()) : null;
      const stuck = this.stick ? this.stick.edge : '';
      const drawKey = `${pose}|${frame}|${this.facingLeft}|${hat ? hat.color + hat.letter + wear : ''}|${stuck}`;
      if (drawKey !== this.lastDraw) {
        this.lastDraw = drawKey;
        if (this.pack) {
          this.drawPack(pose, hat, wear);
          if (stuck) Critters.drawPlungers(this.ctx, this.pack.manifest.frameWidth, this.pack.manifest.frameHeight, this.w / this.pack.manifest.frameWidth);
        } else {
          Critters.draw(this.ctx, this.kind, pose, this.t, this.facingLeft, hat, wear, stuck || false);
          this.lastHead = Critters.headAt();
        }
      }
      // holding on to a taskbar: upside down under a top one, sideways on a left or right one
      const turn = { top: ' scaleY(-1)', left: ' rotate(90deg)', right: ' rotate(-90deg)' }[stuck] || '';
      let move = `translate(${Math.round(this.x)}px, ${Math.round(this.y)}px)${turn}`;
      const sq = this.squishScale();
      if (sq) {
        // squished around the middle, shifted so the feet stay put; whole pixels keep the pixel art crisp
        const ws = this.w + 2 * Math.round((this.w * (sq[0] - 1)) / 2);
        const hs = Math.max(1, Math.round(this.h * sq[1]));
        move = `translate(${Math.round(this.x)}px, ${Math.round(this.y) + (this.h - hs) / 2}px) scale(${ws / this.w}, ${hs / this.h})`;
      }
      if (move !== this.lastMove) {
        this.lastMove = move;
        this.el.style.transform = move;
      }

      // status badge
      let badge = BADGES[this.state] || '';
      if (!badge && this.mode === 'sleep') badge = '💤';
      if (badge !== this.badge.textContent) this.badge.textContent = badge;
      this.badge.classList.toggle('bounce', this.state === 'question' && !this.snoozed && !this.answered);

      const showBar = this.agent && this.state === 'working' && this.progress != null;
      const bar = showBar ? `${Math.round(this.progress * 100)}%` : '';
      if (bar !== this.lastBar) {
        this.lastBar = bar;
        this.bar.style.display = showBar ? 'block' : 'none';
        if (showBar) this.barFill.style.width = bar;
      }

      const cx = this.x + this.w / 2;
      if (this.balloonOpen) {
        const bw = this.balloon.offsetWidth;
        const bh = this.balloon.offsetHeight;
        const d = displayAt(cx, this.feet);
        const left = clamp(cx - bw / 2, d.x + 4, d.x + d.w - bw - 4);
        // under a top taskbar the balloon hangs below the pet
        const top = this.stick && this.stick.edge === 'top' ? this.y + this.h + 14 : Math.max(d.y + 4, this.y - bh - 26);
        this.balloon.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
        this.balloon.style.setProperty('--tail', `${clamp(cx - left, 18, bw - 18)}px`);
      }

      const talking = this.t >= this.sayAt && this.t < this.sayUntil;
      this.chatter.classList.toggle('open', talking && !this.balloonOpen);
      if (talking) {
        if (this.chatter.textContent !== this.sayText) this.chatter.textContent = this.sayText;
        const d = displayAt(cx, this.feet);
        const left = clamp(cx - this.chatter.offsetWidth / 2, d.x + 4, d.x + d.w - this.chatter.offsetWidth - 4);
        this.chatter.style.transform = `translate(${Math.round(left)}px, ${Math.round(Math.max(0, this.y - 34))}px)`;
      }
    }

    // ---------- minis: its subagents ----------

    // a mini for each subagent pickMinis chooses (none with minis off in Settings); the rest fade away
    syncMinis() {
      const picked = cfg.minis === false ? [] : Minis.pickMinis(this.subagents);
      for (const [id, m] of this.minis) {
        if (picked.some((s) => s.id === id)) continue;
        m.fadeOut();
        this.minis.delete(id);
      }
      for (const sub of picked) {
        const m = this.minis.get(sub.id);
        if (m) {
          m.setSub(sub);
          continue;
        }
        const kind = sub.kind && (packs[sub.kind] || Critters.kinds.includes(sub.kind)) ? sub.kind : this.kind;
        this.minis.set(sub.id, new Minis.Mini(this, sub, { kind, pack: packs[kind] || null }));
      }
    }

    // after the pet moved: running minis line up behind it, the napper lies on its back
    updateMinis(dt) {
      if (!this.minis.size) return;
      const span = this.walkSpan();
      let slot = 0;
      for (const m of this.minis.values()) m.update(dt, m.asleep ? 0 : slot++, m.asleep, span);
    }

    // where it can walk, {x1, x2}: inside its box, along the window top or shelf it stands on, or its screen
    walkSpan() {
      if (this.box) return { x1: this.box.x + BOX_EDGE, x2: this.box.x + this.box.w - BOX_EDGE };
      if (this.platform) return { x1: this.platform.x1, x2: this.platform.x2 };
      const d = displayAt(this.x + this.w / 2, this.feet);
      return { x1: d.x, x2: d.x + d.w };
    }

    remove() {
      this.gone = true;
      for (const m of this.minis.values()) m.remove();
      this.minis.clear();
      if (this.curtain) this.curtain.close();
      this.el.remove();
      this.balloon.remove();
      this.chatter.remove();
      pets.delete(this.id);
    }
  }

  // ---------- walking between overlays ----------

  const CARRY = ['kind', 'name', 'provider', 'agent', 'state', 'text', 'progress', 'log', 'facingLeft', 'speed', 't', 'lastEventAt',
    'celebrated', 'answered', 'snoozed', 'askedAt', 'wantsCurtain', 'balloonOpen', 'vx', 'vy', 'mode', 'modeLeft', 'chatCooldown', 'tour', 'keepOpen', 'controls', 'controlNote', 'model', 'capLetter', 'pids', 'url', 'subagents'];

  // hand a pet to the overlay next door ('left', 'right'), or to the one you're using ('focus')
  function handoff(p, side) {
    if (p.gone) return;
    const d = displayAt(p.x + p.w / 2, p.feet);
    const state = { id: p.id, rise: Math.max(0, d.y + d.h - p.feet) };
    for (const k of CARRY) state[k] = p[k];
    if (p.curtain) {
      p.curtain.close();
      if (p.state === 'question' && !p.answered) state.wantsCurtain = true;
    }
    p.remove();
    departed.set(p.id, performance.now());
    api.handoff(side, state);
  }

  function adopt({ side, pet: s }) {
    if (!s || pets.has(s.id)) return;
    const p = new Pet({ id: s.id, kind: packs[s.kind] || Critters.kinds.includes(s.kind) ? s.kind : resolveKind(null, s.id), name: s.name, provider: s.provider, agent: s.agent });
    for (const k of CARRY) if (k in s && !['kind', 'balloonOpen'].includes(k)) p[k] = s[k];
    p.renderTag();
    p.syncMinis(); // its minis come along
    const [minX, maxX] = spanX();
    if (side === 'left' || side === 'right') {
      // came in through the edge it walked out of
      p.x = side === 'left' ? maxX - p.w / 2 - 1 : minX - p.w / 2 + 1;
      const ground = groundAt(p.x + p.w / 2);
      p.y = Math.min(ground, ground - s.rise) - p.h;
    } else {
      // 'focus' or nowhere to go: drop in on the monitor you're using
      const d = side === 'focus' ? focusDisplay() : primaryDisplay();
      p.x = rand(d.x, d.x + d.w - p.w);
      p.y = -p.h;
      p.vx = p.vy = 0;
      p.cameToAsk = side === 'focus'; // you couldn't see it, so it uses the curtain or the tray, not just a balloon
      if (!side) p.stayUntil = p.t + 30; // the other overlay wasn't there: ask from here
    }
    p.platform = null;
    p.flyY = p.y;
    if (['seek', 'curtain', 'chat', 'jump', 'peek', 'sink', 'escape', 'hidden', 'drag'].includes(p.mode)) p.setMode('fall', 0);
    if (roam() === 'boxes') p.moveIntoBox(pickBox());
    pets.set(p.id, p);
    if (s.mode === 'hidden') return p.hide(); // came over tucked away: it comes out where it can live
    if (s.balloonOpen) p.toggleBalloon(true);
  }

  // ---------- pets meeting each other ----------

  function smallTalk(p) {
    if (p.state === 'working') return `💬 busy with ${short(p.name, 16)}`;
    if (p.state === 'done') return '🎉 finished!';
    if (p.state === 'error') return '🥺 it went wrong';
    if (p.state === 'question') return '🙋 waiting on my human';
    return pick(SMALL_TALK);
  }

  function interact() {
    const free = ['walk', 'idle', 'mope', 'work', 'sleep', 'sad', 'wave'];
    const list = [...pets.values()].filter((p) => !p.leaving && !p.hidden && !p.airborne && free.includes(p.mode));
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        let a = list[i];
        let b = list[j];
        if (a.platform !== b.platform || a.box !== b.box || a.stick || b.stick) continue; // not on the same surface
        if (a.x > b.x) [a, b] = [b, a]; // a is on the left
        const gap = b.x + b.w / 2 - (a.x + a.w / 2);
        if (gap > (a.w + b.w) * 0.35) continue;
        if (a.chatCooldown > 0 || b.chatCooldown > 0) continue;
        a.chatCooldown = b.chatCooldown = 6;
        const calm = (p) => ['walk', 'idle'].includes(p.mode) && p.state !== 'question';
        if (calm(a) && calm(b) && Math.random() < 0.5) {
          // stop, face each other and chat
          a.setMode('chat', 3.4);
          b.setMode('chat', 3.4);
          a.facingLeft = false;
          b.facingLeft = true;
          a.say(smallTalk(a), 0, 1.6);
          b.say(smallTalk(b), 1.7, 1.6);
        } else if (a.state === 'error' || b.state === 'error') {
          // a friend comes over to cheer up a sad pet
          const [sad, friend] = a.state === 'error' ? [a, b] : [b, a];
          if (friend.state !== 'error' && friend.mode !== 'sleep') {
            friend.say(pick(['🫂 there there', '🍪 cookie?', '💛 you got this']), 0, 2);
            friend.setMode('idle', 2.2);
            friend.facingLeft = friend.x > sad.x;
          }
        } else {
          // bump: walkers turn around with a little hop
          if (a.mode === 'walk' && !a.facingLeft) {
            a.facingLeft = true;
            a.vy = -200;
          }
          if (b.mode === 'walk' && b.facingLeft) {
            b.facingLeft = false;
            b.vy = -200;
          }
        }
      }
    }
  }

  // ---------- mouse: click-through, dragging, balloons ----------

  let interactive = false;
  let lastMouse = null;
  let drag = null;

  function setInteractive(on) {
    if (on === interactive) return;
    interactive = on;
    api.setInteractive(on);
  }
  function updateInteractive() {
    if (drag || boxDrag || !lastMouse) return;
    const el = document.elementFromPoint(lastMouse.x, lastMouse.y);
    const hit = el && el.closest('.pet, .balloon, .curtain, .petbox-bar, .petbox-grip');
    // without the key combination, only a question waiting for your answer takes clicks
    const arranging = el && el.closest('.petbox.editing');
    // without the key combination, only a question waiting for your answer, or a box you're arranging, takes clicks
    setInteractive(!!arranging || (!!hit && (canTouch() || hit.matches('.curtain, .balloon.asking, .balloon.touring, .balloon.typing'))));
  }

  function onInput(next) {
    input = next;
    if (next.cursor) lastMouse = { x: next.cursor.x, y: next.cursor.y };
    document.body.classList.toggle('interact', holdKeys() && next.held);
    updateInteractive();
  }

  // pet boxes: drag the title bar to move one, the corner to resize it
  let boxDrag = null;
  function startBoxDrag(b, e, kind) {
    if (e.target.closest('button')) return; // ✎ ⚙ × + shelf
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    boxDrag = { b, kind, sx: e.clientX, sy: e.clientY, start: { x: b.x, y: b.y, w: b.w, h: b.h } };
  }
  window.addEventListener('pointermove', (e) => {
    if (!boxDrag) return;
    const { b, kind, start } = boxDrag;
    const dx = e.clientX - boxDrag.sx;
    const dy = e.clientY - boxDrag.sy;
    const ox = b.x;
    const oy = b.y;
    Object.assign(b, fitBox(kind === 'move' ? { ...start, x: start.x + dx, y: start.y + dy } : { ...start, w: start.w + dx, h: start.h + dy }));
    placeBox(b);
    for (const p of pets.values()) {
      if (p.box !== b) continue;
      p.x += b.x - ox; // the pets ride along
      p.y += b.y - oy;
      p.fitInBox();
    }
    computeSegments(); // pets on shelves stay on them
  });
  window.addEventListener('pointerup', () => {
    if (!boxDrag) return;
    const { b } = boxDrag;
    boxDrag = null;
    api.saveBox({ id: b.id, display: overlayKey, x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) });
  });

  // arranging (✎): drag a shelf to move it, drag its ends to resize it. Snaps to an 8 px grid and
  // to the height of the box's other shelves.
  let shelfDrag = null;
  function startShelfDrag(b, id, e) {
    const s = b.shelves.find((x) => x.id === id);
    if (!b.editing || !s) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const end = e.target.closest('.end');
    const kind = end ? (end.classList.contains('left') ? 'left' : 'right') : 'move';
    shelfDrag = { b, s, kind, sx: e.clientX, sy: e.clientY, start: shelfRect(b, s) };
  }
  window.addEventListener('pointermove', (e) => {
    if (!shelfDrag) return;
    const { b, s, kind, start } = shelfDrag;
    const r = inside(b);
    const grid = (v) => r.left + Math.round((v - r.left) / 8) * 8;
    const dx = e.clientX - shelfDrag.sx;
    let { x1, x2, y } = start;
    if (kind === 'move') {
      const w = x2 - x1;
      x1 = clamp(grid(x1 + dx), r.left, r.left + r.w - w);
      x2 = x1 + w;
      y = start.y + (e.clientY - shelfDrag.sy);
      const level = b.shelves.filter((o) => o !== s).map((o) => shelfRect(b, o).y).find((oy) => Math.abs(oy - y) < 6);
      y = clamp(level != null ? level : r.top + Math.round((y - r.top) / 8) * 8, r.top + 8, r.top + r.h - 6);
    } else if (kind === 'left') {
      x1 = clamp(grid(x1 + dx), r.left, x2 - SHELF_MIN);
    } else {
      x2 = clamp(grid(x2 + dx), x1 + SHELF_MIN, r.left + r.w);
    }
    Object.assign(s, { x: (x1 - r.left) / r.w, w: (x2 - x1) / r.w, y: (y - r.top) / r.h });
    placeShelves(b);
    computeSegments(); // pets on it ride along, or fall off if it slides out from under them
  });
  window.addEventListener('pointerup', () => {
    if (!shelfDrag) return;
    const { b } = shelfDrag;
    shelfDrag = null;
    saveShelves(b);
  });
  window.addEventListener('mousemove', (e) => {
    lastMouse = { x: e.clientX, y: e.clientY };
    updateInteractive();
  });
  setInterval(updateInteractive, 200); // pets move under a still cursor too

  function startDrag(p, e) {
    e.preventDefault();
    if (!canTouch()) return;
    p.el.setPointerCapture(e.pointerId);
    drag = { p, ox: e.clientX - p.x, oy: e.clientY - p.y, sx: e.clientX, sy: e.clientY, moved: false, vx: 0, vy: 0, lx: e.clientX, ly: e.clientY, lt: performance.now() };
  }
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const { p } = drag;
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 5) {
      drag.moved = true;
      if (p.curtain) {
        p.curtain.close();
        p.wantsCurtain = true; // it will go back once you let go
      }
      p.mode = 'drag';
      p.platform = null;
      p.fallTop = null; // its fall starts where you let go
      p.stick = null; // pulled off the taskbar
      p.el.classList.add('dragging');
    }
    if (!drag.moved) return;
    const now = performance.now();
    const dt = Math.max(1, now - drag.lt) / 1000;
    drag.vx = drag.vx * 0.6 + ((e.clientX - drag.lx) / dt) * 0.4;
    drag.vy = drag.vy * 0.6 + ((e.clientY - drag.ly) / dt) * 0.4;
    drag.lx = e.clientX;
    drag.ly = e.clientY;
    drag.lt = now;
    p.x = clamp(e.clientX - drag.ox, 0, innerWidth - p.w);
    p.y = clamp(e.clientY - drag.oy, 0, innerHeight - p.h);
  });
  window.addEventListener('pointerup', () => {
    if (!drag) return;
    const { p } = drag;
    p.el.classList.remove('dragging');
    if (!drag.moved) {
      if (p.tour && p.tour.wait === 'click') api.tour('clicked'); // the guide asked you to click it
      else p.toggleBalloon();
    } else {
      p.vx = clamp(drag.vx, -900, 900); // throw
      p.vy = clamp(drag.vy, -900, 900);
      if (roam() === 'boxes') p.box = boxAt(p.x + p.w / 2, p.y + p.h / 2) || p.box || pickBox(); // drop it into another box
      p.setMode('fall', 0);
    }
    drag = null;
  });
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    for (const p of pets.values()) if (p.balloonOpen) p.toggleBalloon(false);
    for (const b of boxes) if (b.editing) setEditing(b, false); // done arranging
  });

  // ---------- spawning ----------

  function spawnWild(kind) {
    const id = `wild-${++wildCount}`;
    pets.set(id, new Pet({ id, kind, name: kind }));
  }

  function spawnWildFlock() {
    if (!isHome) return; // the critters start out on the main monitor
    for (const k of [...Critters.kinds, ...Object.keys(packs)]) if (!sentAway(k)) spawnWild(k);
  }
  const sentAway = (kind) => (cfg.sentAway || []).includes(kind);

  // from its balloon or the pet list: a free critter leaves and its kind stays away; an agent's pet just leaves
  function removePet(id) {
    const p = pets.get(id);
    if (!p || p.leaving || p.tour) return;
    if (!p.agent) api.sendAway(p.kind);
    p.leave();
  }

  function onAgentEvent(ev) {
    let p = pets.get(ev.id);
    if (!p && performance.now() - (departed.get(ev.id) || -1e9) < 3000) return api.reroute(ev); // it just walked next door
    if (ev.state === 'bye') {
      if (p) p.leave();
      return;
    }
    if (!p || p.leaving) {
      if (p) p.remove();
      const kind = /ollama/i.test(ev.provider || '') ? 'llama' : resolveKind(ev.critter, ev.id); // Ollama agents are llamas
      p = new Pet({ id: ev.id, kind, name: ev.name, provider: ev.provider, agent: true });
      pets.set(ev.id, p);
    }
    p.applyEvent(ev);
  }

  function applySettings(next) {
    const before = cfg;
    cfg = next;
    if (before.scale !== next.scale) for (const p of pets.values()) if (!p.pack) p.resize();
    if (before.minis !== next.minis) for (const p of pets.values()) p.syncMinis();
    const wild = [...pets.values()].filter((p) => !p.agent && !p.leaving);
    if (!next.wildCritters) wild.forEach((p) => p.leave());
    else if (!before.wildCritters && !wild.length) spawnWildFlock();
    if (!next.curtain) for (const p of pets.values()) {
      if (!p.curtain) continue;
      p.curtain.close();
      p.wantsCurtain = !p.answered && !p.snoozed; // ask another way
    }
    renderBoxes();
    setWindows(lastWindowList);
  }

  // ---------- main loop ----------

  let last = performance.now();
  const FRAME_MS = 1000 / 30; // 30 fps is plenty for pixel pets and halves the work
  let timing = null; // with --log-pets: {frames, sum, max} ms of work per frame, for the report
  function frame(now) {
    if (now - last < FRAME_MS - 2) return requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const workStart = timing && performance.now();
    for (const p of [...pets.values()]) {
      p.update(dt);
      p.updateMinis(dt);
    }
    interact();
    for (const p of pets.values()) {
      p.render();
      for (const m of p.minis.values()) m.render();
    }
    if (timing) {
      const ms = performance.now() - workStart;
      timing.frames++;
      timing.sum += ms;
      timing.max = Math.max(timing.max, ms);
    }
    requestAnimationFrame(frame);
  }

  (async function start() {
    cfg = await api.getSettings();
    setDisplays(await api.getDisplays());
    await loadPacks();
    renderBoxes();
    if (cfg.wildCritters) spawnWildFlock();
    api.onAgentEvent(onAgentEvent);
    api.onSpawn(spawnWild);
    api.onRemovePet(removePet);
    api.onRemoveCritters(() => [...pets.values()].filter((p) => !p.agent && !p.tour && !p.leaving).forEach((p) => p.leave()));
    api.onReloadPacks(async () => {
      const had = new Set(Object.keys(packs));
      await loadPacks();
      if (cfg.wildCritters && isHome) for (const name of Object.keys(packs)) if (!had.has(name)) spawnWild(name); // say hi to new critters
    });
    api.onSettings(applySettings);
    api.onWindows(setWindows);
    api.onAdopt(adopt);
    api.onInput(onInput);
    // the pet list: what's on this overlay, every couple of seconds
    setInterval(() => {
      api.petsReport(
        [...pets.values()].filter((p) => !p.gone).map((p) => ({
          id: p.id,
          kind: p.kind,
          name: p.name,
          provider: p.provider,
          agent: p.agent,
          state: p.state,
          mode: p.mode,
          text: p.text,
          hidden: p.hidden,
          leaving: p.leaving,
          asking: p.state === 'question' && !p.answered,
          snoozed: !!p.snoozed,
          controls: p.agent && !p.tour ? p.controls || [] : [],
          model: p.model || '',
          canGo: !!(p.agent && !p.tour && ((p.pids && p.pids.length) || p.url)),
          badge: p.agent ? (Critters.providerStyle(p.provider, p.styleExtra()) || {}).letter || '' : '',
          capColor: p.agent ? (Critters.providerStyle(p.provider, p.styleExtra()) || {}).color || '' : '',
          controlNote: p.controlNote || '',
          monitor: displays.indexOf(displayAt(p.x + p.w / 2, p.feet)),
        }))
      );
    }, 2000);
    api.onFindPet((id) => {
      const p = pets.get(id);
      if (!p || p.hidden) return;
      if (!p.airborne && p.mode !== 'peek') {
        p.vy = -420;
        p.platform = null;
        if (p.mode === 'sleep') p.setMode('idle', 2);
      }
      p.el.classList.remove('flash');
      void p.el.offsetWidth; // restart the animation
      p.el.classList.add('flash');
      setTimeout(() => p.el.classList.remove('flash'), 2600);
    });
    // how a message or Stop you sent is getting on
    api.onControlStatus(({ id, message, stop }) => {
      const p = pets.get(id);
      if (!p) return;
      const claude = /claude/i.test(p.provider);
      const notes = {
        message: {
          queued: claude ? "Message waiting for Claude's next step…" : 'Message waiting for the agent to pick it up…',
          delivered: 'Message delivered ✓',
          sent: 'Message sent ✓',
          failed: "Couldn't send the message",
        },
        stop: {
          queued: claude ? 'Stopping at its next step…' : 'Stop waiting for the agent to pick it up…',
          delivered: 'Stopped ■',
          sent: 'Stop sent ■',
          failed: "Couldn't send Stop",
        },
      };
      p.controlNote = message ? notes.message[message] : notes.stop[stop];
      if (p.balloonOpen) p.renderBalloon();
    });
    api.onAnswered(({ id, text }) => {
      const p = pets.get(id);
      if (p && p.state === 'question' && !p.answered) p.markAnswered(text);
    });
    api.onDisplays((info) => {
      setDisplays(info);
      for (const p of pets.values()) if (p.stick && p.mode !== 'peek' && p.mode !== 'sink') p.unstick(); // the taskbar may have moved
      renderBoxes();
      setWindows(lastWindowList);
      for (const p of pets.values()) if (!p.box && !p.platform && !p.airborne) p.y = groundAt(p.x + p.w / 2) - p.h;
    });
    api.onFocusPet((id) => {
      const p = pets.get(id);
      if (p && !p.curtain && !p.hidden) p.toggleBalloon(true);
    });
    if (await api.isDebug()) {
      window.floofDebug = { pets, windows: () => windows, zones: () => zones, displays: () => displays, exits: () => exits };
      timing = { frames: 0, sum: 0, max: 0 };
      setInterval(() => {
        // ms of update + render work per frame over the last 3 s, and frames per second
        const t = timing;
        timing = { frames: 0, sum: 0, max: 0 };
        const round = (ms) => Math.round(ms * 10) / 10;
        api.debugReport({
          frame: { avg: round(t.sum / Math.max(1, t.frames)), max: round(t.max), fps: round(t.frames / 3) },
          minis: [...pets.values()].reduce((n, p) => n + p.minis.size, 0),
          windows: windows.length,
          keepOff: zones.length,
          roam: roam(),
          packAnchors: Object.entries(packs).map(([n, p]) => `${n}:${p.anchors ? (p.anchors.found ? 'found' : 'guessed') : 'unused'}`),
          input: { held: input.held, cursor: input.cursor && [Math.round(input.cursor.x), Math.round(input.cursor.y)], caret: !!input.caret },
          boxes: boxes.map((b) => `${b.id} ${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}x${Math.round(b.h)}`),
          ledges: segments.length,
          pets: [...pets.values()].map((p) => ({
            id: p.id,
            kind: p.kind,
            x: Math.round(p.x),
            feet: Math.round(p.feet),
            mode: p.mode,
            state: p.state,
            on: p.hidden ? 'hidden' : p.stick ? `stuck ${p.stick.edge}` : p.platform ? (p.platform.shelf ? 'shelf' : `window ${p.platform.id}`) : p.box ? 'box floor' : 'taskbar',
            monitor: displays.indexOf(displayAt(p.x + p.w / 2, p.feet)),
            curtain: p.curtain ? p.curtain.target.kind : null,
          })),
        });
      }, 3000);
    }
    requestAnimationFrame(frame);
  })();
})();
