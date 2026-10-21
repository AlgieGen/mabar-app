import { escapeHtml } from './util.js';
import { PALETTE, avatarSvg, avatarHtml, randomAvatar } from './avatar.js';

const TOKEN_KEY = 'mabar:token';
const SLOT_NAME = { border: '🖼️ Bingkai', acc: '🎩 Aksesori', theme: '🎨 Tema' };
const GAME_NAME = { ttt: 'Tic-Tac-Toe', c4: 'Connect 4', chess: 'Catur', tebak: 'Tebak Gambar', werewolf: 'Werewolf', undercover: 'Undercover', uno: 'UNO' };
// Warna contoh untuk pratinjau tema di toko
const THEME_SWATCH = {
  'theme:retro': ['#0d0221', '#ff2e88', '#00e5ff', '#ffe14d'],
  'theme:modern': ['#0f1020', '#7c5cff', '#3ddc97', '#ffd23f'],
  'theme:gameboy': ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'],
  'theme:candy': ['#ffe3f1', '#ff4fa3', '#5bc0eb', '#ffb703'],
  'theme:synthwave': ['#1a0933', '#ff6c11', '#f72585', '#4cc9f0'],
  'theme:matrix': ['#000000', '#003b00', '#00ff41', '#008f11'],
  'theme:sakura': ['#2a1b2e', '#ffb7c5', '#f6e3ba', '#9ad1a6'],
};

