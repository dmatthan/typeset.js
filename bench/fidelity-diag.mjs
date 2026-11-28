// Compares press widths with the browser's natural widths, line by line, for a few columns.
import { chromium } from '../app/node_modules/playwright/index.mjs';
import path from 'node:path';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
await p.goto('http://localhost:5193/');
await p.waitForSelector('.book[data-id]');
await p.click('.book[data-id]');
await p.waitForFunction(() => window.__typeset?.reader?.reading);
await p.waitForTimeout(300);
const res = await p.evaluate(async () => {
  const r = window.__typeset.reader;
  const out = [];
  const probe = document.createElement('span');
  for (let k = 3; k < 30; k++) {
    if (!r.roll.linesAt(k)) continue;
    r.jump(k);
    const col = document.querySelector(`.col[data-k="${k}"]`);
    const L = r.roll.linesAt(k);
    let j = L.from;
    for (const ln of col.querySelectorAll('.ln[data-b]')) {
      const o = j * 9;
      j++;
      const avail = L.sl.f[o + 7],
        nat = L.sl.f[o + 8],
        flags = L.sl.u[o + 5] & 0xffff,
        spaces = L.sl.u[o + 5] >>> 16;
      // the browser's natural width: same element, unjustified, no word-spacing, shrink-wrapped
      const c = ln.cloneNode(true);
      c.style.width = 'auto';
      c.style.wordSpacing = '0px';
      c.classList.remove('j');
      col.append(c);
      const bw = c.getBoundingClientRect().width;
      c.remove();
      out.push({
        k,
        avail: +avail.toFixed(2),
        rust: +nat.toFixed(2),
        browser: +bw.toFixed(2),
        d: +(bw - nat).toFixed(2),
        spaces,
        hy: !!(flags & 2),
        over: ln.scrollWidth - ln.clientWidth,
        t: ln.textContent.slice(0, 40),
      });
    }
  }
  return out;
});
const ds = res.map(x => x.d);
console.log(
  'lines',
  res.length,
  'mean diff',
  (ds.reduce((a, b) => a + b, 0) / ds.length).toFixed(3),
  'max',
  Math.max(...ds),
  'min',
  Math.min(...ds),
);
console.log(res.filter(x => x.over > 0).slice(0, 12));
console.log(res.slice(0, 6));
await b.close();
