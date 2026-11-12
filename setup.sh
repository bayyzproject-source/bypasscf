#!/bin/bash
# Credit: Hiyori senpai
# Pakai di VPS baru (Ubuntu): bash setup.sh
set -e
if ! command -v node >/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
apt-get install -y xvfb
npm install
npx playwright install --with-deps chromium
npm i -g pm2
[ -f .env ] || { cp .env.example .env; echo ">> Edit .env dulu (ganti API_KEY) lalu jalankan: pm2 start ecosystem.config.js && pm2 save && pm2 startup"; exit 0; }
pm2 start ecosystem.config.js
pm2 save
pm2 startup | tail -n 1 | bash || true
echo "Selesai. Cek: pm2 status"
