// Game Werewolf: warga harus menemukan werewolf sebelum werewolf menghabisi warga.
// Setiap pemain menerima tampilan berbeda (peran dirahasiakan), jadi state dikirim per orang.

const NIGHT_MS = 60 * 1000;
const DAY_MS = 150 * 1000;
const DUSK_MS = 6 * 1000;
const HUNTER_MS = 30 * 1000;
const MIN_PLAYERS = 4;

const ROLES = {
  werewolf: { name: 'Werewolf', icon: '🐺', team: 'wolf' },
  minion: { name: 'Pengkhianat', icon: '🕵️', team: 'wolf' },
  seer: { name: 'Peramal', icon: '🔮', team: 'village' },
  doctor: { name: 'Dokter', icon: '💉', team: 'village' },
  witch: { name: 'Penyihir', icon: '🧪', team: 'village' },
  hunter: { name: 'Pemburu', icon: '🏹', team: 'village' },
  cupid: { name: 'Kupid', icon: '💘', team: 'village' },
  elder: { name: 'Tetua', icon: '👴', team: 'village' },
  mayor: { name: 'Kepala Desa', icon: '🎖️', team: 'village' },
  jester: { name: 'Badut', icon: '🤡', team: 'jester' },
  villager: { name: 'Warga', icon: '🧑‍🌾', team: 'village' },
};
// Peran khusus yang bisa dipilih, urut sesuai prioritas
const SPECIALS = ['seer', 'doctor', 'witch', 'hunter', 'cupid', 'elder', 'mayor', 'minion', 'jester'];
const DEFAULT_CONFIG = { wolves: 0, roles: { seer: true, doctor: true } }; // wolves 0 = otomatis

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const autoWolves = (n) => (n >= 12 ? 3 : n >= 8 ? 2 : 1);

// Susun daftar peran; mengembalikan { roles } atau { error }
function buildRoles(n, config) {
  const wolves = config.wolves || autoWolves(n);
  const specials = SPECIALS.filter((r) => config.roles[r]);
  if (wolves * 2 >= n) return { error: `Werewolf terlalu banyak untuk ${n} pemain.` };
  if (wolves + specials.length > n) {
    return { error: `Peran yang dipilih butuh minimal ${wolves + specials.length} pemain (sekarang ${n}). Kurangi peran khusus.` };
  }
  const roles = [...Array(wolves).fill('werewolf'), ...specials];
  while (roles.length < n) roles.push('villager');
  return { roles };
}

// Pilihan dengan suara terbanyak (bisa berbobot); kalau seri, tidak ada yang terpilih
function plurality(entries) {
  const count = {};
  for (const [target, weight = 1] of entries) count[target] = (count[target] || 0) + weight;
  const sorted = Object.entries(count).sort((a, b) => b[1] - a[1]);
  if (!sorted.length || (sorted[1] && sorted[1][1] === sorted[0][1])) return null;
  return sorted[0][0];
}

