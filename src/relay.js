// Cloud relay. Cloud agents can't reach 127.0.0.1, so they publish events to a private
// ntfy topic (https://ntfy.sh by default, or your own ntfy server) and floof subscribes.
// Answers typed into a cloud agent's balloon are published to "<topic>-answers".
// The topic name is the secret: anyone who knows it can send events to your pets.
// A message can be a floof event, or a Claude Code hook payload as is (a cloud session's hook
// can pipe its input straight to the topic with curl).
const { normalizeEvent } = require('./bridge');
const { claudeCodeEvent } = require('./claude-code');

const RETRY_MS = 10000;
const SILENCE_MS = 120000; // ntfy sends a keepalive about every 45 s; this long without one, the connection is dead

// A message body as an object. Besides JSON (with or without the byte order mark PowerShell likes to add), it reads the
// quote-less {id:job-42,state:working,text:Hi} that Windows' cmd makes of a bash curl line, quotes and all: cmd keeps
// the single quotes and drops the double ones. Values can't contain commas that way, so that's the one thing it splits on.
function parseBody(text) {
  const s = text.replace(/^﻿/, '').trim();
  try {
    return JSON.parse(s);
  } catch (err) {
    const loose = /^'?\{([^"{}]*)\}'?$/.exec(s);
    if (!loose) throw err;
    const out = {};
    for (const part of loose[1].split(',')) {
      const at = part.indexOf(':');
      const key = part.slice(0, at).trim();
      if (at < 1 || !/^[a-z_]+$/i.test(key)) throw err;
      out[key] = part.slice(at + 1).trim();
    }
    return out;
  }
}

class Relay {
  constructor({ onEvent, log, onStatus = () => {} }) {
    this.onEvent = onEvent;
    this.log = log;
    this.onStatus = onStatus;
    this.controller = null;
    this.config = null;
    this.ids = new Set(); // agent ids that arrived through the relay
    this.status = { state: 'off', reason: '', since: Date.now(), lastEvent: 0 };
    this.tests = new Map(); // test event id -> resolve, waiting for it to come back
  }

  setStatus(state, reason = '') {
    if (this.status.state === state && this.status.reason === reason) return;
    this.status = { ...this.status, state, reason, since: Date.now() };
    this.onStatus(this.getStatus());
  }

  getStatus() {
    return { ...this.status };
  }

  configure(relay) {
    const same = this.config && JSON.stringify(this.config) === JSON.stringify(relay);
    if (same) return;
    this.stop();
    this.config = { ...relay };
    if (!relay.enabled) return this.setStatus('off');
    if (!relay.topic) return this.setStatus('error', 'no topic: make a new secret topic');
    this.run();
  }

  stop() {
    if (this.controller) this.controller.abort();
    this.controller = null;
  }

  base() {
    return `${this.config.server.replace(/\/+$/, '')}/${encodeURIComponent(this.config.topic)}`;
  }

