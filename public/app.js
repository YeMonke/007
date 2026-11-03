const CHALK = ['#F4D35E', '#F28BA8', '#7CC6FE', '#8FD694', '#FFA552', '#C3A6FF'];
const ICONS = {
  recharger: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M17 41V22c0-8 3-12 7-15 4 3 7 7 7 15v19z"/><path d="M17 33h14"/><path d="M38 6v8M34 10h8"/></svg>',
  defendre: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 6l15 5v11c0 9-6 15-15 20C15 37 9 31 9 22V11z"/></svg>',
  tirer: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="12"/><path d="M24 4v10M24 34v10M4 24h10M34 24h10"/></svg>'
};

const BODY = 'M5 45c0-8.5 4.5-12.5 11-15 2.3 2 5 3 8 3s5.7-1 8-3c6.5 2.5 11 6.5 11 15z';
const AVATAR = `<svg class="avatar" viewBox="0 0 48 48" aria-hidden="true"><ellipse cx="24" cy="15.5" rx="9" ry="10.5"/><path d="${BODY}"/></svg>`;
const PENCIL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l1-5L16 4l4 4L9 19z"/><path d="M13.5 6.5l4 4"/></svg>';
const ERASER = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 15.5l9-10 7.5 6.5-6 7H8.500z"/><path d="M8 11l7.5 6.5"/><path d="M12 20h8"/></svg>';
const HEART_SVG = '<svg class="solid" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>';
const BOLT_SVG = '<svg class="solid" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2L5 13.5h6L10 22l9-12h-6z"/></svg>';
const BADGE = `<span class="badge" role="img" aria-label="Second souffle" title="Second souffle">${BOLT_SVG}</span>`;
const MOVE = {
  pierre: { label: 'Pierre', svg: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M7 30l6-15 13-7 13 6 3 16-8 11H15z"/><path d="M14 16l8 8 12-3M22 24l-2 14"/></svg>' },
  feuille: { label: 'Feuille', svg: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M12 6h18l8 8v28H12z"/><path d="M30 6v8h8"/><path d="M18 24h14M18 31h14"/></svg>' },
  ciseaux: { label: 'Ciseaux', svg: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="14" cy="36" r="6"/><circle cx="34" cy="36" r="6"/><path d="M17.5 31L34 8M30.5 31L14 8"/></svg>' }
};
const FACE = { w: 180, h: 210, maxStrokes: 40, maxPtsStroke: 200, maxPts: 600 };

const $app = document.getElementById('app');
const $toast = document.getElementById('toast');
const socket = io();

const store = {
  get: (k) => localStorage.getItem('007-' + k),
  set: (k, v) => localStorage.setItem('007-' + k, v),
  del: (k) => localStorage.removeItem('007-' + k)
};
let token = store.get('token');
if (!token) {
  token = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Math.random()).slice(2) + String(Date.now());
  store.set('token', token);
}
const urlRoom = (new URLSearchParams(location.search).get('room') || '').toUpperCase().slice(0, 4);

let state = null;
let aiming = false;
let quizTyped = '';
let quizTick = null;
let toastTimer = null;
let slotAnimating = false;

function pathD(s) {
  let d = `M${s[0]} ${s[1]}`;
  if (s.length === 2) return d + `L${s[0]} ${s[1]}`;
  for (let i = 2; i < s.length; i += 2) d += `L${s[i]} ${s[i + 1]}`;
  return d;
}

// Cache pour éviter de recalculer le path du visage à chaque render
const faceCache = new Map();
function faceToD(face) {
  const key = JSON.stringify(face);
  if (faceCache.has(key)) return faceCache.get(key);
  const d = face.map(pathD).join('');
  faceCache.set(key, d);
  return d;
}

function avatarSvg(face) {
  if (!face || !face.length) return AVATAR;
  const d = faceToD(face);
  return `<svg class="avatar" viewBox="0 0 48 48" aria-hidden="true"><ellipse class="head-face" cx="24" cy="15.5" rx="9" ry="10.5"/><g transform="translate(15 5) scale(.1)" clip-path="url(#head-clip)"><path class="face-line" d="${d}"/></g><path d="${BODY}"/></svg>`;
}

function loadFace() {
  try {
    const f = JSON.parse(store.get('face') || 'null');
    return Array.isArray(f) && f.length ? f : null;
  } catch (e) { return null; }
}

document.body.insertAdjacentHTML('beforeend',
  '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><clipPath id="head-clip"><ellipse cx="90" cy="105" rx="90" ry="105"/></clipPath></defs></svg>');

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const val = (id) => (document.getElementById(id) || {}).value || '';
const P = (pid) => state.players.find((p) => p.pid === pid);
const colorOf = (p) => CHALK[p.color % CHALK.length];
const nm = (pid) => { const p = P(pid); return p ? `<b style="color:${colorOf(p)}">${esc(p.name)}</b>` : '?'; };
const plural = (n) => `${n} balle${n > 1 ? 's' : ''}`;

function toast(msg) {
  $toast.textContent = msg;
  $toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.remove('show'), 3200);
}

/* ---------- Vues ---------- */

function homeView() {
  return `
  <main class="home">
    <h1 class="title">007</h1>
    <p class="lead">Le duel de la cour de récré, jusqu'à 6 joueurs.</p>
    <label class="field">Ton prénom
      <input id="name" maxlength="14" autocomplete="nickname" value="${esc(store.get('name') || '')}">
    </label>
    <button class="btn primary" data-act="create">Créer une partie</button>
    <p class="or">ou rejoins tes amis</p>
    <label class="field">Code de la salle
      <input id="code" maxlength="4" autocapitalize="characters" autocomplete="off" spellcheck="false" value="${esc(urlRoom)}">
    </label>
    <button class="btn" data-act="join">Rejoindre</button>
    <details class="rules">
      <summary>Règles du jeu</summary>
      <ul>
        <li>Tout le monde commence avec 0 balle.</li>
        <li>À chaque tour, chacun choisit en secret : recharger (+1 balle), se défendre, ou tirer sur quelqu'un (−1 balle, il faut en avoir une).</li>
        <li>Les choix sont révélés en même temps.</li>
        <li>Si un tir te vise et que tu ne te défends pas, tu perds une vie (une seule par tour). À 0 vie, tu es éliminé.</li>
        <li>Si deux joueurs se tirent dessus, les balles s'entrechoquent et personne n'est touché. Mais c'est le duel : une machine à sous tire le nombre de vies en jeu, puis pierre-feuille-ciseaux en un seul point (quelques secondes pour choisir). Le gagnant vole les vies au perdant, et peut dépasser son nombre de vies de départ.</li>
        <li>Si tu perds ta dernière vie alors que plusieurs joueurs te visent, une roue tourne : plus ils sont nombreux, plus la zone « second souffle » est grande. Si elle t'est favorable, tu dois répondre à un calcul chronométré, devant tout le monde, pour survivre.</li>
        <li>Le dernier en vie gagne.</li>
      </ul>
    </details>
  </main>`;
}

function optionsPanel(isHost) {
  const s = state.settings;
  const row = (label, key, choices, type) => `<div class="opt-row"><span>${label}</span><div class="opt-btns" role="group" aria-label="${label}">${choices.map(([v, txt]) => {
    const on = type === 'bool' ? s[key] === (v === 1) : s[key] === v;
    return `<button class="btn small tool${on ? ' on' : ''}" data-act="opt" data-k="${key}" data-t="${type}" data-v="${v}" aria-pressed="${on}" ${isHost ? '' : 'disabled'}>${txt}</button>`;
  }).join('')}</div></div>`;
  const yesNo = [[1, 'Oui'], [0, 'Non']];
  const secs = [[3, '3 s'], [5, '5 s'], [8, '8 s']];
  return `<section class="opts">
    <h3>Options de la partie${isHost ? '' : ' <small>(choisies par l\'hôte)</small>'}</h3>
    ${row('Vies', 'lives', [[1, '1'], [2, '2'], [3, '3']], 'num')}
    ${row('Temps par tour', 'turnSeconds', [[0, 'Sans'], [5, '5 s'], [10, '10 s'], [15, '15 s'], [20, '20 s']], 'num')}
    ${row('Duel quand deux joueurs se tirent dessus', 'duel', yesNo, 'bool')}
    ${s.duel ? row('Temps pour choisir (duel)', 'rpsSeconds', secs, 'num') : ''}
    ${row('Second souffle (roue + calcul)', 'second', yesNo, 'bool')}
    ${s.second ? row('Chance par tireur', 'chance', [[0.05, '5 %'], [0.1, '10 %'], [0.2, '20 %']], 'num') + `<p class="opt-hint">Avec 2 tireurs : ${Math.round(s.chance * 200)} %, avec 3 : ${Math.round(s.chance * 300)} %…</p>` + row('Temps du calcul', 'quizSeconds', secs, 'num') : ''}
  </section>`;
}

function lobbyView() {
  const isHost = state.hostPid === state.me;
  const host = P(state.hostPid);
  const slots = [];
  for (let i = 0; i < 6; i++) {
    const p = state.players[i];
    if (p) {
      slots.push(`<div class="card" style="--c:${colorOf(p)}">
        <span class="who">${avatarSvg(p.face)}<span class="name">${esc(p.name)}${p.pid === state.me ? ' <small>(toi)</small>' : ''}${p.pid === state.hostPid ? ' <small>hôte</small>' : ''}</span></span>
        <span class="status">${p.connected ? 'Dans la salle' : 'Reconnexion…'}</span>
      </div>`);
    } else {
      slots.push(`<div class="card empty"><span class="status">En attente d'un joueur</span></div>`);
    }
  }
  return `
  <main>
    <header class="bar"><span>Salon</span><button class="link" data-act="leave">Quitter</button></header>
    <p class="center">Code de la salle</p>
    <p class="code-big" aria-label="Code ${esc(state.code.split('').join(' '))}">${esc(state.code)}</p>
    <div class="stack">
      <button class="btn" data-act="share">Inviter des amis</button>
      <button class="btn" data-act="face">${(P(state.me) || {}).face ? 'Modifier mon visage' : 'Dessiner mon visage'}</button>
      ${optionsPanel(isHost)}
      <div class="players">${slots.join('')}</div>
      ${isHost
        ? `<button class="btn primary" data-act="start" ${state.players.length < 2 ? 'disabled' : ''}>Lancer la partie</button>
           ${state.players.length < 2 ? '<p class="hint">Il faut au moins 2 joueurs.</p>' : ''}`
        : `<p class="hint">${host ? esc(host.name) : 'L\'hôte'} lancera la partie.</p>`}
    </div>
  </main>`;
}

function statusOf(p) {
  if (!p.alive) return 'Éliminé·e';
  if (state.phase === 'ended') return 'Vainqueur';
  if (!p.connected) return 'Absent';
  return p.ready ? 'Prêt' : 'Choisit…';
}

function seat(p, k, n) {
  const isMe = p.pid === state.me;
  const targetable = aiming && p.alive && !isMe;
  const tag = targetable ? 'button' : 'div';
  const ang = ((270 - (k * 360) / n) * Math.PI) / 180;
  const left = (50 + 36 * Math.cos(ang)).toFixed(1);
  // Rayon vertical réduit (32 au lieu de 37) et centre décalé vers le bas (54 au lieu de 50)
  // pour que le joueur du haut ne soit plus masqué par le titre "Tour N".
  const top = (54 - 32 * Math.sin(ang)).toFixed(1);
  const showBullets = isMe && p.alive && p.bullets !== null;
  const status = animating || state.quiz || state.duel || (isMe && p.alive && state.phase === 'playing') ? '' : statusOf(p);
  const maxLives = (state.settings && state.settings.lives) || 1;
  const shown = Math.max(maxLives, p.lives);
  const hearts = !p.alive ? ''
    : p.lives >= 4
      ? `<span class="hearts" role="img" aria-label="${p.lives} vies"><i class="full">${HEART_SVG}</i><b class="hx">×${p.lives}</b></span>`
      : `<span class="hearts" role="img" aria-label="${p.lives} vie${p.lives > 1 ? 's' : ''}">${Array.from({ length: shown }, (_, h) => `<i class="${h < p.lives ? 'full' : 'empty'}">${HEART_SVG}</i>`).join('')}</span>`;
  const spot = state.quiz && state.quiz.pid === p.pid;
  return `<${tag} class="seat${p.alive ? '' : ' dead'}${isMe ? ' me' : ''}${spot ? ' spot' : ''}" data-seat="${p.pid}" style="--c:${colorOf(p)};left:${left}%;top:${top}%" ${targetable ? `data-act="target" data-pid="${p.pid}"` : ''}>
    <span class="av">${avatarSvg(p.face)}${p.power && p.alive ? BADGE : ''}</span>
    <span class="name">${esc(p.name)}${isMe ? ' <small>(toi)</small>' : ''}</span>
    ${hearts}
    ${showBullets ? `<span class="count">${plural(p.bullets)}</span>` : ''}
    ${status ? `<span class="status">${status}</span>` : ''}
  </${tag}>`;
}

function tableView() {
  const n = state.players.length;
  const meIdx = Math.max(0, state.players.findIndex((p) => p.pid === state.me));
  const seats = state.players.map((p, i) => seat(p, (i - meIdx + n) % n, n));
  return `<div class="table${n <= 2 ? ' duel' : ''}" role="group" aria-label="Joueurs autour de la table">${seats.join('')}</div>`;
}

function actBtn(a, label, sub, on, disabled) {
  return `<button class="btn act${on ? ' on' : ''}" data-act="pick" data-a="${a}" ${disabled ? 'disabled' : ''} aria-pressed="${on ? 'true' : 'false'}">
    ${ICONS[a]}<span>${label}</span><small>${sub}</small></button>`;
}

function actionBar(me) {
  if (!me.alive) return '<p class="note">Tu es éliminé·e. Tu regardes la suite.</p>';
  const c = state.myChoice;
  const canShoot = me.bullets > 0;
  let line;
  if (aiming) line = 'Touche le joueur que tu vises.';
  else if (c && c.action === 'tirer') line = `Tu vises ${nm(c.target)}. Tu peux encore changer.`;
  else if (c) line = 'Choix envoyé. Tu peux encore changer.';
  else line = 'Choisis ton action.';

  const waiting = state.players.filter((p) => p.alive && p.connected && !p.ready && p.pid !== state.me);
  const wait = waiting.length && c ? `<p class="note">En attente de : ${waiting.map((p) => nm(p.pid)).join(', ')}</p>` : '';
  const force = state.hostPid === state.me && waiting.length
    ? `<p class="note"><button class="btn small" data-act="force">Forcer le tour</button><br><small>Ceux qui n'ont pas choisi se défendent.</small></p>` : '';

  const timer = state.turn ? '<div class="turn-timer" aria-hidden="true"><i id="turn-fill"></i></div>' : '';
  return `
    ${timer}
    <div class="actions">
      ${actBtn('recharger', 'Recharger', '+1 balle', c && c.action === 'recharger', false)}
      ${actBtn('defendre', 'Se défendre', 'bloque les tirs', c && c.action === 'defendre', false)}
      ${actBtn('tirer', 'Tirer', canShoot ? '−1 balle' : 'il faut une balle', aiming || (c && c.action === 'tirer'), !canShoot)}
    </div>
    <p class="status-line" aria-live="polite">${line}${state.turn ? ' <b class="turn-sub" id="turn-sub"></b>' : ''}</p>
    ${wait}${force}`;
}

function lastView() {
  const l = state.last;
  if (!l) return '';
  const rows = l.actions.map((a) => {
    let t;
    if (a.action === 'recharger') t = 'recharge';
    else if (a.action === 'defendre') t = a.auto ? 'ne répond pas, se défend' : 'se défend';
    else {
      const canc = l.events.find((e) => e.type === 'cancel' && e.involved.includes(a.pid));
      const ev = l.events.find((e) => e.type === 'clash' ? (e.a === a.pid || e.b === a.pid) : e.from === a.pid);
      const out = canc ? ' : tir annulé' : !ev ? '' : ev.type === 'hit' ? (' : touché·e' + (ev.lives >= 1 && !(l.quiz || []).includes(ev.to) ? ' (−1 vie)' : '')) : ev.type === 'blocked' ? ' : bloqué' : ' : les balles s\'entrechoquent';
      t = `tire sur ${nm(a.target)}${out}`;
    }
    return `<li>${nm(a.pid)} ${t}</li>`;
  });
  const power = l.events.filter((e) => e.type === 'wheel').map((e) => `<li class="gain">${nm(e.pid)} tente le second souffle (visé par ${e.shooters} joueurs, ${Math.round(e.chance * 100)} %) : ${e.win ? 'réussi !' : 'raté'}</li>`);
  const cancels = l.events.filter((e) => e.type === 'cancel').map((e) => `<li class="gain">${nm(e.pid)} était visé par ${e.shooters.length} joueurs et riposte sur ${nm(e.target)} : tous les tirs sont annulés</li>`);
  const duels = l.events.filter((e) => e.type === 'duel').map((e) => `<li class="gain">Duel : ${nm(e.winner)} vole ${e.stake} vie${e.stake > 1 ? 's' : ''} à ${nm(e.loser)}</li>`);
  const dead = l.dead.map((pid) => `<li class="out">${nm(pid)} est éliminé·e</li>`);
  return `<section class="last"><h3>Tour ${l.round}</h3><ul>${rows.join('')}${power.join('')}${cancels.join('')}${duels.join('')}${dead.join('')}</ul></section>`;
}

function gameView() {
  const me = P(state.me);
  const ended = state.phase === 'ended';
  let title;
  if (ended) {
    const w = state.winner ? P(state.winner) : null;
    title = `<h2 class="round win">${state.winner ? (w ? nm(w.pid) + ' gagne la partie !' : 'La partie est terminée.') : 'Égalité : tout le monde est éliminé.'}</h2>`;
  } else {
    title = `<h2 class="round">Tour ${state.round}</h2>`;
  }
  let bottom;
  if (ended) {
    const host = P(state.hostPid);
    bottom = state.hostPid === state.me
      ? '<div class="stack"><button class="btn primary" data-act="rematch">Rejouer</button></div>'
      : `<p class="note">${host ? esc(host.name) : 'L\'hôte'} peut relancer une partie.</p>`;
  } else {
    bottom = animating ? '<p class="status-line" aria-live="polite">Les choix sont révélés…</p>' : state.duel ? '' : state.quiz ? quizView() : actionBar(me);
  }
  return `
  <main>
    <header class="bar"><span>Salle ${esc(state.code)}</span><button class="link" data-act="leave">Quitter</button></header>
    ${title}
    ${tableView()}
    ${animating ? '' : quizResultView()}
    ${bottom}
    ${animating ? '' : lastView()}
    ${!animating && state.duel ? duelView() : ''}
  </main>`;
}

// Render synchrone — utilisé directement par les animations
function renderNow() {
  if (!state) $app.innerHTML = homeView();
  else if (state.phase === 'lobby') $app.innerHTML = lobbyView();
  else $app.innerHTML = gameView();
  syncQuiz();
  syncDuel();
  syncTurn();
  playSlot();
  const go = document.getElementById('quiz-go');
  if (go) go.focus();
}

// Render throttlé via rAF — utilisé partout ailleurs
let rafPending = false;
function render() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    renderNow();
  });
}

