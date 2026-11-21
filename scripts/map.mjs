// The app's modules at a glance: each file and what it is, in its own words (the first
// sentence of its first comment), layer by layer. With --check, fails if a file does not
// say what it is: the map is the code's own, so it cannot go stale.
//
//   node scripts/map.mjs [--check]
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../app/src/', import.meta.url).pathname;
const LAYERS = [['core', 'the platform: the engine, storage, the service, the browser'], ['reader', 'reading: a book laid out, moved, marked'], ['ui', 'the components: they show and ask'], ['.', 'the start']];

/** What a file says it is: the comment it opens with (a component's, its script's first
 *  thing), its first sentence, on one line. */
function says(text) {
  const script = text.match(/<script[^>]*>([\s\S]*?)<\/script>/);
  const head = (script ? script[1] : text).trimStart();
  const m = head.match(/^\/\*\*?([\s\S]*?)\*\/|^((?:[ \t]*\/\/.*\n)+)/);
  if (!m) return '';
  const body = (m[1] ?? m[2]).replace(/^[ \t]*(\*|\/\/)[ \t]?/gm, '').replace(/\s+/g, ' ').trim();
  const end = body.search(/\.(\s|$)/);
  const first = end > 0 ? body.slice(0, end + 1) : body;
  return first.length > 150 ? first.slice(0, 149) + '…' : first;
}

const missing = [];
for (const [dir, what] of LAYERS) {
  const files = readdirSync(join(root, dir)).filter(f => /\.(ts|svelte)$/.test(f) && !f.endsWith('.d.ts')).sort();
  console.log(`\n${dir === '.' ? 'app/src' : dir + '/'}: ${what}`);
  for (const f of files) {
    const s = says(readFileSync(join(root, dir, f), 'utf8'));
    if (!s) missing.push(join(dir, f));
    console.log(`  ${f.padEnd(26)} ${s || '(says nothing)'}`);
  }
}
if (process.argv.includes('--check') && missing.length) {
  console.error(`\nThese do not say what they are (a comment at their head): ${missing.join(', ')}`);
  process.exit(1);
}
