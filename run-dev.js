// Start floof from this folder with the Electron in node_modules: npm start, npm run demo, npm run bench.
// Usage: node run-dev.js [floof args...]   e.g.  npm start -- --log-pets
// Clears ELECTRON_RUN_AS_NODE first: VS Code (and so Claude Code inside it) sets it, and Electron would
// then run main.js as plain Node.
const { spawn } = require('child_process');
const electron = require('electron'); // from Node, this is the path to electron.exe

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [__dirname, ...process.argv.slice(2)], { stdio: 'inherit', env });
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
