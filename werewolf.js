// Game Werewolf: warga harus menemukan werewolf sebelum werewolf menghabisi warga.
// Setiap pemain menerima tampilan berbeda (peran dirahasiakan), jadi state dikirim per orang.

const NIGHT_MS = 45 * 1000;
const DAY_MS = 150 * 1000;
const DUSK_MS = 6 * 1000;
const MIN_PLAYERS = 4;

const ROLES = {
  werewolf: { name: 'Werewolf', icon: '🐺' },
  seer: { name: 'Peramal', icon: '🔮' },
  doctor: { name: 'Dokter', icon: '💉' },
  villager: { name: 'Warga', icon: '🧑‍🌾' },
};

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function roleList(n) {
  const wolves = n >= 12 ? 3 : n >= 8 ? 2 : 1;
  const roles = Array(wolves).fill('werewolf');
  roles.push('seer');
  if (n >= 5) roles.push('doctor');
  while (roles.length < n) roles.push('villager');
  return roles;
}

// Pilihan terbanyak; kalau seri, tidak ada yang terpilih
function plurality(votes) {
  const count = {};
  for (const t of Object.values(votes)) count[t] = (count[t] || 0) + 1;
  const sorted = Object.entries(count).sort((a, b) => b[1] - a[1]);
  if (!sorted.length || (sorted[1] && sorted[1][1] === sorted[0][1])) return null;
  return sorted[0][0];
}

