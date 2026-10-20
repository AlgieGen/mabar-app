// Nonton YouTube bareng: server menyimpan video yang sedang diputar, posisi, status play/pause, dan antrean.

const MAX_QUEUE = 50;

// Ambil ID video dari berbagai bentuk link YouTube
function parseVideoId(input) {
  const s = String(input ?? '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const url = new URL(s.startsWith('http') ? s : `https://${s}`);
    const host = url.hostname.replace(/^(www\.|m\.|music\.)/, '');
    if (host === 'youtu.be') return url.pathname.slice(1, 12) || null;
    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      if (url.searchParams.get('v')) return url.searchParams.get('v').slice(0, 11);
      const m = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{11})/);
      if (m) return m[1];
    }
  } catch {}
  return null;
}

async function fetchTitle(videoId) {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    return (await res.json()).title?.slice(0, 120) || null;
  } catch {
    return null;
  }
}

function createWatch(io, systemMessage) {
  const states = new Map();

  function get(room) {
    if (!states.has(room.code)) {
      states.set(room.code, { current: null, playing: false, position: 0, updatedAt: Date.now(), queue: [] });
    }
    return states.get(room.code);
  }

  const position = (t) => t.position + (t.playing ? (Date.now() - t.updatedAt) / 1000 : 0);

  function publicState(room) {
    const t = get(room);
    return { current: t.current, playing: t.playing, position: position(t), queue: t.queue };
  }

  const emit = (room) => io.to(room.code).emit('yt:state', publicState(room));

  function setPosition(t, pos, playing) {
    t.position = Math.max(0, Number(pos) || 0);
    t.playing = playing;
    t.updatedAt = Date.now();
  }

  function playNext(room) {
    const t = get(room);
    t.current = t.queue.shift() || null;
    setPosition(t, 0, !!t.current);
    emit(room);
  }

  function register(socket, getRoom) {
    socket.on('yt:add', async (url, cb) => {
      const room = getRoom(); if (!room) return;
      const id = parseVideoId(url);
      if (!id) return cb?.({ error: 'Link YouTube tidak dikenali.' });
      const t = get(room);
      if (t.queue.length >= MAX_QUEUE) return cb?.({ error: 'Antrean sudah penuh.' });
      const by = room.members.get(socket.id)?.name ?? '?';
      const item = { id, title: (await fetchTitle(id)) || `Video ${id}`, by };
      if (!t.current) {
        t.current = item;
        setPosition(t, 0, true);
        systemMessage(room, `📺 ${by} memutar: ${item.title}`);
      } else {
        t.queue.push(item);
        systemMessage(room, `📺 ${by} menambahkan ke antrean: ${item.title}`);
      }
      cb?.({ ok: true });
      emit(room);
    });

    // Play / pause / lompat waktu dari salah satu penonton diteruskan ke semua orang
    socket.on('yt:control', ({ action, position: pos } = {}) => {
      const room = getRoom(); if (!room) return;
      const t = get(room);
      if (!t.current) return;
      if (action === 'play') setPosition(t, pos, true);
      else if (action === 'pause') setPosition(t, pos, false);
      else if (action === 'seek') setPosition(t, pos, t.playing);
      else return;
      socket.to(room.code).emit('yt:state', publicState(room));
    });

    socket.on('yt:ended', (id) => {
      const room = getRoom(); if (!room) return;
      const t = get(room);
      if (t.current?.id === id && position(t) > 1) playNext(room);
    });

    socket.on('yt:next', () => {
      const room = getRoom(); if (!room) return;
      const t = get(room);
      if (!t.current) return;
      systemMessage(room, `⏭️ ${room.members.get(socket.id)?.name} melewati video.`);
      playNext(room);
    });

    socket.on('yt:remove', (index) => {
      const room = getRoom(); if (!room) return;
      const t = get(room);
      if (!Number.isInteger(index) || index < 0 || index >= t.queue.length) return;
      t.queue.splice(index, 1);
      emit(room);
    });

    socket.on('yt:stop', () => {
      const room = getRoom(); if (!room) return;
      const t = get(room);
      t.current = null;
      t.queue = [];
      setPosition(t, 0, false);
      emit(room);
    });
  }

  function onJoin(room, id) {
    if (states.has(room.code)) io.to(id).emit('yt:state', publicState(room));
  }

  function remove(room) { states.delete(room.code); }

  return { register, onJoin, onLeave() {}, remove };
}

module.exports = { createWatch, parseVideoId };
