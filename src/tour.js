// The guide sheep: a short tour of floof, played through floof's own agent events, so the guide is
// an ordinary pet (it crosses monitors, sleeps, shows up in the pet list). Each event carries a
// `tour` field the overlay uses for the balloon's buttons: {open, buttons, wait, demo, nap}.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ID = 'floof-guide';

function createTour({ emit, answers, getFortune, interactKeys, openSettings, openList, onEnd, log = () => {} }) {
  let running = false;
  let step = -1;
  let run = 0; // bumps on every step change, so a step's pending timers know they're stale

  const base = { id: ID, name: 'floof guide', provider: 'floof', critter: 'sheep' };
  const say = (state, text, tour = {}, extra = {}) => emit({ ...base, state, text, tour: { open: true, buttons: ['next', 'skip'], ...tour }, ...extra });
  const later = (ms, fn) => {
    const mine = run;
    setTimeout(() => mine === run && running && fn(), ms);
  };
  const keys = () =>
    interactKeys()
      .split('+')
      .map((k) => (k === 'win' ? 'Win' : k[0].toUpperCase() + k.slice(1)))
      .join('+');

  const steps = [
    // 1. hello
    () => say('idle', "Hi! I'm the floof guide. floof gives each of your AI agents a fluffy pet, so you can see what they're up to at a glance. Shall I show you around?"),
    // 2. hold keys to interact
    () =>
      interactKeys()
        ? say('idle', `Pets keep out of your way: without keys, clicks go straight through them and they walk away from your mouse. Hold ${keys()} and click me!`, { wait: 'click' })
        : say('idle', 'Click me! Pets react to clicks, and you can drag and throw them too.', { wait: 'click' }),
    // 3. working
    async () => {
      const mine = run;
      for (let p = 0; p <= 1.0001 && mine === run && running; p += 0.25) {
        say('working', 'This is a busy agent: ⚙️ over its head, typing on its laptop, with a progress bar. Its balloon shows what it is doing right now.', {}, { progress: p });
        await sleep(1600);
      }
    },
    // 4. a question in its own balloon
    () => {
      say('question', 'When an agent needs you, it asks like this. Type anything below and press Send.', { buttons: ['next', 'skip'] });
      const mine = run;
      const poll = async () => {
        while (mine === run && running) {
          const a = answers.shift(ID);
          if (a) return say('idle', `Thanks! You said “${a}”. Your agent gets the answer straight away. You can also answer from the pet list.`);
          await sleep(400);
        }
      };
      poll();
    },
    // 5. where questions go when you can't see the pet
    () => {
      say('question', "If you can't see a pet when it has a question, it pulls the corner of your window open like a curtain, or pops up next to the clock, like this. (Just a demo: no need to answer.)", { demo: 'away' });
      later(8000, () => go(step + 1));
    },
    // 6. error, done, then a nap
    () => {
      say('error', 'When something goes wrong, the pet gets a little sad 🌧️ and friends come over to cheer it up.');
      later(4000, () => say('done', 'When an agent finishes, its pet jumps for joy ✅.'));
      later(8000, () => say('idle', 'Pets with nothing to do nap 💤 until you click them. Only busy agents and ones waiting for you move about.', { nap: true }));
    },
    // 7. fortunes
    async () => {
      const mine = run;
      const f = await getFortune();
      if (mine !== run) return;
      say('idle', `Click a free critter now and then and it may tell your fortune. Here's yours: “${f}”`);
    },
    // 8. where pets live
    () => say('idle', 'Pets can live everywhere, only on top of apps you pick, or in pet boxes with shelves and your own background. Settings > Pets has it all.', { buttons: ['next', 'settings', 'skip'] }),
    // 9. the pet list
    () => say('idle', 'Lost track? The pet list (tray menu) shows every pet, what it is doing, and agents that have finished.', { buttons: ['next', 'list', 'skip'] }),
    // 10. connect your agents
    () => say('idle', "Last thing: connect your agents. Settings > Claude Code connects Claude Code in one click; the README covers Codex, Gemini and anything else. Each agent wears its provider's colours: a cap like my floof one, a T-shirt, or both (Settings > Pets > Agents wear). Have fun!", { buttons: ['done'] }),
  ];

  function go(i) {
    run++;
    step = i;
    if (i >= steps.length) return end();
    log(`tour step ${i + 1} of ${steps.length}`);
    steps[i]();
  }

  function end() {
    if (!running) return;
    running = false;
    run++;
    emit({ ...base, state: 'bye', tour: null });
    log('tour ended');
    onEnd();
  }

  return {
    get running() {
      return running;
    },
    start() {
      if (running) end();
      running = true;
      go(0);
    },
    // from the guide's balloon: next, skip, settings, list, done; or clicked (the guide was clicked)
    action(a) {
      if (!running) return;
      if (a === 'skip' || a === 'done') return end();
      if (a === 'settings') return openSettings();
      if (a === 'list') return openList();
      if (a === 'clicked') {
        if (step !== 1) return;
        say('idle', "That's it! Clicking a pet opens its balloon. Its 📌 Keep open button stops it closing by itself.", { buttons: ['next', 'skip'] });
        return later(3500, () => go(step + 1));
      }
      if (a === 'next') go(step + 1);
    },
  };
}

module.exports = { createTour, TOUR_ID: ID };
