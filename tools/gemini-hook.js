#!/usr/bin/env node
// Gemini CLI hook -> floof. Gives every Gemini CLI session its own pet.
// Gemini CLI passes the hook payload as JSON on stdin, much like Claude Code.
const path = require('path');
const { post, readStdin } = require('./post');

readStdin().then(async (input) => {
  let h;
  try {
    h = JSON.parse(input);
  } catch {
    process.exit(0);
  }
  const ev = { id: `gemini-${h.session_id || 'session'}`, name: path.basename(h.cwd || '') || 'gemini', provider: 'gemini', critter: process.env.FLOOF_CRITTER || undefined, pids: [process.ppid] }; // pids: for "Take me there"
  const tool = h.tool_name ? `Using ${h.tool_name}` : 'Working';
  switch (h.hook_event_name) {
    case 'SessionStart':
      Object.assign(ev, { state: 'idle', text: 'Session started' });
      break;
    case 'BeforeAgent':
      Object.assign(ev, { state: 'working', text: h.prompt ? `Working on: ${String(h.prompt).slice(0, 200)}` : 'Thinking' });
      break;
    case 'BeforeTool':
      Object.assign(ev, { state: 'working', text: tool });
      break;
    case 'Notification':
      Object.assign(ev, { state: 'question', text: h.message || 'Gemini needs your attention' });
      break;
    case 'AfterAgent':
      Object.assign(ev, { state: 'done', text: 'Finished, waiting for your next message' });
      break;
    case 'SessionEnd':
      Object.assign(ev, { state: 'bye' });
      break;
    default:
      process.exit(0);
  }
  await post(ev);
  process.exit(0);
});
