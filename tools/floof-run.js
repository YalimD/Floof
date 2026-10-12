#!/usr/bin/env node
// Run any command (any agent, any provider) with a floof pet watching it.
//   node floof-run.js [--name n] [--critter c] [--provider p] [--model m] [--badge B] [--url u] [--watch] -- <command> [args...]
// Without --watch the command keeps your terminal as is (good for interactive agents like
// claude, codex, gemini, aider); the pet shows "working" while it runs and done/error at the end.
// With --watch the output is also read: the pet shows the latest line and asks you when the
// output looks like a question (ends with "?" or "(y/n)").
const { spawn } = require('child_process');
const path = require('path');
const { post } = require('./post');

const args = process.argv.slice(2);
const sep = args.indexOf('--');
if (sep < 0 || sep === args.length - 1) {
  console.error('usage: node floof-run.js [--name n] [--critter c] [--provider p] [--model m] [--badge B] [--url u] [--watch] -- <command> [args...]');
  process.exit(2);
}
const opts = { watch: false };
for (let i = 0; i < sep; i++) {
  if (args[i] === '--watch') opts.watch = true;
  else if (/^--(name|critter|provider|model|badge|url)$/.test(args[i])) opts[args[i].slice(2)] = args[++i];
}
const [cmd, ...cmdArgs] = args.slice(sep + 1);
const base = {
  id: `run-${process.pid}`,
  name: opts.name || path.basename(cmd),
  provider: opts.provider || path.basename(cmd),
  critter: opts.critter,
  // the model, for a llama wearing its initial: --model, or the one in "ollama run <model>"
  model: opts.model || (/^ollama(\.exe)?$/i.test(path.basename(cmd)) && cmdArgs[0] === 'run' ? cmdArgs[1] : undefined),
  badge: opts.badge,
  pids: [process.pid], // "Take me there" brings up the terminal this runs in
  url: opts.url, // or a page, for something running elsewhere
  controls: ['stop'], // Stop in the pet's balloon ends the command
};
const send = (state, text) => post({ ...base, state, text });
let stopped = false;

send('working', `Started: ${[cmd, ...cmdArgs].join(' ').slice(0, 200)}`);
const child = spawn(cmd, cmdArgs, { stdio: opts.watch ? ['inherit', 'pipe', 'pipe'] : 'inherit', shell: process.platform === 'win32' });

let timer = null; // pending output update (with --watch)
if (opts.watch) {
  let lastLine = '';
  const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
  const onData = (chunk, out) => {
    out.write(chunk);
    const lines = chunk.toString().replace(ANSI, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return;
    lastLine = lines[lines.length - 1];
    clearTimeout(timer);
    timer = setTimeout(() => {
      const asking = /\?\s*$|\(y\/n\)|\[y\/n\]/i.test(lastLine);
      send(asking ? 'question' : 'working', lastLine.slice(0, 300));
    }, 400);
  };
  child.stdout.on('data', (c) => onData(c, process.stdout));
  child.stderr.on('data', (c) => onData(c, process.stderr));
}

// Stop from the pet's balloon: floof keeps it at GET /control/<id> until we ask
const http = require('http');
function checkControl() {
  const req = http.get({ host: '127.0.0.1', port: Number(process.env.FLOOF_PORT) || 4417, path: `/control/${encodeURIComponent(base.id)}`, timeout: 1000 }, (res) => {
    let body = '';
    res.on('data', (c) => (body += c));
    res.on('end', () => {
      try {
        if (JSON.parse(body).stop) stopChild();
      } catch {
        // floof isn't there or said something odd: try again later
      }
    });
  });
  req.on('error', () => {});
  req.on('timeout', () => req.destroy());
}
const poll = setInterval(checkControl, 1500);

function stopChild() {
  if (stopped) return;
  stopped = true;
  // the whole process tree: with shell: true the command runs under cmd.exe
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
}

child.on('error', async (err) => {
  await send('error', `Could not start: ${err.message}`);
  process.exit(1);
});
child.on('exit', async (code, signal) => {
  clearTimeout(timer);
  clearInterval(poll);
  if (stopped) await send('done', 'Stopped from floof');
  else if (code === 0) await send('done', 'Finished');
  else await send('error', signal ? `Stopped (${signal})` : `Exited with code ${code}`);
  process.exit(code || 0); // the pet wanders off by itself after a while
});
