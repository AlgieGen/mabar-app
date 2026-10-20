const fs = require('fs');
// Baca pengaturan dari file .env kalau ada (Node 20.12+)
try { process.loadEnvFile(); } catch {}
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { createTebak } = require('./tebak');
const ice = require('./ice');
const { createWerewolf } = require('./werewolf');
const { Chess } = require('chess.js');

const app = express();
const server = http.createServer(app);
// Gambar dikirim sebagai dataURL, jadi batas ukuran pesan dinaikkan.
// ALLOWED_ORIGINS: daftar domain tampilan (mis. https://mabar-app.vercel.app), dipisah koma. Kosong = semua boleh.
const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()) : '*';
const io = new Server(server, { maxHttpBufferSize: 8e6, cors: { origin: allowedOrigins } });

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'rooms.json');
const ROOM_TTL = 3 * 24 * 60 * 60 * 1000; // room kosong dihapus setelah 3 hari tidak aktif
const rooms = new Map();
let nextId = 1;
const uid = () => (nextId++).toString(36) + Date.now().toString(36);

const DEFAULT_FILTERS = { brightness: 100, contrast: 100, saturate: 100, grayscale: 0, sepia: 0, hue: 0, blur: 0 };

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function createRoom(name) {
  const code = makeCode();
  const room = {
    code,
    name: (name || '').trim().slice(0, 40) || `Room ${code}`,
    members: new Map(),
    chat: [],
    plan: { tasks: [], notes: '' },
    photo: { image: null, strokes: [], filters: { ...DEFAULT_FILTERS } },
    game: null,
    lastActive: Date.now(),
  };
  rooms.set(code, room);
  return room;
}

// ---------- Simpan & muat data room ----------
let dirty = false;

function loadRooms() {
  try {
    const list = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    for (const r of list) {
      if (Date.now() - r.lastActive > ROOM_TTL) continue;
      rooms.set(r.code, { ...r, members: new Map() });
    }
    console.log(`Memuat ${rooms.size} room dari ${DATA_FILE}`);
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('Gagal memuat data room:', err.message);
  }
}

function saveRooms() {
  if (!dirty) return;
  dirty = false;
  const list = [...rooms.values()].map((r) => ({
    code: r.code, name: r.name, chat: r.chat, plan: r.plan, photo: r.photo, lastActive: r.lastActive,
    // ID pemain berubah setiap koneksi, jadi kursi dikosongkan
    game: r.game && { ...r.game, players: [null, null] },
  }));
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE + '.tmp', JSON.stringify(list));
  fs.renameSync(DATA_FILE + '.tmp', DATA_FILE);
}

function cleanupRooms() {
  for (const r of rooms.values()) {
    if (r.members.size === 0 && Date.now() - r.lastActive > ROOM_TTL) {
      tebak.remove(r);
      werewolf.remove(r);
      rooms.delete(r.code);
      dirty = true;
    }
  }
}

loadRooms();
setInterval(saveRooms, 10 * 1000);
setInterval(cleanupRooms, 60 * 60 * 1000);
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { dirty = true; saveRooms(); process.exit(0); });
}

const membersList = (room) => [...room.members.entries()].map(([id, m]) => ({ id, ...m }));
const clean = (s, max) => String(s ?? '').trim().slice(0, max);

function systemMessage(room, text) {
  const msg = { id: uid(), system: true, text, ts: Date.now() };
  room.chat.push(msg);
  if (room.chat.length > 100) room.chat.shift();
  io.to(room.code).emit('chat:msg', msg);
}

// ---------- Game ----------
const GAMES = {
  ttt: { rows: 3, cols: 3, win: 3 },
  c4: { rows: 6, cols: 7, win: 4 },
};

// ---------- Catur ----------
const DRAW_REASONS = [
  ['isStalemate', 'Pat (stalemate)'],
  ['isInsufficientMaterial', 'Bidak tidak cukup untuk skakmat'],
  ['isThreefoldRepetition', 'Posisi berulang 3 kali'],
  ['isDraw', 'Aturan 50 langkah'],
];

