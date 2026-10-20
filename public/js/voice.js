// Voice chat dengan WebRTC (mesh: setiap peserta terhubung langsung ke peserta lain).
// Server hanya meneruskan sinyal (offer/answer/ICE), audio tidak lewat server.

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

export function initVoice(ctx) {
  const { socket } = ctx;
  const $ = (id) => document.getElementById(id);
  let localStream = null;
  let muted = false;
  const peers = new Map(); // id -> { pc, audio }
  const meters = new Map(); // id -> analyser
  let audioCtx = null;
  let signalQueue = Promise.resolve();

  async function join() {
    $('voiceError').textContent = '';
    if (!navigator.mediaDevices?.getUserMedia) {
      $('voiceError').textContent = 'Browser tidak mendukung mikrofon, atau halaman tidak dibuka lewat HTTPS/localhost.';
      return;
    }
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (err) {
      $('voiceError').textContent = 'Tidak bisa mengakses mikrofon: ' + err.message;
      return;
    }
    audioCtx = audioCtx || new AudioContext();
    addMeter(ctx.me, localStream);
    muted = false;
    updateButtons(true);

    socket.emit('voice:join', null, async (others) => {
      for (const id of others) {
        const pc = createPeer(id);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('voice:signal', { to: id, data: { sdp: pc.localDescription } });
      }
    });
    ctx.toast('Kamu masuk voice 🎙️');
  }

  function leave() {
    if (!localStream) return;
    socket.emit('voice:leave');
    for (const id of [...peers.keys()]) closePeer(id);
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
    meters.delete(ctx.me);
    updateButtons(false);
  }

  function createPeer(id) {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
    const audio = new Audio();
    audio.autoplay = true;
    pc.onicecandidate = (e) => {
      if (e.candidate) socket.emit('voice:signal', { to: id, data: { candidate: e.candidate } });
    };
    pc.ontrack = (e) => {
      audio.srcObject = e.streams[0];
      audio.play().catch(() => {});
      addMeter(id, e.streams[0]);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') closePeer(id);
    };
    peers.set(id, { pc, audio });
    return pc;
  }

  function closePeer(id) {
    const p = peers.get(id);
    if (!p) return;
    p.pc.close();
    p.audio.srcObject = null;
    peers.delete(id);
    meters.delete(id);
  }

  async function handleSignal({ from, data }) {
    if (!localStream) return;
    if (data.sdp) {
      if (data.sdp.type === 'offer') {
        if (peers.has(from)) closePeer(from);
        const pc = createPeer(from);
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
