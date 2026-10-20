import { escapeHtml } from './util.js';

const ROLES = {
  werewolf: { name: 'Werewolf', icon: '🐺', team: 'wolf', desc: 'Setiap malam, pilih satu warga untuk diterkam bersama sesama werewolf. Jangan sampai ketahuan saat siang!' },
  minion: { name: 'Pengkhianat', icon: '🕵️', team: 'wolf', desc: 'Kamu di pihak werewolf dan tahu siapa mereka, tapi mereka tidak tahu kamu. Peramal melihatmu sebagai warga. Bantu werewolf menang!' },
  seer: { name: 'Peramal', icon: '🔮', team: 'village', desc: 'Setiap malam, terawang satu orang untuk mengetahui apakah dia werewolf. Bantu warga tanpa membuka kedokmu.' },
  doctor: { name: 'Dokter', icon: '💉', team: 'village', desc: 'Setiap malam, lindungi satu orang (boleh diri sendiri) dari serangan werewolf. Tidak boleh orang yang sama 2 malam berturut-turut.' },
  witch: { name: 'Penyihir', icon: '🧪', team: 'village', desc: 'Kamu punya 1 ramuan penyelamat (menyelamatkan korban werewolf malam itu) dan 1 racun (membunuh satu orang). Masing-masing hanya sekali per game.' },
  hunter: { name: 'Pemburu', icon: '🏹', team: 'village', desc: 'Saat kamu mati (diterkam atau dieksekusi), kamu boleh menembak satu orang untuk ikut mati bersamamu.' },
  cupid: { name: 'Kupid', icon: '💘', team: 'village', desc: 'Di malam pertama, jodohkan dua orang (boleh dirimu). Kalau salah satu mati, pasangannya ikut mati karena patah hati. Kalau mereka berdua bertahan sampai akhir, mereka menang.' },
  elder: { name: 'Tetua', icon: '👴', team: 'village', desc: 'Kamu kuat: serangan werewolf yang pertama tidak akan membunuhmu.' },
  mayor: { name: 'Kepala Desa', icon: '🎖️', team: 'village', desc: 'Suaramu dihitung 2 saat voting siang hari. Gunakan pengaruhmu dengan bijak!' },
  jester: { name: 'Badut', icon: '🤡', team: 'jester', desc: 'Kamu menang sendirian kalau warga mengeksekusimu lewat vote. Bertingkahlah mencurigakan!' },
  villager: { name: 'Warga', icon: '🧑‍🌾', team: 'village', desc: 'Diskusikan lewat voice siapa yang mencurigakan, lalu vote untuk mengeksekusi werewolf di siang hari.' },
};
const SPECIALS = ['seer', 'doctor', 'witch', 'hunter', 'cupid', 'elder', 'mayor', 'minion', 'jester'];
const ACTION = { werewolf: '🐺 Terkam', seer: '🔮 Terawang', doctor: '💉 Lindungi', cupid: '💘 Jodohkan' };
const autoWolves = (n) => (n >= 12 ? 3 : n >= 8 ? 2 : 1);

