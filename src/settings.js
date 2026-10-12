// Settings, stored as JSON in the app's user data folder (%APPDATA%\floof\settings.json).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const DEFAULTS = {
  port: 4417,
  scale: 3, // size of the built-in critters (pixel scale)
  wildCritters: true, // free-roaming cat, dog, bird and sheep with no agent
  sentAway: [], // kinds of free critter you sent away: they don't come out when floof starts
  walkOnWindows: true, // pets stand on top of open windows, not just the taskbar
  allMonitors: true, // up to 0.15: off meant only the main screen; now read once to fill in "screens"
  screens: [], // the screens pets may use: [{id, label, w, h}] (empty = all)
  curtain: true, // a pet you can't see pulls open a window corner like a curtain to ask its question
  balloonSeconds: 20, // a balloon you opened closes after this many seconds unless you pin it (0 = stays open)
  askTimeout: 5, // minutes a question waits for you before the pet puts it away and wanders again (0 = keep waiting)
  keepOff: [], // windows pets never walk on, cover or pull a curtain over: rules {app (exe name), title (contains, '' = any)}
  keepOffFullscreen: true, // treat full-screen windows (games, videos, presentations) the same way
  tourDone: false, // the guide sheep has shown you around (or you skipped it)
  compatLetter: 'O', // the letter OpenAI-compatible agents wear (1 or 2 characters)
  badges: [], // your own letter for particular agents: [{id, badge}], set from the pet list
  providerWear: 'cap', // what agents' pets wear in their provider's colour, with its initial: cap, tshirt, both or none
  claudeSteps: true, // with Claude Code connected, show each tool call in its pet's balloon (about 0.07 s per call)
  interactKeys: 'ctrl+alt', // hold these to click or drag pets; otherwise they keep out of your way ('' = always clickable)
  idleSleep: true, // free critters and idle agents nap until clicked; only busy agents and ones waiting for you move about
  minis: true, // agents' subagents show as small copies of their pet that follow it
  roam: 'everywhere', // where pets live: 'everywhere', 'apps' (only on the windows of homeApps) or 'boxes'
  homeApps: [], // windows pets live on when roam is 'apps': rules {app, title} like keepOff
  // pet boxes: {id, display (overlay key), x, y, w, h} in that overlay's coordinates, plus
  // bg {type: 'none' | 'color' | 'picture', color, opacity, picture (a copy in userData/boxes), fit: 'fill' | 'fit' | 'tile'},
  // shelves [{id, x, y, w}] as fractions of the box inside, and shelfColor ('' = wood)
  boxes: [],
  boxDefaults: { bg: { type: 'none', color: '#fff6e0', opacity: 0.5, picture: '', fit: 'fill' }, shelfColor: '', gravity: true }, // for new boxes
  fortunes: true, // idle and agent-less pets sometimes share a fortune when clicked
  squishy: true, // pets squash and wobble when they land from a fall
  notify: { questions: true, done: true, errors: true },
  startAtLogin: false,
  relay: { enabled: false, server: 'https://ntfy.sh', topic: '' }, // for cloud agents
};

function isObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

const frac = (v, d) => (v != null && Number.isFinite(Number(v)) ? Math.max(0, Math.min(1, Number(v))) : d);
const colorOr = (c, d) => (/^#[0-9a-f]{6}$/i.test(String(c || '')) ? String(c) : d);
function cleanBg(bg) {
  const b = bg && typeof bg === 'object' ? bg : {};
  return {
    type: ['none', 'color', 'picture'].includes(b.type) ? b.type : 'none',
    color: colorOr(b.color, '#fff6e0'),
    opacity: frac(b.opacity, 0.5),
    picture: typeof b.picture === 'string' ? b.picture : '',
    fit: ['fill', 'fit', 'tile'].includes(b.fit) ? b.fit : 'fill',
  };
}

// a window rule: an app, and optionally text its title contains. Plain app names (up to 0.15) still work.
function cleanRules(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : [])
    .map((r) => (typeof r === 'string' ? { app: r, title: '' } : { app: String((r && r.app) || ''), title: String((r && r.title) || '') }))
    .map((r) => ({ app: r.app.trim(), title: r.title.trim().slice(0, 200) }))
    .filter((r) => r.app && !seen.has(`|`) && seen.add(`|`));
}

