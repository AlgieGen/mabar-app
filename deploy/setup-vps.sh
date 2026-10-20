#!/usr/bin/env bash
# Instalasi MabarRoom di VPS Ubuntu/Debian (jalankan sebagai root).
#
#   curl -fsSL https://raw.githubusercontent.com/AlgieGen/mabar-app/main/deploy/setup-vps.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/AlgieGen/mabar-app/main/deploy/setup-vps.sh | bash -s -- domainkamu.com
#
# Tanpa domain, alamat otomatis memakai <ip>.sslip.io (gratis, tetap HTTPS).
# Jalankan ulang skrip yang sama untuk meng-update aplikasi ke versi terbaru dari GitHub.
set -euo pipefail

REPO="https://github.com/AlgieGen/mabar-app.git"
APP_DIR="/opt/mabar-app"
APP_USER="mabar"
PORT=3000

if [ "$(id -u)" -ne 0 ]; then
  echo "Jalankan sebagai root (atau pakai sudo)." >&2
  exit 1
fi

DOMAIN="${1:-}"
if [ -z "$DOMAIN" ]; then
  IP="$(curl -4 -fsS https://api.ipify.org)"
  DOMAIN="${IP//./-}.sslip.io"
fi
echo "==> Domain: $DOMAIN"

echo "==> Memasang paket dasar"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  echo "==> Memasang Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! command -v caddy >/dev/null; then
  echo "==> Memasang Caddy (server web + HTTPS otomatis)"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

echo "==> Mengambil kode aplikasi"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR"
chown "$APP_USER:$APP_USER" "$APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  runuser -u "$APP_USER" -- git -C "$APP_DIR" pull --ff-only
else
  runuser -u "$APP_USER" -- git clone "$REPO" "$APP_DIR"
fi
(cd "$APP_DIR" && runuser -u "$APP_USER" -- npm ci --omit=dev)

echo "==> Membuat service systemd"
cat > /etc/systemd/system/mabar.service <<EOF
[Unit]
Description=MabarRoom
After=network.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=PORT=$PORT
ExecStart=$(command -v node) server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable mabar >/dev/null
systemctl restart mabar

echo "==> Mengatur Caddy untuk $DOMAIN"
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
  encode gzip
  reverse_proxy localhost:$PORT
}
EOF
systemctl reload caddy || systemctl restart caddy

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
fi

sleep 2
if systemctl is-active --quiet mabar; then
  echo
  echo "✅ MabarRoom berjalan!  Buka: https://$DOMAIN"
  echo "   (Sertifikat HTTPS dibuat otomatis, tunggu ±1 menit kalau belum bisa dibuka.)"
  echo "   Log aplikasi : journalctl -u mabar -f"
  echo "   Update       : jalankan ulang skrip ini"
else
  echo "❌ Aplikasi gagal berjalan. Cek log: journalctl -u mabar -n 50" >&2
  exit 1
fi
