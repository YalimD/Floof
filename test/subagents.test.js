const test = require('node:test');
const assert = require('node:assert/strict');
const { Subagents } = require('../src/subagents');

function setup() {
  const clock = { t: 0 };
  return { clock, s: new Subagents({ now: () => clock.t }) };
}

test('adds a running subagent', () => {
  const { s } = setup();
  assert.equal(s.apply({ id: 'p/a', parent: 'p', state: 'working', name: 'Explore' }, true), 'p');
  assert.deepEqual(s.list('p'), [{ id: 'p/a', name: 'Explore', kind: null, state: 'running', text: '', started: 0, ended: null }]);
});

test('question and idle count as running', () => {
  const { s } = setup();
  s.apply({ id: 'p/a', parent: 'p', state: 'question' }, true);
  s.apply({ id: 'p/b', parent: 'p', state: 'idle' }, true);
  assert.deepEqual(s.list('p').map((x) => x.state), ['running', 'running']);
});

test('done and error finish it', () => {
  const { s, clock } = setup();
  s.apply({ id: 'p/a', parent: 'p', state: 'working' }, true);
  s.apply({ id: 'p/b', parent: 'p', state: 'working' }, true);
  clock.t = 7;
  s.apply({ id: 'p/a', parent: 'p', state: 'done' }, true);
  clock.t = 9;
  s.apply({ id: 'p/b', parent: 'p', state: 'error' }, true);
  const byId = Object.fromEntries(s.list('p').map((x) => [x.id, x]));
  assert.equal(byId['p/a'].state, 'done');
  assert.equal(byId['p/a'].ended, 7);
  assert.equal(byId['p/b'].state, 'error');
  assert.equal(byId['p/b'].ended, 9);
});

test('bye removes it', () => {
  const { s } = setup();
  s.apply({ id: 'p/a', parent: 'p', state: 'working' }, true);
  assert.equal(s.apply({ id: 'p/a', parent: 'p', state: 'bye' }, true), 'p');
  assert.deepEqual(s.list('p'), []);
});

test('updates text and name without restarting', () => {
  const { s, clock } = setup();
  s.apply({ id: 'p/a', parent: 'p', state: 'working', name: 'Explore' }, true);
  clock.t = 5;
  s.apply({ id: 'p/a', parent: 'p', state: 'working', name: 'Explorer', text: 'Reading x.js' }, true);
  const [a] = s.list('p');
  assert.equal(a.started, 0);
  assert.equal(a.name, 'Explorer');
  assert.equal(a.text, 'Reading x.js');
});

test('keeps the critter as its kind', () => {
  const { s } = setup();
  s.apply({ id: 'p/a', parent: 'p', state: 'working', critter: 'dog' }, true);
  assert.equal(s.list('p')[0].kind, 'dog');
});

test('newest first', () => {
  const { s, clock } = setup();
  for (const [t, id] of [[0, 'p/0'], [1, 'p/1'], [2, 'p/2']]) {
    clock.t = t;
    s.apply({ id, parent: 'p', state: 'working' }, true);
  }
  assert.deepEqual(s.list('p').map((x) => x.id), ['p/2', 'p/1', 'p/0']);
});

test('newTurn clears the list', () => {
  const { s } = setup();
  s.apply({ id: 'p/a', parent: 'p', state: 'done' }, true);
  s.newTurn('p');
  assert.deepEqual(s.list('p'), []);
});

test('end forgets the parent', () => {
  const { s } = setup();
  s.apply({ id: 'p/a', parent: 'p', state: 'working' }, true);
  s.end('p');
  assert.deepEqual(s.list('p'), []);
});

test('list is a copy', () => {
  const { s } = setup();
  s.apply({ id: 'p/a', parent: 'p', state: 'working' }, true);
  s.list('p')[0].state = 'done';
  assert.equal(s.list('p')[0].state, 'running');
});

test('parks events for an unknown parent until it arrives', () => {
  const { s, clock } = setup();
  assert.equal(s.apply({ id: 'p/a', parent: 'p', state: 'working', name: 'Explore' }, false), null);
  assert.deepEqual(s.list('p'), []);
  clock.t = 5000;
  assert.equal(s.parentArrived('p'), true);
  assert.deepEqual(s.list('p').map((x) => x.id), ['p/a']);
});

test('drops parked events older than 10 seconds', () => {
  const { s, clock } = setup();
  s.apply({ id: 'p/a', parent: 'p', state: 'working' }, false);
  clock.t = 11000;
  assert.equal(s.parentArrived('p'), false);
  assert.deepEqual(s.list('p'), []);
});

test('keeps at most 50, dropping the oldest finished first', () => {
  const { s, clock } = setup();
  for (let i = 0; i < 51; i++) {
    clock.t = i;
    s.apply({ id: `p/${i}`, parent: 'p', state: 'working' }, true);
    if (i < 10) s.apply({ id: `p/${i}`, parent: 'p', state: 'done' }, true);
  }
  const ids = s.list('p').map((x) => x.id);
  assert.equal(ids.length, 50);
  assert.ok(!ids.includes('p/0'));
  assert.ok(ids.includes('p/1'));
  assert.ok(ids.includes('p/50'));
});

test('never drops running ones for the cap', () => {
  const { s, clock } = setup();
  for (let i = 0; i < 51; i++) {
    clock.t = i;
    s.apply({ id: `p/${i}`, parent: 'p', state: 'working' }, true);
  }
  assert.equal(s.list('p').length, 51);
});

test('asking: the subagent with an open question', () => {
  const { s } = setup();
  s.apply({ id: 'p/a', parent: 'p', state: 'working' }, true);
  s.apply({ id: 'p/b', parent: 'p', state: 'question', name: 'Plan', text: 'Ship?' }, true);
  assert.equal(s.asking('p').id, 'p/b');
});

test('asking ends when it moves on, finishes, or the turn ends', () => {
  const { s } = setup();
  s.apply({ id: 'p/a', parent: 'p', state: 'question' }, true);
  s.apply({ id: 'p/a', parent: 'p', state: 'working' }, true);
  assert.equal(s.asking('p'), null);
  s.apply({ id: 'p/a', parent: 'p', state: 'question' }, true);
  s.apply({ id: 'p/a', parent: 'p', state: 'done' }, true);
  assert.equal(s.asking('p'), null);
  s.apply({ id: 'p/b', parent: 'p', state: 'question' }, true);
  s.newTurn('p');
  assert.equal(s.asking('p'), null);
});

test('a question that waited for its parent is asked once the parent comes', () => {
  const { s } = setup();
  s.apply({ id: 'p/a', parent: 'p', state: 'question' }, false);
  s.parentArrived('p');
  assert.equal(s.asking('p').id, 'p/a');
});

test('starts a new turn: back to work after done, error or idle', () => {
  const { startsTurn } = require('../src/subagents');
  assert.equal(startsTurn('done', { state: 'working' }), true);
  assert.equal(startsTurn('idle', { state: 'working' }), true);
  assert.equal(startsTurn('working', { state: 'working' }), false);
  assert.equal(startsTurn('done', { state: 'question' }), false);
});

test('starts a new turn: agents that mark turns themselves only on their mark', () => {
  const { startsTurn } = require('../src/subagents');
  // Claude Code: idle after compacting mid-turn, then back to work, is the same turn
  assert.equal(startsTurn('idle', { state: 'working' }, { marksTurns: true }), false);
  assert.equal(startsTurn('working', { state: 'working', newTurn: true }, { marksTurns: true }), true);
});
