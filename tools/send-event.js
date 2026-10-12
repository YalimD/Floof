#!/usr/bin/env node
// Send one event to floof from the command line or a script.
//   node tools/send-event.js <id> <state> [text] [--name n] [--provider p] [--critter c] [--progress 0.5] [--model m] [--badge B] [--url u]
// States: idle, working, question, done, error, bye
const http = require('http');

const args = process.argv.slice(2);
const ev = {};
const positional = [];
for (let i = 0; i < args.length; i++) {
  const m = /^--(name|provider|critter|progress|model|badge|url)$/.exec(args[i]);
  if (m) ev[m[1]] = args[++i];
  else positional.push(args[i]);
}
[ev.id, ev.state, ev.text] = positional;
if (!ev.id || !ev.state) {
  console.error('usage: node tools/send-event.js <id> <state> [text] [--name n] [--provider p] [--critter c] [--progress 0..1] [--model m] [--badge B] [--url u]');
  process.exit(1);
}

const body = JSON.stringify(ev);
const req = http.request(
  { host: '127.0.0.1', port: Number(process.env.FLOOF_PORT) || 4417, path: '/event', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
  (res) => res.pipe(process.stdout)
);
req.on('error', (err) => {
  console.error(`floof is not running? ${err.message}`);
  process.exit(1);
});
req.end(body);
