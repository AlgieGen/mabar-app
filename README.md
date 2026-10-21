# 🎮 MabarRoom

Website untuk kumpul bareng teman secara online: bikin room, planning, edit foto bareng, main game, dan ngobrol pakai voice sambil main.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/AlgieGen/mabar-app)

## Fitur
- **Room** — buat room dengan kode 5 huruf, bagikan link undangan.
- **Voice chat** — WebRTC peer-to-peer, ada mute dan indikator siapa yang sedang bicara.
- **Chat teks** di samping.
- **Planning** — daftar rencana (tanggal, ditugaskan ke siapa, centang selesai) + catatan bersama.
- **Edit foto bareng** — upload foto, coret pena/penghapus, tambah teks, filter (kecerahan, kontras, saturasi, hitam-putih, sepia, hue, blur), undo, download. Semua tersinkron ke semua orang di room.
- **Game papan** — Tic-Tac-Toe dan Connect 4 (2 pemain, sisanya menonton).
- **♟️ Catur** — aturan lengkap (skakmat, remis, rokade, en passant, promosi), papan dibalik untuk hitam, riwayat langkah, menyerah.
- **🐺 Werewolf** — 4+ pemain, 11 peran yang bisa dipilih sendiri: Werewolf, Peramal, Dokter, Penyihir, Pemburu, Kupid, Tetua, Kepala Desa, Pengkhianat, Badut, Warga. Fase malam & voting siang. Paling seru sambil voice!
- **🎭 Undercover** — semua dapat kata yang sama kecuali Undercover (kata mirip) dan Mr. White (tanpa kata). Beri petunjuk bergiliran, lalu vote. 70 pasangan kata.
- **🃏 UNO** — 2–10 pemain, aturan lengkap (+2, +4, skip, balik arah, ganti warna), seruan UNO! dan tombol tangkap.
- **📺 Nonton YouTube bareng** — play/pause/lompat waktu tersinkron untuk semua orang, dengan antrean video.
- **🎨 Tebak Gambar** — bergiliran menggambar, yang lain menebak lewat chat. Ada timer 80 detik, petunjuk huruf, poin (makin cepat makin besar), dan papan skor. Daftar kata bisa ditambah di `words.js`.
- **👾 Profil pemain** — avatar pixel 8×8 (gambar sendiri atau acak), XP & level, poin 🪙, 20 lencana, papan peringkat. Akun dibuat otomatis per perangkat; pindah perangkat dengan kode akun.
- **🛒 Toko** — belanjakan poin dari bermain untuk bingkai avatar, aksesori (topi, mahkota, dll.), dan tema website pribadi (Game Boy, Candy Pop, Synthwave, Matrix, Sakura).
- **Sambung ulang otomatis** kalau koneksi putus.
- **Tema Pixel Art / Retro Arcade** dengan **efek suara 8-bit** (klik, chat, giliran, menang/kalah, malam/siang Werewolf, UNO!) — bisa dimatikan lewat tombol 🔊 SFX.

## Menjalankan
```bash
npm install
npm start
```
Buka http://localhost:3000

## Jalankan di laptop + link publik (gratis)
Di Windows, klik dua kali **start-mabar.bat**. Server menyala, Cloudflare Tunnel memberi link `https://....trycloudflare.com`, lalu link itu otomatis disimpan ke branch `live-link` (file `link.json`) lewat GitHub CLI.

Bagikan **https://mabarroom.vercel.app** ke teman — halaman di folder `share/` (di-deploy ke Vercel) membaca `link.json` dan meneruskan ke server yang sedang aktif, termasuk kode room (`/?room=AB3XZ`). Laptop harus tetap menyala. Matikan dengan **stop-mabar.bat** (halaman pendek akan menampilkan "server offline").

## Deploy ke VPS (disarankan)
Butuh VPS Ubuntu 22.04/24.04 atau Debian 12 dengan IPv4 publik (bukan NAT) dan akses root. Login SSH lalu jalankan:
```bash
curl -fsSL https://raw.githubusercontent.com/AlgieGen/mabar-app/main/deploy/setup-vps.sh | bash
```
Skrip memasang Node.js, Caddy (HTTPS otomatis), dan service systemd. Tanpa domain, alamatnya `https://<ip-dengan-strip>.sslip.io`.
Punya domain? Arahkan record A ke IP VPS, lalu tambahkan `-s -- domainkamu.com` di akhir perintah (`... | bash -s -- domainkamu.com`).
Untuk update ke versi terbaru dari GitHub, jalankan ulang perintah yang sama.

