const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeEvent } = require('../src/bridge');

test('normalizeEvent keeps parent', () => {
  assert.equal(normalizeEvent({ id: 'a', parent: 'p', state: 'working' }).parent, 'p');
});

test('normalizeEvent drops parent equal to id', () => {
  assert.ok(!('parent' in normalizeEvent({ id: 'a', parent: 'a' })));
});
