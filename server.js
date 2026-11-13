// Credit: Hiyori senpai (lihat LICENSE)
require('dotenv').config();
const express = require('express');
const guard = require('./guard');
guard.verify();

// ENGINE=patchright -> Chrome yang ditambal anti-deteksi (lebih ampuh); default: playwright-extra + stealth
const ENGINE = process.env.ENGINE || 'playwright-extra';
let chromium;
if (ENGINE === 'patchright') {
  ({ chromium } = require('patchright'));
} else {
  ({ chromium } = require('playwright-extra'));
  chromium.use(require('puppeteer-extra-plugin-stealth')());
}

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || '';
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT || '2');
const TIMEOUT_MS = parseInt(process.env.TIMEOUT_MS || '45000');
const HEADLESS = process.env.HEADLESS === 'true'; // default false (jalan lewat xvfb)
const CHANNEL = process.env.CHANNEL || undefined; // isi 'chrome' kalau Google Chrome terpasang
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

let browser = null;
let running = 0;
const queue = [];

function ctxOptions(proxy) {
  const base = ENGINE === 'patchright'
    ? { viewport: null, locale: 'en-US' } // patchright: biarkan UA & viewport asli Chrome
    : { userAgent: UA, viewport: { width: 1366, height: 768 }, locale: 'en-US' };
  return { ...base, ...(proxy ? { proxy: { server: proxy } } : {}) };
}

async function getBrowser() {
  if (browser && browser.isConnected()) return browser;
  browser = await chromium.launch({
    headless: HEADLESS,
    ...(CHANNEL ? { channel: CHANNEL } : {}),
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1366,768',
    ],
  });
  return browser;
}

// antrian sederhana supaya RAM aman
function acquire() {
  return new Promise((resolve) => {
    if (running < MAX_CONCURRENT) { running++; resolve(); }
    else queue.push(resolve);
  });
}
function release() {
  const next = queue.shift();
  if (next) next(); else running--;
}

async function clickTurnstile(page) {
  const frames = page.frames().filter((f) => /challenges\.cloudflare\.com/.test(f.url()));
  if (!frames.length) { console.log('[turnstile] iframe belum muncul'); return false; }
  for (const frame of frames) {
    try {
      const el = await frame.frameElement();
      await el.scrollIntoViewIfNeeded().catch(() => {});
      const box = await el.boundingBox();
      if (!box || box.width < 50) { console.log('[turnstile] iframe tanpa ukuran, lewati'); continue; }
      // checkbox ada di sisi kiri widget (+-20px dari kiri, tengah vertikal)
      const x = box.x + 20 + Math.random() * 4;
      const y = box.y + box.height / 2 + (Math.random() * 4 - 2);
      await page.mouse.move(x - 150 - Math.random() * 100, y + 60, { steps: 8 });
      await page.mouse.move(x, y, { steps: 18 });
      await page.waitForTimeout(250 + Math.random() * 350);
      await page.mouse.down();
      await page.waitForTimeout(60 + Math.random() * 90);
      await page.mouse.up();
      console.log(`[turnstile] klik di (${Math.round(x)}, ${Math.round(y)}) iframe ${Math.round(box.width)}x${Math.round(box.height)}`);
      return true;
    } catch (e) {
      console.log('[turnstile] gagal klik:', e.message.split('\n')[0]);
    }
  }
  return false;
}

function isChallenge(html, title) {
  return /just a moment|attention required|checking your browser/i.test(title) ||
         /cf-chl|challenge-platform|cf-turnstile/i.test(html.slice(0, 20000)) && /just a moment/i.test(title);
}