export function initProfile(ctx) {
  const { socket } = ctx;
  const $ = (id) => document.getElementById(id);
  let memToken = null;
  let catalog = { items: [], badges: [], reward: {}, levelBonus: 0 };
  let editing = null;    // salinan avatar yang sedang digambar
  let brush = 'c';
  let preview = null;    // tema yang sedang dicoba di toko
  let rankSort = 'xp';

  const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) || memToken; } catch { return memToken; } };
  const setToken = (t) => { memToken = t; try { localStorage.setItem(TOKEN_KEY, t); } catch {} };
  const me = () => ctx.profile;
  const myPublic = () => me() && { avatar: me().avatar, level: me().level, border: me().equipped.border, acc: me().equipped.acc };

  // ---------- Identitas ----------
  function hello() {
    return new Promise((resolve) => {
      socket.emit('profile:hello', { token: getToken(), name: $('userName').value.trim() }, (res) => {
        if (res.token) setToken(res.token);
        setMe(res.profile);
        if (!$('userName').value.trim()) $('userName').value = res.profile.name === 'Pemain' ? '' : res.profile.name;
        resolve(res.profile);
      });
      if (!catalog.items.length) socket.emit('profile:catalog', null, (c) => { catalog = c; render(); });
    });
  }

  function setMe(p) {
    ctx.profile = p;
    if (!editing) editing = p.avatar;
    applyTheme(preview || p.equipped.theme);
    render();
  }
  socket.on('profile:me', setMe);

  // ---------- Tema pribadi ----------
  function applyTheme(id) {
    const name = (id || 'theme:retro').split(':')[1];
    document.documentElement.dataset.theme = name;
    const retro = document.getElementById('retroCss');
    if (retro) retro.disabled = name === 'modern';
  }

  // ---------- Tampilan ----------
  function render() {
    const p = me();
    if (!p) return;
    // Chip di bar atas
    $('meChip').innerHTML = `${avatarHtml(myPublic(), { size: 26, level: false })}<span>Lv ${p.level}</span><span class="me-points">🪙 ${p.points}</span>`;
    $('meChip').classList.remove('hidden');

    // Kartu profil
    $('pfAvatar').innerHTML = avatarHtml(myPublic(), { size: 120, level: false });
    if (document.activeElement !== $('pfName')) $('pfName').value = p.name;
    const span = p.levelNext - p.levelStart;
    const progress = Math.min(100, ((p.xp - p.levelStart) / span) * 100);
    $('pfLevel').textContent = `LEVEL ${p.level}`;
    $('pfXpFill').style.width = `${progress}%`;
    $('pfXpText').textContent = `${p.xp - p.levelStart} / ${span} XP ke level ${p.level + 1}`;
    $('pfPoints').textContent = p.points;
    const s = p.stats;
    const fav = Object.entries(s.byGame).sort((a, b) => b[1].games - a[1].games)[0];
    $('pfStats').innerHTML = `
      <div><b>${s.games}</b><span>Main</span></div>
      <div><b>${s.wins}</b><span>Menang</span></div>
      <div><b>${s.games ? Math.round((s.wins / s.games) * 100) : 0}%</b><span>Rasio</span></div>
      <div><b>${s.bestStreak}</b><span>Streak</span></div>
      ${fav ? `<p class="muted small-text">Favorit: ${GAME_NAME[fav[0]] || fav[0]} (${fav[1].games}× main, ${fav[1].wins}× menang)</p>` : ''}`;

    renderEditor();
    renderEquip();
    renderBadges();
    renderShop();
    $('pfCode').textContent = getToken() || '-';
  }

  // Editor avatar 8×8
  function renderEditor() {
    $('avGrid').innerHTML = [...editing].map((ch, i) => {
      const color = PALETTE[parseInt(ch, 16)];
      return `<button class="av-cell" data-i="${i}" style="${color ? `background:${color}` : ''}"></button>`;
    }).join('');
    $('avPalette').innerHTML = PALETTE.map((c, i) => {
      const hex = i.toString(16);
      return `<button class="av-swatch ${hex === brush ? 'active' : ''} ${c ? '' : 'erase'}" data-c="${hex}" style="${c ? `background:${c}` : ''}" title="${c || 'Hapus'}"></button>`;
    }).join('');
    $('avSave').disabled = editing === me().avatar;
  }

  let painting = false;
  function paint(e) {
    const cell = e.target.closest('.av-cell');
    if (!cell) return;
    const i = Number(cell.dataset.i);
    editing = editing.slice(0, i) + brush + editing.slice(i + 1);
    cell.style.background = PALETTE[parseInt(brush, 16)] || '';
    $('avSave').disabled = editing === me().avatar;
  }
  $('avGrid').addEventListener('pointerdown', (e) => { painting = true; paint(e); });
  $('avGrid').addEventListener('pointerover', (e) => { if (painting) paint(e); });
  document.addEventListener('pointerup', () => { painting = false; });
  $('avPalette').addEventListener('click', (e) => {
    const c = e.target.dataset.c;
    if (c === undefined) return;
    brush = c;
    renderEditor();
  });
  $('avRandom').onclick = () => { editing = randomAvatar(); renderEditor(); };
  $('avClear').onclick = () => { editing = '0'.repeat(64); renderEditor(); };
  $('avSave').onclick = () => { socket.emit('profile:update', { avatar: editing }); ctx.toast('💾 Avatar disimpan!'); };
  $('pfName').addEventListener('change', () => {
    const name = $('pfName').value.trim();
    if (name) { socket.emit('profile:update', { name }); $('userName').value = name; }
  });

  // Item yang dimiliki dan sedang dipakai
  function renderEquip() {
    const p = me();
    const owned = catalog.items.filter((i) => p.owned.includes(i.id));
    $('pfEquip').innerHTML = Object.entries(SLOT_NAME).map(([slot, label]) => `
      <div class="pf-slot"><span class="muted small-text">${label}</span>
        <div class="pf-slot-items">${owned.filter((i) => i.slot === slot).map((i) => `
          <button class="btn small ${p.equipped[slot] === i.id ? 'primary' : ''}" data-equip="${i.id}">${escapeHtml(i.name)}</button>`).join('')}
        </div>
      </div>`).join('');
  }
  $('pfEquip').addEventListener('click', (e) => {
    const id = e.target.closest('[data-equip]')?.dataset.equip;
    if (id) socket.emit('profile:equip', id);
  });

  function renderBadges() {
    const got = me().badges;
    $('pfBadgeCount').textContent = `(${Object.keys(got).length}/${catalog.badges.length})`;
    $('pfBadges').innerHTML = catalog.badges.map((b) => `
      <div class="badge ${got[b.id] ? 'got' : 'locked'}" title="${escapeHtml(b.desc)}">
        <span class="badge-icon">${got[b.id] ? b.icon : '🔒'}</span>
        <span class="badge-name">${escapeHtml(b.name)}</span>
        <span class="badge-desc">${escapeHtml(b.desc)}</span>
      </div>`).join('');
  }

  // ---------- Toko ----------
  function itemPreview(item) {
    const p = myPublic();
    if (item.slot === 'border') return avatarHtml({ ...p, border: item.id }, { size: 56, level: false });
    if (item.slot === 'acc') return avatarHtml({ ...p, acc: item.id }, { size: 56, level: false });
    const sw = THEME_SWATCH[item.id] || [];
    return `<span class="theme-swatch">${sw.map((c) => `<i style="background:${c}"></i>`).join('')}</span>`;
  }

  function renderShop() {
    const p = me();
    $('shopPoints').textContent = p.points;
    $('shopList').innerHTML = Object.entries(SLOT_NAME).map(([slot, label]) => `
      <h4>${label}</h4>
      <div class="shop-grid">${catalog.items.filter((i) => i.slot === slot).map((i) => {
        const owned = p.owned.includes(i.id);
        const using = p.equipped[slot] === i.id;
        const action = using ? '<button class="btn small" disabled>✓ Dipakai</button>'
          : owned ? `<button class="btn small" data-equip-shop="${i.id}">Pakai</button>`
          : `<button class="btn small primary" data-buy="${i.id}" ${p.points < i.price ? 'disabled' : ''}>🪙 ${i.price}</button>`;
        const tryBtn = slot === 'theme' && !using ? `<button class="btn small" data-try="${i.id}">${preview === i.id ? '↩️ Batal' : '👁️ Coba'}</button>` : '';
        return `<div class="shop-item ${owned ? 'owned' : ''} ${using ? 'using' : ''}">
          <div class="shop-preview">${itemPreview(i)}</div>
          <div class="shop-name">${escapeHtml(i.name)}</div>
          <div class="shop-actions">${tryBtn}${action}</div>
        </div>`;
      }).join('')}</div>`).join('');
  }

  $('shopList').addEventListener('click', (e) => {
    const buy = e.target.closest('[data-buy]')?.dataset.buy;
    const equip = e.target.closest('[data-equip-shop]')?.dataset.equipShop;
    const tryOn = e.target.closest('[data-try]')?.dataset.try;
    if (buy) {
      const item = catalog.items.find((i) => i.id === buy);
      if (!confirm(`Beli "${item.name}" seharga ${item.price} poin?`)) return;
      socket.emit('profile:buy', buy, (res) => {
        if (res.error) return ctx.toast('❌ ' + res.error);
        preview = null;
        ctx.sfx?.('correct');
        ctx.toast(`🛒 Berhasil membeli ${item.name}!`);
        if (res.badges?.length) showReward({ badges: res.badges });
      });
    }
    if (equip) { preview = null; socket.emit('profile:equip', equip); }
    if (tryOn) {
      preview = preview === tryOn ? null : tryOn;
      applyTheme(preview || me().equipped.theme);
      renderShop();
    }
  });

  // ---------- Papan peringkat ----------
  function loadRank() {
    socket.emit('profile:leaderboard', rankSort, (list) => {
      const medal = ['🥇', '🥈', '🥉'];
      $('rankList').innerHTML = list.length ? list.map((p, i) => `
        <li class="rank-row ${p.id === me()?.id ? 'me' : ''}">
          <span class="rank-no">${medal[i] || i + 1}</span>
          ${avatarHtml(p, { size: 36 })}
          <span class="rank-name">${escapeHtml(p.name)}${p.id === me()?.id ? ' (kamu)' : ''}<small>🏅 ${p.badges} lencana · ${p.games} game</small></span>
          <span class="rank-val">${rankSort === 'wins' ? `${p.wins} 🏆` : `${p.xp} XP`}</span>
        </li>`).join('') : '<li class="muted">Belum ada yang bermain. Ayo main dulu!</li>';
    });
  }
  document.querySelectorAll('[data-sort]').forEach((b) => {
    b.onclick = () => {
      rankSort = b.dataset.sort;
      document.querySelectorAll('[data-sort]').forEach((x) => x.classList.toggle('active', x === b));
      loadRank();
    };
  });

  // ---------- Sub-tab ----------
  function openSub(name) {
    document.querySelectorAll('.subtab').forEach((b) => b.classList.toggle('active', b.dataset.sub === name));
    document.querySelectorAll('.sub-body').forEach((b) => b.classList.toggle('hidden', b.id !== `sub-${name}`));
    if (name === 'rank') loadRank();
    if (name !== 'shop' && preview) { preview = null; applyTheme(me().equipped.theme); renderShop(); }
  }
  document.querySelectorAll('.subtab').forEach((b) => { b.onclick = () => openSub(b.dataset.sub); });
  $('meChip').onclick = () => { ctx.openTab('profile'); openSub('me'); };

  // ---------- Kode akun ----------
  $('pfCopyCode').onclick = async () => {
    try { await navigator.clipboard.writeText(getToken()); ctx.toast('🔑 Kode akun disalin. Simpan baik-baik!'); }
    catch { prompt('Salin kode akun ini:', getToken()); }
  };
  $('pfLoginForm').onsubmit = (e) => {
    e.preventDefault();
    const code = $('pfLoginCode').value.trim();
    if (!code || !confirm('Masuk dengan kode ini? Profil di perangkat ini akan diganti.')) return;
    socket.emit('profile:login', code, (res) => {
      if (res.error) return ctx.toast('❌ ' + res.error);
      setToken(res.token);
      editing = res.profile.avatar;
      setMe(res.profile);
      $('pfLoginCode').value = '';
      ctx.toast(`✅ Masuk sebagai ${res.profile.name}`);
    });
  };

  // ---------- Popup hadiah ----------
  const queue = [];
  let showing = false;
  function showReward(r) { queue.push(r); if (!showing) nextReward(); }
  function nextReward() {
    const r = queue.shift();
    if (!r) { showing = false; return; }
    showing = true;
    const title = r.outcome === 'win' ? '🏆 MENANG!' : r.outcome === 'draw' ? '🤝 SERI' : r.outcome ? '🎮 GAME OVER' : '🏅 LENCANA BARU!';
    $('rewardPop').innerHTML = `
      <div class="reward-title">${title}</div>
      ${r.game ? `<div class="muted small-text">${escapeHtml(r.game)}</div>` : ''}
      ${r.xp ? `<div class="reward-gain"><span>+${r.xp} XP</span><span>+${r.points} 🪙</span></div>` : ''}
      ${r.levelUp ? `<div class="reward-level">⬆️ LEVEL UP! Lv ${r.levelUp}<small>bonus +${catalog.levelBonus} 🪙</small></div>` : ''}
      ${(r.badges || []).map((b) => `<div class="reward-badge">${b.icon} ${escapeHtml(b.name)}</div>`).join('')}`;
    $('rewardPop').classList.add('show');
    if (r.levelUp) ctx.sfx?.('levelup');
    else if (r.badges?.length) ctx.sfx?.('badge');
    else setTimeout(() => ctx.sfx?.('correct'), 1600); // setelah jingle menang/kalah
    setTimeout(() => { $('rewardPop').classList.remove('show'); setTimeout(nextReward, 300); }, r.levelUp || r.badges?.length ? 4500 : 3200);
  }
  $('rewardPop').onclick = () => $('rewardPop').classList.remove('show');
  socket.on('profile:reward', showReward);

  return { hello, myPublic };
}
