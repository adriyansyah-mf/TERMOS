#!/bin/sh
# One-time setup: random database password (Docker secret) and a .env with safe defaults.
# Re-running keeps existing secrets.
set -eu
cd "$(dirname "$0")"
umask 077
mkdir -p secrets
if [ ! -s secrets/db_password ]; then
  head -c 48 /dev/urandom | base64 | tr -d '/+=\n' | head -c 48 > secrets/db_password
  echo "secrets/db_password dibuat"
fi
if [ ! -f .env ]; then
  cat > .env <<EOF
# first  = hanya akun pertama yang boleh daftar (otomatis jadi admin)
# invite = daftar butuh TERMOS_INVITE_CODE
# open   = siapa pun yang bisa mengakses server boleh daftar
TERMOS_SIGNUP=first
TERMOS_INVITE_CODE=$(head -c 24 /dev/urandom | base64 | tr -d '/+=\n')
# Isi untuk profil https (Caddy): domain yang DNS-nya mengarah ke server ini
TERMOS_DOMAIN=
TERMOS_PORT=8080
EOF
  echo ".env dibuat"
fi
chmod 600 .env secrets/db_password
echo "Selesai. Jalankan: docker compose up -d --build"
