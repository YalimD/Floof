// Watches open windows (Windows only) so pets can stand on them and peel their corners.
// Runs src/winwatch.ps1 in a hidden PowerShell; rectangles are in physical pixels and
// main.js converts them for each overlay.
const { spawn } = require('child_process');
const path = require('path');

// input: also report keys held, the cursor and the text caret (to onInput)
function startWindowWatcher({ onWindows, onInput, input, log }) {
  if (process.platform !== 'win32') return { stop() {} };
  let proc = null;
  let stopped = false;

  function start() {
    proc = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'winwatch.ps1'), '-SelfPid', String(process.pid), ...(input ? ['-WatchInput'] : [])],
      { windowsHide: true }
    );
    let buf = '';
    proc.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line); // window lists are arrays, input lines are objects
          if (Array.isArray(msg)) onWindows(msg);
          else if (msg.t === 'input' && onInput) onInput(msg);
        } catch (err) {
          log(`window watcher: bad line (${err.message})`);
        }
      }
    });
    proc.stderr.on('data', (d) => log(`window watcher: ${d.toString().trim()}`));
    proc.on('exit', (code) => {
      if (stopped) return;
      log(`window watcher exited (${code}); pets stay on the taskbar. Restarting in 30s.`);
      onWindows([]);
      setTimeout(() => !stopped && start(), 30000);
    });
  }

  start();
  return {
    stop() {
      stopped = true;
      if (proc) proc.kill();
    },
  };
}

module.exports = { startWindowWatcher };
