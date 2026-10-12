// Minis: small copies of an agent's pet, one per subagent. Running ones trot after the pet;
// a finished one jumps onto its back and naps there, until a newer one takes its place. A pet shows at most 3.
(function () {
  const MAX_MINIS = 3;
  const JUMP_SECONDS = 0.6;
  const HIDE_MODES = ['drag', 'peek', 'sink', 'hidden', 'curtain', 'escape'];

  // which subagents get a mini: running ones first, then the newest finished one, napping on the pet's back
  // (lists come newest first)
  function pickMinis(list) {
    const all = list || [];
    const running = all.filter((s) => s.state === 'running');
    const napper = all.find((s) => s.state !== 'running');
    return [...running, ...(napper ? [napper] : [])].slice(0, MAX_MINIS);
  }

  // for the balloon: "🐣 2 / 5" (running / this turn), with a line per subagent for its tooltip
  function subagentChip(list) {
    const all = list || [];
    return all.length ? `🐣 ${all.filter((s) => s.state === 'running').length} / ${all.length}` : '';
  }
  const subagentTitle = (list) => (list || []).map((s) => `${s.name}: ${s.state === 'running' ? 'working' : s.state}`).join('\n');

  // for the pet list: [state, when], ago(ms) formats a duration
  function subagentStatus(s, now, ago) {
    if (s.state === 'running') return ['working', `for ${ago(now - s.started)}`];
    if (s.state === 'error') return ['error', `${ago(now - s.ended)} ago`];
    return ['asleep', `done ${ago(now - s.ended)} ago`];
  }

  // where a running mini stands (its left x): behind the pet in its place in the line, kept on the span
  // the pet walks on ({x1, x2}: its box, window top or screen); a span too short for it: the middle
  function lineSpot({ cx, pw, w, ahead, slot, span }) {
    const x = cx - ahead * (pw / 2 + (slot + 0.5) * w) - w / 2;
    if (span.x2 - span.x1 < w) return (span.x1 + span.x2) / 2 - w / 2;
    return Math.min(Math.max(x, span.x1), span.x2 - w);
  }

  // the napper's 💤 or 🌧️ (its top centre): next to the parent's own icon (18px high, 18px above the
  // pet's top, centred), on its tail side, so the two don't overlap
  function napBadgeSpot({ cx, top, ahead }) {
    return { x: cx - ahead * 21, y: top - 15 };
  }

  const lerp = (a, b, u) => a + (b - a) * u;

  class Mini {
    // parent: the Pet; sub: {id, name, state, ...}; look: {kind, pack} to draw
    constructor(parent, sub, look) {
      this.parent = parent;
      this.kind = look.kind;
      this.pack = look.pack || null;
      this.w = Math.max(Critters.size, Math.round(parent.w / 2));
      this.h = this.pack ? Math.round((this.w * this.pack.manifest.frameHeight) / this.pack.manifest.frameWidth) : this.w;
      this.t = Math.random() * 10;
      this.facingLeft = parent.facingLeft;
      // pops out of the pet with a small hop
      this.x = parent.x + parent.w / 2 - this.w / 2;
      this.feet = parent.feet;
      this.walking = false;
      this.jump = { from: null, at: 0, seconds: 0.4, height: this.h * 0.6 }; // from wherever the pet is on its first frame
      this.el = document.createElement('div');
      this.el.className = 'mini';
      this.canvas = document.createElement('canvas');
      this.canvas.width = this.w;
      this.canvas.height = this.h;
      this.ctx = this.canvas.getContext('2d');
      this.badge = document.createElement('div');
      this.badge.className = 'badge';
      this.el.append(this.canvas, this.badge);
      document.getElementById('stage').appendChild(this.el);
      this.removed = false;
      this.setSub(sub);
    }

    get asleep() {
      return this.sub.state !== 'running';
    }

    setSub(sub) {
      const wasAsleep = this.sub && this.asleep;
      this.sub = sub;
      // just finished: jump onto the pet's back
      if (this.asleep && !wasAsleep && this.sub && !this.jump) this.jump = { from: [this.x, this.feet], at: 0, seconds: JUMP_SECONDS, height: this.parent.h * 0.8 };
    }

    // where it heads: its place in the line behind the pet, or the pet's back
    target(slot, onBack, span) {
      const p = this.parent;
      const cx = p.x + p.w / 2;
      const ahead = p.facingLeft ? -1 : 1;
      if (!onBack) return [lineSpot({ cx, pw: p.w, w: this.w, ahead, slot, span }), p.feet];
      // a little towards the tail, clear of the cap
      const x = cx - ahead * p.w * 0.1 - this.w / 2;
      const sq = p.squishScale();
      const back = p.h * 0.45 * (sq ? sq[1] : 1);
      return [x, p.feet - back];
    }

    update(dt, slot, onBack, span) {
      this.t += dt;
      const p = this.parent;
      const [tx, tfeet] = this.target(slot, onBack, span);
      if (this.jump) {
        const j = this.jump;
        if (!j.from) j.from = [p.x + p.w / 2 - this.w / 2, p.feet];
        j.at += dt;
        const u = Math.min(1, j.at / j.seconds);
        this.x = lerp(j.from[0], tx, u);
        this.feet = lerp(j.from[1], tfeet, u) - Math.sin(Math.PI * u) * j.height;
        if (tx !== this.x) this.facingLeft = tx < j.from[0];
        if (u >= 1) this.jump = null;
        this.walking = false;
        return;
      }
      if (onBack) {
        // napping on the back: it goes wherever the pet goes
        this.x = tx;
        this.feet = tfeet;
        this.facingLeft = p.facingLeft;
        this.walking = false;
        return;
      }
      // trot after the pet, a little slower to react than it is
      const dx = tx - this.x;
      const max = (p.speed || 70) * 1.4 * dt;
      const step = Math.abs(dx) < 2 ? 0 : Math.sign(dx) * Math.min(Math.abs(dx) * Math.min(1, dt * 4), max);
      this.x += step;
      this.walking = Math.abs(step) / Math.max(dt, 1e-3) > 5;
      this.facingLeft = this.walking ? step < 0 : p.facingLeft;
      // a big drop or climb (the pet jumped onto a window, or fell): hop there
      if (Math.abs(tfeet - this.feet) > p.h) this.jump = { from: [this.x, this.feet], at: 0, seconds: 0.5, height: this.h * 0.5 };
      else this.feet = lerp(this.feet, tfeet, Math.min(1, dt * 10));
    }

    pose() {
      if (this.jump) return 'fall';
      if (this.asleep) return 'sleep';
      return this.walking ? 'walk' : 'work';
    }

    draw(pose) {
      const ctx = this.ctx;
      if (!this.pack) return Critters.draw(ctx, this.kind, pose, this.t, this.facingLeft, null, 'none', false);
      const m = this.pack.manifest;
      const anims = m.animations || {};
      const a = anims[pose] || anims.idle || anims.walk || { row: 0, frames: 1, fps: 1 };
      const frame = Math.floor(this.t * (a.fps || 6)) % (a.frames || 1);
      const flip = m.facing === 'left' ? !this.facingLeft : this.facingLeft;
      ctx.clearRect(0, 0, this.w, this.h);
      ctx.imageSmoothingEnabled = false;
      ctx.save();
      if (flip) {
        ctx.translate(this.w, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(this.pack.img, frame * m.frameWidth, (a.row || 0) * m.frameHeight, m.frameWidth, m.frameHeight, 0, 0, this.w, this.h);
      ctx.restore();
    }

    render() {
      const p = this.parent;
      // out of sight while the pet can't take it along (dragged, stuck to a taskbar, tucked away...)
      const away = this.leaving || p.gone || p.hidden || !!p.stick || HIDE_MODES.includes(p.mode);
      if (away !== this.away) {
        this.away = away;
        this.el.style.opacity = away ? '0' : '1';
      }
      const pose = this.pose();
      const frame = this.pack ? Math.floor(this.t * 12) : Critters.frameOf(pose, this.t);
      const key = `${pose}|${frame}|${this.facingLeft}`;
      if (key !== this.lastDraw) {
        this.lastDraw = key;
        this.draw(pose);
      }
      const move = `translate(${Math.round(this.x)}px, ${Math.round(this.feet - this.h)}px)`;
      if (move !== this.lastMove) {
        this.lastMove = move;
        this.el.style.transform = move;
      }
      const badge = !this.asleep ? '' : this.sub.state === 'error' ? '🌧️' : '💤';
      if (badge !== this.badge.textContent) this.badge.textContent = badge;
      // napping: its icon goes beside the parent's
      let at = '';
      if (badge && !this.jump) {
        const s = napBadgeSpot({ cx: p.x + p.w / 2, top: p.y, ahead: p.facingLeft ? -1 : 1 });
        at = `${Math.round(s.x - Math.round(this.x))}px,${Math.round(s.y - Math.round(this.feet - this.h))}px`;
      }
      if (at !== this.lastBadgeAt) {
        this.lastBadgeAt = at;
        const [left, top] = at ? at.split(',') : ['', ''];
        this.badge.style.left = left;
        this.badge.style.top = top;
      }
    }

    // fade away, then go
    fadeOut() {
      if (this.leaving) return;
      this.leaving = true;
      this.el.style.opacity = '0';
      setTimeout(() => this.remove(), 400);
    }

    remove() {
      this.removed = true;
      this.el.remove();
    }
  }

  const api = { Mini, pickMinis, lineSpot, napBadgeSpot, MAX_MINIS, subagentChip, subagentTitle, subagentStatus };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.Minis = api;
})();
