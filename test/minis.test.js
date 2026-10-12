const test = require('node:test');
const assert = require('node:assert/strict');
const { pickMinis, MAX_MINIS } = require('../renderer/minis');

// newest first, as the main process sends them
const sub = (id, state) => ({ id, name: id, kind: null, state, text: '', started: 0, ended: null });

test('at most 3, the newest', () => {
  const list = ['e', 'd', 'c', 'b', 'a'].map((id) => sub(id, 'running'));
  assert.equal(MAX_MINIS, 3);
  assert.deepEqual(pickMinis(list).map((s) => s.id), ['e', 'd', 'c']);
});

test('running before sleepers', () => {
  const list = [sub('d1', 'done'), sub('r1', 'running'), sub('d2', 'error'), sub('r2', 'running'), sub('d3', 'done')];
  assert.deepEqual(pickMinis(list).map((s) => s.id), ['r1', 'r2', 'd1']);
});

test('only the newest sleeper stays on the back', () => {
  const list = ['d', 'c', 'b', 'a'].map((id) => sub(id, 'done'));
  assert.deepEqual(pickMinis(list).map((s) => s.id), ['d']);
});

test('one sleeper next to running ones', () => {
  const list = [sub('d1', 'done'), sub('r1', 'running'), sub('d2', 'error')];
  assert.deepEqual(pickMinis(list).map((s) => s.id), ['r1', 'd1']);
});

test('empty', () => {
  assert.deepEqual(pickMinis([]), []);
  assert.deepEqual(pickMinis(undefined), []);
});

const { subagentChip, subagentTitle, subagentStatus } = require('../renderer/minis');

test('chip: running / total, empty with none', () => {
  assert.equal(subagentChip([]), '');
  assert.equal(subagentChip(undefined), '');
  assert.equal(subagentChip([sub('a', 'running'), sub('b', 'done'), sub('c', 'running'), sub('d', 'error')]), '🐣 2 / 4');
});

test('chip tooltip: one line per subagent', () => {
  assert.equal(subagentTitle([{ ...sub('a', 'running'), name: 'Explore' }, { ...sub('b', 'done'), name: 'Plan' }, { ...sub('c', 'error'), name: 'Fix' }]), 'Explore: working\nPlan: done\nFix: error');
});

test('pet list status of a subagent', () => {
  const ago = (ms) => `${ms / 1000} s`;
  assert.deepEqual(subagentStatus({ ...sub('a', 'running'), started: 1000 }, 41000, ago), ['working', 'for 40 s']);
  assert.deepEqual(subagentStatus({ ...sub('a', 'done'), ended: 1000 }, 121000, ago), ['asleep', 'done 120 s ago']);
  assert.deepEqual(subagentStatus({ ...sub('a', 'error'), ended: 1000 }, 3000, ago), ['error', '2 s ago']);
});

const { lineSpot } = require('../renderer/minis');

// a pet 64 wide at x 500 (center 532), minis 32 wide, walking on a span
const pet = { cx: 532, pw: 64, w: 32 };

test('lineSpot: behind the pet, one mini-width apart', () => {
  const span = { x1: 0, x2: 2000 };
  // facing right (ahead +1): behind is to the left
  assert.equal(lineSpot({ ...pet, ahead: 1, slot: 0, span }), 532 - (32 + 16) - 16);
  assert.equal(lineSpot({ ...pet, ahead: 1, slot: 1, span }), 532 - (32 + 48) - 16);
  // facing left: behind is to the right
  assert.equal(lineSpot({ ...pet, ahead: -1, slot: 0, span }), 532 + (32 + 16) - 16);
});

test('lineSpot: kept on the span (a box wall, a window end, the screen edge)', () => {
  const span = { x1: 480, x2: 700 };
  assert.equal(lineSpot({ ...pet, ahead: 1, slot: 2, span }), 480);
  assert.equal(lineSpot({ ...pet, cx: 680, ahead: -1, slot: 0, span }), 700 - 32);
});

test('lineSpot: a span too short for a mini: its middle', () => {
  assert.equal(lineSpot({ ...pet, ahead: 1, slot: 0, span: { x1: 500, x2: 520 } }), 510 - 16);
});

const { napBadgeSpot } = require('../renderer/minis');

test('napBadgeSpot: beside the parent\'s icon, on its tail side', () => {
  // the parent's icon is 18px high, centred on the pet and 18px above its top
  assert.deepEqual(napBadgeSpot({ cx: 100, top: 500, ahead: 1 }), { x: 79, y: 485 });
  assert.deepEqual(napBadgeSpot({ cx: 100, top: 500, ahead: -1 }), { x: 121, y: 485 });
});
