import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://localhost:5193', viewport: { width: 1280, height: 820 } },
  webServer: [
    { command: 'npx vite --port 5193', url: 'http://localhost:5193', reuseExistingServer: true },
    // the production build as volumen.page has it (the app at /read, the site's page at /),
    // for what only it has (the service worker)
    { command: 'TYPESET_WEB=1 npx vite build --outDir dist-test --emptyOutDir && npx vite preview --outDir dist-test --port 4174 --strictPort', url: 'http://localhost:4174', reuseExistingServer: false, timeout: 120_000 },
    // the sharing service (service/) serving its own production build, on a database of its own
    { command: 'TYPESET_WEB=1 npx vite build --outDir dist-svc --emptyOutDir --logLevel warn && cd ../service && { [ -f .dev.vars ] || cp .dev.vars.example .dev.vars; } && rm -rf .wrangler/test && npx wrangler d1 migrations apply typeset --local --persist-to .wrangler/test >/dev/null && exec npx wrangler dev --port 8788 --local-upstream localhost:8788 --upstream-protocol http --persist-to .wrangler/test --assets ../app/dist-svc --test-scheduled', url: 'http://localhost:8788/api/config', reuseExistingServer: false, timeout: 180_000 },
    // typeset.js in a folder of an ordinary site (Python's server), put there as the package
    // does (npx typeset.js), with a page and books; the package itself at /pkg/typeset.js/
    { command: 'TYPESET_PACKAGE=1 npx vite build --logLevel warn && rm -rf package-site && mkdir -p package-site/books && node ../packages/typeset.js/bin/typeset.mjs package-site/typeset >/dev/null && mkdir -p package-site/pkg && cp -r ../packages/typeset.js package-site/pkg/ && cp ../examples/blog/index.html package-site/ && mkdir -p package-site/library && cp ../examples/library/* package-site/library/ && cp ../assets/sample.epub package-site/books/meditations.epub && cp ../bench/fixtures/tables.epub package-site/books/ && exec python3 -m http.server 8791 --bind 127.0.0.1 --directory package-site', url: 'http://127.0.0.1:8791/', reuseExistingServer: false, timeout: 180_000 },
  ],
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' }, testIgnore: /build\.spec|service\.spec|package\.spec/ },
    // readers on Firefox: the same interactions (run with --project=firefox)
    { name: 'firefox', use: { browserName: 'firefox' }, testIgnore: /build\.spec|phone\.spec|service\.spec|package\.spec/ },
    // Safari's engine (Playwright's WebKit; on some Linux distributions it needs Ubuntu's
    // libraries linked into its folder)
    { name: 'webkit', use: { browserName: 'webkit', trace: 'retain-on-failure' }, testIgnore: /build\.spec|service\.spec|package\.spec/ },
    { name: 'build', use: { browserName: 'chromium', baseURL: 'http://localhost:4174' }, testMatch: /build\.spec/ },
    // (Chromium: its virtual authenticator stands in for a passkey)
    { name: 'service', use: { browserName: 'chromium', baseURL: 'http://localhost:8788' }, testMatch: /service\.spec/ },
    { name: 'package', use: { browserName: 'chromium', baseURL: 'http://127.0.0.1:8791' }, testMatch: /package\.spec/ },
  ],
});
