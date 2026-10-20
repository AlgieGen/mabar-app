import { escapeHtml } from './util.js';

const COLORS = ['#000000', '#7f7f7f', '#ffffff', '#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa', '#6d4c41', '#f06292', '#00acc1'];

export function initTebak(ctx) {
  const { socket } = ctx;
  const $ = (id) => document.getElementById(id);
  const canvas = $('tgCanvas');
  const c = canvas.getContext('2d');

  let st = null;          // state publik dari server
  let myWord = null;      // kata yang harus digambar (hanya untuk penggambar)
  let localEndsAt = 0;
  let turnKey = '';
  let color = '#000000', size = 4, eraser = false;
  let last = null;

  const active = () => st && (st.phase === 'drawing' || st.phase === 'reveal');
  const isDrawer = () => st?.phase === 'drawing' && st.drawer === ctx.me;

  // ---------- Kanvas ----------
  function clearCanvas() {
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, canvas.width, canvas.height);
  }
  function drawSeg(g) {
    const W = canvas.width, H = canvas.height;
    c.strokeStyle = g.e ? '#ffffff' : g.c;
    c.lineWidth = g.s * W;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(g.x0 * W, g.y0 * H);
    c.lineTo(g.x1 * W, g.y1 * H);
    c.stroke();
  }
  function replay() {
    clearCanvas();
    st?.strokes.forEach(drawSeg);
  }
  clearCanvas();

  function pos(e) {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height].map((v) => +Math.min(1, Math.max(0, v)).toFixed(4));
  }
  function emitSeg(from, to) {
    const seg = { x0: from[0], y0: from[1], x1: to[0], y1: to[1], c: color, s: (eraser ? size * 2.5 : size) / 800, e: eraser ? 1 : 0 };
    drawSeg(seg);
    socket.emit('tebak:draw', seg);
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (!isDrawer()) return;
    canvas.setPointerCapture(e.pointerId);
    last = pos(e);
    emitSeg(last, last);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!last || !isDrawer()) return;
    const p = pos(e);
    emitSeg(last, p);
    last = p;
  });
  const stop = () => { last = null; };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);

  // ---------- Alat gambar ----------
  $('tgColors').innerHTML = COLORS.map((col) =>
    `<button class="tg-color${col === color ? ' active' : ''}" data-color="${col}" style="background:${col}" title="${col}"></button>`).join('');
  $('tgColors').addEventListener('click', (e) => {
    const col = e.target.dataset.color; if (!col) return;
    color = col;
    eraser = false;
    $('tgEraser').classList.remove('active');
    document.querySelectorAll('.tg-color').forEach((b) => b.classList.toggle('active', b === e.target));
  });
  document.querySelectorAll('.tg-size').forEach((b) => {
    b.onclick = () => {
      size = Number(b.dataset.size);
      document.querySelectorAll('.tg-size').forEach((x) => x.classList.toggle('active', x === b));
    };
  });
  $('tgEraser').onclick = () => { eraser = !eraser; $('tgEraser').classList.toggle('active', eraser); };
  $('tgClear').onclick = () => { clearCanvas(); socket.emit('tebak:clear'); };
  $('tgStartBtn').onclick = () => socket.emit('tebak:start', Number($('tgRounds').value));
  $('tgStopBtn').onclick = () => { if (confirm('Hentikan Tebak Gambar untuk semua orang?')) socket.emit('tebak:stop'); };

  // ---------- Tampilan ----------
  function wordHtml(chars) {
    return chars.map((ch) => (ch === ' ' ? '<span class="gap"></span>' : escapeHtml(ch))).join('');
  }

  function render() {
    if (!st) return;
    const drawer = isDrawer();
    const drawerName = st.scores[st.drawer]?.name ?? ctx.memberName(st.drawer);

    $('tgInfo').textContent = active() ? `Ronde ${st.round}/${st.rounds}` : '';
    if (st.phase === 'drawing') {
      $('tgWord').innerHTML = drawer && myWord ? wordHtml([...myWord.toUpperCase()]) : wordHtml(st.hint.map((ch) => ch.toUpperCase()));
    } else if (st.word) {
      $('tgWord').innerHTML = wordHtml([...st.word.toUpperCase()]);
    } else {
      $('tgWord').textContent = '🎨 Tebak Gambar';
    }

    let overlay = '';
    if (st.phase === 'idle') {
      overlay = 'Ajak teman masuk room (minimal 2 orang),<br>lalu tekan <b>Mulai</b>';
    } else if (st.phase === 'reveal') {
      overlay = `Jawabannya<br><b>${escapeHtml(st.word.toUpperCase())}</b>`;
    } else if (st.phase === 'over') {
      const top = Object.values(st.scores).sort((a, b) => b.score - a.score).slice(0, 3);
      const medals = ['🥇', '🥈', '🥉'];
      overlay = '<div>🏆 Game selesai!<br>' + top.map((p, i) => `${medals[i]} ${escapeHtml(p.name)} — ${p.score}`).join('<br>') + '</div>';
    } else if (st.phase === 'drawing' && !drawer && st.strokes.length === 0) {
      overlay = `✏️ ${escapeHtml(drawerName)} sedang bersiap menggambar...`;
    }
    $('tgOverlay').innerHTML = overlay;

    $('tgTools').classList.toggle('hidden', !drawer);
    canvas.classList.toggle('can-draw', drawer);
    $('tgSetup').classList.toggle('hidden', active());
    $('tgStopBtn').classList.toggle('hidden', !active());

    const guessed = new Set(st.guessed);
    $('tgScores').innerHTML = Object.entries(st.scores)
      .sort((a, b) => b[1].score - a[1].score)
      .map(([id, p]) => {
        const mark = st.phase === 'drawing' && id === st.drawer ? ' ✏️' : guessed.has(id) ? ' ✅' : '';
        return `<li class="${guessed.has(id) ? 'guessed' : ''}">${escapeHtml(p.name)}${id === ctx.me ? ' (kamu)' : ''}${mark}<span class="pts">${p.score}</span></li>`;
      }).join('') || '<li class="muted">Belum ada skor</li>';

    const canGuess = st.phase === 'drawing' && !drawer && !guessed.has(ctx.me);
    $('chatInput').placeholder = canGuess ? '🎨 Ketik tebakanmu...' : 'Ketik pesan...';
    $('tgGuessForm').classList.toggle('hidden', !canGuess);
    if (st.phase !== 'drawing') $('tgFeedback').textContent = '';
  }

  function setState(s) {
    st = s;
    if (st.phase !== 'drawing' || st.drawer !== ctx.me) myWord = null;
    localEndsAt = Date.now() + st.remaining;
    // Giliran baru: gambar ulang kanvas dari data server
    const key = `${st.round}|${st.drawer}|${st.phase}`;
    if (key !== turnKey) { turnKey = key; if (st.phase !== 'reveal') replay(); }
    render();
  }

  setInterval(() => {
    const el = $('tgTimer');
    if (st?.phase !== 'drawing') { el.textContent = ''; return; }
    const sec = Math.max(0, Math.ceil((localEndsAt - Date.now()) / 1000));
    el.textContent = `⏱️ ${sec}`;
    el.classList.toggle('low', sec <= 10);
  }, 250);

  // ---------- Kotak tebakan di bawah gambar ----------
  $('tgGuessForm').onsubmit = (e) => {
    e.preventDefault();
    const text = $('tgGuessInput').value.trim();
    if (text) socket.emit('chat:send', text);
    $('tgGuessInput').value = '';
  };
  // Pesan pribadi dari server (benar / hampir benar) juga ditampilkan di bawah gambar
  socket.on('chat:msg', (msg) => {
    if (msg.system && String(msg.id).startsWith('tg')) $('tgFeedback').textContent = msg.text;
  });

  // ---------- Event dari server ----------
  socket.on('tebak:state', setState);
  socket.on('tebak:word', (w) => { myWord = w; render(); ctx.toast(`Giliranmu menggambar: ${w.toUpperCase()}`); });
  socket.on('tebak:draw', (seg) => {
    if (st) st.strokes.push(seg);
    if (st?.strokes.length === 1) render(); // hilangkan overlay "bersiap"
    drawSeg(seg);
  });
  socket.on('tebak:clear', () => { if (st) st.strokes = []; clearCanvas(); });
  socket.on('tebak:started', () => {
    ctx.showGameView('tebak');
    ctx.openTab('game');
    ctx.toast('🎨 Tebak Gambar dimulai!');
  });
  ctx.memberListeners.push(() => render());

  return {
    load(s) {
      turnKey = '';
      myWord = null;
      setState(s);
      if (active()) ctx.showGameView('tebak');
    },
  };
}
