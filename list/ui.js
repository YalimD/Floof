// floof pet list: pets on screen right now, and agents that finished or left
const api = window.floofList;
const $ = (id) => document.getElementById(id);
const FACES = { cat: '🐱', dog: '🐶', bird: '🐦', sheep: '🐑', llama: '🦙' };

function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ${m % 60} min` : `${Math.floor(h / 24)} d`;
}

function stateOf(p) {
  if (p.leaving) return ['leaving', 'left'];
  if (p.hidden) return ['tucked away', ''];
  if (p.asking) return [p.snoozed ? 'waiting for you (put away)' : 'waiting for you', 'question'];
  if (p.state === 'working') return ['working', 'working'];
  if (p.state === 'error') return ['error', 'error'];
  if (p.mode === 'sleep') return ['asleep', ''];
  return [p.state || 'idle', ''];
}

// style: {letter, color} as the pet wears it (from the overlay), else worked out from the provider
function face(kind, provider, style, model) {
  const el = document.createElement('div');
  el.className = 'face';
  el.textContent = FACES[kind] || '🐾';
  const hat = style && style.letter ? style : provider && window.Critters ? Critters.providerStyle(provider, { model }) : null;
  if (hat) {
    const cap = document.createElement('span');
    cap.className = 'cap';
    cap.textContent = hat.letter;
    cap.style.background = hat.color;
    cap.style.color = hat.color === '#ffd76b' ? '#222' : '#fff';
    el.append(cap);
  }
  return el;
}

function who(name, provider) {
  const el = document.createElement('div');
  el.className = 'who';
  el.textContent = name;
  if (provider) {
    const small = document.createElement('small');
    small.textContent = provider;
    el.append(small);
  }
  return el;
}

// a small × button on a row; it doesn't also make the pet hop
function removeButton(label, title, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'link remove';
  b.textContent = label;
  b.title = title;
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

function agentRow(p, now) {
  const li = document.createElement('li');
  li.addEventListener('click', (e) => {
    if (!e.target.closest('.ask')) api.find(p.id);
  });
  const [label, cls] = stateOf(p);
  const state = document.createElement('div');
  state.className = `state ${cls}`;
  state.innerHTML = '<b></b><span class="muted"></span>';
  state.querySelector('b').textContent = label;
  state.querySelector('.muted').textContent = `${p.since ? `for ${ago(now - p.since)} · ` : ''}${p.screen || ''}`;
  const text = document.createElement('div');
  text.className = 'text';
  text.textContent = p.text || '';
  li.append(face(p.kind, p.provider, { letter: p.badge, color: p.capColor }, p.model),who(p.name, p.model ? `${p.provider} · ${p.model}` : p.provider), state, text);
  if (p.canGo) {
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'link go';
    go.textContent = '↗ Take me there';
    go.addEventListener('click', async (e) => {
      e.stopPropagation();
      const r = await api.goTo(p.id);
      if (!r || !r.ok) go.textContent = `Couldn't: ${(r && r.why) || 'unknown'}`;
    });
    state.append(go);
  }
  if (!p.leaving && !p.tour) state.append(removeButton('× Dismiss', 'The pet leaves; it comes back if its agent sends anything new', () => api.remove(p.id)));
  // your own letter for this agent's cap or shirt
  const letter = document.createElement('label');
  letter.className = 'letter muted';
  letter.innerHTML = 'Letter <input maxlength="2" size="2" />';
  const li2 = letter.querySelector('input');
  li2.value = p.badge || '';
  li2.dataset.for = `badge-${p.id}`;
  li2.addEventListener('change', () => api.setBadge(p.id, li2.value));
  li.append(letter);
  if (p.asking) {
    // answer the question right here
    const form = document.createElement('form');
    form.className = 'ask';
    form.innerHTML = '<input placeholder="Type your answer…" /><button type="submit">Send</button>';
    const input = form.querySelector('input');
    input.dataset.for = p.id;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!input.value.trim()) return;
      api.answer(p.id, input.value.trim());
      input.value = '';
    });
    li.append(form);
  } else if (p.controls && p.controls.length) {
    // send the agent a message, or stop it
    const form = document.createElement('form');
    form.className = 'ask';
    form.innerHTML = '<input placeholder="Message…" /><button type="submit">Send</button><button class="stop" type="button">■ Stop</button>';
    const input = form.querySelector('input');
    input.dataset.for = `msg-${p.id}`;
    const stop = form.querySelector('.stop');
    if (!p.controls.includes('message')) {
      input.style.display = 'none';
      form.querySelector('button[type=submit]').style.display = 'none';
    }
    if (!p.controls.includes('stop') || !['working', 'question'].includes(p.state)) stop.style.display = 'none';
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!input.value.trim()) return;
      api.control(p.id, 'message', input.value.trim());
      input.value = '';
    });
    stop.addEventListener('click', () => {
      if (stop.dataset.armed) return api.control(p.id, 'stop');
      stop.dataset.armed = '1';
      stop.textContent = 'Really stop?';
    });
    li.append(form);
  }
  if (p.controlNote) {
    const note = document.createElement('div');
    note.className = 'text';
    note.textContent = p.controlNote;
    li.append(note);
  }
  return li;
}

