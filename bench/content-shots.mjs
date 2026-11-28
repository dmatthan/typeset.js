// Screenshots of notes and images: node bench/content-shots.mjs outdir   (dev server on :5193)
import { chromium } from '../app/node_modules/playwright/index.mjs';
import path from 'node:path';
const out = process.argv[2];
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 860 } });
p.on('pageerror', e => console.log('pageerror', e.message));
await p.goto('http://localhost:5193/');
await p.evaluate(() => localStorage.clear());
await p.goto('http://localhost:5193/');
async function open(file, title) {
  await p.waitForSelector('.book[data-id]');
  await p.setInputFiles('input[type=file]', path.resolve(file));
  const book = p.locator('.book[data-id]', { hasText: title }).first();
  await book.waitFor({ timeout: 90000 });
  await book.click();
  await p.waitForFunction(() => window.__typeset?.reader?.reading);
  await p.waitForFunction(
    () => {
      const r = window.__typeset.reader;
      return r.strip && r.strip.layouts.size === r.book.sections.length;
    },
    null,
    { timeout: 60000 },
  );
}
// Alice: a column with an image, then the lightbox
await open('corpus/alice.epub', 'Alice');
const k = await p.evaluate(() => {
  const r = window.__typeset.reader,
    s = r.strip;
  for (let k = 0; k < s.N; k++) {
    r.jump(k);
    if (document.querySelector(`.col[data-k="${k}"] figure.img`) && k > 6) return k;
  }
  return -1;
});
console.log('alice image column', k);
await p.waitForTimeout(900);
await p.screenshot({ path: `${out}/alice-page.png` });
const fig = p.locator(`.col[data-k="${k}"] figure.img`).first();
await fig.click();
await p.waitForTimeout(600);
await p.screenshot({ path: `${out}/alice-lightbox.png` });
await p.keyboard.press('Escape');
await p.waitForTimeout(400);
await p.click('.bar .ibtn >> nth=0').catch(() => {});
await p.evaluate(() => window.__typeset.reader.close());
// Art of War: a note card
await open('corpus/artofwar.epub', 'Art of War');
const kn = await p.evaluate(() => {
  const r = window.__typeset.reader,
    s = r.strip;
  for (let k = 4; k < s.N; k++) {
    r.jump(k);
    if (document.querySelector(`.col[data-k="${k}"] a.nr`)) return k;
  }
  return -1;
});
console.log('note column', kn);
await p.waitForTimeout(800);
await p.locator(`.col[data-k="${kn}"] a.nr`).first().click();
await p.waitForTimeout(400);
await p.screenshot({ path: `${out}/note-card.png` });
await b.close();
