#!/usr/bin/env node
// Claude Code hook -> floof. Gives every Claude Code session its own pet.
// Claude Code passes the hook payload as JSON on stdin; we map it to a floof event.
const path = require('path');
const { post, readStdin } = require('./post');

readStdin().then(async (input) => {
  let h;
  try {
    h = JSON.parse(input);
  } catch {
    process.exit(0);
  }
  const ev = { id: `claude-${h.session_id || 'session'}`, name: path.basename(h.cwd || '') || 'claude', provider: 'claude-code', pids: [process.ppid] }; // pids: for "Take me there"
  if (h.agent_id) {
    // inside a subagent: its mini, under the session's pet
    const sub = { id: `${ev.id}/${h.agent_id}`, parent: ev.id, provider: 'claude-code' };
    if (h.agent_type) sub.name = h.agent_type;
    if (h.hook_event_name === 'SubagentStart') Object.assign(sub, { state: 'working', text: 'Started' });
    else if (h.hook_event_name === 'SubagentStop') Object.assign(sub, { state: 'done', text: String(h.last_assistant_message || '').slice(0, 200) || 'Finished' });
    else if (h.hook_event_name === 'PreToolUse') Object.assign(sub, { state: 'working', text: describeTool(h.tool_name, h.tool_input) });
    else if (h.hook_event_name === 'Notification') Object.assign(sub, { state: 'question', text: h.message || 'Claude needs your attention' });
    else process.exit(0);
    await post(sub);
    process.exit(0);
  }
  switch (h.hook_event_name) {
    case 'SessionStart':
      Object.assign(ev, { state: 'idle', text: 'Session started' });
      break;
    case 'UserPromptSubmit':
      Object.assign(ev, { state: 'working', text: `Working on: ${(h.prompt || '').slice(0, 200)}` });
      break;
    case 'PreToolUse':
      Object.assign(ev, { state: 'working', text: describeTool(h.tool_name, h.tool_input) });
      break;
    case 'Notification':
      Object.assign(ev, { state: 'question', text: h.message || 'Claude needs your attention' });
      break;
    case 'Stop':
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

function describeTool(name, input) {
  const i = input || {};
  const file = i.file_path ? path.basename(i.file_path) : '';
  switch (name) {
    case 'Read':
      return `Reading ${file}`;
    case 'Edit':
    case 'Write':
      return `Editing ${file}`;
    case 'Bash':
      return `Running: ${(i.command || '').slice(0, 120)}`;
    case 'Grep':
    case 'Glob':
      return 'Searching the code';
    case 'WebSearch':
    case 'WebFetch':
      return 'Looking things up on the web';
    default:
      return `Using ${name}`;
  }
}

module.exports = { describeTool };
