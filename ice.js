// Daftar server ICE (STUN/TURN) untuk voice chat.
// TURN dibutuhkan kalau pemain berada di jaringan yang tidak bisa terhubung langsung
// (mis. data seluler dengan CGNAT). Atur salah satu pilihan di file .env:
//
//   Cloudflare (gratis 1.000 GB/bulan):  CF_TURN_KEY_ID=...  CF_TURN_API_TOKEN=...
//   Metered (gratis 0,5 GB/bulan):       METERED_APP=namaapp  METERED_API_KEY=...
//   TURN sendiri / lainnya:              TURN_URLS=turn:host:3478,turns:host:5349  TURN_USERNAME=...  TURN_CREDENTIAL=...

const STUN = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
const CACHE_MS = 6 * 60 * 60 * 1000;

let cache = null; // { servers, expires }

async function fetchCloudflare() {
  const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${process.env.CF_TURN_KEY_ID}/credentials/generate-ice-servers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.CF_TURN_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl: 24 * 60 * 60 }),
  });
  if (!res.ok) throw new Error(`Cloudflare TURN ${res.status}: ${await res.text()}`);
  return (await res.json()).iceServers;
}

async function fetchMetered() {
  const res = await fetch(`https://${process.env.METERED_APP}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(process.env.METERED_API_KEY)}`);
  if (!res.ok) throw new Error(`Metered TURN ${res.status}: ${await res.text()}`);
  return res.json();
}

function staticTurn() {
  return [{
    urls: process.env.TURN_URLS.split(',').map((s) => s.trim()),
    username: process.env.TURN_USERNAME,
    credential: process.env.TURN_CREDENTIAL,
  }];
}

function provider() {
  if (process.env.CF_TURN_KEY_ID && process.env.CF_TURN_API_TOKEN) return ['Cloudflare', fetchCloudflare];
  if (process.env.METERED_APP && process.env.METERED_API_KEY) return ['Metered', fetchMetered];
  if (process.env.TURN_URLS) return ['TURN statis', async () => staticTurn()];
  return null;
}

async function getIceServers() {
  if (cache && cache.expires > Date.now()) return cache.servers;
  const p = provider();
  if (!p) return STUN;
  try {
    const turn = await p[1]();
    cache = { servers: [...STUN, ...(Array.isArray(turn) ? turn : [turn])], expires: Date.now() + CACHE_MS };
    return cache.servers;
  } catch (err) {
    console.error('Gagal mengambil kredensial TURN:', err.message);
    return STUN;
  }
}

function describe() {
  const p = provider();
  return p ? `TURN aktif (${p[0]})` : 'TURN belum diatur — voice hanya memakai STUN (bisa gagal di data seluler)';
}

module.exports = { getIceServers, describe };
