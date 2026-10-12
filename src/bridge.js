// The local agent bridge: a tiny HTTP server agents on this PC report to.
// POST /event         {id, state, name?, provider?, critter?, text?, progress?}
// GET  /answers/<id>  -> {answers: [...]} (answers typed into that pet's balloon; cleared on read)
// POST /hook/claude-code  a Claude Code hook payload as is; the reply is what the hook prints for Claude Code
//                         (a message or Stop you sent from the balloon), or empty
// GET  /control/<id>  -> {messages: [...], stop: bool} sent from that pet's balloon (cleared on read)
// POST /control/<id>  {type: 'message' | 'stop', text} sends one, like the balloon does
// GET  /health
const http = require('http');

const CONTROLS = ['message', 'stop'];

const STATES = new Set(['idle', 'working', 'question', 'done', 'error', 'bye']);

function normalizeEvent(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('body must be a JSON object');
  const id = String(raw.id || '').slice(0, 200);
  if (!id) throw new Error('"id" is required');
  const state = String(raw.state || 'working');
  if (!STATES.has(state)) throw new Error(`"state" must be one of ${[...STATES].join(', ')}`);
  const ev = { id, state };
  // a subagent of that agent: it shows as a mini that follows the agent's pet
  if (raw.parent && String(raw.parent) !== id) ev.parent = String(raw.parent).slice(0, 200);
  if (raw.name) ev.name = String(raw.name).slice(0, 80);
  if (raw.provider) ev.provider = String(raw.provider).slice(0, 40);
  if (raw.critter) ev.critter = String(raw.critter).slice(0, 80);
  if (raw.model) ev.model = String(raw.model).slice(0, 60); // e.g. "qwen2.5-coder:7b": Ollama pets wear its initial
  if (raw.badge) ev.badge = String(raw.badge).trim().slice(0, 2); // a letter of your own for the cap or shirt
  if (raw.text) ev.text = String(raw.text).slice(0, 2000);
  if (raw.progress != null && Number.isFinite(Number(raw.progress))) {
    ev.progress = Math.max(0, Math.min(1, Number(raw.progress)));
  }
  // what the agent can take from its balloon: messages, a Stop (see GET /control/<id>)
  if (Array.isArray(raw.controls)) ev.controls = raw.controls.filter((c) => CONTROLS.includes(c));
  // "Take me there": a local agent's process (and its parents), or a web page for a cloud agent
  const pids = cleanPids(raw.pids != null ? raw.pids : raw.pid);
  if (pids.length) ev.pids = pids;
  if (raw.url && /^https?:\/\//i.test(String(raw.url))) ev.url = String(raw.url).slice(0, 500);
  return ev;
}

// "123,456" or [123, 456] or 123 -> [123, 456]: process ids, at most 12
function cleanPids(v) {
  const list = Array.isArray(v) ? v : String(v == null ? '' : v).split(',');
  return list.map((p) => Number(p)).filter((p) => Number.isInteger(p) && p > 4).slice(0, 12);
}

class Answers {
  constructor() {
    this.map = new Map(); // agent id -> [answer text, ...]
  }
  push(id, text) {
    if (!this.map.has(id)) this.map.set(id, []);
    this.map.get(id).push(text);
  }
  take(id) {
    const list = this.map.get(id) || [];
    this.map.delete(id);
    return list;
  }
  shift(id) {
    const list = this.map.get(id);
    return list && list.length ? list.shift() : null;
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function startBridge({ port, answers, onEvent, onClaudeHook, takeControl, addControl = () => {}, log }) {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') return sendJson(res, 200, { ok: true });

    if (req.method === 'GET' && req.url.startsWith('/answers/')) {
      const id = decodeURIComponent(req.url.slice('/answers/'.length));
      return sendJson(res, 200, { answers: answers.take(id) });
    }

    if (req.method === 'GET' && req.url.startsWith('/control/')) {
      const id = decodeURIComponent(req.url.slice('/control/'.length));
      return sendJson(res, 200, takeControl ? takeControl(id) : { messages: [], stop: false });
    }

    // the same as the balloon's message box and Stop, for scripts: {"type": "message" | "stop", "text": "..."}
    if (req.method === 'POST' && req.url.startsWith('/control/')) {
      const id = decodeURIComponent(req.url.slice('/control/'.length));
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 64 * 1024) req.destroy();
      });
      req.on('end', () => {
        try {
          const { type, text } = JSON.parse(body || '{}');
          if (!CONTROLS.includes(type)) throw new Error('"type" must be "message" or "stop"');
          addControl(id, type, text);
          sendJson(res, 200, { ok: true });
        } catch (err) {
          sendJson(res, 400, { ok: false, error: err.message });
        }
      });
      return;
    }

    const [route, query] = req.url.split('?');
    if (req.method === 'POST' && (route === '/event' || route === '/hook/claude-code')) {
      const hook = route !== '/event';
      // the hook's parent processes, for "Take me there"
      const pids = hook ? cleanPids(new URLSearchParams(query || '').get('pids')) : [];
      // hook payloads can carry whole files (a Write's content), so they may be bigger
      const limit = hook ? 16 * 1024 * 1024 : 64 * 1024;
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > limit) req.destroy();
      });
      req.on('end', () => {
        try {
          const raw = JSON.parse(body);
          if (hook) {
            // the reply body is printed by the hook as is: Claude Code reads it as the hook's output
            const output = onClaudeHook ? onClaudeHook(raw, { pids }) : null;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(output ? JSON.stringify(output) : '');
          }
          onEvent(normalizeEvent(raw));
          sendJson(res, 200, { ok: true });
        } catch (err) {
          sendJson(res, 400, { ok: false, error: err.message });
        }
      });
      return;
    }

    sendJson(res, 404, { ok: false, error: 'not found' });
  });
  server.on('error', (err) => log(`bridge failed on port ${port}: ${err.message}`));
  // Localhost only: nothing outside this PC can send events (cloud agents go through the relay).
  server.listen(port, '127.0.0.1', () => log(`listening on http://127.0.0.1:${port}`));
  return server;
}

module.exports = { startBridge, normalizeEvent, Answers };
