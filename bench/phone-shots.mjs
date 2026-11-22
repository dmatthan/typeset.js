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
await p.waitForFunction(() => { const r = window.__typeset.reader; return r.strip && r.strip.layouts.size === r.book.sections.length; });
await V(() => window.__typeset.reader.jump(10)); await p.waitForTimeout(800);
await shot('04-reader');
const box = await p.locator('.stage').boundingBox();
await p.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2); await shot('05-bar');
await V(() => { window.__typeset.ui.sheet = 'settings'; }); await shot('06-settings');
await p.locator('.panel .row.nav', { hasText: 'Style' }).tap(); await shot('07-style');
await p.locator('.panel .back').tap();
await V(() => { window.__typeset.ui.sheet = 'help'; }); await shot('08-help');
// a note on the first full line in view: the sheet with the passage quoted
await V(() => {
  const r = window.__typeset.reader, ln = document.querySelectorAll(`.col[data-k="${r.cur}"] .ln[data-b]`)[3];
  const b = r.book.sections[r.strip.itemAt(r.cur).sec].blocks[+ln.dataset.b], s0 = +ln.dataset.s;
  const a = r.ann.add(b.key, s0, Math.min(b.t.length, s0 + 60), 2, '');
  r.marking.refreshSection(r.strip.itemAt(r.cur).sec);
  window.__typeset.ui.noteFor = a.id; window.__typeset.ui.sheet = 'note';
});
await shot('09-note');
await V(() => { window.__typeset.ui.sheet = 'send'; }); await shot('10-send');
await V(() => { window.__typeset.ui.sheet = null; window.__typeset.contents.open(); }); await p.waitForTimeout(500); await shot('11-contents');
await V(() => window.__typeset.contents.setTab('highlights')); await shot('12-highlights');
await b.close();