## Deploy (Vercel + Render)
Vercel tidak mendukung server yang terus menyala (dibutuhkan Socket.IO, game, dan voice), jadi deploy dibagi dua:

| Bagian | Hosting | Isi |
|---|---|---|
| Server realtime | **Render** | `server.js` (room, chat, game, signaling voice) |
| Tampilan | **Vercel** | folder `public/` |

1. **Render**: klik tombol *Deploy to Render* di atas → *Apply*. Catat alamatnya, mis. `https://mabar-room.onrender.com`.
2. **Vercel**: *Add New → Project* → import repo ini. Di *Environment Variables* tambahkan
   `MABAR_SERVER_URL` = alamat Render dari langkah 1 → *Deploy*.
3. (Opsional, lebih aman) Di Render → *Environment*, tambahkan `ALLOWED_ORIGINS` = alamat Vercel-mu
   (mis. `https://mabar-app.vercel.app`) supaya hanya tampilanmu yang boleh terhubung.

Pengaturan build Vercel ada di `vercel.json`; `scripts/build-config.js` menulis alamat server ke `public/config.js`.

Mikrofon hanya boleh dipakai lewat **HTTPS** atau **localhost**. Kedua hosting di atas sudah otomatis HTTPS.
Untuk coba cepat tanpa deploy: `npx cloudflared tunnel --url http://localhost:3000`.

## Voice tidak terdengar? Pasang TURN
Kalau pemain memakai data seluler atau WiFi kantor/kos, koneksi suara langsung sering gagal (ikon ⚠️ di daftar anggota).
Solusinya server TURN gratis. Salin `.env.example` menjadi `.env`, isi salah satu pilihan (mis. Cloudflare Realtime TURN, gratis 1.000 GB/bulan), lalu restart server.
Saat start, server menulis `Voice: TURN aktif (...)` kalau berhasil.

## Catatan teknis
- Profil pemain disimpan di `data/profiles.json`. Semua poin, XP, dan pembelian dihitung di server.
- Data room (chat, planning, foto, game papan) disimpan ke `data/rooms.json` setiap 10 detik, jadi tetap ada setelah server restart. Room kosong dihapus setelah 3 hari tidak aktif. Catatan: di hosting gratis seperti Render, disk akan direset saat deploy ulang.
- Voice memakai mesh P2P, cocok untuk ±2–6 orang. Kalau ada teman di jaringan ketat (mis. sebagian jaringan seluler/kantor) yang tidak bisa tersambung, tambahkan server TURN di `ICE_SERVERS` pada `public/js/voice.js`.

## Struktur
```
server.js            Server Express + Socket.IO (room, sinkronisasi, signaling voice, penyimpanan)
tebak.js             Logika game Tebak Gambar
werewolf.js          Logika game Werewolf
undercover.js        Logika game Undercover
uno.js               Logika game UNO
watch.js             Nonton YouTube bareng
ice.js               Server STUN/TURN untuk voice
profiles.js          Profil, XP/level, lencana, toko, peringkat
words.js             Daftar kata Tebak Gambar
share/index.html     Halaman pendek mabarroom.vercel.app
scripts/publish-link.js  Simpan link tunnel aktif ke GitHub
public/index.html    Tampilan
public/style.css
public/js/main.js     Lobby, room, anggota, chat
public/js/voice.js    Voice chat WebRTC
public/js/planning.js
public/js/photo.js
public/js/game.js       Tic-Tac-Toe, Connect 4 & Catur
public/js/werewolf.js   Werewolf
public/js/undercover.js Undercover
public/js/uno.js        UNO
public/js/watch.js      Nonton YouTube bareng
public/js/tebak.js      Tebak Gambar
public/js/profile.js    Profil, editor avatar, toko, peringkat
public/js/avatar.js     Gambar avatar pixel + aksesori
public/themes.css       Tema pribadi + gaya profil/toko
```
