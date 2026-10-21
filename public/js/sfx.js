// Efek suara 8-bit, dibuat langsung dengan Web Audio (gelombang kotak ala konsol jadul).
// Tidak ada file audio: setiap suara adalah rangkaian nada pendek.

const VOLUME = 0.07;
const STORAGE_KEY = 'mabar:sfx';

// [frekuensi Hz, durasi detik, (opsional) frekuensi akhir untuk efek geser, (opsional) jenis gelombang]
const SOUNDS = {
  click: [[880, 0.035]],
  message: [[988, 0.06, null, 'triangle'], [1319, 0.08, null, 'triangle']],
  join: [[523, 0.07], [659, 0.07], [784, 0.1]],
  leave: [[784, 0.07], [659, 0.07], [523, 0.12]],
  turn: [[659, 0.08], [988, 0.14]],
  move: [[330, 0.04], [220, 0.05]],
  card: [[1400, 0.09, 500, 'triangle']],
  start: [[523, 0.09], [659, 0.09], [784, 0.09], [1047, 0.25]],
  win: [[523, 0.1], [659, 0.1], [784, 0.1], [1047, 0.18], [784, 0.1], [1047, 0.45]],
  lose: [[392, 0.18], [370, 0.18], [349, 0.18], [330, 0.2], [262, 0.5, 200]],
  draw: [[523, 0.12], [523, 0.12], [392, 0.3]],
  correct: [[988, 0.08], [1319, 0.35]],
  night: [[392, 0.25, 196, 'triangle'], [147, 0.4, null, 'triangle']],
  day: [[784, 0.07], [988, 0.07], [1175, 0.07], [1568, 0.2]],
  uno: [[440, 0.12], [660, 0.25]],
  alarm: [[880, 0.1], [660, 0.1], [880, 0.1], [660, 0.1]],
  tick: [[1760, 0.03, null, 'triangle']],
  levelup: [[523, 0.07], [659, 0.07], [784, 0.07], [1047, 0.07], [784, 0.07], [1047, 0.07], [1319, 0.07], [1568, 0.35]],
  badge: [[1175, 0.08], [1568, 0.08], [2093, 0.3, null, 'triangle']],
};

