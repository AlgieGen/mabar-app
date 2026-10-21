// Menyimpan link Cloudflare Tunnel yang sedang aktif ke GitHub (branch "live-link", file link.json),
// supaya https://mabarroom.vercel.app selalu meneruskan teman ke server yang benar.
//
//   node scripts/publish-link.js                 → baca link dari logs/tunnel.log (menunggu sampai muncul)
//   node scripts/publish-link.js https://xxx.trycloudflare.com
//   node scripts/publish-link.js --offline       → tandai server mati
//
// Memakai GitHub CLI (gh) yang sudah login di laptop ini.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SHARE_URL = 'https://mabarroom.vercel.app';
const BRANCH = 'live-link';
const LOG = path.join(__dirname, '..', 'logs', 'tunnel.log');

function findGh() {
  for (const candidate of ['gh', 'C:\\Program Files\\GitHub CLI\\gh.exe']) {
    try { execFileSync(candidate, ['--version'], { stdio: 'ignore' }); return candidate; } catch {}
  }
  throw new Error('GitHub CLI (gh) tidak ditemukan.');
}

function repoName() {
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: path.join(__dirname, '..') }).toString().trim();
    const m = url.match(/github\.com[:/](.+?)(\.git)?$/);
    if (m) return m[1];
  } catch {}
  return 'AlgieGen/mabar-app';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForTunnelUrl() {
  for (let i = 0; i < 90; i++) {
    try {
      const m = fs.readFileSync(LOG, 'utf8').match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m) return m[0];
    } catch {}
    await sleep(1000);
  }
  throw new Error('Link tunnel tidak muncul dalam 90 detik. Cek logs/tunnel.log.');
}

async function waitUntilReachable(url) {
  for (let i = 0; i < 30; i++) {
    try { if ((await fetch(url, { signal: AbortSignal.timeout(5000) })).ok) return; } catch {}
    await sleep(2000);
  }
  console.warn('⚠️  Link belum bisa dibuka, tetap disimpan.');
}

async function main() {
  const offline = process.argv[2] === '--offline';
  const url = offline ? '' : process.argv[2] || (await waitForTunnelUrl());
  if (!offline) await waitUntilReachable(url);

  const gh = findGh();
  const repo = repoName();
  const api = (args, input) => execFileSync(gh, ['api', ...args], { input, stdio: ['pipe', 'pipe', 'pipe'] }).toString();

  // Buat branch live-link dari main kalau belum ada
  try {
    api([`repos/${repo}/git/ref/heads/${BRANCH}`]);
  } catch {
    const mainSha = JSON.parse(api([`repos/${repo}/git/ref/heads/main`])).object.sha;
    api(['-X', 'POST', `repos/${repo}/git/refs`, '-f', `ref=refs/heads/${BRANCH}`, '-f', `sha=${mainSha}`]);
  }

  let sha;
  try { sha = JSON.parse(api([`repos/${repo}/contents/link.json?ref=${BRANCH}`])).sha; } catch {}

  const body = JSON.stringify({
    message: offline ? 'Server offline' : `Link server: ${url}`,
    branch: BRANCH,
    content: Buffer.from(JSON.stringify({ url, updatedAt: Date.now() }, null, 2)).toString('base64'),
    ...(sha ? { sha } : {}),
  });
  api(['-X', 'PUT', `repos/${repo}/contents/link.json`, '--input', '-'], body);

  if (offline) return console.log('😴 mabarroom.vercel.app sekarang menampilkan "server offline".');
  console.log('');
  console.log('============================================================');
  console.log(`  ✅ Bagikan link ini ke teman:  ${SHARE_URL}`);
  console.log(`     (diteruskan ke ${url})`);
  console.log('============================================================');
}

main().catch((err) => {
  console.error('❌ Gagal memperbarui link mabarroom:', err.message);
  process.exit(1);
});
