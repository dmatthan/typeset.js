// Where a Chromium renderer's memory goes (memory-infra allocator dumps), at a few points
// of a reading session:  node bench/memory-infra.mjs   (dev server on :5193)
import { chromium } from '../app/node_modules/playwright/index.mjs';
const b = await chromium.launch({ args: ['--enable-memory-infra'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const cdp = await p.context().newCDPSession(p);
const bcdp = await b.newBrowserCDPSession();

async function dump(label) {
  await p.waitForTimeout(1200);
  await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
  const events = [];
  bcdp.on('Tracing.dataCollected', e => events.push(...e.value));
  const done = new Promise(r => bcdp.once('Tracing.tracingComplete', r));
  await bcdp.send('Tracing.start', { traceConfig: { includedCategories: ['disabled-by-default-memory-infra'], memoryDumpConfig: { triggers: [] } }, transferMode: 'ReportEvents' });
  await bcdp.send('Tracing.requestMemoryDump', { deterministic: true, levelOfDetail: 'detailed' });
  await bcdp.send('Tracing.end'); await done;
  bcdp.removeAllListeners('Tracing.dataCollected');
  // per process: the top-level allocators' effective size
  const out = {};
  for (const e of events) {
    const dumps = e.args?.dumps?.allocators; if (!dumps) continue;
    const proc = e.args.dumps.process_totals ? e.pid : e.pid;
    const row = out[proc] ??= {};
    for (const [name, d] of Object.entries(dumps)) {
      if (name.split('/').length > (process.env.DEPTH ? +process.env.DEPTH : 2)) continue;
      const sz = d.attrs?.effective_size?.value ?? d.attrs?.size?.value;
      if (!sz) continue;
      row[name] = (row[name] ?? 0) + parseInt(sz, 16) / 1048576;
    }
  }
  console.log('\n== ' + label);
  for (const [pid, row] of Object.entries(out)) {
    const top = Object.entries(row).filter(([, v]) => v > 1.5).sort((a, z) => z[1] - a[1]).slice(0, 30);
    if (!top.length) continue;
    console.log('pid ' + pid + ': ' + top.map(([k, v]) => `${k} ${v.toFixed(1)}`).join(' | '));
  }
}

const URL0 = process.env.URL || 'http://localhost:5193/';
await p.goto(URL0); await p.evaluate(() => localStorage.clear()); await p.goto(URL0);
await p.locator('.book[data-id]').first().waitFor();
await dump('library');
await p.locator('.book[data-id]').first().click();
await p.waitForFunction(() => { const r = window.__vol?.reader; return r ? r.reading && r.strip && r.strip.layouts.size === r.book.sections.length : !!document.querySelector('.col .ln'); }); await p.waitForTimeout(1500);
for (let i = 0; i < 60; i++) { await p.keyboard.press('ArrowRight'); await p.waitForTimeout(60); }
await dump('reading, 60 columns on');
await p.keyboard.press('m'); await p.waitForTimeout(1500);
await dump('map');
await p.keyboard.press('Escape'); await p.waitForTimeout(2500);
await dump('map closed');
await b.close();