export function initWerewolf(ctx) {
  const { socket } = ctx;
  const $ = (id) => document.getElementById(id);
  let st = { phase: 'idle', players: [], config: { wolves: 0, roles: { seer: true, doctor: true } } };
  let localEndsAt = 0;

  const active = () => ['night', 'day', 'dusk', 'hunter'].includes(st.phase);
  const nameOf = (id) => escapeHtml(st.players.find((p) => p.id === id)?.name ?? '?');

  function phaseTitle() {
    switch (st.phase) {
      case 'night': return `🌙 Malam ke-${st.day}`;
      case 'day': return `☀️ Hari ke-${st.day} — Diskusi & Vote`;
      case 'dusk': return '🌆 Senja... malam akan tiba';
      case 'hunter': return '🏹 Pemburu sedang membidik...';
      case 'over': return { village: '🎉 Warga menang!', wolf: '🐺 Werewolf menang!', jester: '🤡 Badut menang!', lovers: '💘 Pasangan kekasih menang!' }[st.winner] || 'Permainan dihentikan';
      default: return '🐺 Werewolf';
    }
  }

  // Apakah aku termasuk pemenang?
  function iWon() {
    const me = st.me;
    if (!me || !st.winner) return null;
    if (st.winner === 'lovers') return !!st.players.find((p) => p.id === ctx.me)?.lover;
    return ROLES[me.role].team === st.winner;
  }

  function hint() {
    const me = st.me;
    if (st.phase === 'over') {
      const won = iWon();
      return won === null ? '' : won ? '🏆 Selamat, kamu menang!' : '😢 Kamu kalah. Coba lagi!';
    }
    if (!active()) return '';
    if (st.phase === 'hunter') return st.hunter === ctx.me ? '🏹 Kamu tewas! Pilih satu orang untuk ditembak.' : `🏹 ${nameOf(st.hunter)} sedang memilih siapa yang ditembak...`;
    if (!me) return '👀 Kamu menonton permainan ini.';
    if (!me.alive) return '👻 Kamu sudah mati. Tetap diam ya, jangan bocorkan apa pun!';
    if (st.phase === 'night') {
      switch (me.role) {
        case 'werewolf': return st.myTarget ? '✅ Pilihanmu tercatat. Masih bisa diganti sebelum pagi.' : '🐺 Pilih korban malam ini.';
        case 'seer': return st.myTarget ? '🔮 Kamu sudah menerawang malam ini.' : '🔮 Pilih satu orang untuk diterawang.';
        case 'doctor': return st.myTarget ? '✅ Pilihanmu tercatat. Masih bisa diganti sebelum pagi.' : '💉 Pilih satu orang untuk dilindungi.';
        case 'witch': return st.witch.night?.done ? '🧪 Kamu sudah selesai malam ini.' : '🧪 Gunakan ramuanmu (atau tidak), lalu tekan Selesai.';
        case 'cupid':
          if (st.day !== 1) return '😴 Tugasmu sudah selesai. Tidur nyenyak...';
          return st.cupidPicks?.length === 2 ? '💘 Pasangan sudah dijodohkan!' : `💘 Pilih dua orang untuk dijodohkan (${st.cupidPicks?.length || 0}/2).`;
        default: return '😴 Kamu tertidur lelap... tunggu pagi.';
      }
    }
    if (st.phase === 'day') {
      const extra = me.role === 'mayor' ? ' Suaramu dihitung 2.' : '';
      return (st.votes?.[ctx.me] ? '🗳️ Vote tercatat. Masih bisa diganti.' : '🗳️ Diskusikan lewat voice, lalu vote siapa yang dicurigai.') + extra;
    }
    return '';
  }

  // Tombol aksi untuk satu pemain di daftar
  function actionsFor(p) {
    const me = st.me;
    if (st.phase === 'hunter') {
      return st.hunter === ctx.me && p.alive ? `<button class="btn small" data-act="${p.id}">🏹 Tembak</button>` : '';
    }
    if (!me?.alive || !p.alive) return '';
    if (st.phase === 'day') {
      return `<button class="btn small ${st.votes?.[ctx.me] === p.id ? 'primary' : ''}" data-vote="${p.id}">🗳️ Vote</button>`;
    }
    if (st.phase !== 'night') return '';
    const btn = (label, selected, kind = '') => `<button class="btn small ${selected ? 'primary' : ''}" data-act="${p.id}" data-kind="${kind}">${label}</button>`;
    switch (me.role) {
      case 'werewolf': return p.role === 'werewolf' ? '' : btn(ACTION.werewolf, st.myTarget === p.id);
      case 'seer': return p.id === ctx.me || st.myTarget ? '' : btn(ACTION.seer, false);
      case 'doctor': return p.id === st.lastDoctor ? '<span class="ww-note">dilindungi kemarin</span>' : btn(ACTION.doctor, st.myTarget === p.id);
      case 'cupid': {
        if (st.day !== 1) return '';
        const picked = st.cupidPicks?.includes(p.id);
        return picked ? '<span class="ww-note">💘 dijodohkan</span>' : st.cupidPicks?.length >= 2 ? '' : btn(ACTION.cupid, false);
      }
      case 'witch': {
        const w = st.witch;
        if (!w.poison || w.night?.done || p.id === ctx.me) return '';
        return btn('☠️ Racun', w.night?.poison === p.id, 'poison');
      }
      default: return '';
    }
  }

  // Panel khusus Penyihir: ramuan penyelamat + tombol selesai
  function witchPanel() {
    const w = st.witch;
    if (st.phase !== 'night' || st.me?.role !== 'witch' || !st.me.alive || !w) return '';
    const target = st.wolfTarget ? `<b>${nameOf(st.wolfTarget)}</b>` : '<i>belum ditentukan</i>';
    const done = w.night?.done;
    return `<div class="ww-witch">
      <div>🐺 Target werewolf malam ini: ${target}</div>
      <div class="ww-witch-actions">
        ${w.heal ? `<button class="btn small ${w.night?.heal ? 'primary' : ''}" data-witch="heal" ${done ? 'disabled' : ''}>💚 Selamatkan korban${w.night?.heal ? ' ✓' : ''}</button>` : '<span class="ww-note">💚 ramuan penyelamat sudah dipakai</span>'}
        ${w.poison ? '<span class="ww-note">☠️ pilih target racun di daftar pemain</span>' : '<span class="ww-note">☠️ racun sudah dipakai</span>'}
        <button class="btn small" data-witch="done" ${done ? 'disabled' : ''}>✅ Selesai</button>
      </div>
    </div>`;
  }

  // ---------- Pengaturan peran (sebelum game dimulai) ----------
  function renderSetup() {
    const cfg = st.config;
    const n = ctx.members.length;
    const wolves = cfg.wolves || autoWolves(n);
    const specials = SPECIALS.filter((r) => cfg.roles[r]);
    const need = wolves + specials.length;
    let warn = '';
    if (n < 4) warn = `Butuh minimal 4 pemain (sekarang ${n}).`;
    else if (wolves * 2 >= n) warn = `Werewolf terlalu banyak untuk ${n} pemain.`;
    else if (need > n) warn = `Peran yang dipilih butuh ${need} pemain (sekarang ${n}). Kurangi peran khusus.`;

    $('wwConfig').innerHTML = `
      <div class="ww-config-row">
        <label class="range-label">🐺 Jumlah werewolf
          <select id="wwWolves">
            <option value="0">Otomatis (${autoWolves(n)})</option>
            <option value="1">1</option><option value="2">2</option><option value="3">3</option>
          </select>
        </label>
        <span class="muted small-text">${n} pemain · ${wolves} werewolf · ${specials.length} peran khusus · ${Math.max(0, n - need)} warga biasa</span>
      </div>
      <div class="ww-role-picks">
        ${SPECIALS.map((r) => `
          <label class="ww-pick ${cfg.roles[r] ? 'on' : ''}" title="${escapeHtml(ROLES[r].desc)}">
            <input type="checkbox" data-role="${r}" ${cfg.roles[r] ? 'checked' : ''} />
            <span>${ROLES[r].icon} ${ROLES[r].name}</span>
          </label>`).join('')}
      </div>
      <p class="error small-text">${warn}</p>`;
    $('wwWolves').value = String(cfg.wolves || 0);
    $('wwStartBtn').disabled = !!warn;
  }

  $('wwConfig').addEventListener('change', (e) => {
    const cfg = structuredClone(st.config);
    if (e.target.id === 'wwWolves') cfg.wolves = Number(e.target.value);
    if (e.target.dataset.role) cfg.roles[e.target.dataset.role] = e.target.checked;
    st.config = cfg;
    renderSetup();
    socket.emit('ww:config', cfg);
  });

  // ---------- Tampilan utama ----------
  function render() {
    $('wwPhase').textContent = phaseTitle();
    $('wwEvent').classList.toggle('hidden', !st.lastEvent);
    $('wwEvent').textContent = st.lastEvent || '';

    const me = st.me;
    $('wwRole').classList.toggle('hidden', !me || st.phase === 'idle');
    if (me) {
      const r = ROLES[me.role];
      const mates = (me.role === 'werewolf' || me.role === 'minion')
        ? st.players.filter((p) => p.role === 'werewolf' && p.id !== ctx.me).map((p) => escapeHtml(p.name)) : [];
      const lovers = st.players.filter((p) => p.lover && p.id !== ctx.me).map((p) => escapeHtml(p.name));
      const amLover = st.players.find((p) => p.id === ctx.me)?.lover;
      const potions = me.role === 'witch' && st.witch ? `<div class="small-text">Ramuan: ${st.witch.heal ? '💚' : '▫️'} penyelamat · ${st.witch.poison ? '☠️' : '▫️'} racun</div>` : '';
      $('wwRole').innerHTML = `<div class="ww-role-icon">${r.icon}</div>
        <div><div class="ww-role-name">Peranmu: ${r.name}${me.alive ? '' : ' (💀 mati)'}</div>
        <div class="muted small-text">${r.desc}</div>
        ${mates.length ? `<div class="small-text">${me.role === 'minion' ? 'Werewolf yang kamu bantu' : 'Teman serigala'}: <b>${mates.join(', ')}</b></div>` : ''}
        ${amLover && lovers.length ? `<div class="small-text">💘 Pasanganmu: <b>${lovers.join(', ')}</b></div>` : ''}
        ${me.role === 'cupid' && lovers.length ? `<div class="small-text">💘 Pasangan yang kamu jodohkan: <b>${lovers.join(' & ')}</b></div>` : ''}
        ${potions}</div>`;
    }
    $('wwHint').innerHTML = hint() + witchPanel();

    // Hitung vote (siang) dan pilihan werewolf (malam, hanya terlihat oleh werewolf)
    const tally = st.tally || {};
    const wolfPick = {};
    for (const [w, t] of Object.entries(st.wolfVotes || {})) (wolfPick[t] ||= []).push(nameOf(w));
    const seer = {};
    for (const s of st.seerResults || []) seer[s.id] = s.isWolf;

    $('wwPlayers').innerHTML = st.players.map((p) => {
      const role = p.role ? `<span class="ww-badge ${ROLES[p.role].team}">${ROLES[p.role].icon} ${ROLES[p.role].name}</span>` : '';
      const seen = p.id in seer && !p.role ? `<span class="ww-badge ${seer[p.id] ? 'wolf' : 'safe'}">🔮 ${seer[p.id] ? 'Werewolf!' : 'Bukan werewolf'}</span>` : '';
      const lover = p.lover ? '<span class="ww-badge lover">💘</span>' : '';
      const votes = tally[p.id] ? `<span class="ww-votes">🗳️ ${tally[p.id]}</span>` : '';
      const wolves = wolfPick[p.id] ? `<span class="ww-note">🐺 ${wolfPick[p.id].join(', ')}</span>` : '';
      const poisoned = st.witch?.night?.poison === p.id ? '<span class="ww-note">☠️ akan diracun</span>' : '';
      return `<div class="ww-card ${p.alive ? '' : 'dead'} ${p.id === ctx.me ? 'me' : ''}">
        <div class="ww-name">${p.alive ? '' : '💀 '}${escapeHtml(p.name)}${p.id === ctx.me ? ' (kamu)' : ''}${p.left ? ' 🚪' : ''}</div>
        <div class="ww-tags">${role}${seen}${lover}${votes}${wolves}${poisoned}</div>
        <div class="ww-action">${actionsFor(p)}</div>
      </div>`;
    }).join('');

    $('wwRoster').innerHTML = active() && st.roles?.length
      ? 'Peran dalam game: ' + Object.entries(st.roles.reduce((m, r) => ((m[r] = (m[r] || 0) + 1), m), {}))
        .map(([r, c]) => `${ROLES[r].icon} ${ROLES[r].name}${c > 1 ? ` ×${c}` : ''}`).join(' · ')
      : '';

    if (st.phase === 'day' && st.votes) {
      const skips = st.tally?.skip || 0;
      $('wwSkipBtn').textContent = `🤷 Lewati (tidak vote)${skips ? ` · ${skips}` : ''}`;
      $('wwSkipBtn').classList.toggle('primary', st.votes[ctx.me] === 'skip');
    }
    $('wwSkipBtn').classList.toggle('hidden', !(st.phase === 'day' && st.me?.alive));
    $('wwStopBtn').classList.toggle('hidden', !active());
    $('wwSetup').classList.toggle('hidden', active());
    $('wwStartBtn').textContent = st.phase === 'over' ? '🔄 Main lagi' : '🐺 Mulai Werewolf';
    if (!active()) renderSetup();
  }

  setInterval(() => {
    const el = $('wwTimer');
    if (!active()) { el.textContent = ''; return; }
    const sec = Math.max(0, Math.ceil((localEndsAt - Date.now()) / 1000));
    el.textContent = `⏱️ ${sec}`;
    el.classList.toggle('low', sec <= 10);
  }, 250);

  $('wwPlayers').addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]');
    const vote = e.target.closest('[data-vote]')?.dataset.vote;
    if (act) socket.emit('ww:act', { target: act.dataset.act, kind: act.dataset.kind || undefined });
    if (vote) socket.emit('ww:vote', vote);
  });
  $('wwHint').addEventListener('click', (e) => {
    const kind = e.target.closest('[data-witch]')?.dataset.witch;
    if (kind) socket.emit('ww:act', { kind });
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
    ctx.openTab('game');
    ctx.showGameView('werewolf');
    ctx.toast('🐺 Werewolf dimulai! Cek peranmu — rahasiakan ya');
  });
  // Jumlah pemain di pengaturan ikut berubah saat ada yang masuk/keluar
  ctx.memberListeners.push(() => { if (!active()) renderSetup(); });

  render();
  return {
    reset() { st = { phase: 'idle', players: [], config: st.config }; render(); },
  };
}
