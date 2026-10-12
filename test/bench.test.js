const test = require('node:test');
const assert = require('node:assert/strict');
const { runBench, benchTable } = require('../src/bench');

test('runBench: idle, agents, then agents with subagents, and cleans up', async () => {
  const events = [];
  const phases = [];
  const results = await runBench({
    emit: (ev) => events.push(ev),
    sample: async (label) => {
      phases.push(label);
      return { cpu: 1, avg: 0.5, max: 1, fps: 30, minis: label.includes('minis') ? 30 : 0 };
    },
    wait: async () => {},
    agents: 10,
  });
  assert.deepEqual(phases, ['idle', '10 agents', '10 agents, 30 minis']);
  assert.equal(results.length, 3);
  assert.equal(results[2].minis, 30);
  const working = events.filter((e) => e.state === 'working');
  assert.equal(working.filter((e) => !e.parent).length, 10);
  assert.equal(working.filter((e) => e.parent).length, 40); // 4 each: 3 show as minis
  // every agent leaves at the end
  assert.equal(events.filter((e) => e.state === 'bye').length, 10);
});

test('benchTable: one line per phase', () => {
  const table = benchTable([
    { label: 'idle', cpu: 7.84, avg: 0, max: 0.12, fps: 30, minis: 0 },
    { label: '10 agents, 30 minis', cpu: 21.5, avg: 1.1, max: 1.4, fps: 30, minis: 30 },
  ]);
  const lines = table.split('\n');
  assert.equal(lines.length, 3);
  assert.match(lines[0], /phase.*cpu.*work avg.*max.*fps.*minis/);
  assert.match(lines[1], /^idle\s+7\.8%\s+0\.0 ms\s+0\.1 ms\s+30\s+0$/);
  assert.match(lines[2], /^10 agents, 30 minis\s+21\.5%\s+1\.1 ms\s+1\.4 ms\s+30\s+30$/);
});
