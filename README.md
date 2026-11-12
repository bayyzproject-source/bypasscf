# CF Bypass Server

Server bypass Cloudflare berbasis Express + Playwright (stealth).
Dibuat oleh **Hiyori senpai**.

## Deploy (VPS baru)
```bash
git clone https://github.com/bayyzproject-source/bypasscf.git
cd bypasscf
bash setup.sh          # pertama kali: bikin .env
nano .env              # ganti API_KEY
bash setup.sh          # kedua kali: jalanin dengan pm2
```
Buka port: `ufw allow 3000/tcp`

## Endpoint
Header wajib: `x-api-key: KEY_KAMU`

- `GET /fetch?url=...&raw=1` : HTML hasil bypass (tanpa raw = JSON lengkap)
- `GET /cookies?url=...` : `cf_clearance` + user agent + cookies
- Opsional: `&proxy=http://user:pass@host:port`, `&wait=ms`

## Lisensi
MIT + wajib mencantumkan credit "Hiyori senpai". Lihat `LICENSE`.
