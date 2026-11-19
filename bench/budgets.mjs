// The numbers that matter, on the production build (what a reader gets), in one run:
//   npm --prefix app run build && (serve app/dist on :4173) && node bench/budgets.mjs [chromium|webkit]
// first visit: bytes over the network and time to the library; opening the sample: time
// from the click to text on the page; a held arrow: frame times; memory at the library
// and while reading (all the browser's processes, proportional share).
import { chromium, webkit, devices } from '../app/node_modules/playwright/index.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import { brotliCompressSync, constants } from 'node:zlib';
const eng = process.argv[2] === 'webkit' ? webkit : chromium;
const URL0 = process.env.URL || 'http://localhost:4173/';
function pss() {
  const kids = new Map();
  for (const d of readdirSync('/proc')) { if (!/^\d+$/.test(d)) continue; try { const ppid = +readFileSync(`/proc/${d}/stat`, 'utf8').split(') ')[1].split(' ')[1]; (kids.get(ppid) ?? kids.set(ppid, []).get(ppid)).push(+d); } catch {} }
  let t = 0; const walk = p => { for (const c of kids.get(p) ?? []) { try { t += +/Pss:\s+(\d+)/.exec(readFileSync(`/proc/${c}/smaps_rollup`, 'utf8'))[1]; } catch {} walk(c); } };
  walk(process.pid); return Math.round(t / 1024);
}
const b = await eng.launch();
// PHONE=1: a phone's screen and touch; CPU=4: the processor slowed four times (Chromium
// only), a mid-range phone from a fast computer
const { defaultBrowserType: _, ...phone } = devices['Pixel 7'];
const ctx = await b.newContext(process.env.PHONE ? phone : { viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
if (process.env.CPU && eng === chromium) await (await ctx.newCDPSession(p)).send('Emulation.setCPUThrottlingRate', { rate: +process.env.CPU });
// each file the network carried (not the HTTP cache, not the service worker's cache:
// the context's requests, so the service worker's pre-cache counts), its size, and its
// size as a host would send it (brotli; an EPUB gains little), from the build's copy
const DIST = new URL('../app/' + (process.env.DIST || 'dist') + '/', import.meta.url);
let bytes = 0, br = 0;
const files = [];
let counting = true;
ctx.on('requestfinished', async q => { if (!counting) return; try { const r = await q.response(); const wire = (await q.sizes()).responseBodySize; if (!r || r.status() !== 200 || r.fromServiceWorker() || wire <= 0) return; const path = new URL(q.url()).pathname; let body; try { body = readFileSync(new URL('.' + (path.endsWith('/') ? path + 'index.html' : path), DIST)); } catch { body = await r.body(); } bytes += body.length; const c = brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }).length; br += Math.min(c, body.length); files.push([path, Math.round(body.length / 1024), Math.round(Math.min(c, body.length) / 1024)]); } catch {} });
const base = pss();
const t0 = Date.now();
await p.goto(URL0);
await p.locator('.book[data-id]').first().waitFor();
await p.waitForTimeout(2000);
const firstVisit = { ms: Date.now() - t0 - 2000, kB: Math.round(bytes / 1024), brotliKB: Math.round(br / 1024) };
counting = false;
if (process.env.FILES) for (const f of files.sort((a, z) => z[2] - a[2])) console.log(f.join('\t'));
const t1 = Date.now();
await p.reload(); await p.locator('.book[data-id]').first().waitFor();
const again = Date.now() - t1;
await p.waitForTimeout(1500);
const libMB = pss() - base;
const t2 = Date.now();
await p.locator('.book[data-id]').first().click();
await p.locator('.col .ln').first().waitFor();
const openMs = Date.now() - t2;
await p.waitForTimeout(2500);
// a held arrow: the frames it takes
const frames = await p.evaluate(() => new Promise(res => {
  const d = []; let last = performance.now(), on = true;
  const tick = t => { d.push(t - last); last = t; if (on) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  document.querySelector('.stage')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  setTimeout(() => { on = false; res(d.slice(5)); }, 2500);
}));
await p.keyboard.down('ArrowRight'); await p.waitForTimeout(2500); await p.keyboard.up('ArrowRight');
// a step of text size, from the key to a column set again at the new size
await p.keyboard.press('s'); await p.waitForTimeout(800);
const sizeMs = [];
for (const k of ['=', '-']) {
  await p.evaluate(() => {
    const col = document.querySelector('.col'), fs = getComputedStyle(document.querySelector('.col .ln')).fontSize, t0 = performance.now();
    window.__sized = new Promise(res => { const tick = () => { const c = document.querySelector('.col'), l = c?.querySelector('.ln'); if (c && c !== col && l && getComputedStyle(l).fontSize !== fs) res(performance.now() - t0); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
  });
  await p.keyboard.press(k);
  sizeMs.push(Math.round(await p.evaluate(() => Promise.race([window.__sized, new Promise(r => setTimeout(() => r(-1), 15000))]))));
  await p.waitForTimeout(1500);
}
await p.keyboard.press('Escape');
const sorted = [...frames].sort((a, z) => a - z);
const readMB = pss() - base;
console.log(JSON.stringify({ engine: eng.name(), firstVisit, libraryAgainMs: again, openToTextMs: openMs, textSizeMs: sizeMs, frames: { n: frames.length, medianMs: +sorted[sorted.length >> 1].toFixed(1), p95Ms: +sorted[Math.floor(sorted.length * 0.95)].toFixed(1), over20: frames.filter(x => x > 20).length }, memoryMB: { library: libMB, reading: readMB } }));
await b.close();