function createWerewolf(io, systemMessage) {
  const states = new Map();

  function get(room) {
    if (!states.has(room.code)) {
      states.set(room.code, {
        phase: 'idle', day: 0, players: {}, order: [], roles: [], config: structuredClone(DEFAULT_CONFIG),
        night: null, votes: {}, seerResults: [], lastDoctor: null, witch: null, lovers: null, elderHit: false,
        pendingHunters: [], hunter: null, afterHunter: null, lastEvent: '', winner: null, endsAt: 0, timers: [],
      });
    }
    return states.get(room.code);
  }

  const active = (t) => ['night', 'day', 'dusk', 'hunter'].includes(t.phase);
  const alive = (t) => t.order.filter((id) => t.players[id].alive);
  const aliveWith = (t, role) => alive(t).filter((id) => t.players[id].role === role);
  const clearTimers = (t) => { t.timers.forEach(clearTimeout); t.timers = []; };
  const roleName = (role) => `${ROLES[role].icon} ${ROLES[role].name}`;
  const name = (t, id) => t.players[id]?.name ?? '?';

  function view(room, id) {
    const t = get(room);
    const me = t.players[id];
    const role = me?.role;
    const over = t.phase === 'over';
    const knowsWolves = role === 'werewolf' || role === 'minion';
    const knowsLovers = over || role === 'cupid' || t.lovers?.includes(id);
    const night = t.phase === 'night';
    return {
      phase: t.phase,
      day: t.day,
      remaining: active(t) ? Math.max(0, t.endsAt - Date.now()) : 0,
      winner: t.winner,
      lastEvent: t.lastEvent,
      config: t.config,
      roles: t.roles,
      players: t.order.map((pid) => {
        const p = t.players[pid];
        const known = over || pid === id || !p.alive || (knowsWolves && p.role === 'werewolf');
        return {
          id: pid, name: p.name, alive: p.alive, left: !!p.left,
          role: known ? p.role : null,
          lover: knowsLovers && !!t.lovers?.includes(pid),
        };
      }),
      me: me ? { role, alive: me.alive } : null,
      myTarget: me && night ? (role === 'werewolf' ? t.night.wolf[id] : role === 'seer' || role === 'doctor' ? t.night[role] : null) ?? null : null,
      wolfVotes: role === 'werewolf' && night ? t.night.wolf : null,
      wolfTarget: role === 'witch' && night ? plurality(Object.values(t.night.wolf).map((x) => [x])) : null,
      witch: role === 'witch' ? { ...t.witch, night: night ? t.night.witch : null } : null,
      cupidPicks: role === 'cupid' && night ? t.night.cupid : null,
      seerResults: role === 'seer' ? t.seerResults : null,
      lastDoctor: role === 'doctor' ? t.lastDoctor : null,
      votes: t.phase === 'day' ? t.votes : null,
      tally: t.phase === 'day' ? voteTally(t) : null,
      hunter: t.phase === 'hunter' ? t.hunter : null,
    };
  }

  // Jumlah suara per target; suara Kepala Desa dihitung 2
  function voteTally(t) {
    const tally = {};
    for (const [voter, target] of Object.entries(t.votes)) tally[target] = (tally[target] || 0) + (t.players[voter].role === 'mayor' ? 2 : 1);
    return tally;
  }

  function emit(room) {
    for (const id of room.members.keys()) io.to(id).emit('ww:state', view(room, id));
  }

  function after(t, ms, fn) {
    t.endsAt = Date.now() + ms;
    t.timers.push(setTimeout(fn, ms));
  }

  // ---------- Kematian ----------
  const DEATH_TEXT = {
    wolf: (n, r) => `${n} ditemukan tewas diterkam werewolf! Ternyata dia ${r}.`,
    poison: (n, r) => `${n} tewas karena racun misterius 🧪. Ternyata dia ${r}.`,
    heartbreak: (n, r) => `${n} meninggal karena patah hati 💔. Ternyata dia ${r}.`,
    lynch: (n, r) => `⚖️ Warga sepakat mengeksekusi ${n}. Ternyata dia ${r}!`,
    hunter: (n, r) => `🏹 Pemburu menembak ${n}! Ternyata dia ${r}.`,
  };

  // Matikan pemain, termasuk efek berantai (pasangan Kupid, tembakan Pemburu)
  function kill(t, id, cause, messages) {
    const p = t.players[id];
    if (!p?.alive) return;
    p.alive = false;
    messages.push(DEATH_TEXT[cause](p.name, roleName(p.role)));
    if (p.role === 'hunter' && !p.left) t.pendingHunters.push(id);
    if (t.lovers?.includes(id)) kill(t, t.lovers.find((x) => x !== id), 'heartbreak', messages);
  }

  // Setelah ada kematian: beri giliran Pemburu dulu, lalu cek pemenang, lalu lanjut fase berikutnya
  function proceed(room, next) {
    const t = get(room);
    if (t.pendingHunters.length) {
      t.hunter = t.pendingHunters.shift();
      t.phase = 'hunter';
      t.afterHunter = next;
      systemMessage(room, `🏹 ${name(t, t.hunter)} adalah Pemburu! Dia boleh menembak satu orang sebelum pergi...`);
      after(t, HUNTER_MS, () => hunterShoot(room, null));
      emit(room);
      return;
    }
    if (checkWin(room)) return;
    if (next === 'day') startDay(room);
    else startDusk(room);
  }

  function hunterShoot(room, target) {
    const t = get(room);
    if (t.phase !== 'hunter') return;
    clearTimers(t);
    const messages = [];
    if (target && t.players[target]?.alive) kill(t, target, 'hunter', messages);
    else messages.push(`🏹 ${name(t, t.hunter)} tidak menembak siapa pun.`);
    t.hunter = null;
    t.lastEvent = messages.join(' ');
    messages.forEach((m) => systemMessage(room, m));
    proceed(room, t.afterHunter);
  }

  // ---------- Alur permainan ----------
  function startNight(room) {
    const t = get(room);
    clearTimers(t);
    t.day++;
    t.phase = 'night';
    t.night = { wolf: {}, seer: null, doctor: null, witch: { heal: false, poison: null, done: false }, cupid: [] };
    systemMessage(room, `🌙 Malam ke-${t.day}. Semua warga tidur... yang punya kemampuan, beraksilah diam-diam.`);
    after(t, NIGHT_MS, () => resolveNight(room));
    emit(room);
  }

  function nightDone(t) {
    const n = t.night;
    const has = (role) => aliveWith(t, role).length > 0;
    return aliveWith(t, 'werewolf').every((id) => n.wolf[id])
      && (!has('seer') || n.seer)
      && (!has('doctor') || n.doctor)
      && (!has('witch') || n.witch.done || (!t.witch.heal && !t.witch.poison))
      && (!has('cupid') || t.day !== 1 || n.cupid.length === 2);
  }

  function resolveNight(room) {
    const t = get(room);
    if (t.phase !== 'night') return;
    clearTimers(t);
    const n = t.night;

    // Kupid: kalau tidak memilih, pasangan tidak terbentuk
    if (t.day === 1 && n.cupid.length === 2) {
      t.lovers = [...n.cupid];
      for (const id of t.lovers) {
        io.to(id).emit('chat:msg', { id: 'ww' + Date.now() + id, system: true, ts: Date.now(),
          text: `💘 Kupid menjodohkanmu dengan ${name(t, t.lovers.find((x) => x !== id))}. Kalau dia mati, kamu ikut mati!` });
      }
    }

    const victim = plurality(Object.values(n.wolf).map((x) => [x]));
    let saved = false;
    if (victim) {
      if (victim === n.doctor) saved = true;
      if (n.witch.heal && t.witch.heal) { saved = true; t.witch.heal = false; }
      if (!saved && t.players[victim].role === 'elder' && !t.elderHit) { saved = true; t.elderHit = true; }
    }
    t.lastDoctor = n.doctor;

    const messages = [];
    if (victim && !saved) kill(t, victim, 'wolf', messages);
    if (n.witch.poison && t.witch.poison) { kill(t, n.witch.poison, 'poison', messages); t.witch.poison = false; }

    if (!messages.length) messages.push(victim ? 'Werewolf menyerang, tapi korbannya berhasil selamat! ✨' : 'Tidak ada yang tewas semalam. 🙏');
    t.lastEvent = '☀️ Pagi hari. ' + messages.join(' ');
    systemMessage(room, t.lastEvent);
    proceed(room, 'day');
  }

  function startDay(room) {
    const t = get(room);
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
    // Suara Kepala Desa dihitung 2
    const target = plurality(Object.entries(voteTally(t)));
    const messages = [];
    if (target && target !== 'skip') {
      kill(t, target, 'lynch', messages);
      if (t.players[target].role === 'jester') {
        t.lastEvent = messages.join(' ');
        messages.forEach((m) => systemMessage(room, m));
        return finish(room, 'jester');
      }
    } else {
      messages.push('⚖️ Warga tidak mencapai kesepakatan. Tidak ada yang dieksekusi hari ini.');
    }
    t.lastEvent = messages.join(' ');
    messages.forEach((m) => systemMessage(room, m));
    proceed(room, 'dusk');
  }

  function startDusk(room) {
    const t = get(room);
    t.phase = 'dusk';
    after(t, DUSK_MS, () => startNight(room));
    emit(room);
  }

  function checkWin(room) {
    const t = get(room);
    const living = alive(t);
    if (t.lovers && living.length === 2 && t.lovers.every((id) => living.includes(id))) {
      finish(room, 'lovers');
      return true;
    }
    const wolves = aliveWith(t, 'werewolf').length;
    if (wolves > 0 && wolves < living.length - wolves) return false;
    finish(room, wolves === 0 ? 'village' : 'wolf');
    return true;
  }

  function finish(room, winner, reason) {
    const t = get(room);
    clearTimers(t);
    t.phase = 'over';
    t.winner = winner;
    const list = (filter) => t.order.filter((id) => filter(t.players[id])).map((id) => t.players[id].name).join(', ');
    const wolves = list((p) => p.role === 'werewolf');
    const texts = {
      village: `🎉 Warga menang! Semua werewolf sudah tertangkap. Werewolf-nya: ${wolves}`,
      wolf: `🐺 Werewolf menang! Mereka menguasai desa. Werewolf-nya: ${wolves}`,
      jester: `🤡 Badut menang! ${list((p) => p.role === 'jester')} berhasil menipu warga supaya mengeksekusinya.`,
      lovers: `💘 Pasangan kekasih menang! ${t.lovers ? t.lovers.map((id) => name(t, id)).join(' & ') : ''} bertahan sampai akhir.`,
    };
    t.lastEvent = reason || texts[winner];
    systemMessage(room, t.lastEvent);
    emit(room);
  }

  // ---------- Event dari pemain ----------
  function register(socket, getRoom) {
    socket.on('ww:config', (config) => {
      const room = getRoom(); if (!room || !config) return;
      const t = get(room);
      if (active(t)) return;
      t.config = {
        wolves: [0, 1, 2, 3].includes(config.wolves) ? config.wolves : 0,
        roles: Object.fromEntries(SPECIALS.map((r) => [r, !!config.roles?.[r]])),
      };
      emit(room);
    });

    socket.on('ww:start', () => {
      const room = getRoom(); if (!room) return;
      const t = get(room);
      if (active(t)) return;
      const tell = (text) => socket.emit('chat:msg', { id: 'ww' + Date.now(), system: true, text, ts: Date.now() });
      if (room.members.size < MIN_PLAYERS) return tell(`Werewolf butuh minimal ${MIN_PLAYERS} orang di room.`);
      const ids = shuffle([...room.members.keys()]);
      const built = buildRoles(ids.length, t.config);
      if (built.error) return tell(built.error);

      const roles = shuffle(built.roles);
      t.players = {};
      ids.forEach((id, i) => { t.players[id] = { name: room.members.get(id).name, role: roles[i], alive: true }; });
      t.order = ids;
      t.roles = [...built.roles].sort((a, b) => Object.keys(ROLES).indexOf(a) - Object.keys(ROLES).indexOf(b));
      Object.assign(t, {
        day: 0, seerResults: [], lastDoctor: null, winner: null, lastEvent: '', lovers: null, elderHit: false,
        witch: { heal: true, poison: true }, pendingHunters: [], hunter: null,
      });
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

    socket.on('ww:act', ({ target, kind } = {}) => {
      const room = getRoom(); if (!room) return;
      const t = get(room);
      const me = t.players[socket.id];

      if (t.phase === 'hunter') {
        if (socket.id === t.hunter && (t.players[target]?.alive)) hunterShoot(room, target);
        return;
      }
      if (t.phase !== 'night' || !me?.alive) return;
      const n = t.night;
      const tp = t.players[target];

      switch (me.role) {
        case 'werewolf':
          if (!tp?.alive || tp.role === 'werewolf') return;
          n.wolf[socket.id] = target;
          break;
        case 'seer':
          if (n.seer || !tp?.alive || target === socket.id) return; // sekali per malam
          n.seer = target;
          t.seerResults.push({ day: t.day, id: target, isWolf: tp.role === 'werewolf' });
          break;
        case 'doctor':
          if (!tp?.alive || target === t.lastDoctor) return; // tidak boleh orang yang sama 2 malam berturut-turut
          n.doctor = target;
          break;
        case 'witch':
          if (n.witch.done) return;
          if (kind === 'heal' && t.witch.heal) n.witch.heal = !n.witch.heal;
          else if (kind === 'poison' && t.witch.poison && tp?.alive && target !== socket.id) n.witch.poison = n.witch.poison === target ? null : target;
          else if (kind === 'done') n.witch.done = true;
          else return;
          break;
        case 'cupid':
          if (t.day !== 1 || n.cupid.length >= 2 || !tp?.alive || n.cupid.includes(target)) return;
          n.cupid.push(target);
          break;
        default:
          return;
      }

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
    p.left = true;
    delete t.votes[id];
    if (t.night) delete t.night.wolf[id];
    const messages = [];
    kill(t, id, 'heartbreak', messages); // teks diganti di bawah; efek berantai (pasangan) tetap berlaku
    messages[0] = `🚪 ${p.name} keluar dari permainan. Dia adalah ${roleName(p.role)}.`;
    messages.forEach((m) => systemMessage(room, m));

    if (t.phase === 'hunter' && t.hunter === id) return hunterShoot(room, null);
    if (t.phase === 'night') {
      if (checkWin(room)) return;
      if (nightDone(t)) resolveNight(room); else emit(room);
    } else if (t.phase === 'day') {
      if (checkWin(room)) return;
      if (alive(t).every((pid) => t.votes[pid])) resolveDay(room); else emit(room);
    } else if (t.phase !== 'hunter') {
      if (!checkWin(room)) emit(room);
    } else emit(room);
  }

  function remove(room) {
    const t = states.get(room.code);
    if (t) clearTimers(t);
    states.delete(room.code);
  }

  return { register, onJoin, onLeave, remove, view };
}

module.exports = { createWerewolf, buildRoles, ROLES, SPECIALS };
