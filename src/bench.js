// --bench: a load test. Idle, then agents' pets, then the same with subagent minis; each phase settles,
// then sample() measures it (floof's CPU, the overlays' frame work). The table goes to the log.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runBench({ emit, sample, wait = sleep, agents = 10, settle = 10000 }) {
  const results = [];
  const phase = async (label) => {
    await wait(settle);
    results.push({ label, ...(await sample(label)) });
  };
  const ids = Array.from({ length: agents }, (_, i) => `bench-${i + 1}`);
  await phase('idle');
  for (const id of ids) emit({ id, state: 'working', name: id, provider: 'bench', text: 'Benchmark' });
  await phase(`${agents} agents`);
  // 4 subagents each, so 3 show as minis
  for (const id of ids) for (let s = 1; s <= 4; s++) emit({ id: `${id}/${s}`, parent: id, state: 'working', name: `sub ${s}`, text: 'Benchmark' });
  await phase(`${agents} agents, ${agents * 3} minis`);
  for (const id of ids) emit({ id, state: 'bye' });
  return results;
}

function benchTable(results) {
  const rows = [['phase', 'cpu', 'work avg', 'max', 'fps', 'minis']].concat(
    results.map((r) => [r.label, `${r.cpu.toFixed(1)}%`, `${r.avg.toFixed(1)} ms`, `${r.max.toFixed(1)} ms`, String(Math.round(r.fps)), String(r.minis)])
  );
  const widths = rows[0].map((_, c) => Math.max(...rows.map((r) => r[c].length)));
  return rows.map((r) => r.map((v, c) => v.padEnd(widths[c])).join('  ').trimEnd()).join('\n');
}

module.exports = { runBench, benchTable };
