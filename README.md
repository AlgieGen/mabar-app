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
- **🎨 Tebak Gambar** — bergiliran menggambar, yang lain menebak lewat chat. Ada timer 80 detik, petunjuk huruf, poin (makin cepat makin besar), dan papan skor. Daftar kata bisa ditambah di `words.js`.
- **Sambung ulang otomatis** kalau koneksi putus.

## Menjalankan
```bash
npm install
npm start
```
Buka http://localhost:3000

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

## Catatan teknis
- Data room (chat, planning, foto, game papan) disimpan ke `data/rooms.json` setiap 10 detik, jadi tetap ada setelah server restart. Room kosong dihapus setelah 3 hari tidak aktif. Catatan: di hosting gratis seperti Render, disk akan direset saat deploy ulang.
- Voice memakai mesh P2P, cocok untuk ±2–6 orang. Kalau ada teman di jaringan ketat (mis. sebagian jaringan seluler/kantor) yang tidak bisa tersambung, tambahkan server TURN di `ICE_SERVERS` pada `public/js/voice.js`.

## Struktur
```
server.js            Server Express + Socket.IO (room, sinkronisasi, signaling voice, penyimpanan)
tebak.js             Logika game Tebak Gambar
words.js             Daftar kata Tebak Gambar
public/index.html    Tampilan
public/style.css
public/js/main.js     Lobby, room, anggota, chat
public/js/voice.js    Voice chat WebRTC
public/js/planning.js
public/js/photo.js
public/js/game.js       Tic-Tac-Toe & Connect 4
public/js/tebak.js      Tebak Gambar
```
