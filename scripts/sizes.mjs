// What a page that embeds the reader downloads before the book: the kit's code (scripts,
// styles, the engine), brotli-compressed as a server sends it, against a budget. Fonts and
// hyphenation patterns are left out: they come with each book, as its languages and theme
// need them.
//
//   node scripts/sizes.mjs [dir] [budget in KB]     defaults: app/dist-kit, 1100
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';

const dir = process.argv[2] ?? 'app/dist-kit';
const budget = Number(process.argv[3] ?? 1100) * 1024;

function* files(d) {
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.(js|css|wasm|html)$/.test(name)) yield p;
  }
}

let total = 0;
const rows = [];
for (const f of files(dir)) {
  const raw = readFileSync(f);
  const br = brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;
  total += br;
  rows.push([br, raw.length, f.slice(dir.length + 1)]);
}
const kb = n => (n / 1024).toFixed(1).padStart(7) + ' KB';
for (const [br, raw, f] of rows.sort((a, z) => z[0] - a[0])) console.log(`${kb(br)} brotli ${kb(raw)} raw  ${f}`);
console.log(`${kb(total)} in all, the budget ${kb(budget)}`);
if (total > budget) { console.error('over the budget: find what grew before raising it'); process.exit(1); }
