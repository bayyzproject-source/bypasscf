// Copyright (c) 2026 Hiyori senpai - lihat LICENSE
// Penjaga atribusi creator. Kalau credit dihapus/diubah, server menolak jalan.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CREATOR = 'Hiyori senpai';
const CREATOR_HASH = '86c4e08452df2e0a0f7ce38dbbea10acfdd0ccf4aa9da29e547087053092d040';

function sha(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

function fail(msg) {
  console.error('\n[GUARD] ' + msg);
  console.error('[GUARD] Credit creator "' + CREATOR + '" wajib dipertahankan (lihat LICENSE).\n');
  process.exit(1);
}

function read(f) {
  try { return fs.readFileSync(path.join(__dirname, f), 'utf8'); } catch { return ''; }
}

function verify() {
  if (sha(CREATOR) !== CREATOR_HASH) fail('Nama creator di guard.js diubah.');
  if (!read('LICENSE').includes('Copyright (c) 2026 ' + CREATOR)) fail('LICENSE dihapus/diubah.');
  let pkg = {};
  try { pkg = JSON.parse(read('package.json')); } catch {}
  if (sha(String(pkg.author || '')) !== CREATOR_HASH) fail('Field author di package.json diubah.');
  if (!read('README.md').includes(CREATOR)) fail('Credit di README.md dihapus.');
  if (!read('server.js').includes('guard.verify()')) fail('Pemanggilan guard di server.js dihapus.');
}

// middleware: suntik creator ke semua response
function middleware(req, res, next) {
  if (sha(CREATOR) !== CREATOR_HASH) fail('Nama creator diubah saat runtime.');
  res.setHeader('X-Created-By', CREATOR);
  const json = res.json.bind(res);
  res.json = (body) => json(body && typeof body === 'object' && !Array.isArray(body) ? { creator: CREATOR, ...body } : body);
  next();
}

module.exports = { CREATOR, verify, middleware };
