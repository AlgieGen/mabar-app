import { escapeHtml } from './util.js';

// Nonton YouTube bareng memakai YouTube IFrame API.
// Server menyimpan posisi acuan; setiap klien menyesuaikan pemutarnya sendiri.

const PLAYING = 1, PAUSED = 2, BUFFERING = 3, ENDED = 0;

let apiPromise = null;
function loadYouTubeApi() {
  if (!apiPromise) {
    apiPromise = new Promise((resolve) => {
      window.onYouTubeIframeAPIReady = resolve;
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(s);
    });
  }
  return apiPromise;
}

export function initWatch(ctx) {
  const { socket } = ctx;
  const $ = (id) => document.getElementById(id);
  let st = { current: null, playing: false, position: 0, queue: [] };
  let base = { pos: 0, at: Date.now(), playing: false };
  let player = null;
  let playerReady = false;
  let loadedId = null;
  let ignoreUntil = 0; // abaikan event pemutar sesaat setelah kita sendiri mengubahnya

  const expected = () => base.pos + (base.playing ? (Date.now() - base.at) / 1000 : 0);
  const suppress = (ms = 1500) => { ignoreUntil = Date.now() + ms; };
  const suppressed = () => Date.now() < ignoreUntil;

  function setBase(pos, playing) { base = { pos, at: Date.now(), playing }; }

  async function ensurePlayer() {
    if (player) return;
    await loadYouTubeApi();
    if (player) return;
    player = new YT.Player('ytPlayer', {
      width: '100%',
      height: '100%',
      playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
      events: {
        onReady: () => { playerReady = true; apply(); },
        onStateChange: onLocalState,
      },
    });
  }

  // Samakan pemutar lokal dengan state dari server
  function apply() {
    renderInfo();
    if (!st.current) {
      if (playerReady && loadedId) { suppress(); player.stopVideo(); }
      loadedId = null;
      return;
    }
    if (!player) { ensurePlayer(); return; }
    if (!playerReady) return;

    suppress();
    if (loadedId !== st.current.id) {
      loadedId = st.current.id;
      const opts = { videoId: loadedId, startSeconds: expected() };
      if (base.playing) player.loadVideoById(opts); else player.cueVideoById(opts);
      checkAutoplay();
      return;
    }
    const state = player.getPlayerState();
    if (Math.abs(player.getCurrentTime() - expected()) > 2) player.seekTo(expected(), true);
    if (base.playing && state !== PLAYING && state !== BUFFERING) { player.playVideo(); checkAutoplay(); }
    if (!base.playing && state === PLAYING) player.pauseVideo();
  }

  // Browser bisa memblokir video yang diputar otomatis; beri tahu penonton untuk menekan play
  function checkAutoplay() {
    setTimeout(() => {
      if (!playerReady || !base.playing || !st.current) return;
      const s = player.getPlayerState();
      $('ytError').textContent = s === PLAYING || s === BUFFERING ? '' : '▶️ Klik tombol play di video untuk ikut menonton.';
    }, 2500);
  }

  // Penonton ini menekan play/pause/lompat di pemutar → kirim ke semua orang
  function onLocalState(e) {
    if (!st.current) return;
    if (e.data === ENDED) { socket.emit('yt:ended', st.current.id); return; }
    if (e.data === PLAYING) $('ytError').textContent = '';
    if (suppressed()) return;
    const now = player.getCurrentTime();
    if (e.data === PLAYING) {
      const diff = now - expected();
      if (!base.playing) {
        setBase(now, true);
        socket.emit('yt:control', { action: 'play', position: now });
      } else if (diff > 3 || diff < -8) {
        // Lompatan besar = penonton menggeser waktu video
        setBase(now, true);
        socket.emit('yt:control', { action: 'seek', position: now });
      } else if (Math.abs(diff) > 1.5) {
        suppress(); player.seekTo(expected(), true); // tertinggal sedikit karena buffering: kejar sendiri
      }
    } else if (e.data === PAUSED && base.playing) {
      setBase(now, false);
      socket.emit('yt:control', { action: 'pause', position: now });
    }
  }

  // Deteksi lompat waktu saat video dijeda, dan koreksi selisih kecil saat diputar
  setInterval(() => {
    if (!playerReady || !st.current || suppressed() || loadedId !== st.current.id) return;
    const state = player.getPlayerState();
    const now = player.getCurrentTime();
    if (!base.playing && state === PAUSED && Math.abs(now - base.pos) > 1.5) {
      setBase(now, false);
      socket.emit('yt:control', { action: 'seek', position: now });
    } else if (base.playing && state === PLAYING && Math.abs(now - expected()) > 3) {
      suppress(); player.seekTo(expected(), true);
    }
  }, 1000);

  function renderInfo() {
    $('ytEmpty').classList.toggle('hidden', !!st.current);
    $('ytPlayer').classList.toggle('hidden', !st.current);
    $('ytNow').classList.toggle('hidden', !st.current);
    if (st.current) $('ytTitle').innerHTML = `▶️ ${escapeHtml(st.current.title)} <span class="muted small-text">· dari ${escapeHtml(st.current.by)}</span>`;
    else $('ytError').textContent = '';
    $('ytQueue').innerHTML = st.queue.length
      ? st.queue.map((q, i) => `<li><span>${escapeHtml(q.title)} <span class="muted small-text">· ${escapeHtml(q.by)}</span></span><button class="t-del" data-remove="${i}" title="Hapus">✕</button></li>`).join('')
      : '<li class="muted">Antrean kosong</li>';
  }

  $('ytForm').onsubmit = (e) => {
    e.preventDefault();
    const url = $('ytUrl').value.trim();
    if (!url) return;
    $('ytError').textContent = '';
    socket.emit('yt:add', url, (res) => {
      if (res?.error) { $('ytError').textContent = res.error; return; }
      $('ytUrl').value = '';
      ensurePlayer(); // tekan tombol = interaksi pengguna, jadi video boleh diputar otomatis
    });
  };
  $('ytNextBtn').onclick = () => socket.emit('yt:next');
  $('ytStopBtn').onclick = () => { if (confirm('Hentikan video dan kosongkan antrean untuk semua orang?')) socket.emit('yt:stop'); };
  $('ytQueue').addEventListener('click', (e) => {
    const i = e.target.dataset.remove;
    if (i !== undefined) socket.emit('yt:remove', Number(i));
  });

  socket.on('yt:state', (s) => {
    st = s;
    setBase(s.position, s.playing);
    apply();
  });

  renderInfo();
  return {
    reset() { st = { current: null, playing: false, position: 0, queue: [] }; setBase(0, false); apply(); },
  };
}
