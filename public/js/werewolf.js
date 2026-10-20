import { escapeHtml } from './util.js';

const ROLES = {
  werewolf: { name: 'Werewolf', icon: '🐺', desc: 'Setiap malam, pilih satu warga untuk diterkam bersama sesama werewolf. Jangan sampai ketahuan saat siang!' },
  seer: { name: 'Peramal', icon: '🔮', desc: 'Setiap malam, terawang satu orang untuk mengetahui apakah dia werewolf. Bantu warga tanpa membuka kedokmu.' },
  doctor: { name: 'Dokter', icon: '💉', desc: 'Setiap malam, lindungi satu orang (boleh diri sendiri) dari serangan werewolf. Tidak boleh orang yang sama 2 malam berturut-turut.' },
  villager: { name: 'Warga', icon: '🧑‍🌾', desc: 'Diskusikan lewat voice siapa yang mencurigakan, lalu vote untuk mengeksekusi werewolf di siang hari.' },
};
const ACTION = { werewolf: '🐺 Terkam', seer: '🔮 Terawang', doctor: '💉 Lindungi' };

export function initWerewolf(ctx) {
  const { socket } = ctx;
  const $ = (id) => document.getElementById(id);
  let st = { phase: 'idle', players: [] };
  let localEndsAt = 0;

  const active = () => ['night', 'day', 'dusk'].includes(st.phase);

  function phaseTitle() {
    switch (st.phase) {
      case 'night': return `🌙 Malam ke-${st.day}`;
      case 'day': return `☀️ Hari ke-${st.day} — Diskusi & Vote`;
      case 'dusk': return '🌆 Senja... malam akan tiba';
      case 'over': return st.winner === 'village' ? '🎉 Warga menang!' : st.winner === 'wolf' ? '🐺 Werewolf menang!' : 'Permainan dihentikan';
      default: return '🐺 Werewolf';
    }
  }

  function hint() {
    const me = st.me;
    if (!active()) return '';
    if (!me) return '👀 Kamu menonton permainan ini.';
    if (!me.alive) return '👻 Kamu sudah mati. Tetap diam ya, jangan bocorkan apa pun!';
    if (st.phase === 'night') {
      if (me.role === 'villager') return '😴 Kamu tertidur lelap... tunggu pagi.';
      if (me.role === 'seer' && st.myTarget) return '🔮 Kamu sudah menerawang malam ini.';
      if (st.myTarget) return '✅ Pilihanmu tercatat. Kamu masih bisa menggantinya sebelum pagi.';
      return { werewolf: '🐺 Pilih korban malam ini.', seer: '🔮 Pilih satu orang untuk diterawang.', doctor: '💉 Pilih satu orang untuk dilindungi.' }[me.role];
    }
    if (st.phase === 'day') return st.votes?.[ctx.me] ? '🗳️ Vote tercatat. Kamu masih bisa menggantinya.' : '🗳️ Diskusikan lewat voice, lalu vote siapa yang dicurigai.';
    return '';
  }

  // Tombol aksi untuk satu pemain di daftar
  function actionFor(p) {
    const me = st.me;
    if (!me?.alive || !p.alive) return '';
    if (st.phase === 'night') {
      if (!ACTION[me.role]) return '';
      if (me.role === 'werewolf' && p.role === 'werewolf') return '';
      if (me.role === 'seer' && (p.id === ctx.me || st.myTarget)) return '';
      if (me.role === 'doctor' && p.id === st.lastDoctor) return '<span class="ww-note">dilindungi kemarin</span>';
      return `<button class="btn small ${st.myTarget === p.id ? 'primary' : ''}" data-act="${p.id}">${ACTION[me.role]}</button>`;
    }
    if (st.phase === 'day') {
      return `<button class="btn small ${st.votes?.[ctx.me] === p.id ? 'primary' : ''}" data-vote="${p.id}">🗳️ Vote</button>`;
    }
    return '';
  }

  function render() {
    $('wwPhase').textContent = phaseTitle();
    $('wwEvent').classList.toggle('hidden', !st.lastEvent);
    $('wwEvent').textContent = st.lastEvent || '';

    const me = st.me;
    $('wwRole').classList.toggle('hidden', !me || st.phase === 'idle');
    if (me) {
      const r = ROLES[me.role];
      const mates = me.role === 'werewolf'
        ? st.players.filter((p) => p.role === 'werewolf' && p.id !== ctx.me).map((p) => escapeHtml(p.name))
        : [];
      $('wwRole').innerHTML = `<div class="ww-role-icon">${r.icon}</div>
        <div><div class="ww-role-name">Peranmu: ${r.name}${me.alive ? '' : ' (💀 mati)'}</div>
        <div class="muted small-text">${r.desc}</div>
        ${mates.length ? `<div class="small-text">Teman serigala: <b>${mates.join(', ')}</b></div>` : ''}</div>`;
    }
    $('wwHint').textContent = hint();

    // Hitung vote (siang) dan pilihan werewolf (malam, hanya terlihat oleh werewolf)
    const tally = {};
    for (const t of Object.values(st.votes || {})) tally[t] = (tally[t] || 0) + 1;
    const wolfPick = {};
    for (const [w, t] of Object.entries(st.wolfVotes || {})) (wolfPick[t] ||= []).push(st.players.find((p) => p.id === w)?.name);
    const seer = {};
    for (const s of st.seerResults || []) seer[s.id] = s.isWolf;

    $('wwPlayers').innerHTML = st.players.map((p) => {
      const role = p.role ? `<span class="ww-badge ${p.role}">${ROLES[p.role].icon} ${ROLES[p.role].name}</span>` : '';
      const seen = p.id in seer && !p.role ? `<span class="ww-badge ${seer[p.id] ? 'werewolf' : 'safe'}">🔮 ${seer[p.id] ? 'Werewolf!' : 'Bukan werewolf'}</span>` : '';
      const votes = tally[p.id] ? `<span class="ww-votes">🗳️ ${tally[p.id]}</span>` : '';
      const wolves = wolfPick[p.id] ? `<span class="ww-note">🐺 ${wolfPick[p.id].map(escapeHtml).join(', ')}</span>` : '';
      return `<div class="ww-card ${p.alive ? '' : 'dead'} ${p.id === ctx.me ? 'me' : ''}">
        <div class="ww-name">${p.alive ? '' : '💀 '}${escapeHtml(p.name)}${p.id === ctx.me ? ' (kamu)' : ''}${p.left ? ' 🚪' : ''}</div>
        <div class="ww-tags">${role}${seen}${votes}${wolves}</div>
        <div class="ww-action">${actionFor(p)}</div>
      </div>`;
    }).join('');

    if (st.phase === 'day' && st.votes) {
      const skips = Object.values(st.votes).filter((v) => v === 'skip').length;
      $('wwSkipBtn').textContent = `🤷 Lewati (tidak vote)${skips ? ` · ${skips}` : ''}`;
      $('wwSkipBtn').classList.toggle('primary', st.votes[ctx.me] === 'skip');
    }
    $('wwSkipBtn').classList.toggle('hidden', !(st.phase === 'day' && st.me?.alive));
    $('wwStopBtn').classList.toggle('hidden', !active());
    $('wwSetup').classList.toggle('hidden', active());
    $('wwStartBtn').textContent = st.phase === 'over' ? '🔄 Main lagi' : '🐺 Mulai Werewolf';
  }

  setInterval(() => {
    const el = $('wwTimer');
    if (!active()) { el.textContent = ''; return; }
    const sec = Math.max(0, Math.ceil((localEndsAt - Date.now()) / 1000));
    el.textContent = `⏱️ ${sec}`;
    el.classList.toggle('low', sec <= 10);
  }, 250);

  $('wwPlayers').addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    const vote = e.target.closest('[data-vote]')?.dataset.vote;
    if (act) socket.emit('ww:act', act);
    if (vote) socket.emit('ww:vote', vote);
  });
  $('wwSkipBtn').onclick = () => socket.emit('ww:vote', 'skip');
  $('wwStartBtn').onclick = () => socket.emit('ww:start');
  $('wwStopBtn').onclick = () => { if (confirm('Hentikan permainan Werewolf untuk semua orang?')) socket.emit('ww:stop'); };

  socket.on('ww:state', (s) => {
    st = s;
    localEndsAt = Date.now() + s.remaining;
    render();
  });
  socket.on('ww:started', () => {
    ctx.showGameView('werewolf');
    ctx.openTab('game');
    ctx.toast('🐺 Werewolf dimulai! Cek peranmu — rahasiakan ya');
  });

  render();
  return {
    reset() { st = { phase: 'idle', players: [] }; render(); },
  };
}
