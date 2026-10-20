# 🎮 MabarRoom

Website untuk kumpul bareng teman secara online: bikin room, planning, edit foto bareng, main game, dan ngobrol pakai voice sambil main.

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

## Main dengan teman
Mikrofon di browser hanya boleh dipakai lewat **HTTPS** atau **localhost**. Jadi kalau teman membuka lewat `http://192.168.x.x:3000`, voice tidak akan jalan. Pilihan:

1. **Tunnel (paling cepat, untuk coba-coba)**
   ```bash
   npx cloudflared tunnel --url http://localhost:3000
   ```
   Bagikan link `https://....trycloudflare.com` yang muncul.
2. **Deploy** ke Render / Railway / Fly.io (gratis/murah, otomatis HTTPS). Perintah start: `npm start`.

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