  async run() {
    const controller = new AbortController();
    this.controller = controller;
    let failures = 0;
    this.setStatus('connecting');
    while (!controller.signal.aborted) {
      // a connection that goes quiet (Wi-Fi drop, sleep, a proxy) is aborted and opened again
      const attempt = new AbortController();
      const abort = () => attempt.abort();
      controller.signal.addEventListener('abort', abort);
      let quiet = setTimeout(abort, SILENCE_MS);
      const heard = () => {
        clearTimeout(quiet);
        quiet = setTimeout(abort, SILENCE_MS);
      };
      try {
        const res = await fetch(`${this.base()}/json`, { signal: attempt.signal });
        if (!res.ok) throw new Error(`the server answered HTTP ${res.status}`);
        failures = 0;
        this.log(`relay connected to ${this.config.server}`);
        this.setStatus('connected');
        const decoder = new TextDecoder();
        let buf = '';
        for await (const chunk of res.body) {
          heard();
          buf += decoder.decode(chunk, { stream: true });
          let nl;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (line) this.handle(line);
          }
        }
        throw new Error('the server closed the connection');
      } catch (err) {
        if (controller.signal.aborted) return;
        failures++;
        const why = attempt.signal.aborted ? 'no keepalive from the server for 2 minutes' : String((err.cause && err.cause.code) || err.message);
        this.log(`relay: ${why}, retrying in ${RETRY_MS / 1000}s`);
        // one dropped connection is normal; several in a row mean it can't get through
        this.setStatus(failures >= 3 ? 'error' : 'reconnecting', why);
      } finally {
        clearTimeout(quiet);
        controller.signal.removeEventListener('abort', abort);
      }
      await new Promise((r) => setTimeout(r, RETRY_MS));
    }
  }

  handle(line) {
    try {
      const msg = JSON.parse(line);
      if (msg.event !== 'message') return;
      const raw = parseBody(String(msg.message));
      const test = !!(raw && raw.relayTest);
      if (test && this.tests.has(raw.relayTest)) this.tests.get(raw.relayTest)(); // our test is back: it goes on to make a pet like any event
      let ev;
      if (raw && raw.hook_event_name) {
        // a Claude Code hook payload from a cloud session: one way, so no messages or Stop
        const hook = claudeCodeEvent(raw);
        if (!hook) return;
        ev = normalizeEvent({ ...hook, controls: [] });
      } else ev = normalizeEvent(raw);
      this.ids.add(ev.id);
      this.status.lastEvent = Date.now();
      this.onEvent(ev, { test });
      this.onStatus(this.getStatus());
    } catch (err) {
      // shown in Settings, so a quoting slip in a curl line doesn't just vanish
      let body = '';
      try {
        body = String(JSON.parse(line).message || '').slice(0, 80);
      } catch {
        body = line.slice(0, 80);
      }
      this.log(`relay: ignored a message (${err.message}): ${body}`);
      this.status = { ...this.status, ignored: { at: Date.now(), why: err.message, body } };
      this.onStatus(this.getStatus());
    }
  }

  // Settings > Send test event: publish a real event to the topic, the way a cloud agent would, and wait for it to come
  // back down the subscription. It makes a "Cloud test" pet like any cloud agent's.
  async test() {
    if (!this.controller) return { ok: false, why: 'Cloud agents are turned off.' };
    const id = `test-${Date.now()}`;
    const back = new Promise((resolve) => this.tests.set(id, () => resolve(true)));
    const ev = { relayTest: id, id: 'cloud-test', name: 'Cloud test', provider: 'cloud', state: 'working', text: 'Hello from the cloud ✓' };
    try {
      const res = await fetch(this.base(), { method: 'POST', body: JSON.stringify(ev) });
      if (!res.ok) return { ok: false, why: `Couldn't post to the topic: HTTP ${res.status}.` };
      const ok = await Promise.race([back, new Promise((r) => setTimeout(() => r(false), 10000))]);
      return ok ? { ok: true } : { ok: false, why: 'Posted, but it didn\'t come back within 10 seconds.' };
    } catch (err) {
      return { ok: false, why: `Couldn't reach ${this.config.server}: ${(err.cause && err.cause.code) || err.message}.` };
    } finally {
      this.tests.delete(id);
    }
  }

  has(id) {
    return !!this.controller && this.ids.has(id);
  }

  // a message or Stop from the balloon, on the same "<topic>-answers" topic: {id, type: 'message' | 'stop', text}
  async sendControl(id, type, text) {
    if (!this.has(id)) return false;
    try {
      await fetch(`${this.base()}-answers`, { method: 'POST', body: JSON.stringify({ id, type, text: text || '' }) });
      return true;
    } catch (err) {
      this.log(`relay: could not send ${type} (${err.message})`);
      return false;
    }
  }

  async sendAnswer(id, text) {
    if (!this.controller || !this.ids.has(id)) return;
    try {
      await fetch(`${this.base()}-answers`, { method: 'POST', body: JSON.stringify({ id, text }) });
    } catch (err) {
      this.log(`relay: could not send answer (${err.message})`);
    }
  }
}

module.exports = { Relay, parseBody };
