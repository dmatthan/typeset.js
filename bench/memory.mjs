// Memory over a reading session, in Chromium or WebKit (dev server on :5193):
//   node bench/memory.mjs [chromium|webkit] [big.epub]
// At each step: the browser's processes (proportional set size, so shared pages count
// once), the page's JavaScript heap, the engine's WebAssembly memory, DOM nodes.
import { chromium, webkit } from '../app/node_modules/playwright/index.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
const eng = process.argv[2] === 'webkit' ? webkit : chromium;
const big = path.resolve(process.argv[3] || 'corpus/middlemarch.epub');
const URL0 = process.env.URL || 'http://localhost:5193/';

/** PSS of every process under this one (the browser and its children), MB; and by kind
 *  (Chromium's --type=renderer, gpu-process…; WebKit's WebContent, Network…). */
const kinds = {};
function pss() {
  for (const k in kinds) delete kinds[k];
  const kids = new Map();
  for (const d of readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try { const ppid = +readFileSync(`/proc/${d}/stat`, 'utf8').split(') ')[1].split(' ')[1]; (kids.get(ppid) ?? kids.set(ppid, []).get(ppid)).push(+d); } catch {}
  }
  let total = 0;
  const walk = p => { for (const c of kids.get(p) ?? []) { try {
    const kb = +/Pss:\s+(\d+)/.exec(readFileSync(`/proc/${c}/smaps_rollup`, 'utf8'))[1]; total += kb;
    const cmd = readFileSync(`/proc/${c}/cmdline`, 'utf8').split('\0');
    const all = cmd.join(' '); const kind = (/--type=([a-z-]+)/.exec(all)?.[1]) || path.basename(all.split(' ')[0]);
    kinds[kind] = (kinds[kind] ?? 0) + kb / 1024;
  } catch {} walk(c); } };
  walk(process.pid);
  return total / 1024;
}

const b = await eng.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const cdp = eng === chromium ? await p.context().newCDPSession(p) : null;
const rows = [];
async function at(step) {
  await p.waitForTimeout(1200);
  if (cdp) await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
  await p.waitForTimeout(300);
  const heap = cdp ? (await cdp.send('Runtime.getHeapUsage')).usedSize / 1048576 : null;
  const { wasm, nodes } = await p.evaluate(async () => ({ wasm: window.__vol ? (await window.__vol.reader.core.memory?.())?.wasm / 1048576 : null, nodes: document.getElementsByTagName('*').length }));
  const all = pss();
  rows.push({ step, browserMB: +all.toFixed(0), ...Object.fromEntries(Object.entries(kinds).filter(([, v]) => v > 8).map(([k, v]) => [k.slice(0, 14), +v.toFixed(0)])), jsHeapMB: heap && +heap.toFixed(1), wasmMB: wasm && +wasm.toFixed(0), nodes });
}
// (a production build has no test hooks: there, text on the page and a moment for the rest)
const ready = () => p.waitForFunction(() => { const r = window.__vol?.reader; return r ? r.reading && r.strip && r.strip.layouts.size === r.book.sections.length : !!document.querySelector('.col .ln') && !document.querySelector('.reader[hidden]'); }, null, { timeout: 60000 }).then(() => p.waitForTimeout(1500));
await p.goto('about:blank'); await p.waitForTimeout(1500); pss();
rows.push({ step: 'empty page', browserMB: +pss().toFixed(0), ...Object.fromEntries(Object.entries(kinds).filter(([, v]) => v > 8).map(([k, v]) => [k.slice(0, 14), +v.toFixed(0)])) });
await p.goto(URL0); await p.evaluate(() => localStorage.clear()); await p.goto(URL0);
await p.locator('.book[data-id]').first().waitFor();
await at('library');
await p.locator('.book[data-id]').first().click(); await ready();
await at('open Thursday');
for (let i = 0; i < 60; i++) { await p.keyboard.press('ArrowRight'); await p.waitForTimeout(60); }
await at('60 columns on');
await p.keyboard.press('m'); await p.waitForTimeout(600);
await at('contents');
await p.keyboard.press('Escape'); await p.waitForTimeout(600); await p.keyboard.press('q'); await p.locator('.shelf').waitFor();
await at('closed');
await p.setInputFiles('input[type=file]', big);
await p.waitForFunction(() => document.querySelectorAll('.book[data-id]').length >= 2, null, { timeout: 120000 });
await at('imported ' + path.basename(big));
await p.locator('.book[data-id]', { hasText: 'Middlemarch' }).first().click(); await ready();
await at('open it');
for (let i = 0; i < 60; i++) { await p.keyboard.press('ArrowRight'); await p.waitForTimeout(60); }
await at('60 columns on');
await p.keyboard.press('q');
await at('closed');
console.table(rows);
await b.close();
