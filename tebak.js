// Game Tebak Gambar: pemain bergiliran menggambar, yang lain menebak lewat chat.
const WORDS = require('./words');

const TURN_MS = 80 * 1000;
const REVEAL_MS = 5 * 1000;

const normalize = (s) => String(s).toLowerCase().replace(/[\s-]+/g, ' ').trim();

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

function createTebak(io, systemMessage) {
  const states = new Map(); // kode room -> state game

  function get(room) {
    if (!states.has(room.code)) {
      states.set(room.code, { phase: 'idle', round: 0, rounds: 3, queue: [], drawer: null, word: null, hint: [], used: new Set(), guessed: new Set(), scores: {}, strokes: [], endsAt: 0, timers: [] });
    }
    return states.get(room.code);
  }

  function publicState(room) {
    const t = get(room);
    return {
      phase: t.phase,
      round: t.round,
      rounds: t.rounds,
      drawer: t.drawer,
      hint: t.phase === 'drawing' ? t.hint : [],
      word: t.phase === 'reveal' || t.phase === 'over' ? t.word : null,
      remaining: t.phase === 'drawing' ? Math.max(0, t.endsAt - Date.now()) : 0,
      scores: t.scores,
      guessed: [...t.guessed],
      strokes: t.strokes,
    };
  }

  const emitState = (room) => io.to(room.code).emit('tebak:state', publicState(room));
  const clearTimers = (t) => { t.timers.forEach(clearTimeout); t.timers = []; };

  function ensureScore(t, id, name) {
    if (!t.scores[id]) t.scores[id] = { name, score: 0 };
  }

  function nextTurn(room) {
    const t = get(room);
    clearTimers(t);
    // Buang pemain yang sudah keluar dari antrean
    t.queue = t.queue.filter((id) => room.members.has(id));
    if (t.queue.length === 0) {
      t.round++;
      if (t.round > t.rounds) return finish(room);
      t.queue = [...room.members.keys()];
    }
    t.drawer = t.queue.shift();

    let choices = WORDS.filter((w) => !t.used.has(w));
    if (choices.length === 0) { t.used.clear(); choices = WORDS; }
    t.word = choices[Math.floor(Math.random() * choices.length)];
    t.used.add(t.word);
    t.hint = [...t.word].map((ch) => (ch === ' ' || ch === '-' ? ch : '_'));
    t.guessed = new Set();
    t.strokes = [];
    t.phase = 'drawing';
    t.endsAt = Date.now() + TURN_MS;

    // Buka satu huruf saat waktu tersisa 50% dan 25%
    for (const frac of [0.5, 0.75]) {
      t.timers.push(setTimeout(() => revealLetter(room), TURN_MS * frac));
    }
    t.timers.push(setTimeout(() => endTurn(room), TURN_MS));

    io.to(t.drawer).emit('tebak:word', t.word);
    systemMessage(room, `✏️ ${room.members.get(t.drawer).name} sedang menggambar (ronde ${t.round}/${t.rounds})`);
    emitState(room);
  }

  function revealLetter(room) {
    const t = get(room);
    const hidden = t.hint.map((c, i) => (c === '_' ? i : -1)).filter((i) => i >= 0);
    if (hidden.length <= 1) return;
    const i = hidden[Math.floor(Math.random() * hidden.length)];
    t.hint[i] = t.word[i];
    emitState(room);
  }

  function endTurn(room) {
    const t = get(room);
    if (t.phase !== 'drawing') return;
    clearTimers(t);
    t.phase = 'reveal';
    systemMessage(room, `Jawabannya: ${t.word.toUpperCase()}`);
    emitState(room);
    t.timers.push(setTimeout(() => nextTurn(room), REVEAL_MS));
  }

  function finish(room, reason) {
    const t = get(room);
    clearTimers(t);
    t.phase = 'over';
    t.drawer = null;
    const ranking = Object.values(t.scores).sort((a, b) => b.score - a.score);
    if (reason) systemMessage(room, reason);
    else if (ranking.length) systemMessage(room, `🏆 Tebak Gambar selesai! Juaranya ${ranking[0].name} dengan ${ranking[0].score} poin`);
    emitState(room);
  }

  // Semua pemain selain penggambar sudah menebak?
  function checkAllGuessed(room) {
    const t = get(room);
    const guessers = [...room.members.keys()].filter((id) => id !== t.drawer);
    if (guessers.length > 0 && guessers.every((id) => t.guessed.has(id))) endTurn(room);
  }

  function register(socket, getRoom) {
    socket.on('tebak:start', (rounds) => {
      const room = getRoom(); if (!room) return;
      const t = get(room);
      if (t.phase === 'drawing' || t.phase === 'reveal') return;
      if (room.members.size < 2) {
        socket.emit('chat:msg', { id: 'tg' + Date.now(), system: true, text: 'Tebak Gambar butuh minimal 2 orang di room.', ts: Date.now() });
        return;
      }
      t.rounds = [1, 2, 3, 5].includes(rounds) ? rounds : 3;
      t.round = 0;
      t.queue = [];
      t.scores = {};
      for (const [id, m] of room.members) ensureScore(t, id, m.name);
      systemMessage(room, `🎨 ${room.members.get(socket.id).name} memulai Tebak Gambar! Ketik tebakan di chat.`);
      io.to(room.code).emit('tebak:started');
      nextTurn(room);
    });

    socket.on('tebak:stop', () => {
      const room = getRoom(); if (!room) return;
      const t = get(room);
      if (t.phase !== 'drawing' && t.phase !== 'reveal') return;
      finish(room, `${room.members.get(socket.id).name} menghentikan Tebak Gambar`);
    });

    socket.on('tebak:draw', (seg) => {
      const room = getRoom(); if (!room) return;
      const t = get(room);
      if (t.phase !== 'drawing' || t.drawer !== socket.id || !seg) return;
      if (t.strokes.length < 20000) t.strokes.push(seg);
      socket.to(room.code).emit('tebak:draw', seg);
    });

    socket.on('tebak:clear', () => {
      const room = getRoom(); if (!room) return;
      const t = get(room);
      if (t.phase !== 'drawing' || t.drawer !== socket.id) return;
      t.strokes = [];
      socket.to(room.code).emit('tebak:clear');
    });
  }

  // Dipanggil untuk setiap pesan chat. Mengembalikan true kalau pesan tidak boleh disiarkan.
  function handleChat(room, socket, text) {
    const t = states.get(room.code);
    if (!t || t.phase !== 'drawing') return false;
    const guess = normalize(text);
    const answer = normalize(t.word);
    const tell = (msg) => socket.emit('chat:msg', { id: 'tg' + Date.now(), system: true, text: msg, ts: Date.now() });

    // Penggambar dan yang sudah benar tidak boleh membocorkan jawaban
    if (socket.id === t.drawer || t.guessed.has(socket.id)) {
      if (guess.includes(answer)) { tell('🤫 Jangan bocorkan jawabannya!'); return true; }
      return false;
    }

    if (guess === answer) {
      const name = room.members.get(socket.id).name;
      ensureScore(t, socket.id, name);
      const timeLeft = Math.max(0, t.endsAt - Date.now()) / TURN_MS;
      const points = Math.round(50 + 100 * timeLeft) + (t.guessed.size === 0 ? 30 : 0);
      t.scores[socket.id].score += points;
      if (t.scores[t.drawer]) t.scores[t.drawer].score += 25;
      t.guessed.add(socket.id);
      tell(`✅ Benar! Jawabannya "${t.word}" (+${points} poin)`);
      systemMessage(room, `🎉 ${name} berhasil menebak!`);
      emitState(room);
      checkAllGuessed(room);
      return true;
    }

    if (answer.length > 3 && levenshtein(guess, answer) === 1) tell(`"${text}" hampir benar!`);
    return false;
  }

  function onJoin(room, id, name) {
    const t = states.get(room.code);
    if (t && (t.phase === 'drawing' || t.phase === 'reveal')) { ensureScore(t, id, name); emitState(room); }
  }

  // Dipanggil setelah anggota dihapus dari room
  function onLeave(room, id) {
    const t = states.get(room.code);
    if (!t || (t.phase !== 'drawing' && t.phase !== 'reveal')) return;
    if (room.members.size < 2) return finish(room, 'Tebak Gambar dihentikan karena pemain kurang dari 2');
    if (t.phase === 'drawing') {
      if (t.drawer === id) endTurn(room);
      else checkAllGuessed(room);
    }
  }

  function remove(room) {
    const t = states.get(room.code);
    if (t) clearTimers(t);
    states.delete(room.code);
  }

  return { register, handleChat, onJoin, onLeave, remove, publicState };
}

module.exports = { createTebak };
