// Agents that finished or left the screen, for the pet list. Kept in history.json in floof's
// user data folder: the newest 200 entries from the last 30 days.
const fs = require('fs');
const path = require('path');

const MAX = 200;
const MAX_AGE = 30 * 24 * 3600 * 1000;

class History {
  constructor(dir) {
    this.file = path.join(dir, 'history.json');
    try {
      this.items = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!Array.isArray(this.items)) this.items = [];
    } catch {
      this.items = [];
    }
    this.prune();
  }

  // entry: {id, name, provider, critter, result: 'done' | 'error' | 'left', text, started, ended}
  add(entry) {
    this.items.unshift(entry);
    this.prune();
    this.save();
  }

  clear() {
    this.items = [];
    this.save();
  }

  // one entry; an agent can be on the list more than once, so its end time picks which
  remove(id, ended) {
    this.items = this.items.filter((e) => !(e.id === id && e.ended === ended));
    this.save();
  }

  list() {
    return this.items.slice();
  }

  prune() {
    const oldest = Date.now() - MAX_AGE;
    this.items = this.items.filter((e) => e && e.ended >= oldest).slice(0, MAX);
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.items, null, 1));
    } catch {
      // the list is a nicety: never let it break floof
    }
  }
}

module.exports = { History };
