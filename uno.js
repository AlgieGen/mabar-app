// Game UNO: habiskan kartu di tangan lebih dulu. Kartu setiap pemain hanya dikirim ke pemiliknya.

const TURN_MS = 40 * 1000;
const COLORS = ['red', 'yellow', 'green', 'blue'];
const COLOR_NAME = { red: 'merah', yellow: 'kuning', green: 'hijau', blue: 'biru' };
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 10;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 108 kartu standar
function makeDeck() {
  const deck = [];
  let id = 0;
  for (const color of COLORS) {
    deck.push({ id: id++, color, value: '0' });
    for (const value of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'skip', 'reverse', 'draw2']) {
      deck.push({ id: id++, color, value }, { id: id++, color, value });
    }
  }
  for (let i = 0; i < 4; i++) deck.push({ id: id++, color: null, value: 'wild' }, { id: id++, color: null, value: 'wild4' });
  return shuffle(deck);
}

const CARD_TEXT = { skip: 'Skip', reverse: 'Balik Arah', draw2: '+2', wild: 'Ganti Warna', wild4: '+4' };
const cardText = (c) => (c.color ? `${CARD_TEXT[c.value] || c.value} ${COLOR_NAME[c.color]}` : CARD_TEXT[c.value]);

function createUno(io, systemMessage, hooks) {
  const states = new Map();

  function get(room) {
    if (!states.has(room.code)) {
      states.set(room.code, { phase: 'idle', order: [], names: {}, hands: {}, draw: [], discard: [], color: null, turn: 0, dir: 1, drawn: null, uno: new Set(), vulnerable: null, winner: null, lastAction: '', endsAt: 0, timers: [] });
    }
    return states.get(room.code);
  }

  const top = (t) => t.discard[t.discard.length - 1];
  const current = (t) => t.order[t.turn];
  const clearTimers = (t) => { t.timers.forEach(clearTimeout); t.timers = []; };
  const playable = (t, c) => !c.color || c.color === t.color || c.value === top(t).value;

  function view(room, id) {
    const t = get(room);
    return {
      phase: t.phase,
      players: t.order.map((pid) => ({ id: pid, name: t.names[pid], count: t.hands[pid].length, uno: t.uno.has(pid) })),
      hand: t.hands[id] || null,
      top: t.discard.length ? top(t) : null,
      color: t.color,
      turn: t.phase === 'playing' ? current(t) : null,
      dir: t.dir,
      drawCount: t.draw.length,
      drawn: current(t) === id ? t.drawn : null,
      vulnerable: t.vulnerable,
      winner: t.winner,
      lastAction: t.lastAction,
      remaining: t.phase === 'playing' ? Math.max(0, t.endsAt - Date.now()) : 0,
    };
  }

  function emit(room) {
    for (const id of room.members.keys()) io.to(id).emit('uno:state', view(room, id));
  }

  function drawCards(t, id, n) {
    const got = [];
    for (let i = 0; i < n; i++) {
      if (!t.draw.length) {
        // Kocok ulang tumpukan buangan (kecuali kartu teratas) menjadi tumpukan ambil
        const keep = t.discard.pop();
        t.draw = shuffle(t.discard);
        t.discard = [keep];
        if (!t.draw.length) break;
      }
      const card = t.draw.pop();
      t.hands[id].push(card);
      got.push(card);
    }
    if (t.hands[id].length > 1) t.uno.delete(id);
    return got;
  }

  const step = (t, n = 1) => { t.turn = (((t.turn + t.dir * n) % t.order.length) + t.order.length) % t.order.length; };

  function startTurn(room) {
    const t = get(room);
    clearTimers(t);
    t.drawn = null;
    t.endsAt = Date.now() + TURN_MS;
    t.timers.push(setTimeout(() => autoPlay(room), TURN_MS));
    emit(room);
  }

  // Waktu habis: ambil satu kartu (kalau belum) lalu lewati giliran
  function autoPlay(room) {
    const t = get(room);
    if (t.phase !== 'playing') return;
    const id = current(t);
    if (t.drawn === null) drawCards(t, id, 1);
    t.lastAction = `⏰ Waktu ${t.names[id]} habis, giliran dilewati.`;
    step(t);
    startTurn(room);
  }

  function finish(room, winner, reason) {
    const t = get(room);
    clearTimers(t);
    t.phase = 'over';
    t.winner = winner;
    t.lastAction = reason || `🏆 ${t.names[winner]} menang UNO!`;
    systemMessage(room, t.lastAction);
    emit(room);
    if (!reason && winner) hooks?.gameOver(room, 'uno', t.order.map((sid) => ({ sid, outcome: sid === winner ? 'win' : 'lose' })));
  }

  function register(socket, getRoom) {
    const tell = (text) => socket.emit('chat:msg', { id: 'uno' + Date.now(), system: true, text, ts: Date.now() });
    // Siapa pun yang bertindak menutup kesempatan menangkap pemain yang lupa UNO (kecuali dirinya)
    const closeCatch = (t) => { if (t.vulnerable && t.vulnerable !== socket.id) t.vulnerable = null; };

    socket.on('uno:start', () => {
      const room = getRoom(); if (!room) return;
      const t = get(room);
      if (t.phase === 'playing') return;
      const ids = shuffle([...room.members.keys()]).slice(0, MAX_PLAYERS);
      if (ids.length < MIN_PLAYERS) return tell('UNO butuh minimal 2 orang.');
      Object.assign(t, { phase: 'playing', order: ids, names: {}, hands: {}, draw: makeDeck(), discard: [], dir: 1, turn: 0, uno: new Set(), vulnerable: null, winner: null });
      for (const id of ids) { t.names[id] = room.members.get(id).name; t.hands[id] = []; drawCards(t, id, 7); }
      // Kartu pertama harus kartu angka
      let first;
      do { first = t.draw.pop(); if (!/^\d$/.test(first.value)) t.draw.unshift(first); } while (!/^\d$/.test(first.value));
      t.discard = [first];
      t.color = first.color;
      t.lastAction = `🃏 Permainan dimulai! ${t.names[ids[0]]} jalan duluan.`;
      systemMessage(room, `🃏 ${room.members.get(socket.id).name} memulai UNO dengan ${ids.length} pemain!`);
      io.to(room.code).emit('uno:started');
      startTurn(room);
    });

    socket.on('uno:stop', () => {
      const room = getRoom(); if (!room) return;
      const t = get(room);
      if (t.phase !== 'playing') return;
      finish(room, null, `${room.members.get(socket.id).name} menghentikan UNO.`);
    });

    socket.on('uno:play', ({ cardId, color } = {}) => {
      const room = getRoom(); if (!room) return;
      const t = get(room);
      if (t.phase !== 'playing' || current(t) !== socket.id) return;
      const hand = t.hands[socket.id];
      const idx = hand.findIndex((c) => c.id === cardId);
      if (idx === -1) return;
      const card = hand[idx];
      if (t.drawn !== null && card.id !== t.drawn) return; // setelah ambil kartu, hanya kartu itu yang boleh dimainkan
      if (!playable(t, card)) return;
      if (!card.color && !COLORS.includes(color)) return;
      closeCatch(t);

      hand.splice(idx, 1);
      t.discard.push(card);
      t.color = card.color || color;
      const name = t.names[socket.id];
      let action = `${name} memainkan ${cardText(card)}${card.color ? '' : ` → ${COLOR_NAME[color]}`}`;

      if (hand.length === 0) {
        t.lastAction = action;
        return finish(room, socket.id);
      }
      if (hand.length === 1 && !t.uno.has(socket.id)) t.vulnerable = socket.id;

      const n = t.order.length;
      if (card.value === 'reverse') {
        t.dir *= -1;
        step(t, n === 2 ? 2 : 1); // berdua: balik arah = skip
      } else if (card.value === 'skip') {
        step(t, 2);
      } else if (card.value === 'draw2' || card.value === 'wild4') {
        step(t);
        const k = card.value === 'draw2' ? 2 : 4;
        drawCards(t, current(t), k);
        action += ` — ${t.names[current(t)]} ambil ${k} kartu & dilewati`;
        step(t);
      } else {
        step(t);
      }
      t.lastAction = action;
      startTurn(room);
    });

    socket.on('uno:draw', () => {
      const room = getRoom(); if (!room) return;
      const t = get(room);
      if (t.phase !== 'playing' || current(t) !== socket.id || t.drawn !== null) return;
      closeCatch(t);
      const [card] = drawCards(t, socket.id, 1);
      if (card && playable(t, card)) {
        // Kartu yang baru diambil bisa langsung dimainkan, atau lewati giliran
        t.drawn = card.id;
        t.lastAction = `${t.names[socket.id]} mengambil 1 kartu.`;
        emit(room);
      } else {
        t.lastAction = `${t.names[socket.id]} mengambil 1 kartu dan melewati giliran.`;
        step(t);
        startTurn(room);
      }
    });

    socket.on('uno:pass', () => {
      const room = getRoom(); if (!room) return;
      const t = get(room);
      if (t.phase !== 'playing' || current(t) !== socket.id || t.drawn === null) return;
      t.lastAction = `${t.names[socket.id]} melewati giliran.`;
      step(t);
      startTurn(room);
    });

    socket.on('uno:call', () => {
      const room = getRoom(); if (!room) return;
      const t = get(room);
      if (t.phase !== 'playing' || !t.hands[socket.id] || t.hands[socket.id].length > 2 || t.uno.has(socket.id)) return;
      t.uno.add(socket.id);
      if (t.vulnerable === socket.id) t.vulnerable = null;
      t.lastAction = `📣 ${t.names[socket.id]} berteriak UNO!`;
      emit(room);
    });

    socket.on('uno:catch', () => {
      const room = getRoom(); if (!room) return;
      const t = get(room);
      const v = t.vulnerable;
      if (t.phase !== 'playing' || !v || v === socket.id || !t.hands[socket.id]) return;
      drawCards(t, v, 2);
      t.vulnerable = null;
      t.lastAction = `🚨 ${t.names[socket.id]} menangkap ${t.names[v]} yang lupa bilang UNO! (+2 kartu)`;
      emit(room);
    });
  }

  function onJoin(room, id) {
    const t = states.get(room.code);
    if (t) io.to(id).emit('uno:state', view(room, id));
  }

  function onLeave(room, id) {
    const t = states.get(room.code);
    if (!t || t.phase !== 'playing' || !t.hands[id]) return;
    const idx = t.order.indexOf(id);
    const wasTurn = idx === t.turn;
    t.draw.unshift(...t.hands[id]);
    delete t.hands[id];
    t.order.splice(idx, 1);
    t.uno.delete(id);
    if (t.vulnerable === id) t.vulnerable = null;
    systemMessage(room, `🚪 ${t.names[id]} keluar dari UNO.`);
    if (t.order.length < MIN_PLAYERS) return finish(room, t.order[0], `🏆 ${t.names[t.order[0]]} menang UNO karena pemain lain keluar.`);
    const len = t.order.length;
    if (wasTurn) {
      // Giliran pindah ke pemain berikutnya sesuai arah permainan
      t.turn = t.dir === 1 ? idx % len : (idx - 1 + len) % len;
      startTurn(room);
    } else {
      if (idx < t.turn) t.turn--;
      emit(room);
    }
  }

  function remove(room) {
    const t = states.get(room.code);
    if (t) clearTimers(t);
    states.delete(room.code);
  }

  return { register, onJoin, onLeave, remove };
}

module.exports = { createUno };
