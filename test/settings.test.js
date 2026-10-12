const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Settings } = require('../src/settings');

const fresh = () => new Settings(fs.mkdtempSync(path.join(os.tmpdir(), 'floof-settings-')));

test('minis are shown by default', () => {
  assert.equal(fresh().get().minis, true);
});

test('minis can be hidden', () => {
  const s = fresh();
  s.update({ minis: false });
  assert.equal(s.get().minis, false);
});