export function initSfx(ctx) {
  const { socket } = ctx;
  const $ = (id) => document.getElementById(id);
  let enabled = true;
  try { enabled = localStorage.getItem(STORAGE_KEY) !== 'off'; } catch {}
  let audio = null;

  // AudioContext hanya boleh dibuat/dijalankan setelah pengguna berinteraksi
  function ensureAudio() {
    if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    return audio;
  }
  document.addEventListener('pointerdown', ensureAudio, { once: true, capture: true });

  function play(name) {
    if (!enabled || !audio || audio.state !== 'running') return;
    let t = audio.currentTime + 0.01;
    for (const [freq, dur, slideTo, type = 'square'] of SOUNDS[name]) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      // Nada "patah" khas 8-bit: langsung keras, lalu turun cepat di akhir
      gain.gain.setValueAtTime(VOLUME, t);
      gain.gain.setValueAtTime(VOLUME, t + dur * 0.7);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
      t += dur;
    }
  }
  ctx.sfx = play;

  // ---------- Tombol on/off ----------
  function renderToggle() {
    $('sfxBtn').textContent = enabled ? '🔊 SFX' : '🔇 SFX';
    $('sfxBtn').title = enabled ? 'Matikan efek suara' : 'Nyalakan efek suara';
  }
  $('sfxBtn').onclick = () => {
    enabled = !enabled;
    try { localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off'); } catch {}
    renderToggle();
    ensureAudio();
    play('click');
  };
  renderToggle();

  // ---------- Bunyi klik ----------
  document.addEventListener('click', (e) => {
    if (e.target.closest('#sfxBtn')) return;
    if (e.target.closest('.btn:not(:disabled), .tab, .ww-pick, .tg-color')) play('click');
  });

  // ---------- Chat & anggota ----------
  socket.on('chat:msg', (msg) => {
    if (!ctx.me) return;
    if (!msg.system) { if (msg.from !== ctx.me) play('message'); return; }
    const id = String(msg.id);
    if (id.startsWith('tg') && msg.text.startsWith('✅')) return play('correct');
    if (msg.text.includes('bergabung ke room')) play('join');
    else if (msg.text.includes('keluar dari room')) play('leave');
    else if (msg.text.includes('berhasil menebak')) play('tick');
  });

  // Setiap game memanggil ini; bunyi "menang/kalah" hanya sekali per permainan
  const lastOver = {};
  function result(game, key, outcome) {
    if (lastOver[game] === key) return;
    lastOver[game] = key;
    if (outcome !== null) play(outcome);
  }

  for (const ev of ['tebak:started', 'ww:started', 'uc:started', 'uno:started']) socket.on(ev, () => play('start'));

  // ---------- Tic-Tac-Toe, Connect 4, Catur ----------
  let board = { turnMine: false, moves: 0 };
  socket.on('game:state', (g) => {
    if (!g) return;
    const seat = g.players.indexOf(ctx.me);
    const over = g.winner !== null || g.draw;
    const moves = g.type === 'chess' ? g.history.length : g.board.filter((c) => c !== null).length;
    if (moves > board.moves && !over) play('move');
    const turnMine = !over && g.players.every(Boolean) && g.players[g.turn] === ctx.me;
    if (turnMine && !board.turnMine) setTimeout(() => play('turn'), 120);
    if (over) {
      const outcome = seat === -1 ? 'draw' : g.draw ? 'draw' : g.winner === seat ? 'win' : 'lose';
      result('board', `${g.type}-${g.pgn ?? g.board.join()}`, outcome);
    }
    board = { turnMine, moves };
  });

  // ---------- UNO ----------
  let uno = { turnMine: false, top: null, unoCalls: 0 };
  socket.on('uno:state', (s) => {
    const turnMine = s.phase === 'playing' && s.turn === ctx.me;
    if (s.top && uno.top !== null && s.top.id !== uno.top) play('card');
    if (turnMine && !uno.turnMine) setTimeout(() => play('turn'), 150);
    if (s.lastAction?.startsWith('📣') && s.lastAction !== uno.action) play('uno');
    if (s.lastAction?.startsWith('🚨') && s.lastAction !== uno.action) play('alarm');
    if (s.phase === 'over') {
      const inGame = s.players.some((p) => p.id === ctx.me);
      result('uno', s.lastAction, !inGame || !s.winner ? null : s.winner === ctx.me ? 'win' : 'lose');
    }
    uno = { turnMine, top: s.top?.id ?? null, action: s.lastAction };
  });

  // ---------- Tebak Gambar ----------
  let tebak = { phase: 'idle', drawer: null };
  socket.on('tebak:state', (s) => {
    if (s.phase === 'drawing' && (tebak.phase !== 'drawing' || s.drawer !== tebak.drawer)) play(s.drawer === ctx.me ? 'turn' : 'tick');
    if (s.phase === 'reveal' && tebak.phase === 'drawing') play('draw');
    if (s.phase === 'over' && tebak.phase !== 'over') {
      const ranking = Object.entries(s.scores).sort((a, b) => b[1].score - a[1].score);
      result('tebak', JSON.stringify(s.scores), !s.scores[ctx.me] ? null : ranking[0]?.[0] === ctx.me ? 'win' : 'lose');
    }
    tebak = { phase: s.phase, drawer: s.drawer };
  });

  // ---------- Werewolf ----------
  const WOLF_TEAM = ['werewolf', 'minion'];
  let ww = { phase: 'idle' };
  socket.on('ww:state', (s) => {
    if (s.phase !== ww.phase) {
      if (s.phase === 'night') play('night');
      else if (s.phase === 'day') play('day');
      else if (s.phase === 'hunter') play('alarm');
    }
    if (s.phase === 'over' && ww.phase !== 'over' && s.me && s.winner) {
      const role = s.me.role;
      const lover = s.players.find((p) => p.id === ctx.me)?.lover;
      const won = s.winner === 'lovers' ? lover
        : s.winner === 'wolf' ? WOLF_TEAM.includes(role)
        : s.winner === 'jester' ? role === 'jester'
        : !WOLF_TEAM.includes(role) && role !== 'jester';
      result('ww', s.lastEvent, won ? 'win' : 'lose');
    }
    ww = { phase: s.phase };
  });

  // ---------- Undercover ----------
  let uc = { phase: 'idle', speaker: null };
  socket.on('uc:state', (s) => {
    if (s.phase === 'describe' && s.speaker === ctx.me && uc.speaker !== ctx.me) play('turn');
    if (s.phase === 'vote' && uc.phase !== 'vote') play('day');
    if (s.phase === 'over' && uc.phase !== 'over' && s.me?.role && s.winner) {
      const role = s.me.role;
      const won = s.winner === 'civilian' ? role === 'civilian' : s.winner === 'undercover' ? role !== 'civilian' : role === 'white';
      result('uc', s.lastEvent, won ? 'win' : 'lose');
    }
    uc = { phase: s.phase, speaker: s.speaker };
  });

  return { play };
}
