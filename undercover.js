// Game Undercover: semua dapat kata yang sama, kecuali Undercover (kata mirip) dan Mr. White (tanpa kata).
// Pemain bergiliran memberi petunjuk, lalu vote siapa yang berbeda. Pemain tidak tahu dirinya Undercover.

const SPEAK_MS = 40 * 1000;
const VOTE_MS = 60 * 1000;
const GUESS_MS = 30 * 1000;
const MIN_PLAYERS = 3;

// [kata warga, kata undercover]
const PAIRS = [
  ['kopi', 'teh'], ['kucing', 'harimau'], ['bakso', 'mi ayam'], ['nasi goreng', 'mi goreng'], ['sate', 'gulai'],
  ['pantai', 'danau'], ['gunung', 'bukit'], ['motor', 'sepeda'], ['bus', 'kereta'], ['pesawat', 'helikopter'],
  ['dokter', 'perawat'], ['guru', 'dosen'], ['polisi', 'tentara'], ['apel', 'pir'], ['jeruk', 'lemon'],
  ['semangka', 'melon'], ['durian', 'nangka'], ['es krim', 'es campur'], ['martabak', 'terang bulan'], ['donat', 'bolu'],
  ['sepatu', 'sandal'], ['kemeja', 'kaos'], ['topi', 'helm'], ['kacamata', 'lensa kontak'], ['jam tangan', 'gelang'],
  ['laptop', 'tablet'], ['televisi', 'proyektor'], ['kulkas', 'freezer'], ['kipas angin', 'AC'], ['sendok', 'garpu'],
  ['gitar', 'ukulele'], ['piano', 'keyboard'], ['sepak bola', 'futsal'], ['bulu tangkis', 'tenis'], ['berenang', 'menyelam'],
  ['Instagram', 'TikTok'], ['WhatsApp', 'Telegram'], ['YouTube', 'Netflix'], ['Shopee', 'Tokopedia'], ['Gojek', 'Grab'],
  ['bioskop', 'teater'], ['mal', 'pasar'], ['sekolah', 'kampus'], ['masjid', 'musala'], ['hotel', 'villa'],
  ['hujan', 'gerimis'], ['matahari', 'bulan'], ['salju', 'es batu'], ['pelangi', 'aurora'], ['petir', 'kilat'],
  ['vampir', 'zombie'], ['hantu', 'pocong'], ['naga', 'dinosaurus'], ['putri duyung', 'peri'], ['superman', 'batman'],
  ['lebaran', 'natal'], ['mudik', 'liburan'], ['ulang tahun', 'pernikahan'], ['kado', 'angpao'], ['lilin', 'senter'],
  ['tempe', 'tahu'], ['kerupuk', 'keripik'], ['sambal', 'saus tomat'], ['susu', 'yogurt'], ['madu', 'sirup'],
  ['ayam', 'bebek'], ['sapi', 'kerbau'], ['lumba-lumba', 'hiu'], ['kupu-kupu', 'capung'], ['semut', 'rayap'],
];

const normalize = (s) => String(s).toLowerCase().replace(/[\s-]+/g, ' ').trim();

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const autoUndercover = (n) => (n <= 5 ? 1 : n <= 9 ? 2 : 3);

function plurality(votes) {
  const count = {};
  for (const t of Object.values(votes)) count[t] = (count[t] || 0) + 1;
  const sorted = Object.entries(count).sort((a, b) => b[1] - a[1]);
  if (!sorted.length || (sorted[1] && sorted[1][1] === sorted[0][1])) return null;
  return sorted[0][0];
}