function merge(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    if (!(k in base)) continue; // ignore unknown keys
    out[k] = isObject(base[k]) ? merge(base[k], v) : v;
  }
  return out;
}

class Settings extends EventEmitter {
  constructor(dir) {
    super();
    this.file = path.join(dir, 'settings.json');
    let saved = {};
    try {
      saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      // first run, or unreadable file: start from defaults
    }
    this.value = merge(DEFAULTS, saved);
    this.value.keepOff = cleanRules(this.value.keepOff); // plain app names from before 0.16 become rules
    this.value.homeApps = cleanRules(this.value.homeApps);
    // 0.7–0.10 had an on/off "providerHats": off means they wear nothing
    if (saved && saved.providerWear === undefined && saved.providerHats === false) this.value.providerWear = 'none';
    if (!this.value.relay.topic) this.value.relay.topic = `floof-${crypto.randomBytes(12).toString('hex')}`;
    this.save();
  }

  get() {
    return JSON.parse(JSON.stringify(this.value));
  }

  update(patch) {
    const before = this.value;
    this.value = merge(this.value, patch);
    this.value.port = Math.max(1024, Math.min(65535, Number(this.value.port) || DEFAULTS.port));
    this.value.scale = Math.max(1, Math.min(8, Number(this.value.scale) || DEFAULTS.scale));
    this.value.balloonSeconds = Math.max(0, Math.min(3600, Number(this.value.balloonSeconds) || 0));
    this.value.askTimeout =Math.max(0, Math.min(1440, Number(this.value.askTimeout) || 0));
    this.value.keepOff = cleanRules(this.value.keepOff);
    if (!['everywhere', 'apps', 'boxes'].includes(this.value.roam)) this.value.roam = 'everywhere';
    if (!['cap', 'tshirt', 'both', 'none'].includes(this.value.providerWear)) this.value.providerWear = 'cap';
    this.value.compatLetter = String(this.value.compatLetter || '').trim().slice(0, 2) || 'O';
    this.value.badges = (Array.isArray(this.value.badges) ? this.value.badges : [])
      .filter((b) => b && b.id && String(b.badge || '').trim())
      .map((b) => ({ id: String(b.id).slice(0, 200), badge: String(b.badge).trim().slice(0, 2) }))
      .slice(-200);
    this.value.interactKeys = String(this.value.interactKeys || '').toLowerCase().replace(/\s+/g, '');
    if (this.value.interactKeys && !/^(ctrl|alt|shift|win)(\+(ctrl|alt|shift|win))*$/.test(this.value.interactKeys)) this.value.interactKeys = DEFAULTS.interactKeys;
    this.value.homeApps = cleanRules(this.value.homeApps);
    this.value.screens = (Array.isArray(this.value.screens) ? this.value.screens : [])
      .filter((s) => s && s.id != null)
      .map((s) => ({ id: String(s.id), label: String(s.label || ''), w: Number(s.w) || 0, h: Number(s.h) || 0 }));
    if (!Array.isArray(this.value.boxes)) this.value.boxes = [];
    this.value.boxes = this.value.boxes
      .filter((b) => b && typeof b.id === 'string')
      .map((b) => ({
        id: b.id,
        display: String(b.display || ''),
        x: Number(b.x) || 0,
        y: Number(b.y) || 0,
        w: Math.max(180, Number(b.w) || 360),
        h: Math.max(150, Number(b.h) || 220),
        bg: cleanBg(b.bg),
        shelves: (Array.isArray(b.shelves) ? b.shelves : []).slice(0, 24).map((s) => ({
          id: String((s && s.id) || Math.random().toString(36).slice(2, 8)),
          x: frac(s && s.x, 0),
          y: frac(s && s.y, 0.5),
          w: frac(s && s.w, 0.3),
        })),
        shelfColor: colorOr(b.shelfColor, ''),
        gravity: b.gravity !== false,
      }));
    const d = this.value.boxDefaults || {};
    this.value.boxDefaults = { bg: cleanBg(d.bg), shelfColor: colorOr(d.shelfColor, ''), gravity: d.gravity !== false };
    this.save();
    this.emit('change', this.get(), before);
    return this.get();
  }

  newRelayTopic() {
    return this.update({ relay: { topic: `floof-${crypto.randomBytes(12).toString('hex')}` } });
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.value, null, 2));
  }
}

module.exports = { Settings, DEFAULTS };