function createWerewolf(io, systemMessage) {
  const states = new Map();

  function get(room) {
    if (!states.has(room.code)) {
      states.set(room.code, { phase: 'idle', day: 0, players: {}, order: [], night: null, votes: {}, seerResults: [], lastDoctor: null, lastEvent: '', winner: null, endsAt: 0, timers: [] });
    }
    return states.get(room.code);
  }

  const active = (t) => ['night', 'day', 'dusk'].includes(t.phase);
  const alive = (t) => t.order.filter((id) => t.players[id].alive);
  const aliveWith = (t, role) => alive(t).filter((id) => t.players[id].role === role);
  const clearTimers = (t) => { t.timers.forEach(clearTimeout); t.timers = []; };
  const roleName = (role) => `${ROLES[role].icon} ${ROLES[role].name}`;

  function view(room, id) {
    const t = get(room);
    const me = t.players[id];
    const meWolf = me?.role === 'werewolf';
    const revealAll = t.phase === 'over';
    return {
      phase: t.phase,
      day: t.day,
      remaining: active(t) ? Math.max(0, t.endsAt - Date.now()) : 0,
      winner: t.winner,
      lastEvent: t.lastEvent,
      composition: t.order.length ? roleList(t.order.length) : [],
      players: t.order.map((pid) => {
        const p = t.players[pid];
        const known = revealAll || pid === id || !p.alive || (meWolf && p.role === 'werewolf');
        return { id: pid, name: p.name, alive: p.alive, left: !!p.left, role: known ? p.role : null };
      }),
      me: me ? { role: me.role, alive: me.alive } : null,
      myTarget: me && t.phase === 'night' ? (meWolf ? t.night.wolf[id] : t.night[me.role]) ?? null : null,
      wolfVotes: meWolf && t.phase === 'night' ? t.night.wolf : null,
      seerResults: me?.role === 'seer' ? t.seerResults : null,
      lastDoctor: me?.role === 'doctor' ? t.lastDoctor : null,
      votes: t.phase === 'day' ? t.votes : null,
    };
  }

  function emit(room) {
    for (const id of room.members.keys()) io.to(id).emit('ww:state', view(room, id));
  }

  function after(t, ms, fn) {
    t.endsAt = Date.now() + ms;
    t.timers.push(setTimeout(fn, ms));
  }

  // ---------- Alur permainan ----------
  function startNight(room) {
    const t = get(room);
    clearTimers(t);
    t.day++;
    t.phase = 'night';
    t.night = { wolf: {}, seer: null, doctor: null };
    systemMessage(room, `🌙 Malam ke-${t.day}. Semua warga tidur... Werewolf, Peramal, dan Dokter beraksi diam-diam.`);
    after(t, NIGHT_MS, () => resolveNight(room));
    emit(room);
  }

  function nightDone(t) {
    const wolvesDone = aliveWith(t, 'werewolf').every((id) => t.night.wolf[id]);
    const seerDone = aliveWith(t, 'seer').length === 0 || t.night.seer;
    const doctorDone = aliveWith(t, 'doctor').length === 0 || t.night.doctor;
    return wolvesDone && seerDone && doctorDone;
  }

  function resolveNight(room) {
    const t = get(room);
    if (t.phase !== 'night') return;
    clearTimers(t);
    const victim = plurality(t.night.wolf);
    const saved = victim && victim === t.night.doctor;
    t.lastDoctor = t.night.doctor;
    if (victim && !saved) {
      const p = t.players[victim];
      p.alive = false;
      t.lastEvent = `☀️ Pagi hari. ${p.name} ditemukan tewas! Ternyata dia ${roleName(p.role)}.`;
    } else {
      t.lastEvent = saved
        ? '☀️ Pagi hari. Werewolf menyerang, tapi Dokter berhasil menyelamatkan korbannya! 💉'
        : '☀️ Pagi hari. Tidak ada yang tewas semalam. 🙏';
    }
    systemMessage(room, t.lastEvent);
    if (checkWin(room)) return;
    t.phase = 'day';
    t.votes = {};
    systemMessage(room, '🗣️ Diskusikan siapa werewolf-nya, lalu vote! Yang suaranya terbanyak akan dieksekusi.');
    after(t, DAY_MS, () => resolveDay(room));
    emit(room);
  }

  function resolveDay(room) {
    const t = get(room);
    if (t.phase !== 'day') return;
    clearTimers(t);
    const target = plurality(t.votes);
    if (target && target !== 'skip') {
      const p = t.players[target];
      p.alive = false;
      t.lastEvent = `⚖️ Warga sepakat mengeksekusi ${p.name}. Ternyata dia ${roleName(p.role)}!`;
    } else {
      t.lastEvent = '⚖️ Warga tidak mencapai kesepakatan. Tidak ada yang dieksekusi hari ini.';
    }
    systemMessage(room, t.lastEvent);
    if (checkWin(room)) return;
    t.phase = 'dusk';
    after(t, DUSK_MS, () => startNight(room));
    emit(room);
  }

  function checkWin(room) {
    const t = get(room);
    const wolves = aliveWith(t, 'werewolf').length;
    const others = alive(t).length - wolves;
    if (wolves > 0 && wolves < others) return false;
    finish(room, wolves === 0 ? 'village' : 'wolf');
    return true;
  }

  function finish(room, winner, reason) {
    const t = get(room);
    clearTimers(t);
    t.phase = 'over';
    t.winner = winner;
    const wolves = t.order.filter((id) => t.players[id].role === 'werewolf').map((id) => t.players[id].name).join(', ');
    t.lastEvent = reason || (winner === 'village'
      ? `🎉 Warga menang! Semua werewolf sudah tertangkap. Werewolf-nya: ${wolves}`
      : `🐺 Werewolf menang! Mereka menguasai desa. Werewolf-nya: ${wolves}`);
    systemMessage(room, t.lastEvent);
    emit(room);
  }

  // ---------- Event dari pemain ----------
  function register(socket, getRoom) {
    socket.on('ww:start', () => {
      const room = getRoom(); if (!room) return;
      const t = get(room);
      if (active(t)) return;
      if (room.members.size < MIN_PLAYERS) {
        socket.emit('chat:msg', { id: 'ww' + Date.now(), system: true, text: `Werewolf butuh minimal ${MIN_PLAYERS} orang di room.`, ts: Date.now() });
        return;
      }
      const ids = shuffle([...room.members.keys()]);
      const roles = shuffle(roleList(ids.length));
      t.players = {};
      ids.forEach((id, i) => { t.players[id] = { name: room.members.get(id).name, role: roles[i], alive: true }; });
      t.order = ids;
      t.day = 0;
      t.seerResults = [];
      t.lastDoctor = null;
      t.winner = null;
      t.lastEvent = '';
      systemMessage(room, `🐺 ${room.members.get(socket.id).name} memulai Werewolf dengan ${ids.length} pemain! Cek peranmu di tab Game — rahasiakan ya!`);
      io.to(room.code).emit('ww:started');
      startNight(room);
    });

    socket.on('ww:stop', () => {
      const room = getRoom(); if (!room) return;
      const t = get(room);
      if (!active(t)) return;
      finish(room, null, `${room.members.get(socket.id).name} menghentikan permainan Werewolf.`);
    });

    socket.on('ww:act', (target) => {
      const room = getRoom(); if (!room) return;
      const t = get(room);
      const me = t.players[socket.id];
      const tp = t.players[target];
      if (t.phase !== 'night' || !me?.alive || !tp?.alive) return;

      if (me.role === 'werewolf') {
        if (tp.role === 'werewolf') return;
        t.night.wolf[socket.id] = target;
      } else if (me.role === 'seer') {
        if (t.night.seer || target === socket.id) return; // sekali per malam
        t.night.seer = target;
        t.seerResults.push({ day: t.day, id: target, isWolf: tp.role === 'werewolf' });
      } else if (me.role === 'doctor') {
        if (target === t.lastDoctor) return; // tidak boleh melindungi orang yang sama 2 malam berturut-turut
        t.night.doctor = target;
      } else return;

      emit(room);
      if (nightDone(t)) {
        clearTimers(t);
        after(t, 2000, () => resolveNight(room));
      }
    });

    socket.on('ww:vote', (target) => {
      const room = getRoom(); if (!room) return;
      const t = get(room);
      if (t.phase !== 'day' || !t.players[socket.id]?.alive) return;
      if (target !== 'skip' && !t.players[target]?.alive) return;
      t.votes[socket.id] = target;
      emit(room);
      if (alive(t).every((id) => t.votes[id])) {
        clearTimers(t);
        after(t, 3000, () => resolveDay(room));
      }
    });
  }

  // Penonton yang baru masuk tetap bisa melihat jalannya permainan
  function onJoin(room, id) {
    const t = states.get(room.code);
    if (t) io.to(id).emit('ww:state', view(room, id));
  }

  function onLeave(room, id) {
    const t = states.get(room.code);
    if (!t || !active(t) || !t.players[id]?.alive) return;
    const p = t.players[id];
    p.alive = false;
    p.left = true;
    delete t.votes[id];
    if (t.night) delete t.night.wolf[id];
    systemMessage(room, `🚪 ${p.name} keluar dari permainan. Dia adalah ${roleName(p.role)}.`);
    if (checkWin(room)) return;
    if (t.phase === 'night' && nightDone(t)) resolveNight(room);
    else if (t.phase === 'day' && alive(t).every((pid) => t.votes[pid])) resolveDay(room);
    else emit(room);
  }

  function remove(room) {
    const t = states.get(room.code);
    if (t) clearTimers(t);
    states.delete(room.code);
  }

  return { register, onJoin, onLeave, remove, view };
}

module.exports = { createWerewolf };
