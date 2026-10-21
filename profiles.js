// Profil pemain: avatar, XP/level, poin, lencana, toko, dan papan peringkat.
// Identitas memakai token rahasia yang disimpan di browser (tanpa password).
// Token juga berfungsi sebagai "kode akun" untuk masuk dari perangkat lain.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const FILE = process.env.PROFILES_FILE || path.join(__dirname, 'data', 'profiles.json');

const REWARD = {
  win: { xp: 40, points: 25 },
  draw: { xp: 25, points: 12 },
  lose: { xp: 15, points: 5 },
};
const LEVEL_BONUS = 50; // poin tambahan setiap naik level

// XP total yang dibutuhkan untuk mencapai level L: 0, 100, 300, 600, 1000, ...
const xpForLevel = (l) => 50 * (l - 1) * l;
function levelFromXp(xp) {
  let l = 1;
  while (xp >= xpForLevel(l + 1)) l++;
  return l;
}

// ---------- Katalog toko ----------
const CATALOG = [
  // Bingkai avatar
  { id: 'border:none', slot: 'border', name: 'Tanpa Bingkai', price: 0 },
  { id: 'border:bronze', slot: 'border', name: 'Perunggu', price: 50 },
  { id: 'border:silver', slot: 'border', name: 'Perak', price: 120 },
  { id: 'border:gold', slot: 'border', name: 'Emas', price: 250 },
  { id: 'border:neon', slot: 'border', name: 'Neon Berkedip', price: 400 },
  { id: 'border:fire', slot: 'border', name: 'Api Membara', price: 600 },
  { id: 'border:rainbow', slot: 'border', name: 'Pelangi', price: 900 },
  { id: 'border:diamond', slot: 'border', name: 'Berlian', price: 1500 },
  // Aksesori di atas avatar
  { id: 'acc:none', slot: 'acc', name: 'Tanpa Aksesori', price: 0 },
  { id: 'acc:cap', slot: 'acc', name: 'Topi', price: 150 },
  { id: 'acc:shades', slot: 'acc', name: 'Kacamata Hitam', price: 200 },
  { id: 'acc:headphones', slot: 'acc', name: 'Headphone', price: 300 },
  { id: 'acc:halo', slot: 'acc', name: 'Lingkaran Malaikat', price: 350 },
  { id: 'acc:horns', slot: 'acc', name: 'Tanduk Iblis', price: 350 },
  { id: 'acc:crown', slot: 'acc', name: 'Mahkota', price: 500 },
  // Tema website (hanya untuk diri sendiri)
  { id: 'theme:retro', slot: 'theme', name: 'Retro Arcade', price: 0 },
  { id: 'theme:modern', slot: 'theme', name: 'Modern', price: 0 },
  { id: 'theme:gameboy', slot: 'theme', name: 'Game Boy', price: 300 },
  { id: 'theme:candy', slot: 'theme', name: 'Candy Pop', price: 300 },
  { id: 'theme:synthwave', slot: 'theme', name: 'Synthwave', price: 400 },
  { id: 'theme:matrix', slot: 'theme', name: 'Matrix', price: 400 },
  { id: 'theme:sakura', slot: 'theme', name: 'Sakura', price: 450 },
];
const ITEMS = new Map(CATALOG.map((i) => [i.id, i]));
const FREE = CATALOG.filter((i) => i.price === 0).map((i) => i.id);
const DEFAULT_EQUIPPED = { border: 'border:none', acc: 'acc:none', theme: 'theme:retro' };

