import { escapeHtml } from './util.js';

const PIECES = {
  ttt: ['✕', '◯'],
  c4: ['🔴', '🟡'],
  chess: ['♔ Putih', '♚ Hitam'],
};

// Bidak catur memakai glyph "solid" untuk kedua warna; warnanya diatur lewat CSS.
// ︎ memaksa tampil sebagai teks, bukan emoji.
const CHESS_GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟︎' };
const FILES = 'abcdefgh';

function parseFen(fen) {
  const board = {};
  fen.split(' ')[0].split('/').forEach((row, r) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) { f += Number(ch); continue; }
      board[FILES[f] + (8 - r)] = { type: ch.toLowerCase(), color: ch === ch.toUpperCase() ? 'w' : 'b' };
      f++;
    }
  });
  return board;
}

export function initGame(ctx) {
  const { socket } = ctx;
  const $ = (id) => document.getElementById(id);
  let game = null;
  let view = 'board'; // 'board' | 'tebak' | 'werewolf'
  let selected = null; // kotak catur yang sedang dipilih

  function showView(v) {
    view = v;
    $('boardView').classList.toggle('hidden', v !== 'board');
    $('tebakView').classList.toggle('hidden', v !== 'tebak');
    $('wwView').classList.toggle('hidden', v !== 'werewolf');
    highlightPicker();
  }
  ctx.showGameView = showView;

  function highlightPicker() {
    document.querySelectorAll('[data-game]').forEach((b) => b.classList.toggle('active',
      view === 'board' ? game?.type === b.dataset.game : b.dataset.game === view));
  }

  const mySeat = () => (game ? game.players.indexOf(ctx.me) : -1);
  const isOver = () => game.winner !== null || game.draw;
  const ready = () => game.players.every(Boolean);
  const myTurn = () => ready() && !isOver() && game.players[game.turn] === ctx.me;

  function render() {
    $('gameArea').classList.toggle('hidden', !game);
    $('gameEmpty').classList.toggle('hidden', !!game);
    highlightPicker();
    if (!game) return;

    // Kursi pemain
    document.querySelectorAll('.seat').forEach((el) => {
      const i = Number(el.dataset.seat);
      const pid = game.players[i];
      el.classList.toggle('turn', ready() && !isOver() && game.turn === i);
      el.innerHTML = pid
        ? `<span class="piece">${PIECES[game.type][i]}</span> ${escapeHtml(ctx.memberName(pid))}${pid === ctx.me ? ' (kamu)' : ''}`
        : `<span class="piece">${PIECES[game.type][i]}</span> <button class="btn small primary" data-sit="${i}">Duduk di sini</button>`;
    });

    // Status
    let status;
    const reason = game.reason ? ` (${game.reason})` : '';
    if (!ready()) status = 'Menunggu 2 pemain duduk...';
    else if (game.winner !== null) status = `🏆 ${ctx.memberName(game.players[game.winner])} menang!${reason}`;
    else if (game.draw) status = `🤝 Seri!${reason}`;
    else if (myTurn()) status = 'Giliran kamu!';
    else status = `Giliran ${ctx.memberName(game.players[game.turn])}...`;
    if (game.type === 'chess' && game.check && !isOver()) status = '♚ Skak! ' + status;
    $('gameStatus').textContent = status;

    const chess = game.type === 'chess';
    $('chessMoves').classList.toggle('hidden', !chess);
    $('resignBtn').classList.toggle('hidden', !chess || mySeat() === -1 || !ready() || isOver());
    $('standBtn').classList.toggle('hidden', mySeat() === -1);
    if (chess) renderChess();
    else renderGrid();
  }

  // ---------- Tic-Tac-Toe & Connect 4 ----------
  function renderGrid() {
    const board = $('board');
    board.className = `board ${game.type}`;
    board.style.gridTemplateColumns = `repeat(${game.cols}, auto)`;
    const winSet = new Set(game.line || []);
    board.innerHTML = game.board.map((v, i) => {
      const cls = ['cell', v !== null ? `p${v}` : '', winSet.has(i) ? 'win' : ''].join(' ');
      const content = game.type === 'ttt' && v !== null ? PIECES.ttt[v] : '';
      return `<div class="${cls}" data-i="${i}">${content}</div>`;
    }).join('');
  }

  // ---------- Catur ----------
  function targetsFrom(sq) {
    return game.moves.filter((m) => m.startsWith(sq)).map((m) => m.slice(2, 4));
  }

  function renderChess() {
    const board = $('board');
    board.className = 'board chess';
    board.style.gridTemplateColumns = 'repeat(8, auto)';
    const pieces = parseFen(game.fen);
    const flip = mySeat() === 1; // pemain hitam melihat dari sisi hitam
    const targets = new Set(selected ? targetsFrom(selected) : []);
    const last = new Set(game.lastMove || []);
    const turnColor = game.turn === 0 ? 'w' : 'b';

    let html = '';
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const file = flip ? 7 - f : f;
        const rank = flip ? r + 1 : 8 - r;
        const sq = FILES[file] + rank;
        const p = pieces[sq];
        const cls = ['sq', (file + rank) % 2 === 0 ? 'light' : 'dark'];
        if (last.has(sq)) cls.push('last');
        if (sq === selected) cls.push('selected');
        if (targets.has(sq)) cls.push(p ? 'capture' : 'target');
        if (game.check && p?.type === 'k' && p.color === turnColor) cls.push('check');
        const coord = (f === 0 ? `<span class="rank">${rank}</span>` : '') + (r === 7 ? `<span class="file">${FILES[file]}</span>` : '');
        html += `<div class="${cls.join(' ')}" data-sq="${sq}">${coord}${p ? `<span class="pc ${p.color}">${CHESS_GLYPH[p.type]}</span>` : ''}</div>`;
      }
    }
    board.innerHTML = html;

    // Riwayat langkah dalam pasangan putih/hitam
    const h = game.history;
    let moves = '';
    for (let i = 0; i < h.length; i += 2) moves += `<li>${escapeHtml(h[i])} <span>${escapeHtml(h[i + 1] || '')}</span></li>`;
    $('chessMoves').innerHTML = `<h4>Langkah</h4><ol>${moves || '<li class="muted">Belum ada</li>'}</ol>`;
    const list = $('chessMoves').querySelector('ol');
    list.scrollTop = list.scrollHeight;
  }

  function clickChess(sq) {
    if (!myTurn()) return;
    const pieces = parseFen(game.fen);
    const myColor = game.turn === 0 ? 'w' : 'b';
    if (selected && targetsFrom(selected).includes(sq)) {
      const promos = game.moves.filter((m) => m.startsWith(selected + sq) && m.length === 5);
      if (promos.length) return askPromotion(selected, sq, myColor);
      socket.emit('game:move', { from: selected, to: sq });
      selected = null;
    } else {
      selected = pieces[sq]?.color === myColor && sq !== selected ? sq : null;
    }
    renderChess();
  }

  function askPromotion(from, to, color) {
    const picker = $('promoPicker');
    picker.innerHTML = '<p>Promosi menjadi:</p>' + ['q', 'r', 'b', 'n'].map((t) =>
      `<button class="btn" data-promo="${t}"><span class="pc ${color}">${CHESS_GLYPH[t]}</span></button>`).join('');
    picker.classList.remove('hidden');
    picker.onclick = (e) => {
      const t = e.target.closest('[data-promo]')?.dataset.promo;
      if (!t) return;
      socket.emit('game:move', { from, to, promotion: t });
      picker.classList.add('hidden');
      selected = null;
    };
  }

  // ---------- Event ----------
  $('board').addEventListener('click', (e) => {
    if (!game) return;
    if (game.type === 'chess') {
      const sq = e.target.closest('.sq')?.dataset.sq;
      if (sq) clickChess(sq);
      return;
    }
    const cell = e.target.closest('.cell');
    if (!cell) return;
    const i = Number(cell.dataset.i);
    socket.emit('game:move', game.type === 'c4' ? i % game.cols : i);
  });
  document.querySelector('.seats').addEventListener('click', (e) => {
    const seat = e.target.dataset.sit;
    if (seat !== undefined) socket.emit('game:sit', Number(seat));
  });
  document.querySelectorAll('[data-game]').forEach((b) => {
    b.onclick = () => {
      const type = b.dataset.game;
      if (type === 'tebak' || type === 'werewolf') return showView(type);
      showView('board');
      if (game?.type === type) return;
      if (game && !confirm('Ganti game? Permainan sekarang akan diulang.')) return;
      socket.emit('game:new', type);
    };
  });
  $('gameResetBtn').onclick = () => {
    if (game && ready() && !isOver() && !confirm('Mulai ulang permainan yang sedang berjalan?')) return;
    socket.emit('game:reset');
  };
  $('standBtn').onclick = () => socket.emit('game:stand');
  $('resignBtn').onclick = () => { if (confirm('Yakin menyerah?')) socket.emit('game:resign'); };

  socket.on('game:state', (g) => {
    game = g;
    selected = null;
    $('promoPicker').classList.add('hidden');
    render();
  });
  // Nama pemain di kursi ikut berubah kalau daftar anggota berubah
  ctx.memberListeners.push(() => render());

  return { load(g) { game = g; selected = null; render(); } };
}