/* ---------- Actions ---------- */

const reply = (res) => { if (res && res.error) toast(res.error); };

const handlers = {
  create() {
    const name = val('name').trim();
    if (!name) return toast('Entre ton prénom.');
    store.set('name', name);
    socket.emit('create', { name, token, face: loadFace() }, reply);
  },
  join() {
    const name = val('name').trim();
    const code = val('code').trim().toUpperCase();
    if (!name) return toast('Entre ton prénom.');
    if (code.length !== 4) return toast('Le code a 4 lettres.');
    store.set('name', name);
    socket.emit('join', { code, name, token, face: loadFace() }, reply);
  },
  quizgo() { socket.emit('quizReady'); },
  move(el) { socket.emit('duelChoose', { move: el.dataset.m }, reply); },
  opt(el) {
    const v = el.dataset.t === 'bool' ? el.dataset.v === '1' : Number(el.dataset.v);
    socket.emit('settings', { [el.dataset.k]: v });
  },
  key(el) {
    if (!state || !state.quiz || !state.quiz.started || state.quiz.pid !== state.me || Date.now() < state.quizAt.start) return;
    const k = el.dataset.k;
    if (k === 'del') quizTyped = quizTyped.slice(0, -1);
    else if (quizTyped.length < 4) quizTyped += k;
    showTyped();
  },
  answer() {
    if (!state || !state.quiz || !state.quiz.started || state.quiz.pid !== state.me || !quizTyped) return;
    const value = quizTyped;
    socket.emit('answer', { value }, (res) => {
      if (res && res.wrong) {
        toast(res.left > 0 ? `Raté ! Il te reste ${res.left} essai${res.left > 1 ? 's' : ''}.` : 'Raté !');
        quizTyped = '';
        showTyped();
      } else if (res && res.error) {
        toast(res.error);
      }
    });
  },
  face() { openEditor(); },
  start() { socket.emit('start'); },
  force() { socket.emit('force'); },
  rematch() { socket.emit('rematch'); },
  leave() {
    socket.emit('leave');
    store.del('room');
    animToken++; animating = false; pending = null; animatedRound = null;
    document.body.classList.remove('quiz-open');
    clearInterval(duelTick); duelTick = null;
    clearInterval(turnTick); turnTick = null;
    document.querySelectorAll('.wheel-overlay, .death-note').forEach((e) => e.remove());
    state = null;
    aiming = false;
    history.replaceState(null, '', location.pathname);
    render();
  },
  async share() {
    const url = `${location.origin}/?room=${state.code}`;
    if (navigator.share) {
      try { await navigator.share({ title: '007', text: 'Viens jouer au 007 !', url }); } catch (e) { /* annulé */ }
      return;
    }
    try { await navigator.clipboard.writeText(url); toast('Lien copié.'); } catch (e) { toast(url); }
  },
  pick(el) {
    const a = el.dataset.a;
    if (a === 'tirer') {
      const targets = state.players.filter((p) => p.alive && p.pid !== state.me);
      if (targets.length === 1) {
        aiming = false;
        socket.emit('choose', { action: 'tirer', target: targets[0].pid }, reply);
      } else {
        aiming = !aiming;
        render();
      }
      return;
    }
    aiming = false;
    socket.emit('choose', { action: a }, reply);
    render();
  },
  target(el) {
    aiming = false;
    socket.emit('choose', { action: 'tirer', target: el.dataset.pid }, reply);
    render();
  }
};