// ---------- Lencana ----------
const winsIn = (p, game) => p.stats.byGame[game]?.wins || 0;
const tag = (p, t) => p.stats.tags[t] || 0;
const paidOwned = (p) => p.owned.filter((id) => ITEMS.get(id)?.price > 0).length;
const BADGES = [
  { id: 'first_win', icon: '🥇', name: 'Kemenangan Pertama', desc: 'Menang 1 kali', check: (p) => p.stats.wins >= 1 },
  { id: 'wins_10', icon: '🏆', name: 'Juara Sejati', desc: 'Menang 10 kali', check: (p) => p.stats.wins >= 10 },
  { id: 'wins_50', icon: '👑', name: 'Legenda', desc: 'Menang 50 kali', check: (p) => p.stats.wins >= 50 },
  { id: 'games_10', icon: '🎮', name: 'Rajin Mabar', desc: 'Main 10 game', check: (p) => p.stats.games >= 10 },
  { id: 'games_50', icon: '🕹️', name: 'Penghuni Tetap', desc: 'Main 50 game', check: (p) => p.stats.games >= 50 },
  { id: 'streak_3', icon: '🔥', name: 'On Fire', desc: 'Menang 3 kali berturut-turut', check: (p) => p.stats.bestStreak >= 3 },
  { id: 'level_5', icon: '⭐', name: 'Bintang Naik', desc: 'Capai level 5', check: (p) => levelFromXp(p.xp) >= 5 },
  { id: 'level_10', icon: '🌟', name: 'Veteran', desc: 'Capai level 10', check: (p) => levelFromXp(p.xp) >= 10 },
  { id: 'chess', icon: '♟️', name: 'Pecatur', desc: 'Menang catur', check: (p) => winsIn(p, 'chess') >= 1 },
  { id: 'uno_king', icon: '🃏', name: 'Raja UNO', desc: 'Menang UNO 3 kali', check: (p) => winsIn(p, 'uno') >= 3 },
  { id: 'artist', icon: '🎨', name: 'Seniman', desc: 'Juara Tebak Gambar', check: (p) => winsIn(p, 'tebak') >= 1 },
  { id: 'wolf', icon: '🐺', name: 'Serigala Licik', desc: 'Menang sebagai Werewolf', check: (p) => tag(p, 'win_werewolf') >= 1 },
  { id: 'hero', icon: '🛡️', name: 'Pahlawan Desa', desc: 'Menang di tim Warga (Werewolf)', check: (p) => tag(p, 'win_village') >= 1 },
  { id: 'jester', icon: '🤡', name: 'Badut Jenius', desc: 'Menang sebagai Badut', check: (p) => tag(p, 'win_jester') >= 1 },
  { id: 'detective', icon: '🔍', name: 'Detektif', desc: 'Menang sebagai Warga (Undercover)', check: (p) => tag(p, 'win_civilian') >= 1 },
  { id: 'spy', icon: '🕵️', name: 'Mata-mata', desc: 'Menang sebagai Undercover', check: (p) => tag(p, 'win_undercover') >= 1 },
  { id: 'ghost', icon: '👻', name: 'Hantu Pintar', desc: 'Menang sebagai Mr. White', check: (p) => tag(p, 'win_white') >= 1 },
  { id: 'versatile', icon: '🎯', name: 'Serba Bisa', desc: 'Menang di 5 game berbeda', check: (p) => Object.values(p.stats.byGame).filter((g) => g.wins > 0).length >= 5 },
  { id: 'sultan', icon: '💰', name: 'Sultan', desc: 'Beli item pertama di toko', check: (p) => paidOwned(p) >= 1 },
  { id: 'collector', icon: '💎', name: 'Kolektor', desc: 'Punya 5 item toko', check: (p) => paidOwned(p) >= 5 },
];

const GAME_NAME = { ttt: 'Tic-Tac-Toe', c4: 'Connect 4', chess: 'Catur', tebak: 'Tebak Gambar', werewolf: 'Werewolf', undercover: 'Undercover', uno: 'UNO' };

// ---------- Avatar ----------
// 64 karakter hex: '0' = transparan, '1'..'f' = warna palet (lihat public/js/avatar.js)
const AVATAR_RE = /^[0-9a-f]{64}$/;
function randomAvatar() {
  const colors = ['9', 'a', 'b', 'c', 'd', 'e', 'f', '4', '3'];
  const body = colors[crypto.randomInt(colors.length)];
  const grid = Array(64).fill('0');
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 4; c++) {
      if (crypto.randomInt(100) < (r === 0 || r === 7 ? 35 : 55)) grid[r * 8 + c] = grid[r * 8 + 7 - c] = body;
    }
  }
  grid[3 * 8 + 2] = grid[3 * 8 + 5] = '1'; // mata
  return grid.join('');
}

