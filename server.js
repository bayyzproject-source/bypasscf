// Credit: Hiyori senpai (lihat LICENSE)
require('dotenv').config();
const express = require('express');
const guard = require('./guard');
guard.verify();

const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

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
  for (const frame of page.frames()) {
    if (!/challenges\.cloudflare\.com/.test(frame.url())) continue;
    try {
      const el = await frame.frameElement();
      const box = await el.boundingBox();
      if (!box) continue;
      await page.mouse.move(box.x + 20, box.y + box.height / 2, { steps: 12 });
      await page.waitForTimeout(300 + Math.random() * 400);
      await page.mouse.click(box.x + 30, box.y + box.height / 2);
      return true;
    } catch {}
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
    context = await b.newContext({
      userAgent: UA,
      viewport: { width: 1366, height: 768 },
      locale: 'en-US',
      ...(proxy ? { proxy: { server: proxy } } : {}),
    });
    const page = await context.newPage();
    const start = Date.now();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });

    // tunggu challenge selesai
    let tick = 0;
    while (Date.now() - start < TIMEOUT_MS) {
      const title = await page.title().catch(() => '');
      const html = await page.content().catch(() => '');
      if (!isChallenge(html, title)) break;
      if (tick++ % 3 === 2) await clickTurnstile(page);
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
      userAgent: UA,
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

app.get('/', (req, res) => res.json({ status: true, running, queued: queue.length }));

app.listen(PORT, () => console.log(`CF bypass server by ${guard.CREATOR} jalan di port ${PORT}`));
process.on('SIGINT', async () => { if (browser) await browser.close(); process.exit(0); });
