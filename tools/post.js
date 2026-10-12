// Shared helper for the adapters: send one event to floof on this PC.
// Never throws and never waits more than a second, so it can't slow an agent down.
const http = require('http');

function post(ev, path = '/event') {
  return new Promise((resolve) => {
    const body = JSON.stringify(ev);
    const req = http.request(
      { host: '127.0.0.1', port: Number(process.env.FLOOF_PORT) || 4417, path, method: 'POST', timeout: 1000, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      (res) => {
        res.resume();
        res.on('end', () => resolve(true));
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end(body);
  });
}

function readStdin() {
  return new Promise((resolve) => {
    let input = '';
    process.stdin.on('data', (c) => (input += c));
    process.stdin.on('end', () => resolve(input));
  });
}

module.exports = { post, readStdin };
