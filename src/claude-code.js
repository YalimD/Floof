// Claude Code hook payload -> floof event, for POST /hook/claude-code. The hook itself can then be a
// single curl.exe call (about 10 ms), so it doesn't slow Claude Code down. Same mapping as
// tools/claude-code-hook.js, which stays a standalone adapter.
const path = require('path');

function describeTool(name, input) {
  const i = input || {};
  const file = i.file_path ? path.basename(String(i.file_path)) : '';
  switch (name) {
    case 'Read':
      return `Reading ${file}`;
    case 'Edit':
    case 'Write':
      return `Editing ${file}`;
    case 'Bash':
    case 'PowerShell':
      return `Running: ${String(i.command || '').slice(0, 120)}`;
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

// returns null for hook events floof doesn't show
function claudeCodeEvent(h) {
  if (!h || typeof h !== 'object') return null;
  const cwd = String(h.cwd || '').replace(/[\\/]+$/, '');
  const ev = { id: `claude-${h.session_id || 'session'}`, name: path.win32.basename(cwd) || 'claude', provider: 'claude-code' };
  if (h.agent_id) return subagentEvent(h, ev.id);
  switch (h.hook_event_name) {
    case 'SessionStart':
      return { ...ev, state: 'idle', text: 'Session started' };
    case 'UserPromptSubmit':
      // newTurn: its earlier subagents go
      return { ...ev, state: 'working', text: `Working on: ${String(h.prompt || '').slice(0, 200)}`, newTurn: true };
    case 'PreToolUse':
      return { ...ev, state: 'working', text: describeTool(h.tool_name, h.tool_input) };
    case 'Notification':
      return { ...ev, state: 'question', text: h.message || 'Claude needs your attention' };
    case 'Stop':
      return { ...ev, state: 'done', text: 'Finished, waiting for your next message' };
    case 'SessionEnd':
      return { ...ev, state: 'bye' };
    default:
      return null;
  }
}

// a hook from inside a subagent (it carries agent_id): the subagent's mini, under the session's pet
function subagentEvent(h, parent) {
  const ev = { id: `${parent}/${h.agent_id}`, parent, provider: 'claude-code' };
  if (h.agent_type) ev.name = String(h.agent_type);
  switch (h.hook_event_name) {
    case 'SubagentStart':
      return { ...ev, state: 'working', text: 'Started' };
    case 'SubagentStop':
      return { ...ev, state: 'done', text: String(h.last_assistant_message || '').slice(0, 200) || 'Finished' };
    case 'PreToolUse':
      return { ...ev, state: 'working', text: describeTool(h.tool_name, h.tool_input) };
    case 'Notification':
      // e.g. a permission prompt: the parent's pet asks it, with the subagent's name
      return { ...ev, state: 'question', text: h.message || 'Claude needs your attention' };
    default:
      return null;
  }
}

// the Claude Code hooks floof adds ("Connect Claude Code"); PreToolUse only with each step on
const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'Notification', 'Stop', 'SessionEnd', 'SubagentStart', 'SubagentStop'];
const isFloofHook = (entry) => !!entry && Array.isArray(entry.hooks) && entry.hooks.some((h) => /claude-code-hook/i.test(String(h.command || '')));

// connected by an older floof: some of floof's hooks are there, but not all it adds now
function outdatedHooks(hooks) {
  const has = (ev) => !!hooks && Array.isArray(hooks[ev]) && hooks[ev].some(isFloofHook);
  return HOOK_EVENTS.some(has) && HOOK_EVENTS.some((ev) => ev !== 'PreToolUse' && !has(ev));
}

// for outdated hooks: a copy with floof's hook added to the events it's missing (same command as the
// ones there, so it keeps pointing at the same floof), or null when there's nothing to add
function upgradeHooks(hooks) {
  if (!outdatedHooks(hooks)) return null;
  const mine = HOOK_EVENTS.flatMap((ev) => hooks[ev] || []).find(isFloofHook);
  const up = { ...hooks };
  for (const ev of HOOK_EVENTS) {
    if (ev === 'PreToolUse' || (up[ev] || []).some(isFloofHook)) continue;
    up[ev] = [...(up[ev] || []), mine];
  }
  return up;
}

module.exports = { claudeCodeEvent, describeTool, HOOK_EVENTS, isFloofHook, outdatedHooks, upgradeHooks };