function createUndercover(io, systemMessage) {
  const states = new Map();

  function get(room) {
    if (!states.has(room.code)) {
      states.set(room.code, {
        phase: 'idle', round: 0, config: { undercover: 0, mrWhite: false }, players: {}, order: [],
        queue: [], speaker: null, votes: {}, words: null, guesser: null, winner: null, lastEvent: '', endsAt: 0, timers: [], used: new Set(),
      });
    }
    return states.get(room.code);
  }

  const active = (t) => ['describe', 'vote', 'guess'].includes(t.phase);
  const alive = (t) => t.order.filter((id) => t.players[id].alive);
  const clearTimers = (t) => { t.timers.forEach(clearTimeout); t.timers = []; };
  const ROLE_TEXT = { civilian: '👥 Warga', undercover: '🕵️ Undercover', white: '👻 Mr. White' };

  function after(t, ms, fn) {
    t.endsAt = Date.now() + ms;
    t.timers.push(setTimeout(fn, ms));
  }

  function view(room, id) {
    const t = get(room);
    const me = t.players[id];
    const over = t.phase === 'over';
    return {
      phase: t.phase,
      round: t.round,
      config: t.config,
      remaining: active(t) ? Math.max(0, t.endsAt - Date.now()) : 0,
      speaker: t.phase === 'describe' ? t.speaker : null,
      queue: t.phase === 'describe' ? t.queue : [],
      guesser: t.phase === 'guess' ? t.guesser : null,
      winner: t.winner,
      lastEvent: t.lastEvent,
      words: over ? t.words : null,
      // Pemain tidak diberi tahu apakah dia Undercover; Mr. White tahu karena tidak dapat kata
      me: me ? { word: me.word, white: me.role === 'white', alive: me.alive, role: over || !me.alive ? me.role : null } : null,
      players: t.order.map((pid) => {
        const p = t.players[pid];
        return { id: pid, name: p.name, alive: p.alive, clues: p.clues, role: over || !p.alive ? p.role : null };
      }),
      votes: t.phase === 'vote' ? t.votes : null,
      composition: t.order.length ? {
        undercover: t.order.filter((pid) => t.players[pid].role === 'undercover').length,
        white: t.order.filter((pid) => t.players[pid].role === 'white').length,
      } : null,
    };
  }

  function emit(room) {
    for (const id of room.members.keys()) io.to(id).emit('uc:state', view(room, id));
  }

  // ---------- Alur ----------
  function startRound(room) {
    const t = get(room);
    clearTimers(t);
    t.round++;
    t.phase = 'describe';
    // Urutan bicara bergeser setiap ronde; Mr. White tidak boleh bicara pertama di ronde 1
    const living = alive(t);
    const offset = (t.round - 1) % living.length;
    t.queue = [...living.slice(offset), ...living.slice(0, offset)];
    if (t.round === 1) {
      while (t.players[t.queue[0]].role === 'white' && t.queue.length > 1) t.queue.push(t.queue.shift());
    }
    systemMessage(room, `🎭 Ronde ${t.round}: bergiliran beri petunjuk tentang katamu (lewat voice atau ketik). Jangan terlalu jelas!`);
    nextSpeaker(room);
  }

  function nextSpeaker(room) {
    const t = get(room);
    clearTimers(t);
    t.queue = t.queue.filter((id) => t.players[id]?.alive);
    if (!t.queue.length) return startVote(room);
    t.speaker = t.queue.shift();
    after(t, SPEAK_MS, () => nextSpeaker(room));
    emit(room);
  }

  function startVote(room) {
    const t = get(room);
    clearTimers(t);
    t.phase = 'vote';
    t.speaker = null;
    t.votes = {};
    systemMessage(room, '🗳️ Waktunya vote! Siapa yang katanya berbeda?');
    after(t, VOTE_MS, () => resolveVote(room));
    emit(room);
  }

  function resolveVote(room) {
    const t = get(room);
    if (t.phase !== 'vote') return;
    clearTimers(t);
    const target = plurality(t.votes);
    if (!target) {
      t.lastEvent = '⚖️ Suara seri. Tidak ada yang tersingkir, lanjut ronde berikutnya.';
      systemMessage(room, t.lastEvent);
      return startRound(room);
    }
    const p = t.players[target];
    p.alive = false;
    t.lastEvent = `❌ ${p.name} tersingkir. Ternyata dia ${ROLE_TEXT[p.role]}${p.word ? ` (kata: "${p.word}")` : ''}.`;
    systemMessage(room, t.lastEvent);
    if (p.role === 'white') {
      t.phase = 'guess';
      t.guesser = target;
      systemMessage(room, `👻 ${p.name} punya satu kesempatan menebak kata warga!`);
      after(t, GUESS_MS, () => resolveGuess(room, null));
      return emit(room);
    }
    if (!checkWin(room)) startRound(room);
  }

  function resolveGuess(room, guess) {
    const t = get(room);
    if (t.phase !== 'guess') return;
    clearTimers(t);
    const name = t.players[t.guesser].name;
    if (guess && normalize(guess) === normalize(t.words.civilian)) {
      systemMessage(room, `👻 ${name} menebak "${guess}" — BENAR!`);
      return finish(room, 'white');
    }
    systemMessage(room, guess ? `👻 ${name} menebak "${guess}" — salah!` : `👻 ${name} tidak menebak.`);
    t.guesser = null;
    if (!checkWin(room)) startRound(room);
  }

  function checkWin(room) {
    const t = get(room);
    const living = alive(t);
    const civilians = living.filter((id) => t.players[id].role === 'civilian').length;
    const infiltrators = living.length - civilians;
    if (infiltrators === 0) { finish(room, 'civilian'); return true; }
    if (civilians <= infiltrators) { finish(room, 'undercover'); return true; }
    return false;
  }

  function finish(room, winner, reason) {
    const t = get(room);
    clearTimers(t);
    t.phase = 'over';
    t.winner = winner;
    const names = (role) => t.order.filter((id) => t.players[id].role === role).map((id) => t.players[id].name).join(', ');
    const texts = {
      civilian: `🎉 Warga menang! Undercover-nya: ${names('undercover')}${names('white') ? `, Mr. White: ${names('white')}` : ''}.`,
      undercover: `🕵️ Penyusup menang! Undercover: ${names('undercover')}${names('white') ? `, Mr. White: ${names('white')}` : ''}.`,
      white: `👻 Mr. White (${names('white')}) menang dengan menebak kata warga!`,
    };
    t.lastEvent = (reason || texts[winner]) + (t.words ? ` Kata warga: "${t.words.civilian}", kata undercover: "${t.words.undercover}".` : '');
    systemMessage(room, t.lastEvent);
    emit(room);
  }

  // ---------- Event ----------
  function register(socket, getRoom) {
    const tell = (text) => socket.emit('chat:msg', { id: 'uc' + Date.now(), system: true, text, ts: Date.now() });

    socket.on('uc:config', (config) => {
      const room = getRoom(); if (!room || !config) return;
      const t = get(room);
      if (active(t)) return;
      t.config = { undercover: [0, 1, 2, 3].includes(config.undercover) ? config.undercover : 0, mrWhite: !!config.mrWhite };
      emit(room);
    });

    socket.on('uc:start', () => {
      const room = getRoom(); if (!room) return;
      const t = get(room);
      if (active(t)) return;
      const n = room.members.size;
      if (n < MIN_PLAYERS) return tell(`Undercover butuh minimal ${MIN_PLAYERS} orang.`);
      const uc = t.config.undercover || autoUndercover(n);
      const white = t.config.mrWhite ? 1 : 0;
      if ((uc + white) * 2 >= n) return tell(`Penyusup terlalu banyak untuk ${n} pemain. Kurangi Undercover atau matikan Mr. White.`);

      let choices = PAIRS.filter((p) => !t.used.has(p[0]));
      if (!choices.length) { t.used.clear(); choices = PAIRS; }
      const pair = choices[Math.floor(Math.random() * choices.length)];
      t.used.add(pair[0]);
      // Acak juga mana kata warga dan mana kata undercover
      const [civ, und] = Math.random() < 0.5 ? pair : [pair[1], pair[0]];
      t.words = { civilian: civ, undercover: und };

      const ids = shuffle([...room.members.keys()]);
      const roles = shuffle([...Array(uc).fill('undercover'), ...Array(white).fill('white'), ...Array(n - uc - white).fill('civilian')]);
      t.players = {};
      ids.forEach((id, i) => {
        const role = roles[i];
        t.players[id] = { name: room.members.get(id).name, role, alive: true, clues: [], word: role === 'civilian' ? civ : role === 'undercover' ? und : null };
      });
      t.order = ids;
      Object.assign(t, { round: 0, winner: null, lastEvent: '', guesser: null });
      systemMessage(room, `🎭 ${room.members.get(socket.id).name} memulai Undercover dengan ${n} pemain (${uc} Undercover${white ? ' + Mr. White' : ''}). Cek katamu!`);
      io.to(room.code).emit('uc:started');
      startRound(room);
    });

    socket.on('uc:stop', () => {
      const room = getRoom(); if (!room) return;
      const t = get(room);
      if (!active(t)) return;
      finish(room, null, `${room.members.get(socket.id).name} menghentikan Undercover.`);
    });

    // Pembicara mengetik petunjuk (opsional) atau menandai sudah selesai bicara lewat voice
    socket.on('uc:clue', (text) => {
      const room = getRoom(); if (!room) return;
      const t = get(room);
      if (t.phase !== 'describe' || t.speaker !== socket.id) return;
      const clue = String(text ?? '').trim().slice(0, 40);
      const p = t.players[socket.id];
      if (clue) {
        // Tidak boleh menyebut katanya sendiri
        if (p.word && normalize(clue).includes(normalize(p.word))) return tell('🤫 Jangan sebut katamu sendiri!');
        p.clues.push(clue);
      } else {
        p.clues.push('🎙️');
      }
      nextSpeaker(room);
    });

    socket.on('uc:vote', (target) => {
      const room = getRoom(); if (!room) return;
      const t = get(room);
      if (t.phase !== 'vote' || !t.players[socket.id]?.alive || !t.players[target]?.alive || target === socket.id) return;
      t.votes[socket.id] = target;
      emit(room);
      if (alive(t).every((id) => t.votes[id])) {
        clearTimers(t);
        after(t, 2000, () => resolveVote(room));
      }
    });

    socket.on('uc:guess', (text) => {
      const room = getRoom(); if (!room) return;
      const t = get(room);
      if (t.phase !== 'guess' || t.guesser !== socket.id) return;
      resolveGuess(room, String(text ?? '').trim().slice(0, 40));
    });
  }

  function onJoin(room, id) {
    const t = states.get(room.code);
    if (t) io.to(id).emit('uc:state', view(room, id));
  }

  function onLeave(room, id) {
    const t = states.get(room.code);
    if (!t || !active(t) || !t.players[id]?.alive) return;
    const p = t.players[id];
    p.alive = false;
    delete t.votes[id];
    systemMessage(room, `🚪 ${p.name} keluar dari Undercover. Dia adalah ${ROLE_TEXT[p.role]}.`);
    if (t.phase === 'guess' && t.guesser === id) return resolveGuess(room, null);
    if (checkWin(room)) return;
    if (t.phase === 'describe' && t.speaker === id) nextSpeaker(room);
    else if (t.phase === 'vote' && alive(t).every((pid) => t.votes[pid])) resolveVote(room);
    else emit(room);
  }

  function remove(room) {
    const t = states.get(room.code);
    if (t) clearTimers(t);
    states.delete(room.code);
  }

  return { register, onJoin, onLeave, remove };
}

module.exports = { createUndercover };