async function solve(url, { wait = 0, proxy } = {}) {
  await acquire();
  let context;
  try {
    const b = await getBrowser();
    context = await b.newContext(ctxOptions(proxy));
    const page = await context.newPage();
    const start = Date.now();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });

    // tunggu challenge selesai
    let tick = 0;
    while (Date.now() - start < TIMEOUT_MS) {
      const title = await page.title().catch(() => '');
      const html = await page.content().catch(() => '');
      if (!isChallenge(html, title)) break;
      if (tick++ % 4 === 2) await clickTurnstile(page);
      await page.waitForTimeout(1500);
    }
    if (wait) await page.waitForTimeout(wait);

    const html = await page.content();
    const title = await page.title();
    if (isChallenge(html, title)) throw new Error('Challenge belum lolos (kemungkinan Turnstile/IP diblok)');

    const cookies = await context.cookies();
    return {
      url: page.url(),
      title,
      html,
      userAgent: await page.evaluate(() => navigator.userAgent).catch(() => UA),
      cookies,
      cf_clearance: (cookies.find((c) => c.name === 'cf_clearance') || {}).value || null,
      took_ms: Date.now() - start,
    };
  } finally {
    if (context) await context.close().catch(() => {});
    release();
  }
}

const app = express();
app.use(guard.middleware);

app.use((req, res, next) => {
  if (!API_KEY) return next();
  const key = req.headers['x-api-key'] || req.query.key;
  if (key !== API_KEY) return res.status(401).json({ status: false, error: 'API key salah' });
  next();
});

function validUrl(u) {
  try { const x = new URL(u); return ['http:', 'https:'].includes(x.protocol); } catch { return false; }
}

// GET /fetch?url=...&raw=1  -> HTML saja (raw) atau JSON lengkap
app.get('/fetch', async (req, res) => {
  const { url, wait, proxy, raw } = req.query;
  if (!validUrl(url)) return res.status(400).json({ status: false, error: 'Parameter url tidak valid' });
  try {
    const r = await solve(url, { wait: parseInt(wait || '0'), proxy });
    if (raw === '1') return res.type('html').send(r.html);
    res.json({ status: true, ...r });
  } catch (e) {
    res.status(502).json({ status: false, error: e.message });
  }
});

// GET /cookies?url=... -> cf_clearance + user agent (buat dipakai axios dkk)
app.get('/cookies', async (req, res) => {
  const { url, proxy } = req.query;
  if (!validUrl(url)) return res.status(400).json({ status: false, error: 'Parameter url tidak valid' });
  try {
    const r = await solve(url, { proxy });
    res.json({ status: true, cf_clearance: r.cf_clearance, userAgent: r.userAgent, cookies: r.cookies });
  } catch (e) {
    res.status(502).json({ status: false, error: e.message });
  }
});


// GET /screenshot?url=...&wait=20000 -> PNG apa yang dilihat browser (buat debug)
app.get('/screenshot', async (req, res) => {
  const { url, proxy } = req.query;
  const wait = Math.min(parseInt(req.query.wait || '20000'), TIMEOUT_MS);
  if (!validUrl(url)) return res.status(400).json({ status: false, error: 'Parameter url tidak valid' });
  await acquire();
  let context;
  try {
    const b = await getBrowser();
    context = await b.newContext(ctxOptions(proxy));
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
    const start = Date.now();
    let tick = 0;
    while (Date.now() - start < wait) {
      const title = await page.title().catch(() => '');
      const html = await page.content().catch(() => '');
      if (!isChallenge(html, title)) break;
      if (tick++ % 4 === 2) await clickTurnstile(page);
      await page.waitForTimeout(1500);
    }
    const png = await page.screenshot({ type: 'png' });
    res.setHeader('X-Page-Title', encodeURIComponent(await page.title().catch(() => '')));
    res.type('png').send(png);
  } catch (e) {
    res.status(502).json({ status: false, error: e.message });
  } finally {
    if (context) await context.close().catch(() => {});
    release();
  }
});

app.get('/', (req, res) => res.json({ status: true, running, queued: queue.length }));

app.listen(PORT, () => console.log(`CF bypass server by ${guard.CREATOR} jalan di port ${PORT}`));
process.on('SIGINT', async () => { if (browser) await browser.close(); process.exit(0); });
