// The code's shape, checked (scripts/lint.sh): what no linter knows about this project.
//
//   - Layers point one way. `core/` is the platform and imports nothing above it;
//     `reader/` does not import the interface (`ui/`); `state.svelte.ts` imports types
//     only. A type alone may cross (it costs nothing at run time).
//   - The importer's version is the same number in Rust and TypeScript.
//   - The release version is the same in every manifest that carries it (version.mjs).
//   - No source file grows past 800 lines (a Rust file's tests not counted): a file that
//     long is doing more than one job, and is split by job before it gets there.
//
// Prints each breach and exits 1 if there is any.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { versions } from './version.mjs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const MAX_LINES = 800;
const bad = [];

function* files(dir, ext) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === 'node_modules' || name === 'pkg' || name === 'target') continue;
    if (statSync(p).isDirectory()) yield* files(p, ext);
    else if (ext.some(e => name.endsWith(e))) yield p;
  }
}

// layers
const src = join(root, 'app/src');
const imports = text => [...text.matchAll(/^\s*import\s+(type\s+)?[^'";]*?from\s+'([^']+)'|import\('([^']+)'\)/gm)]
  .map(m => ({ type: !!m[1], path: m[2] ?? m[3] }));
for (const f of files(src, ['.ts', '.svelte'])) {
  const at = relative(src, f), text = readFileSync(f, 'utf8');
  for (const { type, path } of imports(text)) {
    if (type || !path.startsWith('.')) continue;
    const to = relative(src, join(f, '..', path));
    if (at.startsWith('core/') && /^(reader|ui)\/|^state\.svelte/.test(to)) bad.push(`${at}: core/ imports ${to} (core is the platform: nothing above it)`);
    if (at.startsWith('reader/') && to.startsWith('ui/')) bad.push(`${at}: reader/ imports ${to} (the reader does not know the interface)`);
    if (at === 'state.svelte.ts') bad.push(`${at}: imports ${to} (the shared state imports types only)`);
  }
}

// sizes
const sources = [
  ...files(src, ['.ts', '.svelte']),
  ...files(join(root, 'crates'), ['.rs']),
  ...files(join(root, 'src-tauri/src'), ['.rs']),
  ...files(join(root, 'service/src'), ['.ts']),
];
for (const f of sources) {
  const lines = readFileSync(f, 'utf8').split('\n');
  const end = f.endsWith('.rs') ? lines.findIndex(l => l.startsWith('#[cfg(test)]')) : -1;
  const n = end < 0 ? lines.length : end;
  if (n > MAX_LINES) bad.push(`${relative(root, f)}: ${n} lines (at most ${MAX_LINES}: split it by job)`);
}

// one number in two languages: the importer's version, which the app compares saved books with
const version = (f, re) => re.exec(readFileSync(join(root, f), 'utf8'))?.[1];
const rust = version('crates/ingest/src/lib.rs', /pub const VERSION: u32 = (\d+);/);
const ts = version('app/src/core/types.ts', /export const IMPORTER_VERSION = (\d+);/);
if (!rust || rust !== ts) bad.push(`importer version: ${rust} in crates/ingest/src/lib.rs, ${ts} in app/src/core/types.ts (the same, always)`);

// one release version in every manifest (scripts/version.mjs)
const releases = versions();
if (new Set(Object.values(releases)).size !== 1) bad.push(`release version: ${Object.entries(releases).map(([f, v]) => `${v} in ${f}`).join(', ')} (the same, always)`);

for (const b of bad) console.error(b);
process.exit(bad.length ? 1 : 0);