$app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (el && !el.disabled && handlers[el.dataset.act]) handlers[el.dataset.act](el);
});

$app.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'code') handlers.join();
  else if (e.target.id === 'name') (val('code').trim() ? handlers.join() : handlers.create());
});

$app.addEventListener('input', (e) => {
  if (e.target.id === 'code') e.target.value = e.target.value.replace(/[^a-zA-Z]/g, '').toUpperCase();
});

/* ---------- Second souffle : le calcul ---------- */

function quizView() {
  const q = state.quiz;
  const mine = q.pid === state.me;
  if (!q.started) {
    if (mine) {
      return `<div class="quiz-pop" role="dialog" aria-modal="true" aria-labelledby="qp-title">
        <div class="quiz-card">
          <h2 id="qp-title">Second souffle !</h2>
          <p>Tu viens de perdre ta dernière vie, mais tu as droit à un second souffle.</p>
          <p>Un calcul va apparaître : tout le monde le voit. Trouve la réponse en <b>${q.seconds} secondes</b> (${q.tries} essais). Réussi, tu survis. Raté ou trop lent, tu es éliminé·e.</p>
          <button class="btn primary" id="quiz-go" data-act="quizgo">OK, c'est parti</button>
        </div>
      </div>`;
    }
    return `<section class="quiz">
      <p class="quiz-title">Second souffle de ${nm(q.pid)} !</p>
      <p class="note">Dernière vie perdue : un calcul va apparaître…</p>
    </section>`;
  }
  const key = (k) => `<button class="btn key" data-act="key" data-k="${k}">${k}</button>`;
  return `<section class="quiz${mine ? ' mine' : ''}">
    <p class="quiz-title">Second souffle de ${nm(q.pid)}${mine ? ' (toi)' : ''}</p>
    <p class="quiz-calc" id="quiz-calc" aria-live="polite">Prépare-toi…</p>
    <div class="quiz-bar" aria-hidden="true"><i id="quiz-fill"></i></div>
    <p class="quiz-sub" id="quiz-sub"></p>
    ${mine
      ? `<p class="quiz-typed" id="quiz-typed">${quizTyped ? esc(quizTyped) : '&nbsp;'}</p>
         <div class="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(key).join('')}<button class="btn key" data-act="key" data-k="del" aria-label="Effacer">←</button>${key(0)}<button class="btn primary key" data-act="answer">OK</button></div>`
      : `<p class="note">${q.seconds} secondes pour répondre…</p>`}
  </section>`;
}

function quizResultView() {
  const r = state.lastQuiz;
  if (!r || !state.last || r.round !== state.last.round || state.quiz) return '';
  return `<p class="quiz-result ${r.ok ? 'good' : 'bad'}">${nm(r.pid)} ${r.ok ? 'réussit' : 'rate'} : ${esc(r.text)} = ${r.answer}. ${r.ok ? 'Dernière vie conservée !' : 'Éliminé·e.'}</p>`;
}

function tickQuiz() {
  const q = state && state.quiz;
  const fill = document.getElementById('quiz-fill');
  if (!q || !q.started || !state.quizAt || !fill) { clearInterval(quizTick); quizTick = null; return; }
  const now = Date.now();
  const { start, end } = state.quizAt;
  const calc = document.getElementById('quiz-calc');
  const sub = document.getElementById('quiz-sub');
  if (now < start) {
    calc.textContent = 'Prépare-toi…';
    fill.style.transform = 'scaleX(1)';
    sub.textContent = '';
    return;
  }
  const left = Math.max(0, end - now);
  calc.textContent = `${q.text} = ?`;
  fill.style.transform = `scaleX(${Math.min(1, left / (q.seconds * 1000)).toFixed(3)})`;
  sub.textContent = left > 0 ? `${(left / 1000).toFixed(1).replace('.', ',')} s` : 'Temps écoulé…';
}

function syncQuiz() {
  clearInterval(quizTick);
  quizTick = null;
  document.body.classList.toggle('quiz-open', !!(state && (state.quiz || state.duel) && state.phase === 'playing' && !animating));
  if (!state || !state.quiz || !state.quiz.started || state.phase !== 'playing' || animating) return;
  tickQuiz();
  quizTick = setInterval(tickQuiz, 100);
}

const showTyped = () => {
  const el = document.getElementById('quiz-typed');
  if (el) el.textContent = quizTyped || '\u00a0';
};

document.addEventListener('keydown', (e) => {
  if (!state || !state.quiz || !state.quiz.started || state.quiz.pid !== state.me || animating) return;
  if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
  if (/^\d$/.test(e.key)) { e.preventDefault(); handlers.key({ dataset: { k: e.key } }); }
  else if (e.key === 'Backspace') { e.preventDefault(); handlers.key({ dataset: { k: 'del' } }); }
  else if (e.key === 'Enter') { e.preventDefault(); handlers.answer(); }
});

/* ---------- Chrono du tour ---------- */

let turnTick = null;

function tickTurn() {
  const fill = document.getElementById('turn-fill');
  if (!state || !state.turn || !state.turnAt || !fill) { clearInterval(turnTick); turnTick = null; return; }
  const now = Date.now();
  const { start, end } = state.turnAt;
  const left = Math.max(0, end - now);
  const sub = document.getElementById('turn-sub');
  fill.style.transform = `scaleX(${(now < start ? 1 : Math.min(1, left / (state.turn.seconds * 1000))).toFixed(3)})`;
  fill.parentElement.classList.toggle('urgent', now >= start && left <= 3000);
  if (sub) sub.textContent = now < start ? '' : left > 0 ? `· ${Math.ceil(left / 1000)} s` : '· temps écoulé…';
}

function syncTurn() {
  clearInterval(turnTick);
  turnTick = null;
  if (!state || state.phase !== 'playing' || !state.turn || animating || state.quiz || state.duel) return;
  tickTurn();
  turnTick = setInterval(tickTurn, 100);
}

/* ---------- Duel ---------- */

let duelTick = null;
let slotPlayedFor = null;

const stakeText = (n) => `${n} vie${n > 1 ? 's' : ''}`;

function duelWho(p) {
  return p ? `<span class="duel-who" style="--c:${colorOf(p)}">${avatarSvg(p.face)}<span class="name">${esc(p.name)}</span></span>` : '';
}

function slotSeq(d) {
  const cycles = 9;
  const seq = [];
  for (let c = 0; c <= cycles; c++) for (let v = 1; v <= d.max; v++) seq.push(v);
  return { seq, target: cycles * d.max + (d.stake - 1) };
}

function duelView() {
  const d = state.duel;
  const pa = P(d.a);
  const pb = P(d.b);
  const isPlayer = state.me === d.a || state.me === d.b;
  const vs = `<div class="duel-vs">${duelWho(pa)}<b>VS</b>${duelWho(pb)}</div>`;
  let body = '';
  if (d.stage === 'intro') {
    body = `<h2 class="duel-title">DUEL !</h2>${vs}<p>Deux tirs en même temps : ${nm(d.a)} et ${nm(d.b)} règlent ça en duel.</p>`;
  } else if (d.stage === 'slot') {
    const { seq, target } = slotSeq(d);
    const done = slotPlayedFor === d.id;
    body = `<h2>Mise en jeu</h2>
      <p>Combien de vies ? Maximum ${d.max} (le joueur le plus faible).</p>
      <div class="slot" aria-hidden="true"><i class="bulbs"></i><div class="slot-window"><div class="slot-reel" id="slot-reel" style="${done && !slotAnimating ? `transform:translateY(-${target * 96}px)` : ''}">${seq.map((v) => `<div>${v}</div>`).join('')}</div></div></div>
      <p class="slot-result" id="slot-result" aria-live="polite">${done && !slotAnimating ? `${stakeText(d.stake)} en jeu !` : '&nbsp;'}</p>`;
  } else if (d.stage === 'rps') {
    const chip = (pid) => `<li>${nm(pid)} : ${d.chosen[pid] ? 'a choisi ✓' : 'réfléchit…'}</li>`;
    body = `<h2>Pierre · Feuille · Ciseaux</h2>${vs}
      <p><b>${stakeText(d.stake)}</b> en jeu · un seul point${d.round > 1 ? ' · égalité, on recommence !' : ''}</p>
      <div class="quiz-bar" aria-hidden="true"><i id="duel-fill"></i></div>
      <p class="quiz-sub" id="duel-sub"></p>
      ${isPlayer
        ? `<div class="moves">${['pierre', 'feuille', 'ciseaux'].map((m) => `<button class="btn move${d.mine === m ? ' on' : ''}" data-act="move" data-m="${m}" ${d.mine ? 'disabled' : ''}>${MOVE[m].svg}<span>${MOVE[m].label}</span></button>`).join('')}</div>
           <p class="note">${d.mine ? 'Choix verrouillé, en attente de l\'autre…' : 'Choisis vite !'}</p>`
        : `<ul class="chips">${chip(d.a)}${chip(d.b)}</ul>`}`;
  } else if (d.stage === 'reveal') {
    const r = d.reveal;
    const head = r.winner ? (r.coin ? 'Pile ou face !' : `${nm(r.winner)} gagne le point !`) : 'Égalité !';
    const card = (pid, m) => `<div class="rv${r.winner === pid ? ' win' : ''}" style="--c:${colorOf(P(pid))}">${MOVE[m].svg}<span>${MOVE[m].label}</span><small>${nm(pid)}</small></div>`;
    body = `<h2>${head}</h2><div class="duel-reveal">${card(d.a, r.a)}<b>VS</b>${card(d.b, r.b)}</div>
      <p>${r.winner ? (r.coin ? 'Trop d\'égalités : la pièce décide.' : '') : 'On recommence !'}</p>`;
  } else {
    const r = d.result;
    body = `<h2>${nm(r.winner)} remporte le duel !</h2>
      <p class="duel-loot">${nm(r.winner)} vole ${Array.from({ length: Math.min(r.stake, 8) }, () => `<i class="lootheart">${HEART_SVG}</i>`).join('')} <b>${stakeText(r.stake)}</b> à ${nm(r.loser)}.</p>
      ${r.eliminated ? `<p class="duel-out">${nm(r.loser)} est éliminé·e.</p>` : ''}`;
  }
  return `<div class="duel-pop" role="dialog" aria-modal="true" aria-label="Duel"><div class="duel-card">${body}</div></div>`;
}

function playSlot() {
  const d = state && state.duel;
  if (!d || d.stage !== 'slot' || slotPlayedFor === d.id) return;
  const reel = document.getElementById('slot-reel');
  const res = document.getElementById('slot-result');
  if (!reel) return;
  slotPlayedFor = d.id;
  slotAnimating = true;
  const total = slotSeq(d).target * 96;
  const finish = () => {
    if (res) res.textContent = `${stakeText(d.stake)} en jeu !`;
    slotAnimating = false;
  };
  if (reducedMotion()) { reel.style.transform = `translateY(-${total}px)`; finish(); return; }
  // Force reflow : Safari iOS ignore les animations lancées dans la même frame
  void reel.offsetHeight;
  requestAnimationFrame(() => {
    anim(reel, [{ transform: 'translateY(0)' }, { transform: `translateY(-${total}px)` }],
      { duration: Math.max(1500, d.slotMs - 1500), easing: 'cubic-bezier(.15,.65,.1,1)' })
      .then(finish);
  });
}

function tickDuel() {
  const d = state && state.duel;
  const fill = document.getElementById('duel-fill');
  if (!d || d.stage !== 'rps' || !state.duelAt || !fill) { clearInterval(duelTick); duelTick = null; return; }
  const now = Date.now();
  const { start, end } = state.duelAt;
  const sub = document.getElementById('duel-sub');
  if (now < start) { fill.style.transform = 'scaleX(1)'; sub.textContent = 'Prêt…'; return; }
  const left = Math.max(0, end - now);
  fill.style.transform = `scaleX(${Math.min(1, left / (d.seconds * 1000)).toFixed(3)})`;
  sub.textContent = left > 0 ? `${(left / 1000).toFixed(1).replace('.', ',')} s` : 'Temps écoulé…';
}

function syncDuel() {
  clearInterval(duelTick);
  duelTick = null;
  if (!state || !state.duel || state.duel.stage !== 'rps' || animating) return;
  tickDuel();
  duelTick = setInterval(tickDuel, 100);
}

/* ---------- Éditeur de visage ---------- */

let closeEditor = null;

function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function touches(s, x, y, r) {
  if (s.length === 2) return Math.hypot(s[0] - x, s[1] - y) <= r;
  for (let i = 0; i + 3 < s.length; i += 2) {
    if (distSeg(x, y, s[i], s[i + 1], s[i + 2], s[i + 3]) <= r) return true;
  }
  return false;
}

function openEditor() {
  const me = state && P(state.me);
  if (!me || state.phase !== 'lobby' || closeEditor) return;
  const R = 9;
  let strokes = (me.face || []).map((s) => s.slice());
  let tool = 'pencil';
  let current = null;
  let erasing = false;

  const wrap = document.createElement('div');
  wrap.className = 'editor';
  wrap.style.setProperty('--c', colorOf(me));
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.setAttribute('aria-label', 'Dessiner ton visage');
  wrap.innerHTML = `
    <h2 class="round">Dessine ton visage</h2>
    <div class="frame-box">
      <svg class="frame" viewBox="-6 -6 192 222" role="img" aria-label="Zone de dessin du visage">
        <ellipse class="oval" cx="90" cy="105" rx="90" ry="105"/>
        <g clip-path="url(#head-clip)"><g class="strokes"></g></g>
        <circle class="eraser-cursor" r="${R}" cx="-50" cy="-50"/>
      </svg>
    </div>
    <div class="tools">
      <button class="btn tool on" data-tool="pencil" aria-pressed="true">${PENCIL}Crayon</button>
      <button class="btn tool" data-tool="eraser" aria-pressed="false">${ERASER}Gomme</button>
      <button class="btn tool" data-clear>Tout effacer</button>
    </div>
    <div class="tools">
      <button class="btn" data-cancel>Annuler</button>
      <button class="btn primary" data-ok>Valider</button>
    </div>`;
  document.body.appendChild(wrap);
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  const svg = wrap.querySelector('.frame');
  const layer = wrap.querySelector('.strokes');
  const cursor = wrap.querySelector('.eraser-cursor');
  const total = () => strokes.reduce((n, s) => n + s.length / 2, 0);
  const draw = () => { layer.innerHTML = strokes.map((s) => `<path d="${pathD(s)}"/>`).join(''); };
  const raw = (e) => {
    const r = svg.getBoundingClientRect();
    return [-6 + ((e.clientX - r.left) / r.width) * 192, -6 + ((e.clientY - r.top) / r.height) * 222];
  };
  const pt = (e) => {
    const [x, y] = raw(e);
    return [Math.round(Math.min(FACE.w, Math.max(0, x))), Math.round(Math.min(FACE.h, Math.max(0, y)))];
  };
  const eraseAt = (x, y) => {
    const before = strokes.length;
    strokes = strokes.filter((s) => !touches(s, x, y, R));
    if (strokes.length !== before) draw();
  };
  const setTool = (t) => {
    tool = t;
    wrap.querySelectorAll('[data-tool]').forEach((b) => {
      const on = b.dataset.tool === t;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    cursor.style.visibility = 'hidden';
  };

  svg.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { svg.setPointerCapture(e.pointerId); } catch (err) { /* ignoré */ }
    const [x, y] = pt(e);
    if (tool === 'pencil') {
      if (strokes.length >= FACE.maxStrokes || total() >= FACE.maxPts) { toast('Dessin trop chargé : utilise la gomme.'); return; }
      current = [x, y];
      strokes.push(current);
      draw();
    } else {
      erasing = true;
      eraseAt(x, y);
    }
  });
  svg.addEventListener('pointermove', (e) => {
    if (tool === 'eraser') {
      const [rx, ry] = raw(e);
      cursor.setAttribute('cx', rx);
      cursor.setAttribute('cy', ry);
      cursor.style.visibility = 'visible';
    }
    const [x, y] = pt(e);
    if (current) {
      const lx = current[current.length - 2], ly = current[current.length - 1];
      if (Math.hypot(x - lx, y - ly) >= 3 && current.length / 2 < FACE.maxPtsStroke && total() < FACE.maxPts) {
        current.push(x, y);
        draw();
      }
    } else if (erasing) {
      eraseAt(x, y);
    }
  });
  const end = () => { current = null; erasing = false; };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
  svg.addEventListener('pointerleave', () => { cursor.style.visibility = 'hidden'; });

  const onKey = (e) => { if (e.key === 'Escape') close(false); };
  const close = (save) => {
    if (save) {
      let answered = false;
      const wait = setTimeout(() => {
        if (!answered) toast('Le serveur n’a pas enregistré le dessin : remplace server.js puis relance npm start.');
      }, 2500);
      socket.emit('face', { strokes }, (res) => {
        answered = true;
        clearTimeout(wait);
        if (res && res.ok) store.set('face', JSON.stringify(strokes));
        reply(res);
      });
    }
    document.removeEventListener('keydown', onKey);
    document.body.style.overflow = prevOverflow;
    wrap.remove();
    closeEditor = null;
  };
  closeEditor = close;
  document.addEventListener('keydown', onKey);

  wrap.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.tool) setTool(b.dataset.tool);
    else if (b.hasAttribute('data-clear')) { strokes = []; draw(); }
    else if (b.hasAttribute('data-cancel')) close(false);
    else if (b.hasAttribute('data-ok')) close(true);
  });

  draw();
  wrap.querySelector('[data-tool="pencil"]').focus();
}

/* ---------- Animations de fin de tour ---------- */

let animating = false;
let pending = null;
let animatedRound = null;
let animToken = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reducedMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
const anim = (el, frames, opts) => {
  try { return el.animate(frames, { fill: 'forwards', ...opts }).finished.catch(() => {}); } catch (e) { return Promise.resolve(); }
};

// Exécute les tâches par vagues de `limit` pour éviter de saturer le compositing iOS
async function runLimited(tasks, limit) {
  const queue = [...tasks];
  const running = new Set();
  while (queue.length || running.size) {
    while (running.size < limit && queue.length) {
      const raw = queue.shift();
      const p = Promise.resolve(raw).catch(() => {});
      running.add(p);
      p.then(() => running.delete(p));
    }
    if (running.size) await Promise.race([...running]);
  }
}

const BULLET_SVG = '<svg viewBox="0 0 26 12" aria-hidden="true"><path d="M1.5 1.5h12c7 0 11 1.8 11 4.5s-4 4.5-11 4.5h-12z"/></svg>';
const CARTRIDGE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 21V11c0-4 1.5-6 4-8 2.5 2 4 4 4 8v10z"/><path d="M8 17h8"/></svg>';
const SHIELD_SVG = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 6l15 5v11c0 9-6 15-15 20C15 37 9 31 9 22V11z"/></svg>';
const SKY = '#7CC6FE';

function fxEl(layer, cls, x, y, html, style) {
  const d = document.createElement('div');
  d.className = cls;
  d.style.cssText = `left:${x}px;top:${y}px;${style || ''}`;
  d.innerHTML = html || '';
  layer.appendChild(d);
  return d;
}

function seatCenter(table, pid) {
  const av = table.querySelector(`[data-seat="${pid}"] .avatar`);
  if (!av) return null;
  const t = table.getBoundingClientRect();
  const r = av.getBoundingClientRect();
  return { x: r.left - t.left + r.width / 2, y: r.top - t.top + r.height / 2 };
}
const avatarOf = (table, pid) => table.querySelector(`[data-seat="${pid}"] .avatar`);

function plusOne(layer, c, color) {
  const el = fxEl(layer, 'fx-plus', c.x, c.y - 46, `${CARTRIDGE_SVG}<b>+1</b>`, `color:${color}`);
  return anim(el, [
    { transform: 'translate(-50%,-50%) translateY(12px) scale(.6)', opacity: 0 },
    { transform: 'translate(-50%,-50%) translateY(-4px) scale(1.15)', opacity: 1, offset: 0.35 },
    { transform: 'translate(-50%,-50%) translateY(-28px) scale(1)', opacity: 0 }
  ], { duration: 1000, easing: 'ease-out' });
}

function floatText(layer, c, html, color, ms) {
  const el = fxEl(layer, 'fx-plus', c.x, c.y - 46, html, `color:${color}`);
  return anim(el, [
    { transform: 'translate(-50%,-50%) translateY(12px) scale(.6)', opacity: 0 },
    { transform: 'translate(-50%,-50%) translateY(-4px) scale(1.12)', opacity: 1, offset: 0.3 },
    { transform: 'translate(-50%,-50%) translateY(-30px) scale(1)', opacity: 0 }
  ], { duration: ms || 1000, easing: 'ease-out' });
}

function addShield(layer, c) {
  const el = fxEl(layer, 'fx-shield', c.x, c.y, SHIELD_SVG);
  const appear = anim(el, [
    { transform: 'translate(-50%,-50%) scale(.3)', opacity: 0 },
    { transform: 'translate(-50%,-50%) scale(1.1)', opacity: 1, offset: 0.7 },
    { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 }
  ], { duration: 600, easing: 'ease-out' });
  return { el, appear };
}

function burst(layer, p, color, n, dist) {
  const ring = fxEl(layer, 'fx-ring', p.x, p.y, '', `--c:${color}`);
  const jobs = [anim(ring, [
    { transform: 'translate(-50%,-50%) scale(.2)', opacity: 1 },
    { transform: 'translate(-50%,-50%) scale(1.6)', opacity: 0 }
  ], { duration: 480, easing: 'ease-out' })];
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2;
    const dot = fxEl(layer, 'fx-dot', p.x, p.y, '', `--c:${color}`);
    jobs.push(anim(dot, [
      { transform: 'translate(-50%,-50%) translate(0px,0px) scale(1)', opacity: 1 },
      { transform: `translate(-50%,-50%) translate(${Math.cos(ang) * dist}px,${Math.sin(ang) * dist}px) scale(.2)`, opacity: 0 }
    ], { duration: 480, easing: 'ease-out' }));
  }
  return Promise.all(jobs);
}

const bulletAt = (layer, p, color, ang) =>
  fxEl(layer, 'fx-bullet', p.x, p.y, BULLET_SVG, `--c:${color};transform:translate(-50%,-50%) rotate(${ang}rad)`);

const move = (el, dx, dy, ang, ms, easing) => anim(el, [
  { transform: `translate(-50%,-50%) translate(0px,0px) rotate(${ang}rad)` },
  { transform: `translate(-50%,-50%) translate(${dx}px,${dy}px) rotate(${ang}rad)` }
], { duration: ms, easing });

function ricochet(el, dx, dy, ang, ux, uy) {
  return anim(el, [
    { transform: `translate(-50%,-50%) translate(${dx}px,${dy}px) rotate(${ang}rad)`, opacity: 1 },
    { transform: `translate(-50%,-50%) translate(${dx - ux * 46}px,${dy - uy * 46 - 16}px) rotate(${ang + 5}rad)`, opacity: 0 }
  ], { duration: 420, easing: 'ease-out' });
}

const SHAKE = [
  { transform: 'translateX(0)' }, { transform: 'translateX(-7px)' }, { transform: 'translateX(7px)' },
  { transform: 'translateX(-4px)' }, { transform: 'translateX(0)' }
];

async function shotHit(layer, table, from, to, color, targetPid, showLife) {
  const ang = Math.atan2(to.y - from.y, to.x - from.x);
  const b = bulletAt(layer, from, color, ang);
  await move(b, to.x - from.x, to.y - from.y, ang, 560, 'ease-in');
  b.remove();
  const av = avatarOf(table, targetPid);
  await Promise.all([
    burst(layer, to, color, 10, 40),
    av ? anim(av, SHAKE, { duration: 420 }) : null,
    showLife ? floatText(layer, to, `${HEART_SVG}<b>−1</b>`, '#F28BA8', 1000) : null
  ]);
}

async function shotBlocked(layer, from, to, color, shield) {
  const ang = Math.atan2(to.y - from.y, to.x - from.x);
  const d = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  const ux = (to.x - from.x) / d, uy = (to.y - from.y) / d;
  const stop = { x: to.x - ux * 47, y: to.y - uy * 47 };
  const dx = stop.x - from.x, dy = stop.y - from.y;
  const b = bulletAt(layer, from, color, ang);
  await move(b, dx, dy, ang, 520, 'ease-in');
  await Promise.all([
    burst(layer, stop, SKY, 8, 30),
    ricochet(b, dx, dy, ang, ux, uy),
    shield ? anim(shield, [
      { transform: 'translate(-50%,-50%) scale(1)' },
      { transform: 'translate(-50%,-50%) scale(1.16)' },
      { transform: 'translate(-50%,-50%) scale(1)' }
    ], { duration: 420 }) : null
  ]);
}

async function shotClash(layer, pa, pb, ca, cb) {
  const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
  const angA = Math.atan2(pb.y - pa.y, pb.x - pa.x);
  const angB = angA + Math.PI;
  const ba = bulletAt(layer, pa, ca, angA);
  const bb = bulletAt(layer, pb, cb, angB);
  const da = { x: mid.x - pa.x, y: mid.y - pa.y };
  const db = { x: mid.x - pb.x, y: mid.y - pb.y };
  await Promise.all([move(ba, da.x, da.y, angA, 560, 'ease-in'), move(bb, db.x, db.y, angB, 560, 'ease-in')]);
  const la = Math.hypot(da.x, da.y) || 1, lb = Math.hypot(db.x, db.y) || 1;
  await Promise.all([
    burst(layer, mid, '#F3F1EA', 12, 42),
    ricochet(ba, da.x, da.y, angA, da.x / la, da.y / la),
    ricochet(bb, db.x, db.y, angB, db.x / lb, db.y / lb)
  ]);
}

// Tir annulé : la balle part, s'arrête à mi-chemin et se brise en étincelles.
async function shotCancel(layer, from, to, color) {
  const ang = Math.atan2(to.y - from.y, to.x - from.x);
  const d = { x: (to.x - from.x) / 2, y: (to.y - from.y) / 2 };
  const len = Math.hypot(d.x, d.y) || 1;
  const b = bulletAt(layer, from, color, ang);
  await move(b, d.x, d.y, ang, 560, 'ease-in');
  await Promise.all([
    burst(layer, { x: from.x + d.x, y: from.y + d.y }, '#F3F1EA', 8, 34),
    ricochet(b, d.x, d.y, ang, d.x / len, d.y / len)
  ]);
}

async function playRound(last) {
  const table = $app.querySelector('.table');
  if (!table) return;
  const layer = document.createElement('div');
  layer.className = 'fx-layer';
  table.appendChild(layer);
  // Force reflow : Safari iOS ignore les animations lancées dans la même frame
  // que la création de l'élément
  void layer.offsetHeight;

  const colorOfPid = (pid) => { const p = P(pid); return p ? colorOf(p) : '#F3F1EA'; };
  const pos = {};
  for (const a of last.actions) pos[a.pid] = seatCenter(table, a.pid);

  // 1) Recharges (+1) et boucliers en même temps
  const shields = {};
  const plusJobs = [];
  const shieldJobs = [];
  for (const a of last.actions) {
    const c = pos[a.pid];
    if (!c) continue;
    if (a.action === 'recharger') plusJobs.push(plusOne(layer, c, colorOfPid(a.pid)));
    if (a.action === 'defendre') {
      const s = addShield(layer, c);
      shields[a.pid] = s.el;
      shieldJobs.push(s.appear);
    }
  }
  // Les boucliers doivent être en place avant les tirs ; les +1 continuent de flotter pendant ce temps.
  await Promise.all(shieldJobs);
  await sleep(shieldJobs.length ? 150 : 350);

  // 2) Tirs : touché, bloqué par un bouclier, ou balles qui s'entrechoquent
  const shots = [];
  const doneClash = new Set();
  const lifeShown = new Set();
  for (const a of last.actions) {
    if (a.action !== 'tirer' || !pos[a.pid]) continue;
    const cev = last.events.find((e) => e.type === 'cancel' && e.involved.includes(a.pid));
    if (cev) {
      const avc = avatarOf(table, a.pid);
      if (avc) anim(avc, [{ transform: 'scale(1)' }, { transform: 'scale(1.15)' }, { transform: 'scale(1)' }], { duration: 240 });
      if (pos[a.target]) shots.push(shotCancel(layer, pos[a.pid], pos[a.target], colorOfPid(a.pid)));
      continue;
    }
    const ev = last.events.find((e) => (e.type === 'clash' ? (e.a === a.pid || e.b === a.pid) : e.from === a.pid));
    if (!ev) continue;
    const av = avatarOf(table, a.pid);
    if (av) anim(av, [{ transform: 'scale(1)' }, { transform: 'scale(1.15)' }, { transform: 'scale(1)' }], { duration: 240 });
    if (ev.type === 'clash') {
      if (doneClash.has(ev)) continue;
      doneClash.add(ev);
      const other = ev.a === a.pid ? ev.b : ev.a;
      if (pos[other]) shots.push(shotClash(layer, pos[a.pid], pos[other], colorOfPid(a.pid), colorOfPid(other)));
    } else if (pos[a.target]) {
      if (ev.type === 'blocked') shots.push(shotBlocked(layer, pos[a.pid], pos[a.target], colorOfPid(a.pid), shields[a.target]));
      else {
        const showLife = ev.lives >= 1 && !(last.quiz || []).includes(a.target) && !lifeShown.has(a.target);
        if (showLife) lifeShown.add(a.target);
        shots.push(shotHit(layer, table, pos[a.pid], pos[a.target], colorOfPid(a.pid), a.target, showLife));
      }
    }
  }
  // On attend les +1, puis les tirs (par vagues de 3 pour ne pas saturer iOS)
  await Promise.all(plusJobs);
  await runLimited(shots, 3);
  // Second souffle gagné : la foudre apparaît au-dessus du joueur
  const gains = last.events.filter((e) => e.type === 'power' && pos[e.pid])
    .map((e) => floatText(layer, pos[e.pid], `${BOLT_SVG}<b>Second souffle !</b>`, '#F4D35E', 1300));
  const cancels = last.events.filter((e) => e.type === 'cancel' && pos[e.pid])
    .map((e) => floatText(layer, pos[e.pid], '<b>Tirs annulés !</b>', '#F3F1EA', 1400));
  await Promise.all([sleep(shots.length ? 450 : 250), ...gains, ...cancels]);
  layer.remove();
}

async function quizResultFx(r) {
  if (reducedMotion() || document.hidden) return;
  const table = $app.querySelector('.table');
  const c = table && seatCenter(table, r.pid);
  if (!c) return;
  const layer = document.createElement('div');
  layer.className = 'fx-layer';
  table.appendChild(layer);
  void layer.offsetHeight;
  if (r.ok) {
    await Promise.all([burst(layer, c, '#8FD694', 14, 48), floatText(layer, c, `${BOLT_SVG}<b>Sauvé !</b>`, '#8FD694', 1200)]);
  } else {
    const av = avatarOf(table, r.pid);
    await Promise.all([burst(layer, c, '#F28BA8', 10, 40), av ? anim(av, SHAKE, { duration: 420 }) : null, floatText(layer, c, '<b>Raté…</b>', '#F28BA8', 1100)]);
  }
  layer.remove();
}

/* ---------- La roue du second souffle ---------- */

let wheelEl = null;

async function playWheel(ev) {
  if (document.hidden) return;
  const rad = (d) => (d * Math.PI) / 180;
  const deg = ev.chance * 360;
  const pct = Math.round(ev.chance * 100);
  const end = { x: 100 + 100 * Math.sin(rad(deg)), y: 100 - 100 * Math.cos(rad(deg)) };
  const winShape = ev.chance >= 1
    ? '<circle cx="100" cy="100" r="100" fill="#8FD694"/>'
    : `<path d="M100 100 L100 0 A100 100 0 ${deg > 180 ? 1 : 0} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)} Z" fill="#8FD694"/>`;
  const mid = rad(deg / 2);
  const bx = (100 + 62 * Math.sin(mid)).toFixed(1);
  const by = (100 - 62 * Math.cos(mid)).toFixed(1);
  const wrap = document.createElement('div');
  wrap.className = 'wheel-overlay';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.setAttribute('aria-label', 'Roue du second souffle');
  wrap.innerHTML = `
    <div class="wheel-card">
      <h2>Second souffle ?</h2>
      <p class="wheel-sub">${nm(ev.pid)} est visé par <b>${ev.shooters}</b> joueurs.<br>Chance de survivre : <b>${pct} %</b></p>
      <div class="wheel-box">
        <svg class="wheel-pointer" viewBox="0 0 40 40" aria-hidden="true"><path d="M20 38L6 6h28z"/></svg>
        <svg class="wheel" viewBox="-4 -4 208 208" aria-hidden="true">
          <circle cx="100" cy="100" r="100" fill="#F28BA8"/>
          ${winShape}
          <g transform="translate(${bx} ${by}) scale(1.5) translate(-12 -12)"><path d="M13 2L5 13.5h6L10 22l9-12h-6z" fill="#37434C"/></g>
          <circle cx="100" cy="100" r="100" fill="none" stroke="#F3F1EA" stroke-width="4"/>
          <circle cx="100" cy="100" r="12" fill="#37434C" stroke="#F3F1EA" stroke-width="3"/>
        </svg>
      </div>
      <p class="wheel-legend"><i class="g"></i>Second souffle ${pct} % <i class="r"></i>Éliminé ${100 - pct} %</p>
      <p class="wheel-result" aria-live="assertive">&nbsp;</p>
    </div>`;
  document.body.appendChild(wrap);
  wheelEl = wrap;
  const wheel = wrap.querySelector('.wheel');
  const result = wrap.querySelector('.wheel-result');
  await sleep(700);
  const final = 360 * 5 + (360 - ev.spin * 360);
  await anim(wheel, [{ transform: 'rotate(0deg)' }, { transform: `rotate(${final}deg)` }], { duration: 3400, easing: 'cubic-bezier(.12,.6,.12,1)' });
  result.textContent = ev.win ? 'Second souffle !' : 'Raté…';
  result.className = 'wheel-result ' + (ev.win ? 'good' : 'bad');
  await sleep(1400);
  wrap.remove();
  wheelEl = null;
}

async function playWheelsSequential(wheels) {
  for (const w of wheels) {
    await playWheel(w);
    await sleep(200);
  }
}

function noteBox(html, ms) {
  const el = document.createElement('div');
  el.className = 'death-note';
  el.setAttribute('role', 'status');
  el.innerHTML = html;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms || 2800);
}

function deathModal() {
  const wrap = document.createElement('div');
  wrap.className = 'quiz-pop';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.setAttribute('aria-labelledby', 'death-title');
  wrap.innerHTML = `<div class="quiz-card">
    <h2 id="death-title" class="dead">Tu es mort</h2>
    <p>Le second souffle ne t'a pas sauvé. Tu restes à la table pour regarder la suite.</p>
    <button class="btn primary" id="death-ok">OK</button>
  </div>`;
  document.body.appendChild(wrap);
  const ok = wrap.querySelector('#death-ok');
  ok.addEventListener('click', () => wrap.remove());
  ok.focus();
}

function announceDeaths(last) {
  for (const e of (last && last.events) || []) {
    if (e.type !== 'wheel' || e.win) continue;
    if (state && e.pid === state.me) {
      deathModal();
    } else {
      const p = state && P(e.pid);
      noteBox(`${p ? nm(p.pid) : 'Un joueur'} est mort`);
    }
  }
}

function applyState(s) {
  if (!state || s.round !== state.round || s.phase !== 'playing') aiming = false;
  const prev = state && state.code === s.code ? state : null;
  if (!s.quiz || !prev || !prev.quiz || prev.quiz.pid !== s.quiz.pid) quizTyped = '';
  const rx = s._rx || Date.now();
  if (s.quiz && s.quiz.started) s.quizAt = { start: rx + s.quiz.startIn, end: rx + s.quiz.endsIn };
  if (s.duel && s.duel.stage === 'rps') s.duelAt = { start: rx + s.duel.startIn, end: rx + s.duel.endsIn };
  if (s.turn) s.turnAt = { start: rx + s.turn.startIn, end: rx + s.turn.endsIn };
  const newResult = prev && s.lastQuiz && (!prev.lastQuiz || prev.lastQuiz.round !== s.lastQuiz.round || prev.lastQuiz.pid !== s.lastQuiz.pid);
  state = s;
  if (closeEditor && s.phase !== 'lobby') closeEditor(false);
  store.set('room', s.code);
  renderNow(); // synchrone : quizResultFx a besoin du DOM à jour (render() est différé d'une frame)
  if (newResult) quizResultFx(s.lastQuiz);
}

async function startAnimation(s) {
  const token = ++animToken;
  animating = true;
  aiming = false;
  pending = null;
  // renderNow() synchrone : le DOM est prêt immédiatement pour playRound
  renderNow();
  const wheels = (s.last.events || []).filter((e) => e.type === 'wheel');

  // 1) La scène de tir (avec une sécurité : si l'animation ne se termine jamais, on continue quand même)
  try {
    await Promise.race([playRound(s.last), sleep(7000)]);
  } catch (e) { /* l'animation est facultative */ }

  if (token !== animToken) return;

  // 2) Les roues, l'une après l'autre. On attend leur fin AVANT d'afficher le nouvel état :
  //    sinon le résultat (mort, pop-up, calcul) est déjà en place derrière la roue.
  if (wheels.length && !reducedMotion() && !document.hidden) {
    try {
      await Promise.race([playWheelsSequential(wheels), sleep(wheels.length * 9000 + 1000)]);
    } catch (e) { /* facultatif */ }
    if (wheelEl) { wheelEl.remove(); wheelEl = null; }
    if (token !== animToken) return;
  }

  animating = false;
  const next = pending || s;
  pending = null;
  if (next.last) animatedRound = Math.max(animatedRound || 0, next.last.round);
  applyState(next);
  announceDeaths(s.last);
}

/* ---------- Réseau ---------- */

socket.on('connect', () => {
  const code = store.get('room');
  if (!code) return;
  socket.emit('join', { code, token, name: store.get('name'), face: loadFace() }, (res) => {
    if (res && res.error) {
      store.del('room');
      state = null;
      render();
    }
  });
});

socket.on('state', (s) => {
  s._rx = Date.now();
  if (animating) { pending = s; return; }
  const sameRoom = state && state.code === s.code;
  if (!sameRoom || animatedRound === null) animatedRound = s.last ? s.last.round : 0;
  if (!s.last) animatedRound = 0;
  const fresh = sameRoom && state.phase === 'playing' && s.last && s.last.round > animatedRound;
  if (fresh && !reducedMotion() && !document.hidden) {
    animatedRound = s.last.round;
    startAnimation(s);
    return;
  }
  if (s.last) animatedRound = Math.max(animatedRound, s.last.round);
  applyState(s);
  if (fresh) announceDeaths(s.last);
});

socket.on('notice', toast);

// iOS suspend les timers quand l'app passe en arrière-plan : on resynchronise au retour
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (state) applyState(state);
});

render();