// Every surface on an emulated phone: node bench/phone-shots.mjs outdir [webkit|chromium] [device] [light|dark]   (dev server on :5193)
import { webkit, chromium, devices } from '../app/node_modules/playwright/index.mjs';
const out = process.argv[2], eng = process.argv[3] === 'chromium' ? chromium : webkit;
const { defaultBrowserType: _, ...dev } = devices[process.argv[4] || 'iPhone 15 Pro'];
const b = await eng.launch();
const ctx = await b.newContext({ ...dev, colorScheme: process.argv[5] || 'light' });
const p = await ctx.newPage();
p.on('pageerror', e => console.log('pageerror', e.message));
const shot = async (n) => { await p.waitForTimeout(450); await p.screenshot({ path: `${out}/${n}.png` }); };
const V = (f, a) => p.evaluate(f, a);
await p.goto('http://localhost:5193/'); await V(() => localStorage.clear()); await p.goto('http://localhost:5193/');
await p.locator('.book[data-id]').first().waitFor();
await shot('01-library');
const ov = await V(() => ({ sw: document.documentElement.scrollWidth, cw: innerWidth, bodyW: document.body.scrollWidth }));
console.log('overflow', JSON.stringify(ov));
await p.locator('.more').first().tap().catch(e => console.log('more', e.message)); await shot('02-more');
await p.goto('http://localhost:5193/'); await p.locator('.book[data-id]').first().tap();
await p.waitForFunction(() => { const r = window.__vol.reader; return r.strip && r.strip.layouts.size === r.book.sections.length; });
await V(() => window.__vol.reader.jump(10)); await p.waitForTimeout(800);
await shot('04-reader');
const box = await p.locator('.stage').boundingBox();
await p.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2); await shot('05-bar');
await V(() => { window.__vol.ui.sheet = 'settings'; }); await shot('06-settings');
for (const [i, t] of ['Layout', 'Text', 'Reading'].entries()) {
  const r = p.locator('.panel .row.nav').nth(i); if (await r.count()) { await r.tap(); await shot('07-settings-' + i); await p.locator('.panel .back').first().tap().catch(() => {}); }
}
await V(() => { window.__vol.ui.sheet = 'help'; }); await shot('08-help');
await V(() => { window.__vol.ui.sheet = 'send'; }); await shot('10-send');
await V(() => { window.__vol.ui.sheet = null; window.__vol.map?.open?.(); }); await p.waitForTimeout(1500); await shot('11-map');
await p.touchscreen.tap(200, 330); await shot('12-map-tap');
await b.close();
