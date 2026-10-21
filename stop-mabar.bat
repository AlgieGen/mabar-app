@echo off
REM Mematikan server MabarRoom dan Cloudflare Tunnel.
cd /d "%~dp0"
taskkill /f /im cloudflared.exe >nul 2>&1
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000 " ^| findstr LISTENING') do taskkill /f /pid %%p >nul 2>&1
node scripts\publish-link.js --offline
echo MabarRoom sudah dimatikan.
timeout /t 3 >nul