function loadChess(g) {
  const c = new Chess();
  if (g.pgn) c.loadPgn(g.pgn);
  return c;
}

// Salin posisi papan dari objek Chess ke state yang dikirim ke klien
function syncChess(g, c) {
  g.pgn = c.pgn();
  g.fen = c.fen();
  g.turn = c.turn() === 'w' ? 0 : 1;
  g.check = c.inCheck();
  g.history = c.history();
  g.moves = c.moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion || ''));
  return g;
}

function newChess(players) {
  return syncChess({ type: 'chess', players, winner: null, draw: false, reason: '', lastMove: null }, new Chess());
}

function chessMove(g, { from, to, promotion } = {}) {
  const c = loadChess(g);
  let m;
  try { m = c.move({ from, to, promotion: promotion || 'q' }); } catch { return false; }
  const mover = g.turn;
  g.lastMove = [m.from, m.to];
  if (c.isCheckmate()) { g.winner = mover; g.reason = 'Skakmat'; }
  else {
    const draw = DRAW_REASONS.find(([fn]) => c[fn]());
    if (draw) { g.draw = true; g.reason = draw[1]; }
  }
  syncChess(g, c);
  return true;
}

function newGame(type, players = [null, null]) {
  if (type === 'chess') return newChess(players);
  const g = GAMES[type];
  return { type, rows: g.rows, cols: g.cols, board: Array(g.rows * g.cols).fill(null), players, turn: 0, winner: null, line: null, draw: false };
}

function checkWinner(game, idx) {
  const { rows, cols, board } = game;
  const need = GAMES[game.type].win;
  const r0 = Math.floor(idx / cols), c0 = idx % cols, p = board[idx];
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    const line = [idx];
    for (const s of [1, -1]) {
      let r = r0 + dr * s, c = c0 + dc * s;
      while (r >= 0 && r < rows && c >= 0 && c < cols && board[r * cols + c] === p) {
        line.push(r * cols + c);
        r += dr * s; c += dc * s;
      }
    }
    if (line.length >= need) return line;
  }
  return null;
}

const tebak = createTebak(io, systemMessage);
const werewolf = createWerewolf(io, systemMessage);

