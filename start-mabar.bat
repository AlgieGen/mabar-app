@echo off
REM Menyalakan MabarRoom di laptop ini + link publik HTTPS lewat Cloudflare Tunnel (gratis).
REM Klik dua kali file ini. Biarkan jendelanya terbuka selama main.
REM Link untuk teman selalu sama: https://mabarroom.vercel.app
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
if not exist logs mkdir logs
if exist logs\tunnel.log del logs\tunnel.log

start "MabarRoom Server" /min cmd /k "node server.js"
timeout /t 2 /nobreak >nul
start "MabarRoom Tunnel" /min bin\cloudflared.exe tunnel --no-autoupdate --logfile logs\tunnel.log --url http://localhost:3000

echo Menyalakan server dan tunnel, tunggu sebentar...
node scripts\publish-link.js
echo.
echo Biarkan jendela "MabarRoom Server" dan "MabarRoom Tunnel" tetap terbuka (boleh diperkecil).
echo Untuk mematikan, jalankan stop-mabar.bat
pause
