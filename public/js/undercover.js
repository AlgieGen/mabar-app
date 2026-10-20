import { escapeHtml } from './util.js';

const ROLE = {
  civilian: { name: 'Warga', icon: '👥', cls: 'village' },
  undercover: { name: 'Undercover', icon: '🕵️', cls: 'wolf' },
  white: { name: 'Mr. White', icon: '👻', cls: 'jester' },
};
const autoUndercover = (n) => (n <= 5 ? 1 : n <= 9 ? 2 : 3);

export function initUndercover(ctx) {
  const { socket } = ctx;
  const $ = (id) => document.getElementById(id);
  let st = { phase: 'idle', players: [], config: { undercover: 0, mrWhite: false } };
  let localEndsAt = 0;

  const active = () => ['describe', 'vote', 'guess'].includes(st.phase);
  const nameOf = (id) => escapeHtml(st.players.find((p) => p.id === id)?.name ?? '?');

  function phaseTitle() {
    switch (st.phase) {
      case 'describe': return `🎭 Ronde ${st.round} — Beri petunjuk`;
      case 'vote': return `🗳️ Ronde ${st.round} — Vote`;
      case 'guess': return '👻 Mr. White menebak...';
      case 'over': return { civilian: '🎉 Warga menang!', undercover: '🕵️ Penyusup menang!', white: '👻 Mr. White menang!' }[st.winner] || 'Permainan dihentikan';
      default: return '🎭 Undercover';
    }
  }

  function iWon() {
    const role = st.me?.role;
    if (!role || !st.winner) return null;
    if (st.winner === 'civilian') return role === 'civilian';
    if (st.winner === 'undercover') return role !== 'civilian';
    return role === 'white';
  }

  function hint() {
    const me = st.me;
    if (st.phase === 'over') {
      const won = iWon();
      return won === null ? '' : won ? '🏆 Selamat, kamu menang!' : '😢 Kamu kalah. Coba lagi!';
    }
    if (!active()) return '';
    if (!me) return '👀 Kamu menonton permainan ini.';
    if (!me.alive && st.phase !== 'guess') return '👻 Kamu sudah tersingkir. Tetap diam ya!';
    if (st.phase === 'describe') {
      if (st.speaker === ctx.me) return '🎙️ Giliranmu! Jelaskan katamu lewat voice atau ketik satu petunjuk, lalu tekan Kirim / Sudah bicara.';
      const order = [st.speaker, ...st.queue].map(nameOf).join(' → ');
      return `👂 Dengarkan ${nameOf(st.speaker)}. Urutan: ${order}`;
    }
    if (st.phase === 'vote') return st.votes?.[ctx.me] ? '🗳️ Vote tercatat. Masih bisa diganti.' : '🗳️ Siapa yang katanya berbeda? Vote sekarang!';
    if (st.phase === 'guess') return st.guesser === ctx.me ? '👻 Kamu tersingkir! Tebak kata warga untuk menang.' : `👻 ${nameOf(st.guesser)} sedang menebak kata warga...`;
    return '';
  }

  function renderSetup() {
    const n = ctx.members.length;
    const uc = st.config.undercover || autoUndercover(n);
    const white = st.config.mrWhite ? 1 : 0;
    let warn = '';
    if (n < 3) warn = `Butuh minimal 3 pemain (sekarang ${n}).`;
    else if ((uc + white) * 2 >= n) warn = `Penyusup terlalu banyak untuk ${n} pemain.`;
    $('ucConfig').innerHTML = `
      <div class="ww-config-row">
        <label class="range-label">🕵️ Jumlah Undercover
          <select id="ucCount">
            <option value="0">Otomatis (${autoUndercover(n)})</option>
            <option value="1">1</option><option value="2">2</option><option value="3">3</option>
          </select>
        </label>
        <label class="ww-pick ${white ? 'on' : ''}"><input type="checkbox" id="ucWhite" ${white ? 'checked' : ''} /> 👻 Mr. White</label>
        <span class="muted small-text">${n} pemain · ${uc} undercover${white ? ' · 1 Mr. White' : ''} · ${Math.max(0, n - uc - white)} warga</span>
      </div>
      <p class="error small-text">${warn}</p>`;
    $('ucCount').value = String(st.config.undercover || 0);
    $('ucStartBtn').disabled = !!warn;
  }

  $('ucConfig').addEventListener('change', () => {
    st.config = { undercover: Number($('ucCount').value), mrWhite: $('ucWhite').checked };
    renderSetup();
    socket.emit('uc:config', st.config);
  });

  function render() {
    $('ucPhase').textContent = phaseTitle();
    $('ucEvent').classList.toggle('hidden', !st.lastEvent);
    $('ucEvent').textContent = st.lastEvent || '';

    const me = st.me;
    const showWord = me && st.phase !== 'idle';
    $('ucWord').classList.toggle('hidden', !showWord);
    if (showWord) {
      $('ucWord').innerHTML = me.white
        ? '<div class="uc-label">Kamu adalah</div><div class="uc-secret">👻 Mr. White</div><div class="muted small-text">Kamu tidak punya kata. Dengarkan yang lain dan pura-pura tahu!</div>'
        : `<div class="uc-label">Kata rahasiamu</div><div class="uc-secret">${escapeHtml(me.word)}</div><div class="muted small-text">Kamu mungkin Warga... atau Undercover. Hati-hati!</div>`;
    }
    $('ucHint').textContent = hint();

    $('ucClueForm').classList.toggle('hidden', !(st.phase === 'describe' && st.speaker === ctx.me));
    $('ucGuessForm').classList.toggle('hidden', !(st.phase === 'guess' && st.guesser === ctx.me));

    const tally = {};
    for (const t of Object.values(st.votes || {})) tally[t] = (tally[t] || 0) + 1;
    const canVote = st.phase === 'vote' && me?.alive;
    $('ucPlayers').innerHTML = st.players.map((p) => {
      const role = p.role ? `<span class="ww-badge ${ROLE[p.role].cls}">${ROLE[p.role].icon} ${ROLE[p.role].name}</span>` : '';
      const speaking = st.speaker === p.id ? '<span class="ww-badge lover">🎙️ bicara</span>' : '';
      const votes = tally[p.id] ? `<span class="ww-votes">🗳️ ${tally[p.id]}</span>` : '';
      const clues = p.clues.length ? `<div class="uc-clues">${p.clues.map((c) => `<span>${escapeHtml(c)}</span>`).join('')}</div>` : '';
      const action = canVote && p.alive && p.id !== ctx.me
        ? `<button class="btn small ${st.votes?.[ctx.me] === p.id ? 'primary' : ''}" data-vote="${p.id}">🗳️ Vote</button>` : '';
      return `<div class="ww-card ${p.alive ? '' : 'dead'} ${p.id === ctx.me ? 'me' : ''} ${st.speaker === p.id ? 'speaking-now' : ''}">
        <div class="ww-name">${p.alive ? '' : '❌ '}${escapeHtml(p.name)}${p.id === ctx.me ? ' (kamu)' : ''}</div>
        <div class="ww-tags">${role}${speaking}${votes}</div>
        ${clues}
        <div class="ww-action">${action}</div>
      </div>`;
    }).join('');

    $('ucStopBtn').classList.toggle('hidden', !active());
    $('ucSetup').classList.toggle('hidden', active());
    $('ucStartBtn').textContent = st.phase === 'over' ? '🔄 Main lagi' : '🎭 Mulai Undercover';
    if (!active()) renderSetup();
  }

  setInterval(() => {
    const el = $('ucTimer');
    if (!active()) { el.textContent = ''; return; }
    const sec = Math.max(0, Math.ceil((localEndsAt - Date.now()) / 1000));
    el.textContent = `⏱️ ${sec}`;
    el.classList.toggle('low', sec <= 10);
  }, 250);

  $('ucClueForm').onsubmit = (e) => {
    e.preventDefault();
    const text = $('ucClueInput').value.trim();
    if (!text) return;
    socket.emit('uc:clue', text);
    $('ucClueInput').value = '';
  };
  $('ucDoneBtn').onclick = () => socket.emit('uc:clue', '');
  $('ucGuessForm').onsubmit = (e) => {
    e.preventDefault();
    socket.emit('uc:guess', $('ucGuessInput').value);
    $('ucGuessInput').value = '';
  };
  $('ucPlayers').addEventListener('click', (e) => {
    const vote = e.target.closest('[data-vote]')?.dataset.vote;
    if (vote) socket.emit('uc:vote', vote);
  });
  $('ucStartBtn').onclick = () => socket.emit('uc:start');
  $('ucStopBtn').onclick = () => { if (confirm('Hentikan Undercover untuk semua orang?')) socket.emit('uc:stop'); };

  socket.on('uc:state', (s) => {
    st = s;
    localEndsAt = Date.now() + s.remaining;
    render();
  });
  socket.on('uc:started', () => {
    ctx.openTab('game');
    ctx.showGameView('undercover');
    ctx.toast('🎭 Undercover dimulai! Cek kata rahasiamu');
  });
  ctx.memberListeners.push(() => { if (!active()) renderSetup(); });

  render();
  return { reset() { st = { phase: 'idle', players: [], config: st.config }; render(); } };
}