io.on('connection', (socket) => {
  const room = () => rooms.get(socket.data.code);

  // Setiap event dianggap mengubah data: tandai untuk disimpan
  socket.onAny(() => {
    dirty = true;
    const r = room();
    if (r) r.lastActive = Date.now();
  });
  tebak.register(socket, room);
  werewolf.register(socket, room);

  // ---------- Room ----------
  socket.on('room:create', ({ roomName } = {}, cb) => {
    const r = createRoom(roomName);
    cb?.({ code: r.code });
  });

  socket.on('room:join', ({ code, userName } = {}, cb) => {
    const r = rooms.get(clean(code, 10).toUpperCase());
    if (!r) return cb?.({ error: 'Room tidak ditemukan. Cek lagi kodenya.' });
    if (socket.data.code) return cb?.({ error: 'Sudah berada di room.' });
    const name = clean(userName, 24) || 'Tamu';
    socket.data.code = r.code;
    socket.join(r.code);
    r.members.set(socket.id, { name, inVoice: false, muted: false });
    cb?.({
      ok: true,
      me: socket.id,
      room: { code: r.code, name: r.name, chat: r.chat, plan: r.plan, photo: r.photo, game: r.game, tebak: tebak.publicState(r), members: membersList(r) },
    });
    tebak.onJoin(r, socket.id, name);
    werewolf.onJoin(r, socket.id);
    io.to(r.code).emit('members', membersList(r));
    systemMessage(r, `${name} bergabung ke room`);
  });

  // ---------- Chat ----------
  socket.on('chat:send', (text) => {
    const r = room(); if (!r) return;
    text = clean(text, 500); if (!text) return;
    if (tebak.handleChat(r, socket, text)) return;
    const msg = { id: uid(), from: socket.id, name: r.members.get(socket.id).name, text, ts: Date.now() };
    r.chat.push(msg);
    if (r.chat.length > 100) r.chat.shift();
    io.to(r.code).emit('chat:msg', msg);
  });

  // ---------- Planning ----------
  const emitPlan = (r) => io.to(r.code).emit('plan:tasks', r.plan.tasks);

  socket.on('plan:add', ({ text, date, assignee } = {}) => {
    const r = room(); if (!r) return;
    text = clean(text, 200); if (!text) return;
    r.plan.tasks.push({ id: uid(), text, date: clean(date, 20), assignee: clean(assignee, 24), done: false, by: r.members.get(socket.id).name });
    emitPlan(r);
  });
  socket.on('plan:toggle', (id) => {
    const r = room(); if (!r) return;
    const t = r.plan.tasks.find((t) => t.id === id);
    if (t) { t.done = !t.done; emitPlan(r); }
  });
  socket.on('plan:delete', (id) => {
    const r = room(); if (!r) return;
    r.plan.tasks = r.plan.tasks.filter((t) => t.id !== id);
    emitPlan(r);
  });
  socket.on('plan:notes', (text) => {
    const r = room(); if (!r) return;
    r.plan.notes = String(text ?? '').slice(0, 20000);
    socket.to(r.code).emit('plan:notes', r.plan.notes);
  });

  // ---------- Edit foto ----------
  socket.on('photo:image', (dataUrl) => {
    const r = room(); if (!r) return;
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return;
    r.photo = { image: dataUrl, strokes: [], filters: { ...DEFAULT_FILTERS } };
    io.to(r.code).emit('photo:state', r.photo);
    systemMessage(r, `${r.members.get(socket.id).name} mengunggah foto baru`);
  });
  socket.on('photo:stroke', (stroke) => {
    const r = room(); if (!r || !stroke) return;
    stroke.id = uid();
    stroke.by = socket.id;
    r.photo.strokes.push(stroke);
    if (r.photo.strokes.length > 2000) r.photo.strokes.shift();
    socket.to(r.code).emit('photo:stroke', stroke);
  });
  // Potongan goresan selagi digambar, supaya teman melihatnya secara realtime
  socket.on('photo:seg', (seg) => {
    const r = room(); if (!r || !seg) return;
    socket.to(r.code).volatile.emit('photo:seg', seg);
  });
  socket.on('photo:undo', () => {
    const r = room(); if (!r) return;
    for (let i = r.photo.strokes.length - 1; i >= 0; i--) {
      if (r.photo.strokes[i].by === socket.id) { r.photo.strokes.splice(i, 1); break; }
    }
    io.to(r.code).emit('photo:strokes', r.photo.strokes);
  });
  socket.on('photo:clear', () => {
    const r = room(); if (!r) return;
    r.photo.strokes = [];
    io.to(r.code).emit('photo:strokes', r.photo.strokes);
  });
  socket.on('photo:filters', (filters) => {
    const r = room(); if (!r || typeof filters !== 'object') return;
    for (const k of Object.keys(DEFAULT_FILTERS)) {
      if (typeof filters[k] === 'number') r.photo.filters[k] = filters[k];
    }
    socket.to(r.code).emit('photo:filters', r.photo.filters);
  });

  // ---------- Game ----------
  const emitGame = (r) => io.to(r.code).emit('game:state', r.game);

  socket.on('game:new', (type) => {
    const r = room(); if (!r || !(GAMES[type] || type === 'chess')) return;
    const players = r.game ? r.game.players : [null, null];
    r.game = newGame(type, players);
    emitGame(r);
  });
  socket.on('game:sit', (seat) => {
    const r = room(); if (!r?.game || ![0, 1].includes(seat)) return;
    if (r.game.players[seat] || r.game.players.includes(socket.id)) return;
    r.game.players[seat] = socket.id;
    emitGame(r);
  });
  socket.on('game:stand', () => {
    const r = room(); if (!r?.game) return;
    r.game.players = r.game.players.map((p) => (p === socket.id ? null : p));
    emitGame(r);
  });
  socket.on('game:move', (index) => {
    const r = room(); const g = r?.game; if (!g || g.winner !== null || g.draw) return;
    if (g.players[g.turn] !== socket.id || !g.players.every(Boolean)) return;
    if (g.type === 'chess') {
      if (chessMove(g, index)) emitGame(r);
      return;
    }
    let idx = index;
    if (g.type === 'c4') {
      // index = kolom; bidak jatuh ke baris kosong paling bawah
      const col = index;
      if (col < 0 || col >= g.cols) return;
      idx = -1;
      for (let row = g.rows - 1; row >= 0; row--) {
        if (g.board[row * g.cols + col] === null) { idx = row * g.cols + col; break; }
      }
      if (idx === -1) return;
    }
    if (idx < 0 || idx >= g.board.length || g.board[idx] !== null) return;
    g.board[idx] = g.turn;
    const line = checkWinner(g, idx);
    if (line) { g.winner = g.turn; g.line = line; }
    else if (g.board.every((c) => c !== null)) g.draw = true;
    else g.turn = 1 - g.turn;
    emitGame(r);
  });
  socket.on('game:resign', () => {
    const r = room(); const g = r?.game; if (!g || g.winner !== null || g.draw) return;
    const seat = g.players.indexOf(socket.id);
    if (seat === -1 || !g.players.every(Boolean)) return;
    g.winner = 1 - seat;
    g.reason = 'Lawan menyerah';
    emitGame(r);
    systemMessage(r, `🏳️ ${r.members.get(socket.id).name} menyerah`);
  });
  socket.on('game:reset', () => {
    const r = room(); if (!r?.game) return;
    if (r.game.type === 'chess') {
      // Tukar warna setiap permainan baru
      r.game = newChess([r.game.players[1], r.game.players[0]]);
      emitGame(r);
      return;
    }
    const starter = r.game.winner === null ? 0 : 1 - r.game.winner; // yang kalah jalan duluan
    r.game = newGame(r.game.type, r.game.players);
    r.game.turn = starter;
    emitGame(r);
  });

  // ---------- Voice (signaling WebRTC) ----------
  socket.on('voice:ice', async (_, cb) => cb?.(await ice.getIceServers()));
  socket.on('voice:join', (_, cb) => {
    const r = room(); if (!r) return;
    const others = membersList(r).filter((m) => m.inVoice && m.id !== socket.id).map((m) => m.id);
    r.members.get(socket.id).inVoice = true;
    cb?.(others);
    io.to(r.code).emit('members', membersList(r));
  });
  const leaveVoice = (r) => {
    const m = r.members.get(socket.id);
    if (!m?.inVoice) return;
    m.inVoice = false;
    m.muted = false;
    socket.to(r.code).emit('voice:peer-left', socket.id);
  };
  socket.on('voice:leave', () => {
    const r = room(); if (!r) return;
    leaveVoice(r);
    io.to(r.code).emit('members', membersList(r));
  });
  socket.on('voice:mute', (muted) => {
    const r = room(); if (!r) return;
    r.members.get(socket.id).muted = !!muted;
    io.to(r.code).emit('members', membersList(r));
  });
  socket.on('voice:signal', ({ to, data } = {}) => {
    const r = room(); if (!r || !r.members.has(to)) return;
    io.to(to).emit('voice:signal', { from: socket.id, data });
  });

  // ---------- Keluar ----------
  socket.on('disconnect', () => {
    const r = room(); if (!r) return;
    const m = r.members.get(socket.id);
    leaveVoice(r);
    r.members.delete(socket.id);
    if (r.game) {
      r.game.players = r.game.players.map((p) => (p === socket.id ? null : p));
      emitGame(r);
    }
    tebak.onLeave(r, socket.id);
    werewolf.onLeave(r, socket.id);
    if (r.members.size === 0) return;
    io.to(r.code).emit('members', membersList(r));
    systemMessage(r, `${m.name} keluar dari room`);
  });
});

server.listen(PORT, () => {
  console.log(`MabarRoom berjalan di http://localhost:${PORT}`);
  console.log(`Voice: ${ice.describe()}`);
});