const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');
const newToken = () => 'MBR-' + crypto.randomBytes(9).toString('base64url').toUpperCase().replace(/[^A-Z0-9]/g, 'X').match(/.{1,4}/g).join('-');

function createProfiles(io) {
  const profiles = new Map(); // id -> profile
  const byToken = new Map();  // hash token -> id
  let dirty = false;

  // ---------- Simpan & muat ----------
  try {
    for (const p of JSON.parse(fs.readFileSync(FILE, 'utf8'))) {
      profiles.set(p.id, p);
      byToken.set(p.tokenHash, p.id);
    }
    console.log(`Memuat ${profiles.size} profil pemain`);
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('Gagal memuat profil:', err.message);
  }
  function save() {
    if (!dirty) return;
    dirty = false;
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE + '.tmp', JSON.stringify([...profiles.values()]));
    fs.renameSync(FILE + '.tmp', FILE);
  }
  setInterval(save, 10 * 1000);

  function create(name) {
    const token = newToken();
    const p = {
      id: crypto.randomUUID(),
      tokenHash: hash(token),
      name: name || 'Pemain',
      avatar: randomAvatar(),
      xp: 0,
      points: 0,
      stats: { games: 0, wins: 0, draws: 0, streak: 0, bestStreak: 0, byGame: {}, tags: {} },
      badges: {},
      owned: [...FREE],
      equipped: { ...DEFAULT_EQUIPPED },
      createdAt: Date.now(),
    };
    profiles.set(p.id, p);
    byToken.set(p.tokenHash, p.id);
    dirty = true;
    return { p, token };
  }

  // Data yang boleh dilihat pemain lain
  function publicOf(id) {
    const p = profiles.get(id);
    if (!p) return null;
    return { id: p.id, avatar: p.avatar, level: levelFromXp(p.xp), border: p.equipped.border, acc: p.equipped.acc, badges: Object.keys(p.badges).length };
  }

  // Data lengkap untuk pemiliknya sendiri
  function privateOf(p) {
    const level = levelFromXp(p.xp);
    return {
      id: p.id, name: p.name, avatar: p.avatar, xp: p.xp, points: p.points, level,
      levelStart: xpForLevel(level), levelNext: xpForLevel(level + 1),
      stats: p.stats, badges: p.badges, owned: p.owned, equipped: p.equipped,
    };
  }

  // Kirim ke semua tab/perangkat yang sedang memakai profil ini
  const sendMe = (p) => io.to('p:' + p.id).emit('profile:me', privateOf(p));
  function bind(socket, p) {
    if (socket.data.profileId) socket.leave('p:' + socket.data.profileId);
    socket.data.profileId = p.id;
    socket.join('p:' + p.id);
  }

  function checkBadges(p) {
    const fresh = [];
    for (const b of BADGES) {
      if (!p.badges[b.id] && b.check(p)) {
        p.badges[b.id] = Date.now();
        fresh.push({ id: b.id, icon: b.icon, name: b.name });
      }
    }
    return fresh;
  }

  // ---------- Hadiah setelah game selesai ----------
  // results: [{ sid, outcome: 'win'|'lose'|'draw', tags?: [] }]
  function award(room, game, results) {
    for (const { sid, outcome, tags = [] } of results) {
      const member = room.members.get(sid);
      const p = member && profiles.get(member.profileId);
      if (!p) continue;
      const r = REWARD[outcome];
      const levelBefore = levelFromXp(p.xp);
      p.xp += r.xp;
      p.points += r.points;

      const s = p.stats;
      s.games++;
      const g = (s.byGame[game] ||= { games: 0, wins: 0 });
      g.games++;
      if (outcome === 'win') { s.wins++; g.wins++; s.streak++; s.bestStreak = Math.max(s.bestStreak, s.streak); }
      else { s.streak = 0; if (outcome === 'draw') s.draws++; }
      for (const t of tags) s.tags[t] = (s.tags[t] || 0) + 1;

      const levelAfter = levelFromXp(p.xp);
      const bonus = (levelAfter - levelBefore) * LEVEL_BONUS;
      p.points += bonus;
      const badges = checkBadges(p);
      dirty = true;

      io.to(sid).emit('profile:reward', {
        game: GAME_NAME[game], outcome, xp: r.xp, points: r.points + bonus,
        levelUp: levelAfter > levelBefore ? levelAfter : null, badges,
      });
      sendMe(p);
    }
    onChange?.(room);
  }

  let onChange = null; // dipanggil supaya daftar anggota room ikut diperbarui

  // ---------- Event ----------
  function register(socket) {
    const me = () => profiles.get(socket.data.profileId);

    socket.on('profile:hello', ({ token, name } = {}, cb) => {
      let p = token && profiles.get(byToken.get(hash(String(token))));
      let fresh = null;
      if (!p) { const made = create(String(name ?? '').trim().slice(0, 24)); p = made.p; fresh = made.token; }
      bind(socket, p);
      p.lastSeen = Date.now();
      dirty = true;
      cb?.({ token: fresh, profile: privateOf(p) });
    });

    // Masuk dengan kode akun dari perangkat lain
    socket.on('profile:login', (code, cb) => {
      const p = profiles.get(byToken.get(hash(String(code ?? '').trim().toUpperCase())));
      if (!p) return cb?.({ error: 'Kode akun tidak ditemukan.' });
      bind(socket, p);
      cb?.({ token: String(code).trim().toUpperCase(), profile: privateOf(p) });
      onChange?.(null, socket);
    });

    socket.on('profile:update', ({ name, avatar } = {}) => {
      const p = me(); if (!p) return;
      if (typeof name === 'string' && name.trim()) p.name = name.trim().slice(0, 24);
      if (typeof avatar === 'string' && AVATAR_RE.test(avatar)) p.avatar = avatar;
      dirty = true;
      sendMe(p);
      onChange?.(null, socket);
    });

    socket.on('profile:buy', (itemId, cb) => {
      const p = me(); const item = ITEMS.get(itemId);
      if (!p || !item) return cb?.({ error: 'Item tidak ditemukan.' });
      if (p.owned.includes(itemId)) return cb?.({ error: 'Kamu sudah punya item ini.' });
      if (p.points < item.price) return cb?.({ error: `Poin belum cukup (butuh ${item.price}, kamu punya ${p.points}).` });
      p.points -= item.price;
      p.owned.push(itemId);
      p.equipped[item.slot] = itemId; // langsung dipakai
      const badges = checkBadges(p);
      dirty = true;
      cb?.({ ok: true, badges });
      sendMe(p);
      onChange?.(null, socket);
    });

    socket.on('profile:equip', (itemId) => {
      const p = me(); const item = ITEMS.get(itemId);
      if (!p || !item || !p.owned.includes(itemId)) return;
      p.equipped[item.slot] = itemId;
      dirty = true;
      sendMe(p);
      onChange?.(null, socket);
    });

    socket.on('profile:leaderboard', (sort, cb) => {
      const key = sort === 'wins' ? (p) => p.stats.wins : (p) => p.xp;
      const top = [...profiles.values()].filter((p) => p.stats.games > 0)
        .sort((a, b) => key(b) - key(a)).slice(0, 25)
        .map((p) => ({ ...publicOf(p.id), name: p.name, xp: p.xp, wins: p.stats.wins, games: p.stats.games }));
      cb?.(top);
    });

    socket.on('profile:catalog', (_, cb) => {
      cb?.({ items: CATALOG, badges: BADGES.map(({ check, ...b }) => b), reward: REWARD, levelBonus: LEVEL_BONUS });
    });
  }

  return {
    register, award, publicOf, save: () => { dirty = true; save(); },
    nameOf: (id) => profiles.get(id)?.name,
    setName(id, name) { const p = profiles.get(id); if (p && name) { p.name = name; dirty = true; } },
    onChange(fn) { onChange = fn; },
  };
}

module.exports = { createProfiles, levelFromXp, xpForLevel };
