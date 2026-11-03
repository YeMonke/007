const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const MAX_PLAYERS = 6;
const ACTIONS = ['recharger', 'defendre', 'tirer'];
const GRACE_LOBBY_MS = 10_000;
const GRACE_GAME_MS = 60_000;
const rooms = new Map();

/* ---------- Réglages du jeu ---------- */
const num = (name, def) => (process.env[name] ? Number(process.env[name]) : def);
const CFG = {
  LIVES_DEFAULT: 2,
  LIVES_OPTIONS: [1, 2, 3],
  CHANCE_OPTIONS: [0.05, 0.1, 0.2],
  SECONDS_OPTIONS: [3, 5, 8],
  TURN_OPTIONS: [0, 5, 10, 15, 20],   // chrono par tour proposé à l'hôte (0 = sans chrono)
  TURN_SECONDS: num('TURN_SECONDS', 10), // chrono par tour par défaut
  TURN_OPEN_DELAY_MS: 700,            // petit délai avant le premier tour d'une partie
  FOCUS_MIN_SHOOTERS: 2,
  FOCUS_CHANCE_PER_SHOOTER: num('FOCUS_CHANCE', 0.1),
  QUIZ_SECONDS: num('QUIZ_SECONDS', 5),
  QUIZ_MAX_ATTEMPTS: 3,
  QUIZ_GRACE_MS: 700,
  QUIZ_INTRO_MS: num('QUIZ_INTRO_MS', 20000),
  QUIZ_PREP_MS: 400,
  QUIZ_START_DELAY_MS: num('QUIZ_START_DELAY_MS', 3600),
  QUIZ_NEXT_DELAY_MS: num('QUIZ_NEXT_DELAY_MS', 2200),

  DUEL_ENABLED: process.env.DUEL_ENABLED !== '0',
  DUEL_INTRO_MS: num('DUEL_INTRO_MS', 2400),
  DUEL_SLOT_MS: num('DUEL_SLOT_MS', 4800),
  DUEL_RPS_SECONDS: num('DUEL_RPS_SECONDS', 5),
  DUEL_REVEAL_MS: num('DUEL_REVEAL_MS', 2600),
  DUEL_RESULT_MS: num('DUEL_RESULT_MS', 3200),
  DUEL_MAX_ROUNDS: 6,
  DUEL_START_DELAY_MS: num('DUEL_START_DELAY_MS', 3600),
  DUEL_WHEEL_EXTRA_MS: num('DUEL_WHEEL_EXTRA_MS', 6500),
  DUEL_NEXT_DELAY_MS: num('DUEL_NEXT_DELAY_MS', 2600),

  MAX_QUIZ_QUEUE: 12,
  MAX_DUEL_QUEUE: 12,
};

/* ---------- Utilitaires ---------- */

const newPid = () => crypto.randomBytes(4).toString('hex');
const validToken = (t) => typeof t === 'string' && t.length >= 8 && t.length <= 80;

function makeCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do {
    code = Array.from({ length: 4 }, () => letters[crypto.randomInt(letters.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function cleanName(raw, room) {
  const base = String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 14) || 'Joueur';
  let name = base;
  let n = 2;
  while (room && room.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    name = `${base} ${n++}`;
  }
  return name;
}

const FACE_W = 180;
const FACE_H = 210;
function sanitizeFace(raw) {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 40) return null;
  const out = [];
  let total = 0;
  for (const stroke of raw) {
    if (!Array.isArray(stroke) || stroke.length < 2 || stroke.length % 2 !== 0 || stroke.length > 400) return null;
    total += stroke.length;
    if (total > 1200) return null;
    const clean = [];
    for (let i = 0; i < stroke.length; i++) {
      const v = stroke[i];
      if (typeof v !== 'number' || !Number.isFinite(v)) return null;
      clean.push(Math.round(Math.min(i % 2 ? FACE_H : FACE_W, Math.max(0, v))));
    }
    out.push(clean);
  }
  return out;
}

function makeQuestion() {
  const r = (lo, hi) => crypto.randomInt(lo, hi + 1);
  const k = Math.random();
  if (k < 0.4) { const a = r(3, 9); const b = r(3, 9); return { text: `${a} × ${b}`, answer: a * b }; }
  if (k < 0.75) { const a = r(12, 79); const b = r(11, 59); return { text: `${a} + ${b}`, answer: a + b }; }
  const a = r(31, 99);
  const b = r(11, a - 10);
  return { text: `${a} − ${b}`, answer: a - b };
}

function freeColor(room) {
  const used = new Set(room.players.map((p) => p.color));
  for (let i = 0; i < MAX_PLAYERS; i++) if (!used.has(i)) return i;
  return 0;
}

function newPlayer(room, name, token, socketId) {
  return {
    pid: newPid(),
    token,
    name,
    socketId,
    connected: true,
    alive: true,
    bullets: 0,
    lives: room ? room.maxLives : CFG.LIVES_DEFAULT,
    power: false,
    powerUsed: false,
    quizPending: false,
    choice: null,
    face: null,
    color: room ? freeColor(room) : 0,
    dropTimer: null,
  };
}

function duelFor(room, me, now) {
  const d = room.duel;
  if (!d) return null;
  const hidden = d.stage === 'intro';
  return {
    id: d.id, a: d.a, b: d.b, stage: d.stage, round: d.round,
    stake: hidden ? null : d.stake,
    max: hidden ? null : d.max,
    seconds: room.opts.rpsSeconds,
    slotMs: CFG.DUEL_SLOT_MS,
    chosen: { [d.a]: !!d.choices[d.a], [d.b]: !!d.choices[d.b] },
    mine: d.choices[me.pid] || null,
    startIn: d.stage === 'rps' ? Math.max(0, d.startAt - now) : null,
    endsIn: d.stage === 'rps' ? Math.max(0, d.endsAt - now) : null,
    reveal: d.reveal,
    result: d.result,
  };
}

function stateFor(room, me) {
  const now = Date.now();
  const q = room.quiz;
  return {
    code: room.code,
    phase: room.phase,
    round: room.round,
    hostPid: room.hostPid,
    me: me.pid,
    myChoice: me.choice,
    players: room.players.map((p) => ({
      pid: p.pid,
      name: p.name,
      bullets: p.pid === me.pid ? p.bullets : null,
      alive: p.alive,
      lives: p.lives,
      power: p.power,
      connected: p.connected,
      ready: !!p.choice,
      color: p.color,
      face: p.face,
    })),
    last: room.last,
    winner: room.winner,
    settings: { lives: room.maxLives, ...room.opts },
    quiz: q ? {
      pid: q.pid,
      started: q.started,
      seconds: room.opts.quizSeconds,
      tries: CFG.QUIZ_MAX_ATTEMPTS,
      text: q.started ? q.text : null,
      startIn: q.started ? Math.max(0, q.startAt - now) : null,
      endsIn: q.started ? Math.max(0, q.endsAt - now) : null,
    } : null,
    lastQuiz: room.lastQuiz,
    duel: duelFor(room, me, now),
    turn: room.roundEndsAt
      ? { startIn: Math.max(0, room.roundOpenAt - now), endsIn: Math.max(0, room.roundEndsAt - now), seconds: room.opts.turnSeconds }
      : null,
  };
}

function broadcast(room) {
  for (const p of room.players) {
    if (p.connected && p.socketId) io.to(p.socketId).emit('state', stateFor(room, p));
  }
}

function ensureHost(room) {
  const host = room.players.find((p) => p.pid === room.hostPid);
  if (host && host.connected) return;
  const next = room.players.find((p) => p.connected);
  if (next) room.hostPid = next.pid;
}

function resetPlayers(room) {
  clearTimeout(room.quizTimer);
  clearTimeout(room.duelTimer);
  clearTimeout(room.roundTimer);
  room.roundOpenAt = null;
  room.roundEndsAt = null;
  room.quiz = null;
  room.quizQueue = [];
  room.lastQuiz = null;
  room.duel = null;
  room.duelQueue = [];
  for (const p of room.players) {
    p.bullets = 0;
    p.alive = true;
    p.choice = null;
    p.lives = room.maxLives;
    p.power = false;
    p.powerUsed = false;
    p.quizPending = false;
  }
}

// Nettoie tous les timers d'une salle avant suppression
function cleanRoom(room) {
  clearTimeout(room.quizTimer);
  clearTimeout(room.duelTimer);
  clearTimeout(room.roundTimer);
  for (const p of room.players) clearTimeout(p.dropTimer);
}

/* ---------- Logique de jeu ---------- */

function checkEnd(room) {
  if (room.phase !== 'playing') return;
  const alive = room.players.filter((p) => p.alive);
  if (alive.length <= 1) {
    room.phase = 'ended';
    room.winner = alive[0] ? alive[0].pid : null;
    for (const p of room.players) p.choice = null;
    // Stoppe les files en cours
    room.quizQueue = [];
    room.duelQueue = [];
    clearTimeout(room.quizTimer);
    clearTimeout(room.duelTimer);
    clearTimeout(room.roundTimer);
    room.roundOpenAt = null;
    room.roundEndsAt = null;
    room.quiz = null;
    room.duel = null;
  }
}

// Chrono du tour : à la fin, ceux qui n'ont pas choisi se défendent. `delay` laisse le temps aux animations.
function openRound(room, delay) {
  clearTimeout(room.roundTimer);
  room.roundOpenAt = null;
  room.roundEndsAt = null;
  const secs = room.opts.turnSeconds;
  if (room.phase !== 'playing' || !secs) return;
  room.roundOpenAt = Date.now() + delay;
  room.roundEndsAt = room.roundOpenAt + secs * 1000;
  room.roundTimer = setTimeout(() => {
    if (!rooms.has(room.code) || room.phase !== 'playing' || busy(room)) return;
    resolve(room);
    broadcast(room);
  }, delay + secs * 1000);
}

function resolve(room) {
  clearTimeout(room.roundTimer);
  room.roundOpenAt = null;
  room.roundEndsAt = null;
  const alive = room.players.filter((p) => p.alive);
  const byPid = new Map(alive.map((p) => [p.pid, p]));

  for (const p of alive) {
    if (!p.choice) p.choice = { action: 'defendre', target: null, auto: true };
  }

  const actions = alive.map((p) => ({
    pid: p.pid,
    action: p.choice.action,
    target: p.choice.target,
    auto: !!p.choice.auto,
  }));

  const events = [];
  const hit = new Set();
  const shooters = new Map();

  // Riposte contre un tir groupé : un joueur visé par 2 joueurs ou plus qui tire sur l'un d'eux
  // annule tous les tirs qui le concernent (ceux qu'il reçoit et le sien) :
  // pas de touché, pas de duel, pas de second souffle. Les balles sont quand même dépensées.
  const targeting = new Map();
  for (const p of alive) {
    if (p.choice.action !== 'tirer' || !byPid.has(p.choice.target)) continue;
    if (!targeting.has(p.choice.target)) targeting.set(p.choice.target, []);
    targeting.get(p.choice.target).push(p.pid);
  }
  const cancelled = new Set();
  for (const t of alive) {
    const list = targeting.get(t.pid) || [];
    if (list.length >= 2 && t.choice.action === 'tirer' && list.includes(t.choice.target)) {
      events.push({ type: 'cancel', pid: t.pid, target: t.choice.target, shooters: [...list], involved: [...list, t.pid] });
      for (const sp of list) cancelled.add(sp);
      cancelled.add(t.pid);
    }
  }

  for (const p of alive) {
    if (p.choice.action !== 'tirer') continue;
    if (cancelled.has(p.pid)) continue; // tir annulé
    const t = byPid.get(p.choice.target);
    if (!t) continue;
    shooters.set(t.pid, (shooters.get(t.pid) || 0) + 1);
    if (t.choice.action === 'tirer' && t.choice.target === p.pid) {
      if (p.pid < t.pid) events.push({ type: 'clash', a: p.pid, b: t.pid });
    } else if (t.choice.action === 'defendre') {
      events.push({ type: 'blocked', from: p.pid, to: t.pid });
    } else {
      events.push({ type: 'hit', from: p.pid, to: t.pid });
      hit.add(t.pid);
    }
  }

  const dead = new Set();
  const quiz = [];
  const wheels = [];
  for (const pid of hit) {
    const t = byPid.get(pid);
    if (t.lives > 1) {
      t.lives -= 1;
      continue;
    }
    const n = shooters.get(pid) || 0;
    if (room.opts.second && n >= CFG.FOCUS_MIN_SHOOTERS && !t.powerUsed) {
      const chance = Math.min(1, room.opts.chance * n);
      const spin = Math.random();
      const win = spin < chance;
      wheels.push({ type: 'wheel', pid, shooters: n, chance, spin, win });
      if (win) {
        t.powerUsed = true;
        t.quizPending = true;
        quiz.push(pid);
        // ← event visuel : la foudre s'affiche côté client
        continue;
      }
    }
    t.lives = 0;
    t.alive = false;
    dead.add(pid);
  }
  for (const ev of events) if (ev.type === 'hit') ev.lives = byPid.get(ev.to).lives;
  events.push(...wheels);

  for (const p of alive) {
    if (p.choice.action === 'recharger') p.bullets += 1;
    else if (p.choice.action === 'tirer') p.bullets -= 1;
    p.choice = null;
  }

  room.last = { round: room.round, actions, events, dead: [...dead], quiz: [...quiz] };
  room.lastQuiz = null;
  room.round += 1;

  room.duelQueue = room.opts.duel ? events.filter((e) => e.type === 'clash').map((e) => ({ a: e.a, b: e.b })).slice(0, CFG.MAX_DUEL_QUEUE) : [];
  if (quiz.length) {
    room.quizQueue = quiz.slice(0, CFG.MAX_QUIZ_QUEUE);
    nextQuiz(room, CFG.QUIZ_START_DELAY_MS);
  } else {
    // Temps laissé aux animations avant d'ouvrir le tour suivant : court s'il n'y a eu aucun tir.
    const animMs = events.length ? CFG.DUEL_START_DELAY_MS : 1800;
    nextDuel(room, animMs + wheels.length * CFG.DUEL_WHEEL_EXTRA_MS);
  }
}

/* ---------- Second souffle ---------- */

function nextQuiz(room, delay) {
  let p = null;
  while (room.quizQueue.length && !p) {
    const cand = room.players.find((x) => x.pid === room.quizQueue.shift());
    if (cand && cand.alive) p = cand;
  }
  if (!p) {
    room.quiz = null;
    nextDuel(room, CFG.DUEL_NEXT_DELAY_MS);
    return;
  }
  const q = makeQuestion();
  room.quiz = { pid: p.pid, text: q.text, answer: q.answer, attempts: 0, started: false, startAt: null, endsAt: null };
  clearTimeout(room.quizTimer);
  room.quizTimer = setTimeout(() => {
    if (!rooms.has(room.code) || !room.quiz || room.quiz.started) return;
    startQuiz(room);
    broadcast(room);
  }, delay + CFG.QUIZ_INTRO_MS);
}

function startQuiz(room) {
  const q = room.quiz;
  if (!q || q.started) return;
  q.started = true;
  q.startAt = Date.now() + CFG.QUIZ_PREP_MS;
  q.endsAt = q.startAt + room.opts.quizSeconds * 1000;
  clearTimeout(room.quizTimer);
  room.quizTimer = setTimeout(() => {
    if (!rooms.has(room.code) || !room.quiz) return;
    settleQuiz(room, false);
    broadcast(room);
  }, CFG.QUIZ_PREP_MS + room.opts.quizSeconds * 1000 + CFG.QUIZ_GRACE_MS);
}

function settleQuiz(room, ok) {
  const q = room.quiz;
  if (!q) return;
  clearTimeout(room.quizTimer);
  const p = room.players.find((x) => x.pid === q.pid);
  if (p) {
    p.quizPending = false;
    if (p.alive && !ok) {
      p.lives = 0;
      p.alive = false;
      if (room.last && !room.last.dead.includes(p.pid)) room.last.dead.push(p.pid);
    }
  }
  if (room.last) {
    room.lastQuiz = { round: room.last.round, pid: q.pid, text: q.text, answer: q.answer, ok: !!ok };
  }
  room.quiz = null;
  if (room.quizQueue.length) nextQuiz(room, CFG.QUIZ_NEXT_DELAY_MS);
  else nextDuel(room, CFG.DUEL_NEXT_DELAY_MS);
}

/* ---------- Duel ---------- */

const MOVES = ['pierre', 'feuille', 'ciseaux'];
const BEATS = { pierre: 'ciseaux', ciseaux: 'feuille', feuille: 'pierre' };

function duelAfter(room, ms, fn) {
  const d = room.duel;
  clearTimeout(room.duelTimer);
  room.duelTimer = setTimeout(() => {
    if (!rooms.has(room.code) || room.duel !== d) return;
    fn(room);
    broadcast(room);
  }, ms);
}

function nextDuel(room, delay) {
  clearTimeout(room.duelTimer);
  let pa = null;
  let pb = null;
  while (room.duelQueue.length && !pa) {
    const c = room.duelQueue.shift();
    const x = room.players.find((p) => p.pid === c.a);
    const y = room.players.find((p) => p.pid === c.b);
    if (x && y && x.alive && y.alive) { pa = x; pb = y; }
  }
  if (!pa) {
    room.duel = null;
    checkEnd(room);
    if (room.phase === 'playing') openRound(room, delay);
    return;
  }
  const max = Math.max(1, Math.min(pa.lives, pb.lives));
  room.duelSeq += 1;
  room.duel = {
    id: room.duelSeq, a: pa.pid, b: pb.pid, stage: 'intro',
    stake: 1 + crypto.randomInt(max), max, round: 1,
    choices: {}, reveal: null, result: null, startAt: null, endsAt: null,
  };
  duelAfter(room, delay + CFG.DUEL_INTRO_MS, startSlot);
}

function startSlot(room) {
  if (!room.duel) return;
  room.duel.stage = 'slot';
  duelAfter(room, CFG.DUEL_SLOT_MS, startRps);
}

function startRps(room) {
  const d = room.duel;
  if (!d) return;
  d.stage = 'rps';
  d.choices = {};
  d.reveal = null;
  d.startAt = Date.now() + CFG.QUIZ_PREP_MS;
  d.endsAt = d.startAt + room.opts.rpsSeconds * 1000;
  duelAfter(room, CFG.QUIZ_PREP_MS + room.opts.rpsSeconds * 1000 + CFG.QUIZ_GRACE_MS, revealRps);
}

function revealRps(room) {
  const d = room.duel;
  if (!d || d.stage !== 'rps') return;
  const auto = {};
  for (const pid of [d.a, d.b]) {
    if (!d.choices[pid]) { d.choices[pid] = MOVES[crypto.randomInt(MOVES.length)]; auto[pid] = true; }
  }
  const ca = d.choices[d.a];
  const cb = d.choices[d.b];
  let winner = null;
  if (ca !== cb) winner = BEATS[ca] === cb ? d.a : d.b;
  d.reveal = { round: d.round, a: ca, b: cb, auto, winner, coin: false };
  d.stage = 'reveal';
  if (!winner && d.round >= CFG.DUEL_MAX_ROUNDS) {
    winner = crypto.randomInt(2) ? d.a : d.b;
    d.reveal.winner = winner;
    d.reveal.coin = true;
  }
  if (winner) duelAfter(room, CFG.DUEL_REVEAL_MS, () => finishDuel(room, winner));
  else duelAfter(room, CFG.DUEL_REVEAL_MS, () => { d.round += 1; startRps(room); });
}

function finishDuel(room, winnerPid) {
  const d = room.duel;
  if (!d) return;
  const loserPid = winnerPid === d.a ? d.b : d.a;
  const w = room.players.find((p) => p.pid === winnerPid);
  const l = room.players.find((p) => p.pid === loserPid);
  let stake = d.stake;
  let eliminated = false;
  if (w && l && w.alive && l.alive) {
    stake = Math.min(d.stake, l.lives);
    l.lives -= stake;
    w.lives += stake;
    if (l.lives <= 0) {
      l.lives = 0;
      l.alive = false;
      eliminated = true;
      if (room.last && !room.last.dead.includes(l.pid)) room.last.dead.push(l.pid);
    }
  }
  d.result = { winner: winnerPid, loser: loserPid, stake, eliminated };
  d.stage = 'result';
  if (room.last) {
    room.last.events.push({ type: 'duel', a: d.a, b: d.b, stake, winner: winnerPid, loser: loserPid, eliminated });
  }
  duelAfter(room, CFG.DUEL_RESULT_MS, () => {
    room.duel = null;
    nextDuel(room, CFG.DUEL_NEXT_DELAY_MS);
  });
}

const busy = (room) => !!(room.quiz || room.quizQueue.length || room.duel);

function checkProgress(room) {
  if (room.phase !== 'playing' || busy(room)) return;
  const connected = room.players.filter((p) => p.alive && p.connected);
  if (connected.length && connected.every((p) => p.choice)) resolve(room);
}

/* ---------- Déconnexions ---------- */

function dropPlayer(room, p) {
  if (p.connected || !rooms.has(room.code)) return;
  clearTimeout(p.dropTimer);
  if (room.phase === 'playing') {
    // Si le joueur déconnecté était en plein quiz ou duel, on termine immédiatement
    if (room.quiz && room.quiz.pid === p.pid) {
      clearTimeout(room.quizTimer);
      settleQuiz(room, false);
    }
    if (room.duel && (room.duel.a === p.pid || room.duel.b === p.pid)) {
      // Le duel continue : l'autre joueur gagne par forfait
      const d = room.duel;
      const winner = d.a === p.pid ? d.b : d.a;
      clearTimeout(room.duelTimer);
      finishDuel(room, winner);
    }
    p.alive = false;
    p.choice = null;
    checkEnd(room);
    checkProgress(room);
  } else {
    room.players = room.players.filter((x) => x !== p);
  }
  if (room.players.every((x) => !x.connected)) {
    cleanRoom(room);
    rooms.delete(room.code);
    return;
  }
  ensureHost(room);
  broadcast(room);
}

function scheduleDrop(room, p) {
  clearTimeout(p.dropTimer);
  const delay = room.phase === 'playing' ? GRACE_GAME_MS : GRACE_LOBBY_MS;
  p.dropTimer = setTimeout(() => dropPlayer(room, p), delay);
}

/* ---------- Sockets ---------- */

io.on('connection', (socket) => {
  socket.data = {};

  const ctx = () => {
    const room = rooms.get(socket.data.code);
    if (!room) return {};
    const me = room.players.find((p) => p.pid === socket.data.pid);
    return { room, me };
  };

  const attach = (room, p) => {
    clearTimeout(p.dropTimer);
    p.socketId = socket.id;
    p.connected = true;
    socket.data.code = room.code;
    socket.data.pid = p.pid;
  };

  const detach = () => {
    const { room, me } = ctx();
    if (room && me && me.socketId === socket.id) {
      me.connected = false;
      me.socketId = null;
      dropPlayer(room, me);
    }
    socket.data = {};
  };

  socket.on('create', (data = {}, cb = () => {}) => {
    const { name, token } = data;
    if (!validToken(token)) return cb({ error: 'Session invalide, recharge la page.' });
    if (socket.data.code) detach();

    const code = makeCode();
    const room = {
      code,
      phase: 'lobby',
      round: 1,
      hostPid: null,
      players: [],
      last: null,
      winner: null,
      maxLives: CFG.LIVES_DEFAULT,
      opts: {
        duel: CFG.DUEL_ENABLED,
        second: true,
        chance: CFG.FOCUS_CHANCE_PER_SHOOTER,
        quizSeconds: CFG.QUIZ_SECONDS,
        rpsSeconds: CFG.DUEL_RPS_SECONDS,
        turnSeconds: CFG.TURN_SECONDS,
      },
      quiz: null,
      quizQueue: [],
      lastQuiz: null,
      quizTimer: null,
      duel: null,
      duelQueue: [],
      duelTimer: null,
      duelSeq: 0,
      roundTimer: null,
      roundOpenAt: null,
      roundEndsAt: null,
    };
    const p = newPlayer(room, cleanName(name, room), token, socket.id);
    p.face = sanitizeFace(data.face);
    room.players.push(p);
    room.hostPid = p.pid;
    rooms.set(code, room);
    attach(room, p);
    cb({ ok: true, code });
    broadcast(room);
  });

  socket.on('join', (data = {}, cb = () => {}) => {
    const { code, name, token } = data;
    if (!validToken(token)) return cb({ error: 'Session invalide, recharge la page.' });
    const room = rooms.get(String(code || '').trim().toUpperCase());
    if (!room) return cb({ error: 'Salle introuvable. Vérifie le code.' });

    const existing = room.players.find((p) => p.token === token);
    if (existing) {
      if (socket.data.code && socket.data.code !== room.code) detach();
      attach(room, existing);
      ensureHost(room);
      cb({ ok: true, code: room.code });
      return broadcast(room);
    }

    if (room.phase !== 'lobby') return cb({ error: 'La partie a déjà commencé.' });
    if (room.players.length >= MAX_PLAYERS) return cb({ error: 'Salle pleine (6 joueurs maximum).' });

    if (socket.data.code) detach();
    const p = newPlayer(room, cleanName(name, room), token, socket.id);
    p.face = sanitizeFace(data.face);
    room.players.push(p);
    attach(room, p);
    cb({ ok: true, code: room.code });
    broadcast(room);
  });

  socket.on('face', (data = {}, cb = () => {}) => {
    const { room, me } = ctx();
    if (!room || !me) return;
    if (room.phase !== 'lobby') return cb({ error: 'Tu peux dessiner ton visage dans le salon.' });
    me.face = sanitizeFace(data.strokes);
    cb({ ok: true });
    broadcast(room);
  });

  socket.on('settings', (data = {}) => {
    const { room, me } = ctx();
    if (!room || !me || room.hostPid !== me.pid || room.phase !== 'lobby') return;
    const o = room.opts;
    if (data.lives !== undefined && CFG.LIVES_OPTIONS.includes(Number(data.lives))) {
      room.maxLives = Number(data.lives);
      for (const p of room.players) p.lives = room.maxLives;
    }
    if (typeof data.duel === 'boolean') o.duel = data.duel;
    if (typeof data.second === 'boolean') o.second = data.second;
    if (CFG.CHANCE_OPTIONS.includes(data.chance)) o.chance = data.chance;
    if (CFG.SECONDS_OPTIONS.includes(data.quizSeconds)) o.quizSeconds = data.quizSeconds;
    if (CFG.SECONDS_OPTIONS.includes(data.rpsSeconds)) o.rpsSeconds = data.rpsSeconds;
    if (CFG.TURN_OPTIONS.includes(data.turnSeconds)) o.turnSeconds = data.turnSeconds;
    broadcast(room);
  });

  socket.on('duelChoose', (data = {}, cb = () => {}) => {
    const { room, me } = ctx();
    const d = room && room.duel;
    if (!d || !me || d.stage !== 'rps' || (me.pid !== d.a && me.pid !== d.b)) return cb({ error: "Ce n'est pas ton duel." });
    const now = Date.now();
    if (now < d.startAt - 250) return cb({ error: 'Pas encore !' });
    if (now > d.endsAt + CFG.QUIZ_GRACE_MS) return cb({ error: 'Trop tard.' });
    if (!MOVES.includes(data.move)) return cb({ error: 'Choix invalide.' });
    if (d.choices[me.pid]) return cb({ error: 'Ton choix est déjà verrouillé.' });
    d.choices[me.pid] = data.move;
    cb({ ok: true });
    if (d.choices[d.a] && d.choices[d.b]) revealRps(room);
    broadcast(room);
  });

  socket.on('quizReady', () => {
    const { room, me } = ctx();
    const q = room && room.quiz;
    if (!q || !me || q.pid !== me.pid || q.started) return;
    startQuiz(room);
    broadcast(room);
  });

  socket.on('answer', (data = {}, cb = () => {}) => {
    const { room, me } = ctx();
    const q = room && room.quiz;
    if (!q || !me || q.pid !== me.pid) return cb({ error: "Ce calcul n'est pas pour toi." });
    if (!q.started) return cb({ error: "Appuie d'abord sur OK." });
    const now = Date.now();
    if (now < q.startAt - 250) return cb({ error: 'Pas encore !' });
    if (now > q.endsAt + CFG.QUIZ_GRACE_MS) return cb({ error: 'Trop tard.' });
    const txt = String(data.value === undefined ? '' : data.value).trim();
    if (!/^\d{1,4}$/.test(txt)) return cb({ error: 'Entre un nombre.' });
    if (Number(txt) === q.answer) {
      cb({ ok: true });
      settleQuiz(room, true);
      broadcast(room);
      return;
    }
    q.attempts += 1;
    const left = CFG.QUIZ_MAX_ATTEMPTS - q.attempts;
    cb({ wrong: true, left });
    if (left <= 0) {
      settleQuiz(room, false);
      broadcast(room);
    }
  });

  socket.on('start', () => {
    const { room, me } = ctx();
    if (!room || !me || room.hostPid !== me.pid || room.phase !== 'lobby') return;
    const connected = room.players.filter((p) => p.connected);
    if (connected.length < 2) return socket.emit('notice', 'Il faut au moins 2 joueurs connectés.');
    room.phase = 'playing';
    room.round = 1;
    room.last = null;
    room.winner = null;
    resetPlayers(room);
    openRound(room, CFG.TURN_OPEN_DELAY_MS);
    broadcast(room);
  });

  socket.on('choose', (data = {}, cb = () => {}) => {
    const { room, me } = ctx();
    if (!room || !me || room.phase !== 'playing' || !me.alive) return;
    if (busy(room)) return cb({ error: 'Un calcul ou un duel est en cours.' });
    const { action, target } = data;
    if (!ACTIONS.includes(action)) return;

    if (action === 'tirer') {
      const t = room.players.find((p) => p.pid === target);
      if (me.bullets < 1) return cb({ error: "Tu n'as pas de balle." });
      if (!t || !t.alive || t.pid === me.pid) return cb({ error: 'Cible invalide.' });
      me.choice = { action, target: t.pid };
    } else {
      me.choice = { action, target: null };
    }
    cb({ ok: true });
    checkProgress(room);
    broadcast(room);
  });

  socket.on('force', () => {
    const { room, me } = ctx();
    if (!room || !me || room.hostPid !== me.pid || room.phase !== 'playing') return;
    if (busy(room)) return;
    resolve(room);
    broadcast(room);
  });

  socket.on('rematch', () => {
    const { room, me } = ctx();
    if (!room || !me || room.hostPid !== me.pid || room.phase !== 'ended') return;
    room.players = room.players.filter((p) => p.connected);
    room.phase = 'lobby';
    room.round = 1;
    room.last = null;
    room.winner = null;
    resetPlayers(room);
    ensureHost(room);
    broadcast(room);
  });

  socket.on('leave', () => detach());

  socket.on('disconnect', () => {
    const { room, me } = ctx();
    if (!room || !me || me.socketId !== socket.id) return;
    me.connected = false;
    me.socketId = null;
    scheduleDrop(room, me);
    if (room.phase === 'playing') checkProgress(room);
    ensureHost(room);
    broadcast(room);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`007 prêt sur http://localhost:${PORT}`));