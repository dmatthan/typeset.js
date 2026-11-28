#!/usr/bin/env node
// Puts the reader in a folder of a site, to be served with it: `npx typeset.js [folder]`
// (public/typeset when none is named). Run again, it puts the newer one there in its place;
// a folder holding anything else is left alone.
import { cpSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const from = fileURLToPath(new URL('../reader/', import.meta.url));
const arg = process.argv[2];
if (arg === '-h' || arg === '--help') {
  console.log('npx typeset.js [folder]   the reader, put in a folder of your site (public/typeset when none is named)');
  process.exit(0);
}
const to = resolve(arg ?? 'public/typeset');
const isReader = d => existsSync(resolve(d, 'embed.html')) && existsSync(resolve(d, 'typeset.js'));

if (existsSync(to) && readdirSync(to).length) {
  if (!statSync(to).isDirectory() || !isReader(to)) {
    console.error(
      `${relative('.', to) || to} is not a reader's folder: nothing was written. Name a new folder, or an empty one.`,
    );
    process.exit(1);
  }
  rmSync(to, { recursive: true });
}
cpSync(from, to, { recursive: true });

// where it is served: the path under the site's public folder (public/, static/), as most
// frameworks serve it; else said as a guess
const parts = relative('.', to).split(sep);
const pub = parts.findLastIndex(p => p === 'public' || p === 'static');
const served = '/' + (pub >= 0 ? parts.slice(pub + 1) : parts.slice(-1)).join('/') + '/';
console.log(`The reader is in ${relative('.', to) || to}. Served at ${served}, a page shows a book with:

  <script type="module" src="${served}typeset.js"></script>
  <typeset-book src="/books/your-book.epub"></typeset-book>
${served === '/typeset/' ? '' : `\n(imported into a script of the site's own: serveFrom('${served}') first)\n`}`);
