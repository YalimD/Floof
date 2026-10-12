// Built-in fluffy critters, drawn procedurally as 32x32 pixel art and scaled up.
// Every critter faces right; the pet flips the canvas when walking left.
// Poses: walk, idle, sleep, work, wave, celebrate, fall, drag, sad, fly, chat, pull.
(function () {
  const N = 32;
  const buf = document.createElement('canvas');
  buf.width = buf.height = N;
  const b = buf.getContext('2d');

  function px(x, y, w, h, c) {
    b.fillStyle = c;
    b.fillRect(Math.round(x), Math.round(y), w, h);
  }
  function ell(cx, cy, rx, ry, c) {
    b.fillStyle = c;
    for (let y = -ry; y <= ry; y++) {
      const w = Math.floor(rx * Math.sqrt(1 - (y * y) / (ry * ry)));
      b.fillRect(Math.round(cx - w), Math.round(cy + y), w * 2 + 1, 1);
    }
  }
  // filled ellipse with a 1px outline
  function blob(cx, cy, rx, ry, fill, line) {
    ell(cx, cy, rx + 1, ry + 1, line);
    ell(cx, cy, rx, ry, fill);
  }

  const PAL = {
    cat: { fill: '#f0a04b', dark: '#c4691f', light: '#ffe2bd', line: '#3a2414' },
    dog: { fill: '#c8925a', dark: '#7d4f28', light: '#efd2ab', line: '#2e1d10' },
    sheep: { fill: '#f6f3ea', dark: '#3b3b46', light: '#ffffff', line: '#5a5a62' },
    bird: { fill: '#6ab0e8', dark: '#3f7fbf', light: '#f6e7a8', line: '#1f3550', beak: '#f39c34' },
    llama: { fill: '#f0e2c4', dark: '#b88f5e', light: '#fff8e8', line: '#4a3420' },
  };

  // top centre of the head in the last drawn frame, where a provider cap sits
  let head = { x: 24, y: 10 };
  // big plungers on the feet this frame, for holding on to a taskbar at the top or side of a screen
  let plungers = false;
  function plunger(x) {
    px(x, 25, 2, 4, '#8a5a2b'); // wooden handle
    px(x - 2, 29, 6, 3, '#5a0f12'); // rubber cup, with a rim
    px(x - 1, 29, 4, 2, '#d8323a');
    px(x - 1, 29, 1, 1, '#ff8a8f');
  }

  // a provider T-shirt to draw on the body this frame ({color, letter}), and where its chest is
  let shirt = null;
  let chest = null;

  function darker(color) {
    if (!/^#/.test(color)) return 'rgba(0, 0, 0, 0.45)';
    const c = (i) => Math.round(parseInt(color.slice(i, i + 2), 16) * 0.6).toString(16).padStart(2, '0');
    return `#${c(1)}${c(3)}${c(5)}`;
  }

  // a T-shirt over the body, with short sleeves over the front legs; the letter goes on after scaling
  function drawShirt(cx, cy, rx, ry, sleeveY) {
    ell(cx, cy, rx + 1, ry + 1, darker(shirt.color));
    ell(cx, cy, rx, ry, shirt.color);
    if (sleeveY != null) {
      px(cx + rx - 4, sleeveY, 4, 2, darker(shirt.color));
      px(cx + rx - 3, sleeveY, 3, 1, shirt.color);
    }
    chest = { x: cx, y: cy };
  }

  function eye(x, y, closed, line) {
    if (closed) px(x - 1, y + 1, 2, 1, line);
    else px(x, y, 1, 2, line);
  }

  // sad face: brows slanting down to the outside, eyes half shut, a tear now and then
  function sadEye(x, y, line, tear) {
    px(x - 1, y - 2, 1, 1, line);
    px(x, y - 3, 1, 1, line);
    px(x, y + 1, 1, 1, line);
    if (tear) px(x, y + 2, 1, 2, '#6ec6ff');
  }

  function laptop(line) {
    px(24, 22, 7, 5, '#9aa3ad');
    px(25, 23, 5, 3, '#cfe8ff');
    px(23, 27, 9, 1, line);
  }

  // shared four-legged body: cat, dog, sheep
  function quadruped(kind, pose, f) {
    const P = PAL[kind];
    const lying = pose === 'sleep';
    const sq = lying ? 2 : 0;
    const hop = pose === 'walk' && f ? -1 : 0;
    const closed = lying;
    const sad = pose === 'sad';
    const face = (x, y) => (sad ? sadEye(x, y, P.line, f) : eye(x, y, closed, P.line));

    // tail, behind the body
    const wag = (pose === 'walk' || pose === 'celebrate' || pose === 'wave' || pose === 'pull') && f ? 1 : 0;
    if (sad && kind !== 'sheep') {
      // tail hangs down
      px(1, 21, 5, 3, P.line);
      px(2, 22, 4, 1, P.fill);
    } else if (kind === 'cat') {
      px(3 - wag, 12 + sq, 2, 9, P.line);
      px(4 - wag, 13 + sq, 1, 8, P.fill);
      px(4 - wag, 13 + sq, 2, 1, P.dark);
    } else if (kind === 'dog') {
      px(3 + wag, 14 + sq, 3, 5, P.line);
      px(4 + wag, 15 + sq, 1, 4, P.fill);
    } else if (kind === 'llama') {
      blob(5 - wag, 17 + sq, 2, 3, P.fill, P.line); // a woolly tuft of a tail
    } else {
      blob(4, 21 + sq, 2, 2, P.fill, P.line);
    }

    // legs
    if (!lying) {
      const legC = kind === 'sheep' ? P.dark : P.fill;
      const xs = [6, 10, 17, 21];
      xs.forEach((x, i) => {
        let lift = 0;
        if (pose === 'walk') lift = (i % 2 === 0) === !!f ? 1 : 0;
        let len = 4 - lift;
        let lx = x;
        if (pose === 'fall' || pose === 'drag') {
          len = 5;
          lx += i < 2 ? -1 : 1;
        }
        px(lx - 1, 27 + hop, 4, len + 1, P.line);
        px(lx, 27 + hop, 2, len, legC);
      });
    }
    if (plungers) [6, 10, 17, 21].forEach((x) => plunger(x));

    // body
    const by = 21 + sq + hop;
    if (kind === 'sheep') {
      const bumps = [[6, 17], [10, 14], [15, 13], [20, 14], [22, 19], [5, 23], [11, 27], [18, 27]];
      bumps.forEach(([x, y]) => ell(x, y + sq + hop, 4, 4, P.line));
      ell(14, by, 11, 8 - sq, P.line);
      bumps.forEach(([x, y]) => ell(x, y + sq + hop, 3, 3, P.fill));
      ell(14, by, 10, 7 - sq, P.fill);
      px(9, 18 + sq + hop, 2, 1, P.light);
      px(15, 16 + sq + hop, 2, 1, P.light);
    } else if (kind === 'llama') {
      // a woolly body, slimmer than the sheep's
      const tufts = [[7, 17], [12, 15], [17, 16], [6, 24], [13, 27], [19, 26]];
      tufts.forEach(([x, y]) => ell(x, y + sq + hop, 3, 3, P.line));
      ell(13, by, 9, 6 - sq, P.line);
      tufts.forEach(([x, y]) => ell(x, y + sq + hop, 2, 2, P.fill));
      ell(13, by, 8, 5 - sq, P.fill);
      px(9, 18 + sq + hop, 2, 1, P.light);
      px(14, 17 + sq + hop, 2, 1, P.light);
    } else {
      blob(14, by, 10, 7 - sq, P.fill, P.line);
      ell(16, by + 3 - sq, 6, 3 - (lying ? 1 : 0), P.light); // belly
      if (kind === 'cat') {
        px(9, by - 6 + sq, 1, 3, P.dark);
        px(13, by - 7 + sq, 1, 3, P.dark);
        px(17, by - 6 + sq, 1, 3, P.dark);
      } else {
        ell(9, by - 3, 3, 2, P.dark); // dog patch
      }
    }
    if (shirt) drawShirt(15, by, 8, Math.max(3, 5 - sq), lying ? null : by + 4);

    // head
    const hy = 15 + sq + hop + (lying ? 4 : 0) + (sad ? 2 : 0); // sad: head hangs a little
    const hx = 24;
    head = { x: 24, y: hy - 5 };
    if (kind === 'cat') {
      if (sad) {
        // ears flatten sideways
        px(17, hy - 5, 4, 2, P.line);
        px(27, hy - 5, 4, 2, P.line);
      } else {
        px(19, hy - 7, 3, 4, P.line);
        px(20, hy - 6, 1, 3, P.dark);
        px(26, hy - 7, 3, 4, P.line);
        px(27, hy - 6, 1, 3, P.dark);
      }
      blob(hx, hy, 6, 5, P.fill, P.line);
      face(26, hy - 1);
      face(22, hy - 1);
      px(28, hy + 2, 1, 1, '#e76f8a');
      px(29, hy + 1, 2, 1, P.line); // whiskers
      px(29, hy + 3, 2, 1, P.line);
    } else if (kind === 'llama') {
      // a long neck up to a small head held high, banana ears and a soft snout
      const ly = hy - (lying ? 2 : 6);
      head = { x: 24, y: ly - 4 };
      px(18, ly + 2, 7, by - ly - 1, P.line); // neck
      px(19, ly + 2, 5, by - ly - 1, P.fill);
      px(20, ly + 4, 1, 2, P.light);
      if (sad) {
        px(17, ly - 2, 4, 2, P.line); // ears droop sideways
        px(27, ly - 2, 4, 2, P.line);
      } else {
        px(20, ly - 7, 3, 5, P.line);
        px(21, ly - 6, 1, 3, P.dark);
        px(25, ly - 7, 3, 5, P.line);
        px(26, ly - 6, 1, 3, P.dark);
      }
      blob(23, ly, 4, 4, P.fill, P.line);
      blob(27, ly + 2, 3, 2, P.light, P.line); // snout
      px(29, ly + 1, 1, 1, P.line); // nostril
      face(24, ly - 1);
      if (pose === 'celebrate' || pose === 'wave') px(27, ly + 4, 2, 1, '#e76f8a'); // a happy little mouth
    } else if (kind === 'dog') {
      blob(hx, hy, 6, 5, P.fill, P.line);
      blob(29, hy + 2, 2, 2, P.light, P.line); // snout
      px(30, hy + 1, 2, 1, P.line); // nose
      px(18, hy - 3, 3, 7, P.line); // floppy ear
      px(19, hy - 2, 2, 6, P.dark);
      face(25, hy - 1);
      if (pose === 'celebrate' || pose === 'wave') px(28, hy + 4, 2, 2, '#e76f8a'); // tongue
    } else {
      px(20, hy - 2, 3, 2, P.dark); // ear
      ell(hx + 1, hy + 1, 5, 6, P.line);
      ell(hx + 1, hy + 1, 4, 5, P.dark);
      if (closed) px(25, hy, 2, 1, '#fff');
      else if (sad) {
        px(25, hy - 2, 1, 1, '#fff');
        px(26, hy, 1, 1, '#fff');
        if (f) px(26, hy + 2, 1, 2, '#6ec6ff');
      } else px(26, hy - 1, 1, 2, '#fff');
      ell(hx, hy - 5, 3, 2, P.fill); // wool tuft
    }

    // pose extras
    if (pose === 'work') {
      laptop(P.line);
      px(22, 25 + (f ? 0 : 1), 3, 2, kind === 'sheep' ? P.dark : P.fill); // typing paw
    }
    if (pose === 'wave' || pose === 'celebrate' || pose === 'pull') {
      // raised front paw, waving beside the head (or tugging the curtain)
      const up = f ? 0 : 2;
      px(29, 3 + up, 3, 9, P.line);
      px(30, 4 + up, 1, 8, kind === 'sheep' ? P.dark : P.fill);
    }
  }

  function bird(pose, f) {
    const P = PAL.bird;
    const lying = pose === 'sleep';
    const sq = lying ? 2 : 0;
    const hop = pose === 'walk' && f ? -1 : 0;

    px(3, 18 + sq + hop, 4, 4, P.line); // tail
    px(4, 19 + sq + hop, 3, 2, P.dark);
    if (!lying && pose !== 'fly') {
      const spread = pose === 'fall' || pose === 'drag' ? 1 : 0;
      px(13 - spread, 28 + hop, 1, 3, P.beak);
      px(18 + spread, 28 + hop, 1, 3, P.beak);
      px(12 - spread, 30 + hop, 3, 1, P.beak);
      px(17 + spread, 30 + hop, 3, 1, P.beak);
    }
    if (plungers) [12, 18].forEach((x) => plunger(x));
    blob(15, 20 + sq + hop, 10, 8 - sq, P.fill, P.line);
    ell(17, 24 + hop, 6, 3 - (lying ? 1 : 0), P.light);
    // wing: flaps when flying, waving or celebrating
    const flapping = pose === 'fly' || pose === 'wave' || pose === 'celebrate' || pose === 'pull';
    if (flapping && f) {
      ell(11, 12 + hop, 5, 3, P.line);
      ell(11, 12 + hop, 4, 2, P.dark);
    } else {
      ell(11, 21 + sq + hop, 5, 4, P.line);
      ell(11, 21 + sq + hop, 4, 3, P.dark);
    }
    const ey = 16 + sq + hop + (pose === 'sad' ? 1 : 0);
    head = { x: 20, y: ey - 3 };
    if (lying) px(20, ey + 1, 3, 1, P.line);
    else if (pose === 'sad') {
      px(20, ey + 1, 3, 2, '#fff');
      px(21, ey + 2, 2, 1, P.line);
      px(19, ey - 1, 1, 1, P.line);
      px(20, ey - 2, 2, 1, P.line);
      if (f) px(22, ey + 3, 1, 2, '#6ec6ff');
    } else {
      px(20, ey, 3, 3, '#fff');
      px(21, ey + 1, 2, 2, P.line);
    }
    px(25, ey + 2, 4, 2, P.beak);
    px(25, ey + 3, 3, 1, '#c26f17');
    if (shirt) {
      // a bird can't wear a T-shirt: a little scarf in the provider's colour, with a loose end
      const sy = ey + 5;
      px(16, sy - 1, 9, 4, darker(shirt.color));
      px(17, sy, 7, 2, shirt.color);
      px(17, sy + 1, 7, 1, 'rgba(255, 255, 255, 0.75)'); // a light stripe, so it shows on any bird
      px(15, sy + 1, 3, 5, darker(shirt.color));
      px(16, sy + 2, 1, 3, shirt.color);
      px(16, sy + 4, 1, 1, 'rgba(255, 255, 255, 0.75)');
    }
    if (pose !== 'sad') px(13, 13 + hop, 2, 2, P.dark); // crest (flat when sad)
    if (pose === 'work') laptop(P.line);
  }

  function frameOf(pose, t) {
    const fps = pose === 'work' ? 10 : pose === 'fly' ? 12 : pose === 'sad' ? 1.2 : 6;
    return Math.floor(t * fps) % 2;
  }

  // ---------- provider caps: an agent's pet wears its provider's colour and initial ----------
  // Only colours and letters, no logos. Unknown providers get a colour picked from their name.
  const PROVIDERS = [
    [/claude|anthropic/, '#d97745', 'C'],
    [/gemini|google/, '#4a7fe0', 'G'],
    [/codex/, '#2f2f2f', 'X'],
    [/openai|gpt|chatgpt/, '#2f2f2f', 'O'],
    [/copilot/, '#8a5cd6', 'C'],
    [/mistral/, '#f08a24', 'M'],
    [/flo(o|f)f/, '#ffd76b', 'f'],
  ];

  const hashColor = (s) => {
    let h = 0;
    for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
    return `hsl(${Math.abs(h) % 360}, 55%, 45%)`;
  };

  // "library/qwen2.5-coder:7b" -> name "qwen2.5-coder", family "qwen", initial "Q"
  function modelName(model) {
    const name = String(model || '').split('/').pop().split(':')[0].trim();
    return { name, family: (name.match(/^[a-z]+/i) || [name])[0].toLowerCase(), initial: (name.match(/[a-z0-9]/i) || [''])[0].toUpperCase() };
  }

  // extra: {model, badge (the agent's own letter), compat (the letter for OpenAI-compatible agents)}
  function providerStyle(provider, extra = {}) {
    const p = String(provider || '').toLowerCase().trim();
    if (!p) return null;
    const badge = String(extra.badge || '').trim().slice(0, 2);
    let style;
    if (/ollama/.test(p)) {
      // Ollama agents wear the initial of the model they serve, in that model family's colour
      const m = modelName(extra.model);
      style = m.name ? { color: hashColor(m.family), letter: m.initial } : { color: '#8a6a4a', letter: 'O' };
    } else if (/openai[-_ ]?compat|compatible/.test(p)) {
      style = { color: '#2f7f78', letter: String(extra.compat || 'O').trim().slice(0, 2) || 'O' };
    } else {
      const known = PROVIDERS.find(([re]) => re.test(p));
      style = known ? { color: known[1], letter: known[2] } : { color: hashColor(p), letter: p[0].toUpperCase() };
    }
    return badge ? { ...style, letter: badge } : style;
  }

  const isLight = (color) => /^#/.test(color) && parseInt(color.slice(1, 3), 16) * 0.3 + parseInt(color.slice(3, 5), 16) * 0.59 + parseInt(color.slice(5, 7), 16) * 0.11 > 170;

  // A cap whose crown sits on (ax, ay), the top centre of the head, in units of u screen pixels;
  // the brim points the way the critter faces. The letter is drawn unmirrored.
  // a letter on a cap or shirt; upsideDown: the canvas is shown flipped (under a top taskbar),
  // so the letter is drawn flipped too, to read the right way up
  function letter(ctx, text, x, y, upsideDown) {
    if (!upsideDown) return ctx.fillText(text, x, y);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, -1);
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  function drawCap(ctx, ax, ay, u, style, flip, upsideDown = false) {
    const W = ctx.canvas.width;
    const line = '#262626';
    const r = (x, y, w, h, c) => {
      ctx.fillStyle = c;
      ctx.fillRect(Math.round(x * u), Math.round(y * u), Math.round(w * u), Math.round(h * u));
    };
    ctx.save();
    if (flip) {
      ctx.translate(W, 0);
      ctx.scale(-1, 1);
    }
    r(ax - 4, ay - 4, 9, 5, line); // crown
    r(ax - 3, ay - 3, 7, 4, style.color);
    r(ax - 1, ay - 5, 3, 1, line); // button
    r(ax + 4, ay, 4, 2, line); // brim
    r(ax + 5, ay, 3, 1, style.color);
    ctx.restore();
    const cx = (ax + 0.5) * u;
    ctx.fillStyle = isLight(style.color) ? '#262626' : '#ffffff';
    ctx.font = `bold ${Math.max(7, Math.round((style.letter.length > 1 ? 2.7 : 3.6) * u))}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    letter(ctx, style.letter, flip ? W - cx : cx, (ay - 1.1) * u, upsideDown);
  }

  // hat: {color, letter} from providerStyle, or null for nothing; wear: 'cap', 'tshirt' or 'both'
  // stuck: holding on to a taskbar at the top or side of a screen (big plungers on its feet)
  function draw(ctx, kind, pose, t, facingLeft, hat, wear = 'cap', stuck = false) {
    b.clearRect(0, 0, N, N);
    const f = frameOf(pose, t);
    plungers = !!stuck; // stuck: the taskbar edge it holds on to ('top', 'left', 'right'), or false
    shirt = hat && (wear === 'tshirt' || wear === 'both') ? hat : null;
    const cap = hat && wear !== 'tshirt';
    chest = null;
    b.save();
    if (kind === 'bird') bird(pose, f);
    else quadruped(kind, pose, f);
    b.restore();

    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = false;
    ctx.save();
    if (facingLeft) {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(buf, 0, 0, w, h);
    ctx.restore();
    if (cap) drawCap(ctx, head.x, head.y, w / N, hat, facingLeft, stuck === 'top');
    if (shirt && chest) {
      // the initial on the shirt, never mirrored
      const u = w / N;
      const cx = (chest.x + 0.5) * u;
      ctx.fillStyle = isLight(shirt.color) ? '#262626' : '#ffffff';
      ctx.font = `bold ${Math.max(8, Math.round((shirt.letter.length > 1 ? 3.2 : 4.4) * u))}px "Segoe UI", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      letter(ctx, shirt.letter, facingLeft ? w - cx : cx, (chest.y + 0.3) * u, stuck === 'top');
    }
  }

  // a T-shirt patch for sprite packs that give a "body" anchor (chest centre, in units of u pixels)
  function drawShirtPatch(ctx, ax, ay, u, style, flip) {
    const W = ctx.canvas.width;
    const r = (x, y, w, h, c) => {
      ctx.fillStyle = c;
      ctx.fillRect(Math.round(x * u), Math.round(y * u), Math.round(w * u), Math.round(h * u));
    };
    ctx.save();
    if (flip) {
      ctx.translate(W, 0);
      ctx.scale(-1, 1);
    }
    r(ax - 5, ay - 4, 11, 8, darker(style.color));
    r(ax - 4, ay - 3, 9, 6, style.color);
    ctx.restore();
    const cx = (ax + 0.5) * u;
    ctx.fillStyle = isLight(style.color) ? '#262626' : '#ffffff';
    ctx.font = `bold ${Math.max(8, Math.round((style.letter.length > 1 ? 3.2 : 4.4) * u))}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(style.letter, flip ? W - cx : cx, (ay + 0.3) * u);
  }

  // plungers for sprite packs: two at the bottom of the frame (u screen pixels per frame pixel)
  function drawPlungers(ctx, fw, fh, u) {
    for (const fx of [0.3, 0.7]) {
      const x = Math.round(fw * fx);
      const r = (rx, ry, w, h, c) => {
        ctx.fillStyle = c;
        ctx.fillRect(Math.round(rx * u), Math.round(ry * u), Math.round(w * u), Math.round(h * u));
      };
      r(x, fh - 7, 2, 4, '#8a5a2b');
      r(x - 2, fh - 3, 6, 3, '#5a0f12');
      r(x - 1, fh - 3, 4, 2, '#d8323a');
    }
  }

  const headAt = () => ({ ...head }); // top centre of the head in the frame just drawn, facing right
  window.Critters = { drawPlungers, headAt, kinds: ['cat', 'dog', 'bird', 'sheep', 'llama'], size: N, draw, frameOf, providerStyle, drawCap, drawShirtPatch };
})();
