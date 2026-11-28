import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';

/** The web build for volumen.page (`TYPESET_WEB=1`): the app at /read, and the site's own
 *  page, privacy page, stylesheet and script (app/site/) at the root. Other builds (the
 *  desktop app's, the local preview) keep the app at /. */
const WEB = !!process.env.TYPESET_WEB;
/** The npm package's reader (`TYPESET_PACKAGE=1`): the reader alone, to put in a folder of
 *  any site, with typeset.js, the elements that place it on a page (packages/typeset.js/src). */
const PACKAGE = !!process.env.TYPESET_PACKAGE;
/** Where it is built: the package's own folder, from which `npx typeset.js` copies it into
 *  a site, and the release's zip is made. */
const PACKAGE_OUT = '../packages/typeset.js/reader/';
/** The elements' source. */
const ELEMENTS = new URL('../packages/typeset.js/src/typeset.js', import.meta.url);
const START = WEB ? '/read' : '/';

/** Writes the service worker (sw.js) into the web build: the build's own files are its
 *  shell, and a hash of them its version, so each build replaces the last. */
function serviceWorker(): Plugin {
  return {
    name: 'service-worker',
    apply: () => !PACKAGE,
    enforce: 'post',
    generateBundle(_, bundle) {
      const files = Object.keys(bundle).filter(f => !f.endsWith('.map'));
      // (pages by their address, not their file: a host may redirect /x.html to /x)
      const shell = [
        START,
        ...(WEB ? ['/embed'] : []),
        ...files.filter(f => !f.endsWith('.html')).map(f => '/' + f),
        '/app/manifest.webmanifest',
      ];
      const version = createHash('sha256').update(files.sort().join('\n')).digest('hex').slice(0, 12);
      const src = readFileSync(new URL('./sw.js', import.meta.url), 'utf8')
        .replace('__VERSION__', version)
        .replace('__SHELL__', JSON.stringify(shell))
        .replace('__START__', START);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: src });
    },
  };
}

/** The web build's layout: the app's page becomes read.html (served as /read), and the
 *  site's files go at the root. */
function website(): Plugin {
  return {
    name: 'site',
    apply: () => WEB,
    enforce: 'post',
    generateBundle(_, bundle) {
      const app = bundle['index.html'];
      if (app) {
        delete bundle['index.html'];
        app.fileName = 'read.html';
        bundle['read.html'] = app;
        // the same app, for a book embedded in another site's page (core/embed.ts)
        if (app.type === 'asset') this.emitFile({ type: 'asset', fileName: 'embed.html', source: app.source });
      }
      const dir = new URL('./site/', import.meta.url);
      for (const f of readdirSync(dir))
        this.emitFile({ type: 'asset', fileName: f, source: readFileSync(new URL(f, dir)) });
      // the elements, for the site's own pages (its demos), beside its embed.html
      this.emitFile({ type: 'asset', fileName: 'typeset.js', source: readFileSync(ELEMENTS) });
    },
  };
}

/** The policy a book embedded in another site's page runs under: volumen.page sends it as
 *  a header (assets/_headers, `/embed`); the package's, served by hosts that send none, carries
 *  it in the page, less `frame-ancestors`, which only a header can say. Without it a
 *  self-hosted reader would run on the host site's own origin with no policy at all. */
function embedPolicy(): string {
  const headers = readFileSync(new URL('../assets/_headers', import.meta.url), 'utf8');
  const csp = /^\/embed\n(?:[ \t]+.*\n)*?[ \t]+Content-Security-Policy: (.+)$/m.exec(headers)?.[1];
  if (!csp) throw new Error('assets/_headers: no Content-Security-Policy for /embed');
  return csp
    .split(';')
    .map(d => d.trim())
    .filter(d => d && !d.startsWith('frame-ancestors'))
    .join('; ');
}

/** The package's layout: the reader's page as embed.html, typeset.js beside it, and none of
 *  the app's own extras (the sample, the site's headers, the install manifest). */
function packaged(): Plugin {
  return {
    name: 'package',
    apply: () => PACKAGE,
    enforce: 'post',
    generateBundle(_, bundle) {
      const app = bundle['index.html'];
      if (app?.type === 'asset') {
        delete bundle['index.html'];
        app.fileName = 'embed.html';
        bundle['embed.html'] = app;
        // the policy first, before anything it governs; and none of the app's own head (its
        // name, its colours, installing it: files the package has not)
        const own = /<title>[\s\S]*?<link rel="apple-touch-icon"[^>]*>\n/;
        if (!own.test(String(app.source)))
          throw new Error("index.html: the app's own head is not as the package expects");
        app.source = String(app.source)
          .replace(own, '<title>A book</title>\n')
          .replace('<head>', `<head>\n<meta http-equiv="Content-Security-Policy" content="${embedPolicy()}">`);
      }
      this.emitFile({ type: 'asset', fileName: 'typeset.js', source: readFileSync(ELEMENTS) });
    },
    closeBundle() {
      const out = new URL(PACKAGE_OUT, import.meta.url).pathname;
      // (and the library's cover shadow: the package has no library of its own)
      for (const f of ['sample.epub', '_headers', 'app', 'ui/shadow-cover.png'])
        rmSync(out + f, { recursive: true, force: true });
    },
  };
}

// Tauri expects a fixed port and no clearing of its output.
export default defineConfig({
  plugins: [svelte(), website(), packaged(), serviceWorker()],
  base: PACKAGE ? './' : '/',
  define: { 'import.meta.env.TYPESET_PACKAGE': JSON.stringify(PACKAGE) },
  publicDir: '../assets',
  clearScreen: false,
  server: { port: 5193, strictPort: true, fs: { allow: ['..'] } },
  build: {
    target: 'es2022',
    outDir: PACKAGE ? PACKAGE_OUT : 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 0,
    sourcemap: false,
  },
  worker: { format: 'es' },
});
