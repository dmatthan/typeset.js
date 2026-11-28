// Spike 0.3: does the browser draw the press's lines at the press's widths?
// For every column of a book: lines whose text overflows their box, and justified lines
// whose text does not reach the right edge, in each theme.
//   node bench/fidelity.mjs [book.epub] [theme,theme,…] [dpr] [chromium|firefox]   (dev server on :5193)
import { chromium, firefox } from '../app/node_modules/playwright/index.mjs';
import path from 'node:path';
const file = path.resolve(process.argv[2] || 'corpus/middlemarch.epub');
const themes = (process.argv[3] || 'book,slate,linen,clear,warm,open').split(',');
// display scale (devicePixelRatio): node bench/fidelity.mjs book themes 1.5
const dpr = +(process.argv[4] || 1);
// browser: node bench/fidelity.mjs book themes dpr firefox
const engine = process.argv[5] === 'firefox' ? firefox : chromium;
const b = await engine.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: dpr });
await p.goto('http://localhost:5193/');
await p.waitForSelector('.book[data-id]');
await p.setInputFiles('input[type=file]', file);
await p.waitForFunction(n => document.querySelectorAll('.book[data-id]').length >= n, 2, { timeout: 60000 });
await p.click('.book[data-id]:not(:last-of-type)');
const id = await p.evaluate(() => document.querySelector('.book[data-id]').dataset.id);
await p.waitForFunction(() => window.__typeset?.reader?.reading);
await p.waitForTimeout(300);
await p.waitForFunction(
  () => {
    const r = window.__typeset.reader;
    return r.strip && r.strip.layouts.size === r.book.sections.length;
  },
  null,
  { timeout: 120000 },
);
for (const theme of themes) {
  const res = await p.evaluate(async theme => {
    const v = window.__typeset,
      r = v.reader;
    v.settings.theme = theme;
    await r.settingsChanged('layout');
    while (r.strip.layouts.size !== r.book.sections.length) await new Promise(f => setTimeout(f, 30));
    const N = r.strip.N;
    v.resetFitStats();
    const out = { lines: 0, overflow: 0, short: 0, worstOver: 0, worstShort: 0, examples: [] };
    const rng = document.createRange();
    for (let k = 0; k < N; k++) {
      r.jump(k);
      const col = document.querySelector(`.col[data-k="${k}"]`);
      if (!col) continue;
      for (const ln of col.querySelectorAll('.ln:not(.brk)')) {
        out.lines++;
        // what a reader sees past the margin, after the page's own check
        const over = v.residual(ln);
        if (over > 0.5) {
          out.overflow++;
          out.worstOver = Math.max(out.worstOver, over);
          if (out.examples.length < 5) out.examples.push(['over', k, over, ln.textContent]);
        }
        if (ln.classList.contains('j') && !ln.classList.contains('hy') && /[ \u00a0]/.test(ln.textContent)) {
          rng.selectNodeContents(ln);
          const rects = [...rng.getClientRects()];
          const gap = rects.length ? ln.getBoundingClientRect().right - Math.max(...rects.map(x => x.right)) : 0;
          if (gap > 1) {
            out.short++;
            out.worstShort = Math.max(out.worstShort, gap);
            if (out.examples.length < 8) out.examples.push(['short', k, +gap.toFixed(2), ln.innerHTML.slice(0, 200)]);
          }
        }
      }
    }
    out.samples = v.fitStats.samples.slice();
    out.corrected = v.fitStats.fixed;
    out.squeezed = v.fitStats.squeezed;
    out.maxCorrection = v.fitStats.maxPx;
    out.theme = theme;
    out.dpr = devicePixelRatio;
    out.round = r.round;
    out.appUnits = r.appUnits;
    out.calibErr = +r.calibErr.toFixed(3);
    return out;
  }, theme);
  console.log(JSON.stringify(res));
}
await p.evaluate(id => window.__typeset.reader.core.remove(id), id);
await b.close();
