@echo off
REM Menyalakan MabarRoom di laptop ini + link publik HTTPS lewat Cloudflare Tunnel (gratis).
REM Klik dua kali file ini. Biarkan jendelanya terbuka selama main; tutup jendela = website mati.
cd /d "%~dp0"
title MabarRoom

if not exist node_modules (
  echo Memasang dependensi...
  call npm install --omit=dev
)
if not exist bin\cloudflared.exe (
  echo Mengunduh cloudflared...
  if not exist bin mkdir bin
  curl -fsSL -o bin\cloudflared.exe https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe
)

start "MabarRoom Server" /min cmd /k "node server.js"
timeout /t 2 /nobreak >nul

echo.
echo ============================================================
echo  Tunggu beberapa detik, lalu cari baris berisi
echo     https://....trycloudflare.com
echo  Itu link yang dibagikan ke teman. Link berganti setiap start.
echo ============================================================
echo.
bin\cloudflared.exe tunnel --no-autoupdate --url http://localhost:3000
