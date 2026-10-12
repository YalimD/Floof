// Each agent's subagents for its current turn: what its minis and the pet list show.
// An event with a "parent" updates one of them; a new turn or the parent's bye clears them.
const RUNNING = new Set(['working', 'question', 'idle']);
const MAX = 50; // per turn; the oldest finished ones make room first
const WAIT = 10000; // ms a subagent waits for its parent's first event

class Subagents {
  constructor({ now = Date.now } = {}) {
    this.now = now;
    this.turns = new Map(); // parent id -> [subagent, ...], oldest first
    this.parked = new Map(); // parent id -> [{ev, at}, ...] that came before the parent did
    this.asks = new Map(); // parent id -> id of the subagent with an open question (its pet asks it)
  }

  // returns the parent id whose list changed, or null when the event waits for its parent
  apply(ev, parentKnown) {
    const parent = ev.parent;
    if (!parentKnown) {
      // forget ones that waited too long, for parents that never came
      for (const [p, waiting] of this.parked) {
        const fresh = waiting.filter((w) => this.now() - w.at <= WAIT);
        if (fresh.length) this.parked.set(p, fresh);
        else this.parked.delete(p);
      }
      if (!this.parked.has(parent)) this.parked.set(parent, []);
      this.parked.get(parent).push({ ev, at: this.now() });
      return null;
    }
    const list = this.turns.get(parent) || [];
    this.turns.set(parent, list);
    const i = list.findIndex((s) => s.id === ev.id);
    if (ev.state === 'question') this.asks.set(parent, ev.id);
    else if (this.asks.get(parent) === ev.id) this.asks.delete(parent);
    if (ev.state === 'bye') {
      if (i >= 0) list.splice(i, 1);
      return parent;
    }
    let s = list[i];
    if (!s) {
      s = { id: ev.id, name: ev.id, kind: null, state: 'running', text: '', started: this.now(), ended: null };
      list.push(s);
    }
    if (ev.name) s.name = ev.name;
    if (ev.critter) s.kind = ev.critter;
    if (ev.text) s.text = ev.text;
    if (RUNNING.has(ev.state)) Object.assign(s, { state: 'running', ended: null });
    else if (s.state !== ev.state) Object.assign(s, { state: ev.state, ended: this.now() });
    while (list.length > MAX) {
      const old = list.findIndex((x) => x.state !== 'running');
      if (old < 0) break;
      list.splice(old, 1);
    }
    return parent;
  }

  // the parent's first event: subagents that came early join it (if they didn't wait too long)
  parentArrived(parent) {
    const waiting = this.parked.get(parent) || [];
    this.parked.delete(parent);
    const fresh = waiting.filter((w) => this.now() - w.at <= WAIT);
    for (const w of fresh) this.apply(w.ev, true);
    return fresh.length > 0;
  }

  newTurn(parent) {
    this.turns.delete(parent);
    this.asks.delete(parent);
  }

  end(parent) {
    this.newTurn(parent);
    this.parked.delete(parent);
  }

  // the subagent whose question the parent's pet asks, or null
  asking(parent) {
    const s = (this.turns.get(parent) || []).find((x) => x.id === this.asks.get(parent));
    return s && s.state === 'running' ? { ...s } : null;
  }

  // newest first
  list(parent) {
    return (this.turns.get(parent) || []).map((s) => ({ ...s })).reverse();
  }
}

// Does this event of the agent start a new turn (its earlier subagents go)? Back to work after finishing
// or idling does; an agent that marks its turns itself (Claude Code: newTurn on each prompt) only on its mark.
function startsTurn(prevState, ev, { marksTurns = false } = {}) {
  if (marksTurns) return !!ev.newTurn;
  return ev.state === 'working' && ['done', 'error', 'idle'].includes(prevState);
}

module.exports = { Subagents, startsTurn };