// one of an agent's subagents, under its row
function subagentRow(p, s, now) {
  const li = document.createElement('li');
  li.className = 'sub';
  li.addEventListener('click', () => api.find(p.id));
  const [label, when] = Minis.subagentStatus(s, now, ago);
  const state = document.createElement('div');
  state.className = `state ${s.state === 'running' ? 'working' : s.state === 'error' ? 'error' : ''}`;
  state.innerHTML = '<b></b><span class="muted"></span>';
  state.querySelector('b').textContent = label;
  state.querySelector('.muted').textContent = when;
  const text = document.createElement('div');
  text.className = 'text';
  text.textContent = s.text || '';
  li.append(face(s.kind || p.kind), who(s.name), state, text);
  return li;
}

function critterRow(p) {
  const li = document.createElement('li');
  li.addEventListener('click', () => api.find(p.id));
  const [label] = stateOf(p);
  const state = document.createElement('div');
  state.className = 'state';
  state.innerHTML = '<b></b><span class="muted"></span>';
  state.querySelector('b').textContent = label;
  state.querySelector('.muted').textContent = p.screen || '';
  if (!p.leaving) state.append(removeButton('× Send away', `It leaves, and no ${p.kind} comes out when floof starts`, () => api.remove(p.id)));
  li.append(face(p.kind), who(p.kind), state);
  return li;
}

function finishedRow(e) {
  const li = document.createElement('li');
  const state = document.createElement('div');
  state.className = `state ${e.result === 'error' ? 'error' : ''}`;
  state.innerHTML = '<b></b><span class="muted"></span>';
  state.querySelector('b').textContent = e.result === 'left' ? 'left' : e.result;
  const ended = new Date(e.ended);
  state.querySelector('.muted').textContent = `${ended.toLocaleDateString()} ${ended.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ran ${ago(e.ended - e.started)}`;
  const text = document.createElement('div');
  text.className = 'text';
  text.textContent = e.text || '';
  state.append(removeButton('×', 'Remove from the list', () => api.forget(e.id, e.ended)));
  li.append(face(e.critter, e.provider), who(e.name || e.id, e.provider), state, text);
  return li;
}

function render(data) {
  // keep what you're typing into an answer box across live updates
  const drafts = {};
  let focused = null;
  for (const input of document.querySelectorAll('input[data-for]')) {
    drafts[input.dataset.for] = input.value;
    if (document.activeElement === input) focused = input.dataset.for;
  }
  const agents = [...data.agents].sort((a, b) => (b.asking ? 1 : 0) - (a.asking ? 1 : 0) || String(a.name).localeCompare(String(b.name)));
  $('agents').replaceChildren(...agents.flatMap((p) => [agentRow(p, data.now), ...(p.subagents || []).map((s) => subagentRow(p, s, data.now))]));
  $('noAgents').style.display = agents.length ? 'none' : '';
  $('critters').replaceChildren(...data.critters.map(critterRow));
  $('noCritters').style.display = data.critters.length ? 'none' : '';
  $('removeCritters').style.display = data.critters.length ? '' : 'none';
  $('finished').replaceChildren(...data.finished.map(finishedRow));
  $('finished').classList.add('done');
  $('noFinished').style.display = data.finished.length ? 'none' : '';
  for (const input of document.querySelectorAll('input[data-for]')) {
    if (drafts[input.dataset.for]) input.value = drafts[input.dataset.for];
    if (focused === input.dataset.for) input.focus();
  }
}

$('clear').addEventListener('click', () => api.clear());
$('removeCritters').addEventListener('click', () => api.removeCritters());
api.onUpdate(render);
api.get().then(render);
