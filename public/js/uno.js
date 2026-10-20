import { escapeHtml } from './util.js';

const COLOR_NAME = { red: 'Merah', yellow: 'Kuning', green: 'Hijau', blue: 'Biru' };
const LABEL = { skip: '⊘', reverse: '⇄', draw2: '+2', wild: '★', wild4: '+4' };
const ORDER = { red: 0, yellow: 1, green: 2, blue: 3, null: 4 };
const VALUE_ORDER = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'skip', 'reverse', 'draw2', 'wild', 'wild4'];

export function cardHtml(card, extra = '', attrs = '') {
  const label = LABEL[card.value] ?? card.value;
  return `<button class="uno-card ${card.color || 'wild'} ${extra}" ${attrs}>
    <span class="uno-corner">${label}</span><span class="uno-center">${label}</span>
  </button>`;
}

export function initUno(ctx) {
  const { socket } = ctx;
  const $ = (id) => document.getElementById(id);
  let st = { phase: 'idle', players: [] };
  let localEndsAt = 0;
  let pendingWild = null;

  const playing = () => st.phase === 'playing';
  const myTurn = () => playing() && st.turn === ctx.me;
  const playable = (c) => myTurn() && (st.drawn === null || c.id === st.drawn) && (!c.color || c.color === st.color || c.value === st.top.value);
  const nameOf = (id) => escapeHtml(st.players.find((p) => p.id === id)?.name ?? '?');

  function render() {
    const inGame = !!st.hand;
    $('unoTable').classList.toggle('hidden', !st.top);
    $('unoStartBtn').classList.toggle('hidden', playing());
    $('unoStopBtn').classList.toggle('hidden', !playing());
    $('unoStartBtn').textContent = st.phase === 'over' ? '🔄 Main lagi' : '🃏 Mulai UNO';
    $('unoRules').classList.toggle('hidden', playing());

    if (st.phase === 'over') $('unoInfo').textContent = st.winner ? `🏆 ${st.players.find((p) => p.id === st.winner)?.name ?? ''} menang!` : '🃏 UNO dihentikan';
    else if (myTurn()) $('unoInfo').textContent = '🃏 Giliran kamu!';
    else if (playing()) $('unoInfo').textContent = `🃏 Giliran ${st.players.find((p) => p.id === st.turn)?.name ?? ''}`;
    else $('unoInfo').textContent = '🃏 UNO';

    // Pemain lain: jumlah kartu, siapa yang sedang giliran, arah permainan
    const arrow = st.dir === 1 ? '→' : '←';
    $('unoPlayers').innerHTML = st.players.map((p, i) => `
      <div class="uno-player ${p.id === st.turn ? 'turn' : ''} ${p.id === ctx.me ? 'me' : ''}">
        <div class="uno-pname">${escapeHtml(p.name)}${p.id === ctx.me ? ' (kamu)' : ''}</div>
        <div class="uno-count">🂠 ${p.count}${p.uno ? ' <b class="uno-called">UNO!</b>' : ''}</div>
      </div>${i < st.players.length - 1 ? `<span class="uno-arrow">${arrow}</span>` : ''}`).join('');

    if (st.top) {
      $('unoTop').innerHTML = cardHtml(st.top, 'top', 'disabled');
      $('unoColor').innerHTML = `Warna: <b class="uno-color-text ${st.color}">${COLOR_NAME[st.color]}</b>`;
      $('unoDrawCount').textContent = `${st.drawCount} kartu`;
      $('unoDrawBtn').disabled = !myTurn() || st.drawn !== null;
      $('unoDrawBtn').classList.toggle('glow', myTurn() && st.drawn === null && !st.hand.some(playable));
    }
    $('unoAction').textContent = st.lastAction || '';

    // Kartu di tangan, diurutkan per warna lalu nilai
    const hand = [...(st.hand || [])].sort((a, b) => ORDER[a.color] - ORDER[b.color] || VALUE_ORDER.indexOf(a.value) - VALUE_ORDER.indexOf(b.value));
    $('unoHand').innerHTML = inGame
      ? hand.map((c) => cardHtml(c, playable(c) ? 'playable' : myTurn() ? 'dim' : '', `data-card="${c.id}"`)).join('')
      : (playing() ? '<p class="muted">👀 Kamu menonton permainan ini.</p>' : '');

    const myCount = st.hand?.length ?? 0;
    const me = st.players.find((p) => p.id === ctx.me);
    $('unoCallBtn').classList.toggle('hidden', !playing() || !inGame || myCount > 2 || me?.uno);
    $('unoCatchBtn').classList.toggle('hidden', !playing() || !inGame || !st.vulnerable || st.vulnerable === ctx.me);
    $('unoCatchBtn').textContent = st.vulnerable ? `🚨 Tangkap ${st.players.find((p) => p.id === st.vulnerable)?.name ?? ''}!` : '🚨 Tangkap!';
    $('unoPassBtn').classList.toggle('hidden', !(myTurn() && st.drawn !== null));
    if (!playing()) $('unoColorPicker').classList.add('hidden');
  }

  setInterval(() => {
    const el = $('unoTimer');
    if (!playing()) { el.textContent = ''; return; }
    const sec = Math.max(0, Math.ceil((localEndsAt - Date.now()) / 1000));
    el.textContent = `⏱️ ${sec}`;
    el.classList.toggle('low', sec <= 10);
  }, 250);

  $('unoHand').addEventListener('click', (e) => {
    const id = Number(e.target.closest('[data-card]')?.dataset.card);
    const card = st.hand?.find((c) => c.id === id);
    if (!card || !playable(card)) return;
    if (!card.color) {
      // Kartu wild: pilih warna dulu
      pendingWild = card.id;
      $('unoColorPicker').classList.remove('hidden');
      return;
    }
    socket.emit('uno:play', { cardId: card.id });
  });
  $('unoColorPicker').addEventListener('click', (e) => {
    const color = e.target.dataset.color;
    if (!color || pendingWild === null) return;
    socket.emit('uno:play', { cardId: pendingWild, color });
    pendingWild = null;
    $('unoColorPicker').classList.add('hidden');
  });
  $('unoColorCancel').onclick = () => { pendingWild = null; $('unoColorPicker').classList.add('hidden'); };
  $('unoDrawBtn').onclick = () => socket.emit('uno:draw');
  $('unoPassBtn').onclick = () => socket.emit('uno:pass');
  $('unoCallBtn').onclick = () => socket.emit('uno:call');
  $('unoCatchBtn').onclick = () => socket.emit('uno:catch');
  $('unoStartBtn').onclick = () => socket.emit('uno:start');
  $('unoStopBtn').onclick = () => { if (confirm('Hentikan UNO untuk semua orang?')) socket.emit('uno:stop'); };

  socket.on('uno:state', (s) => {
    const wasMyTurn = myTurn();
    st = s;
    localEndsAt = Date.now() + s.remaining;
    if (!myTurn()) { pendingWild = null; $('unoColorPicker').classList.add('hidden'); }
    render();
    if (myTurn() && !wasMyTurn && document.hidden === false) ctx.toast('🃏 Giliranmu!');
  });
  socket.on('uno:started', () => {
    ctx.openTab('game');
    ctx.showGameView('uno');
  });

  render();
  return { reset() { st = { phase: 'idle', players: [] }; render(); } };
}
