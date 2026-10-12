const test = require('node:test');
const assert = require('node:assert/strict');
const { claudeCodeEvent } = require('../src/claude-code');

const base = { session_id: 's1', cwd: 'C:/code/app' };

test('SubagentStart starts a subagent', () => {
  const ev = claudeCodeEvent({ ...base, hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'Explore' });
  assert.equal(ev.id, 'claude-s1/a1');
  assert.equal(ev.parent, 'claude-s1');
  assert.equal(ev.name, 'Explore');
  assert.equal(ev.state, 'working');
  assert.equal(ev.text, 'Started');
});

test('SubagentStop finishes it with its last message', () => {
  const ev = claudeCodeEvent({ ...base, hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: 'Explore', last_assistant_message: 'Found 3 endpoints' });
  assert.equal(ev.id, 'claude-s1/a1');
  assert.equal(ev.parent, 'claude-s1');
  assert.equal(ev.state, 'done');
  assert.equal(ev.text, 'Found 3 endpoints');
});

test('SubagentStop without a message', () => {
  assert.equal(claudeCodeEvent({ ...base, hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: 'Explore' }).text, 'Finished');
});

test('SubagentStop cuts a long message to 200 characters', () => {
  const ev = claudeCodeEvent({ ...base, hook_event_name: 'SubagentStop', agent_id: 'a1', last_assistant_message: 'x'.repeat(500) });
  assert.equal(ev.text.length, 200);
});

test('a tool call inside a subagent goes to the subagent', () => {
  const ev = claudeCodeEvent({ ...base, hook_event_name: 'PreToolUse', agent_id: 'a1', agent_type: 'Explore', tool_name: 'Read', tool_input: { file_path: 'C:/code/app/x.js' } });
  assert.equal(ev.id, 'claude-s1/a1');
  assert.equal(ev.parent, 'claude-s1');
  assert.equal(ev.state, 'working');
  assert.equal(ev.text, 'Reading x.js');
});

test("the parent's own tool call is unchanged", () => {
  const ev = claudeCodeEvent({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 'C:/code/app/x.js' } });
  assert.equal(ev.id, 'claude-s1');
  assert.ok(!('parent' in ev));
  assert.equal(ev.text, 'Reading x.js');
});

test('a notification inside a subagent is its question', () => {
  const ev = claudeCodeEvent({ ...base, hook_event_name: 'Notification', agent_id: 'a1', agent_type: 'Explore', message: 'Claude needs your permission to use Bash' });
  assert.equal(ev.id, 'claude-s1/a1');
  assert.equal(ev.parent, 'claude-s1');
  assert.equal(ev.state, 'question');
  assert.equal(ev.text, 'Claude needs your permission to use Bash');
});

test('other hooks inside a subagent are ignored', () => {
  assert.equal(claudeCodeEvent({ ...base, hook_event_name: 'Stop', agent_id: 'a1' }), null);
});

test('UserPromptSubmit starts a new turn', () => {
  const ev = claudeCodeEvent({ ...base, hook_event_name: 'UserPromptSubmit', prompt: 'do it' });
  assert.equal(ev.newTurn, true);
  assert.equal(ev.id, 'claude-s1');
});

const { outdatedHooks } = require('../src/claude-code');
const floof = [{ hooks: [{ type: 'command', command: '"C:/floof/tools/claude-code-hook.exe"' }] }];
const other = [{ hooks: [{ type: 'command', command: 'echo hi' }] }];
const hooksFor = (events) => Object.fromEntries(events.map((e) => [e, floof]));
const OLD = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'Notification', 'Stop', 'SessionEnd'];

test('hooks from before subagents are outdated', () => {
  assert.equal(outdatedHooks(hooksFor(OLD)), true);
});

test('hooks with the subagent events are up to date', () => {
  assert.equal(outdatedHooks(hooksFor([...OLD, 'SubagentStart', 'SubagentStop'])), false);
});

test('without each step (no PreToolUse) is up to date', () => {
  assert.equal(outdatedHooks(hooksFor(OLD.filter((e) => e !== 'PreToolUse').concat('SubagentStart', 'SubagentStop'))), false);
});

test('not connected is not outdated', () => {
  assert.equal(outdatedHooks({}), false);
  assert.equal(outdatedHooks(undefined), false);
  assert.equal(outdatedHooks({ Stop: other }), false);
});

const { upgradeHooks } = require('../src/claude-code');

test('upgradeHooks adds the missing events with the same command, keeping the rest', () => {
  const hooks = { ...hooksFor(OLD), Stop: [...other, ...floof] };
  const up = upgradeHooks(hooks);
  assert.deepEqual(up.SubagentStart, floof);
  assert.deepEqual(up.SubagentStop, floof);
  assert.deepEqual(up.Stop, [...other, ...floof]);
  assert.equal(outdatedHooks(up), false);
  assert.equal(hooks.SubagentStart, undefined); // the original is left as it was
});

test('upgradeHooks: nothing to do when up to date or not connected', () => {
  assert.equal(upgradeHooks(hooksFor([...OLD, 'SubagentStart', 'SubagentStop'])), null);
  assert.equal(upgradeHooks({}), null);
});
