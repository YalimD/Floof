// Draws the README pictures with floof's own critters (see main.js --render-docs).
const S = 4; // pixel scale
function pet(kind, pose, opts = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = Critters.size * S;
  const hat = opts.provider ? Critters.providerStyle(opts.provider, opts) : null;
  Critters.draw(c.getContext('2d'), kind, pose, opts.t || 0, !!opts.left, hat, opts.wear || 'cap', opts.stuck ? 'top' : false);
  return c;
}
function cell(canvas, label, cls) {
  const d = document.createElement('div');
  d.className = 'cell';
  if (cls) canvas.classList.add(cls);
  const t = document.createElement('div');
  t.textContent = label;
  d.append(canvas, t);
  return d;
}
function row(sheet, cells) {
  const r = document.createElement('div');
  r.className = 'row';
  r.append(...cells);
  document.getElementById(sheet).append(r);
}

// the logo: the guide sheep in its floof cap
row('logo', [cell(pet('sheep', 'wave', { provider: 'floof' }), '')]);

// the five built-in critters
row('critters', [
  cell(pet('cat', 'walk'), 'cat'),
  cell(pet('dog', 'idle'), 'dog'),
  cell(pet('bird', 'walk'), 'bird'),
  cell(pet('sheep', 'idle'), 'sheep'),
  cell(pet('llama', 'walk'), 'llama'),
]);

// what agents look like in each state
row('states', [
  cell(pet('cat', 'work', { provider: 'claude-code', t: 0.05 }), '⚙️ working'),
  cell(pet('dog', 'wave', { provider: 'codex' }), '❓ asking'),
  cell(pet('bird', 'sad', { provider: 'gemini' }), '🌧️ error'),
  cell(pet('sheep', 'celebrate', { provider: 'mistral' }), '✅ done'),
  cell(pet('llama', 'sleep', { provider: 'ollama', model: 'qwen2.5-coder' }), '💤 asleep'),
]);

// provider colours: caps, T-shirts, scarves, Ollama llamas, your own letter
row('outfits', [
  cell(pet('cat', 'idle', { provider: 'claude-code' }), 'Claude cap'),
  cell(pet('dog', 'idle', { provider: 'codex', wear: 'tshirt' }), 'Codex T-shirt'),
  cell(pet('bird', 'idle', { provider: 'gemini', wear: 'both' }), 'Gemini scarf'),
  cell(pet('llama', 'idle', { provider: 'ollama', model: 'llama3.1' }), 'Ollama: llama3.1'),
  cell(pet('sheep', 'idle', { provider: 'openai-compatible', badge: 'LM' }), 'your letter'),
]);

// holding on to a top taskbar
const bar = document.createElement('div');
bar.className = 'taskbar';
document.getElementById('plungers').append(bar);
row('plungers', [
  cell(pet('cat', 'walk', { stuck: true, provider: 'claude-code' }), '', 'stuck'),
  cell(pet('sheep', 'sleep', { stuck: true }), '', 'stuck'),
  cell(pet('llama', 'idle', { stuck: true, provider: 'ollama', model: 'gemma2' }), '', 'stuck'),
]);

// a pet placed in a scene, its feet at (x, feet)
function place(scene, canvas, x, feet) {
  canvas.style.left = `${x}px`;
  canvas.style.top = `${feet - canvas.height}px`;
  document.getElementById(scene).append(canvas);
}
function html(scene, markup) {
  const el = document.getElementById(scene);
  el.insertAdjacentHTML('beforeend', markup);
  return el.lastElementChild;
}

// a question in the pet's own balloon
place('questionScene', pet('cat', 'wave', { provider: 'claude-code' }), 110, 288);
html(
  'questionScene',
  `<div class="balloon open asking" style="left:12px;top:24px;--tail:190px">
     <div class="who">refactor-api<small>claude-code</small></div>
     <div class="now">Should I also update the tests?</div>
     <form class="ask" style="display:flex"><input placeholder="Type an answer…" /><button type="button">Send</button></form>
   </div>`
);

// the curtain, pulled open on the corner of a window
html('curtainScene', '<div class="window" style="left:0;top:96px;width:500px;height:230px"><div class="titlebar"></div></div>');
html(
  'curtainScene',
  `<div class="curtain corner-tr show open" style="left:190px;top:104px">
     <div class="note"><div class="who">fix-login-bug · codex needs you</div>
       <div class="text">Tests pass now. Shall I push the fix?</div>
       <form class="ask"><input placeholder="Type your answer…" /><button type="button">Send</button></form>
       <button class="later" type="button">Later</button></div>
     <div class="drape"></div><div class="tie"></div>
   </div>`
);
place('curtainScene', pet('dog', 'pull', { provider: 'codex' }), 395, 98);

// a pet box with a background and shelves
const box = html(
  'boxScene',
  `<div class="petbox" style="left:0;top:0;width:540px;height:330px;--shelf:#a8743f">
     <div class="petbox-bg" style="opacity:.55;background:linear-gradient(160deg,#cfe8ff,#fde4c8)"></div>
     <div class="petbox-shelves">
       <div class="petbox-shelf" style="transform:translate(30px,150px);width:220px"></div>
       <div class="petbox-shelf" style="transform:translate(300px,230px);width:210px"></div>
     </div>
     <div class="petbox-bar"><span>pet box</span><span class="petbox-tools"><button class="petbox-edit">✎</button><button>⚙</button><button>×</button></span></div>
     <div class="petbox-grip"></div>
   </div>`
);
place('boxScene', pet('sheep', 'sleep'), 34, 150);
place('boxScene', pet('bird', 'idle', { provider: 'gemini' }), 150, 150);
place('boxScene', pet('llama', 'work', { provider: 'ollama', model: 'qwen2.5-coder' }), 360, 230);
place('boxScene', pet('cat', 'walk', { provider: 'claude-code' }), 170, 327);
place('boxScene', pet('dog', 'sleep'), 395, 327);

// main.js shows one sheet at a time and captures it
window.showSheet = (id) => {
  for (const s of document.querySelectorAll('.sheet')) s.style.display = s.id === id ? 'block' : 'none';
  const el = document.getElementById(id);
  const r = el.getBoundingClientRect();
  return { width: Math.ceil(r.width), height: Math.ceil(r.height) };
};
