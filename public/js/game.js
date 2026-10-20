import { escapeHtml } from './util.js';

const PIECES = {
  ttt: ['✕', '◯'],
  c4: ['🔴', '🟡'],
};

export function initGame(ctx) {
  const { socket } = ctx;
  const $ = (id) => document.getElementById(id);
  let game = null;
  let view = 'board'; // 'board' (Tic-Tac-Toe / Connect 4) atau 'tebak'

  function showView(v) {
    view = v;
    $('boardView').classList.toggle('hidden', v !== 'board');
    $('tebakView').classList.toggle('hidden', v !== 'tebak');
    highlightPicker();
  }
  ctx.showGameView = showView;

  function highlightPicker() {
    document.querySelectorAll('[data-game]').forEach((b) => b.classList.toggle('active',
      view === 'tebak' ? b.dataset.game === 'tebak' : game?.type === b.dataset.game));
  }

  function render() {
    $('gameArea').classList.toggle('hidden', !game);
    $('gameEmpty').classList.toggle('hidden', !!game);
    highlightPicker();
    if (!game) return;

    const over = game.winner !== null || game.draw;
    const ready = game.players.every(Boolean);

    // Kursi pemain
    document.querySelectorAll('.seat').forEach((el) => {
      const i = Number(el.dataset.seat);
      const pid = game.players[i];
      el.classList.toggle('turn', ready && !over && game.turn === i);
      el.innerHTML = pid
        ? `<span class="piece">${PIECES[game.type][i]}</span> ${escapeHtml(ctx.memberName(pid))}${pid === ctx.me ? ' (kamu)' : ''}`
        : `<span class="piece">${PIECES[game.type][i]}</span> <button class="btn small primary" data-sit="${i}">Duduk di sini</button>`;
    });

    // Status
    let status;
    if (!ready) status = 'Menunggu 2 pemain duduk...';
    else if (game.winner !== null) status = `🏆 ${ctx.memberName(game.players[game.winner])} menang!`;
    else if (game.draw) status = '🤝 Seri!';
    else if (game.players[game.turn] === ctx.me) status = 'Giliran kamu!';
    else status = `Giliran ${ctx.memberName(game.players[game.turn])}...`;
    $('gameStatus').textContent = status;

    // Papan
    const board = $('board');
    board.className = `board ${game.type}`;
    board.style.gridTemplateColumns = `repeat(${game.cols}, auto)`;
    const winSet = new Set(game.line || []);
    board.innerHTML = game.board.map((v, i) => {
      const cls = ['cell', v !== null ? `p${v}` : '', winSet.has(i) ? 'win' : ''].join(' ');
      const content = game.type === 'ttt' && v !== null ? PIECES.ttt[v] : '';
      return `<div class="${cls}" data-i="${i}">${content}</div>`;
    }).join('');

    $('standBtn').classList.toggle('hidden', !game.players.includes(ctx.me));
  }

  $('board').addEventListener('click', (e) => {
    const cell = e.target.closest('.cell');
    if (!cell || !game) return;
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
      if (type === 'tebak') return showView('tebak');
      showView('board');
      if (game?.type === type) return;
      if (game && !confirm('Ganti game? Permainan sekarang akan diulang.')) return;
      socket.emit('game:new', type);
    };
  });
  $('gameResetBtn').onclick = () => socket.emit('game:reset');
  $('standBtn').onclick = () => socket.emit('game:stand');

  socket.on('game:state', (g) => { game = g; render(); });
  // Nama pemain di kursi ikut berubah kalau daftar anggota berubah
  ctx.memberListeners.push(() => render());

  return { load(g) { game = g; render(); } };
}
