// The compositor's layers while reading (Chromium): how many, how large, and why each
// exists.  node bench/layers.mjs [width height dpr]   (dev server on :5193)
import { chromium } from '../app/node_modules/playwright/index.mjs';
const [W, H, dpr] = [+(process.argv[2] || 1440), +(process.argv[3] || 900), +(process.argv[4] || 1)];
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: dpr });
const cdp = await p.context().newCDPSession(p);
await p.goto('http://localhost:5193/'); await p.evaluate(() => localStorage.clear()); await p.goto('http://localhost:5193/');
await p.locator('.book[data-id]').first().click();
await p.waitForFunction(() => { const r = window.__typeset.reader; return r.reading && r.strip && r.strip.layouts.size === r.book.sections.length; });
for (let i = 0; i < 20; i++) { await p.keyboard.press('ArrowRight'); await p.waitForTimeout(80); }
await p.waitForTimeout(1500);
if (process.env.NOSTRIPS) await p.evaluate(() => document.querySelectorAll('.edge-strip').forEach(e => e.remove()));
if (process.env.STYLE) await p.addStyleTag({ content: process.env.STYLE });
if (process.env.REMOVE) await p.evaluate(sel => document.querySelectorAll(sel).forEach(e => e.remove()), process.env.REMOVE);
await cdp.send('DOM.enable'); await cdp.send('LayerTree.enable');
let layers = [];
cdp.on('LayerTree.layerTreeDidChange', e => { if (e.layers) layers = e.layers; });
await p.keyboard.press('ArrowRight'); await p.waitForTimeout(1500);
let total = 0;
const rows = [];
for (const l of layers.filter(l => l.drawsContent)) {
  const px = l.width * l.height * dpr * dpr;
  total += px * 4;
  let why = '';
  try { why = (await cdp.send('LayerTree.compositingReasons', { layerId: l.layerId })).compositingReasons.join(','); } catch {}
  let who = '';
  if (l.backendNodeId) { try { const d = await cdp.send('DOM.describeNode', { backendNodeId: l.backendNodeId }); who = d.node.localName + (d.node.attributes ? '.' + (d.node.attributes[d.node.attributes.indexOf('class') + 1] || '') : ''); } catch {} }
  rows.push({ who: who.slice(0, 40), w: Math.round(l.width), h: Math.round(l.height), MB: +(px * 4 / 1048576).toFixed(1), why: why.slice(0, 60) });
}
console.table(rows.sort((a, z) => z.MB - a.MB));
if (process.env.TREE) for (const l of layers) console.log(l.layerId, 'parent', l.parentLayerId, l.drawsContent ? 'draws' : '', Math.round(l.offsetX), Math.round(l.offsetY), Math.round(l.width) + 'x' + Math.round(l.height), l.backendNodeId ?? '', l.transform ? 'T' : '', l.scrollRects?.length ? 'scroll' : '');
console.log('layers drawing content:', rows.length, 'area as RGBA:', (total / 1048576).toFixed(0), 'MB at dpr', dpr);
await b.close();
