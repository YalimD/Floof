// Fake agents so you can see the whole loop without wiring up a real one.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function runDemo({ emit, answers }) {
  async function waitForAnswer(id, ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const a = answers.shift(id);
      if (a) return a;
      await sleep(500);
    }
    return null;
  }

  async function claude() {
    const a = { id: 'demo-claude', name: 'refactor-api', provider: 'claude-code', critter: 'cat' };
    emit({ ...a, state: 'working', text: 'Reading the API routes', progress: 0.1 });
    await sleep(6000);
    emit({ ...a, state: 'working', text: 'Splitting routes.ts into three modules', progress: 0.4 });
    await sleep(8000);
    emit({ ...a, state: 'question', text: 'Should I also update the tests?' });
    const reply = await waitForAnswer(a.id, 60000);
    emit({ ...a, state: 'working', text: reply ? `You said "${reply}". On it.` : 'No answer, so I left the tests alone.', progress: 0.7 });
    await sleep(7000);
    emit({ ...a, state: 'done', text: 'Refactor finished, 12 files changed', progress: 1 });
    await sleep(20000);
    emit({ ...a, state: 'bye' });
  }

  async function codex() {
    const a = { id: 'demo-codex', name: 'fix-login-bug', provider: 'codex', critter: 'dog' };
    emit({ ...a, state: 'working', text: 'Reproducing the login bug' });
    await sleep(9000);
    emit({ ...a, state: 'error', text: 'Tests failed: session cookie is missing' });
    await sleep(9000);
    emit({ ...a, state: 'working', text: 'Retrying with the cookie fix' });
    await sleep(9000);
    emit({ ...a, state: 'done', text: 'Login works again, tests are green' });
    await sleep(20000);
    emit({ ...a, state: 'bye' });
  }

  async function gemini() {
    const a = { id: 'demo-gemini', name: 'write-docs', provider: 'gemini', critter: 'bird' };
    for (let p = 0; p <= 1.0001; p += 0.2) {
      emit({ ...a, state: 'working', text: `Writing docs, ${Math.round(p * 100)}% done`, progress: p });
      await sleep(5000);
    }
    emit({ ...a, state: 'done', text: 'README and API docs written' });
    await sleep(20000);
    emit({ ...a, state: 'bye' });
  }

  // an agent with subagents: 4 start (so only 3 minis show), then finish one by one and nap on its back
  async function lead() {
    const a = { id: 'demo-lead', name: 'plan-release', provider: 'claude-code', critter: 'sheep' };
    emit({ ...a, state: 'working', text: 'Planning the release' });
    const subs = [
      ['Explore', 'Reading the changelog', 8000, 'done', 'Found 14 changes since 0.19'],
      ['Explore', 'Checking open issues', 11000, 'done', '2 issues block the release'],
      ['Plan', 'Drafting the release steps', 14000, 'error', 'Could not reach the build server'],
      ['general-purpose', 'Writing release notes', 20000, 'done', 'Release notes drafted'],
    ];
    const runs = subs.map(async ([name, text, ms, end, endText], i) => {
      const s = { id: `demo-lead/${i + 1}`, parent: a.id, name };
      await sleep(i * 1500);
      emit({ ...s, state: 'working', text });
      await sleep(ms);
      emit({ ...s, state: end, text: endText });
    });
    await sleep(3000);
    emit({ ...a, state: 'working', text: 'Waiting for the subagents' });
    await Promise.all(runs);
    emit({ ...a, state: 'done', text: 'Release plan written' });
    await sleep(20000);
    emit({ ...a, state: 'bye' });
  }

  claude();
  setTimeout(codex, 2000);
  setTimeout(gemini, 4000);
  setTimeout(lead, 6000);
}

module.exports = { runDemo };
