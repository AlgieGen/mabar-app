// Voice chat dengan WebRTC (mesh: setiap peserta terhubung langsung ke peserta lain).
// Server hanya meneruskan sinyal (offer/answer/ICE) dan memberi daftar server STUN/TURN.

const FALLBACK_ICE = [{ urls: 'stun:stun.l.google.com:19302' }];
const MAX_RETRIES = 2;

export function initVoice(ctx) {
  const { socket } = ctx;
  const $ = (id) => document.getElementById(id);
  let localStream = null;
  let muted = false;
  let iceServers = FALLBACK_ICE;
  const peers = new Map();   // id -> { pc, audio, retries }
  const status = new Map();  // id -> 'connecting' | 'connected' | 'failed'
  const meters = new Map();  // id -> analyser
  let audioCtx = null;
  let signalQueue = Promise.resolve();

  // Elemen audio ditaruh di halaman (wajib untuk Safari/iOS)
  const sink = document.createElement('div');
  sink.hidden = true;
  document.body.appendChild(sink);

  async function join() {
    $('voiceError').textContent = '';
    if (!navigator.mediaDevices?.getUserMedia) {
      $('voiceError').textContent = 'Browser tidak mendukung mikrofon, atau halaman tidak dibuka lewat HTTPS.';
      return;
    }
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (err) {
      $('voiceError').textContent = err.name === 'NotAllowedError'
        ? 'Izin mikrofon ditolak. Klik ikon gembok di address bar → izinkan Mikrofon, lalu coba lagi.'
        : 'Tidak bisa mengakses mikrofon: ' + err.message;
      return;
    }
    audioCtx = audioCtx || new AudioContext();
    audioCtx.resume();
    addMeter(ctx.me, localStream);
    muted = false;
    updateButtons(true);

    iceServers = await new Promise((resolve) => {
      const t = setTimeout(() => resolve(FALLBACK_ICE), 5000);
      socket.emit('voice:ice', null, (servers) => { clearTimeout(t); resolve(servers?.length ? servers : FALLBACK_ICE); });
    });

    socket.emit('voice:join', null, (others) => others.forEach((id) => call(id)));
    ctx.toast('Kamu masuk voice 🎙️');
  }

  function leave() {
    if (!localStream) return;
    socket.emit('voice:leave');
    for (const id of [...peers.keys()]) closePeer(id);
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
    meters.delete(ctx.me);
    status.clear();
    paintStatus();
    updateButtons(false);
  }

  async function call(id, retries = 0) {
    const pc = createPeer(id, retries);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('voice:signal', { to: id, data: { sdp: pc.localDescription } });
  }

  function createPeer(id, retries = 0) {
    if (peers.has(id)) closePeer(id);
    const pc = new RTCPeerConnection({ iceServers });
    localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.playsInline = true;
    sink.appendChild(audio);

    pc.onicecandidate = (e) => {
      if (e.candidate) socket.emit('voice:signal', { to: id, data: { candidate: e.candidate } });
    };
    pc.ontrack = (e) => {
      audio.srcObject = e.streams[0];
      playAudio(audio);
      addMeter(id, e.streams[0]);
    };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === 'connected') setStatus(id, 'connected');
      else if (s === 'failed') onFailed(id);
    };
    peers.set(id, { pc, audio, retries });
    setStatus(id, 'connecting');
    return pc;
  }

  function onFailed(id) {
    const p = peers.get(id);
    if (!p) return;
    // Yang ID-nya lebih kecil yang mencoba menyambung ulang, supaya tidak saling tabrak
    if (p.retries < MAX_RETRIES && ctx.me < id) {
      call(id, p.retries + 1).catch(console.error);
      return;
    }
    setStatus(id, 'failed');
    ctx.toast(`Voice ke ${ctx.memberName(id)} gagal tersambung. Jaringan kalian mungkin butuh server TURN.`);
  }

  function closePeer(id) {
    const p = peers.get(id);
    if (!p) return;
    p.pc.close();
    p.audio.srcObject = null;
    p.audio.remove();
    peers.delete(id);
    meters.delete(id);
    status.delete(id);
    paintStatus();
  }

  async function handleSignal({ from, data }) {
    if (!localStream) return;
    if (data.sdp) {
      if (data.sdp.type === 'offer') {
        const retries = peers.get(from)?.retries ?? 0;
        const pc = createPeer(from, retries);
        await pc.setRemoteDescription(data.sdp);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('voice:signal', { to: from, data: { sdp: pc.localDescription } });
      } else {
        await peers.get(from)?.pc.setRemoteDescription(data.sdp);
      }
    } else if (data.candidate) {
      try { await peers.get(from)?.pc.addIceCandidate(data.candidate); } catch {}
    }
  }

  // Sinyal diproses berurutan supaya ICE candidate tidak datang sebelum offer selesai diproses
  socket.on('voice:signal', (msg) => {
    signalQueue = signalQueue.then(() => handleSignal(msg)).catch((e) => console.error('voice signal', e));
  });
  socket.on('voice:peer-left', closePeer);

  // ---------- Pemutaran audio ----------
  // Browser bisa memblokir audio yang diputar otomatis; tampilkan tombol untuk mengaktifkannya
  function playAudio(audio) {
    audio.play().catch(() => $('audioUnlockBtn').classList.remove('hidden'));
  }
  $('audioUnlockBtn').onclick = () => {
    audioCtx?.resume();
    for (const p of peers.values()) p.audio.play().catch(() => {});
    $('audioUnlockBtn').classList.add('hidden');
  };

  // ---------- Status koneksi per anggota ----------
  const STATUS_TEXT = { connecting: '⏳', failed: '⚠️' };
  const STATUS_TITLE = { connecting: 'Menyambungkan voice...', failed: 'Voice gagal tersambung' };
  function setStatus(id, s) { status.set(id, s); paintStatus(); }
  function paintStatus() {
    document.querySelectorAll('#memberList li[data-id]').forEach((li) => {
      const el = li.querySelector('.m-status');
      const s = status.get(li.dataset.id);
      el.textContent = STATUS_TEXT[s] || '';
      el.title = STATUS_TITLE[s] || '';
    });
  }
  ctx.memberListeners.push(paintStatus);

  // ---------- Indikator bicara ----------
  function addMeter(id, stream) {
    if (!audioCtx) return;
    const src = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    meters.set(id, analyser);
  }
  const buf = new Uint8Array(512);
  function tick() {
    for (const [id, analyser] of meters) {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
      const speaking = Math.sqrt(sum / buf.length) > 0.04 && !(id === ctx.me && muted);
      document.querySelector(`#memberList li[data-id="${id}"]`)?.classList.toggle('speaking', speaking);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ---------- Tombol ----------
  function updateButtons(inVoice) {
    $('voiceJoinBtn').classList.toggle('hidden', inVoice);
    $('voiceControls').classList.toggle('hidden', !inVoice);
    $('muteBtn').textContent = muted ? '🎙️ Unmute' : '🔇 Mute';
  }
  $('voiceJoinBtn').onclick = join;
  $('voiceLeaveBtn').onclick = leave;
  $('muteBtn').onclick = () => {
    muted = !muted;
    localStream?.getAudioTracks().forEach((t) => (t.enabled = !muted));
    socket.emit('voice:mute', muted);
    updateButtons(true);
  };

  return { leave };
}
