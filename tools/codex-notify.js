#!/usr/bin/env node
// Codex CLI -> floof. Codex runs its "notify" program after every turn with a JSON argument.
// Add to ~/.codex/config.toml:   notify = ["node", "C:/path/to/floof/tools/codex-notify.js"]
// For live "working" updates as well, start Codex through floof-run.js.
const path = require('path');
const { post } = require('./post');

let n;
try {
  n = JSON.parse(process.argv[process.argv.length - 1]);
} catch {
  process.exit(0);
}
if (n.type !== 'agent-turn-complete') process.exit(0);

const cwd = n.cwd || process.cwd();
post({
  id: `codex-${n['thread-id'] || cwd}`,
  name: path.basename(cwd) || 'codex',
  provider: 'codex',
  state: 'done',
  text: String(n['last-assistant-message'] || 'Turn finished').slice(0, 500),
}).then(() => process.exit(0));
