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
    { command: 'VOLUMEN_WEB=1 npx vite build --outDir dist-test --emptyOutDir && npx vite preview --outDir dist-test --port 4174 --strictPort', url: 'http://localhost:4174', reuseExistingServer: false, timeout: 120_000 },
    // the sharing service (service/) serving its own production build, on a database of its own
    { command: 'VOLUMEN_WEB=1 npx vite build --outDir dist-svc --emptyOutDir --logLevel warn && cd ../service && { [ -f .dev.vars ] || cp .dev.vars.example .dev.vars; } && rm -rf .wrangler/test && npx wrangler d1 migrations apply volumen --local --persist-to .wrangler/test >/dev/null && exec npx wrangler dev --port 8788 --local-upstream localhost:8788 --upstream-protocol http --persist-to .wrangler/test --assets ../app/dist-svc --test-scheduled', url: 'http://localhost:8788/api/config', reuseExistingServer: false, timeout: 180_000 },
    // the kit in a folder of an ordinary site (Python's server), with a page and books
    { command: 'VOLUMEN_KIT=1 npx vite build --logLevel warn && rm -rf kit-site && mkdir -p kit-site/books && cp -r dist-kit kit-site/volumen && cp ../examples/blog/index.html kit-site/ && mkdir -p kit-site/library && cp ../examples/library/* kit-site/library/ && cp ../assets/sample.epub kit-site/books/meditations.epub && cp ../bench/fixtures/tables.epub kit-site/books/ && exec python3 -m http.server 8791 --bind 127.0.0.1 --directory kit-site', url: 'http://127.0.0.1:8791/', reuseExistingServer: false, timeout: 180_000 },
  ],
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' }, testIgnore: /build\.spec|service\.spec|kit\.spec/ },
    // readers on Firefox: the same interactions (run with --project=firefox)
    { name: 'firefox', use: { browserName: 'firefox' }, testIgnore: /build\.spec|phone\.spec|service\.spec|kit\.spec/ },
    // Safari's engine (Playwright's WebKit; on some Linux distributions it needs Ubuntu's
    // libraries linked into its folder)
    { name: 'webkit', use: { browserName: 'webkit', trace: 'retain-on-failure' }, testIgnore: /build\.spec|service\.spec|kit\.spec/ },
    { name: 'build', use: { browserName: 'chromium', baseURL: 'http://localhost:4174' }, testMatch: /build\.spec/ },
    // (Chromium: its virtual authenticator stands in for a passkey)
    { name: 'service', use: { browserName: 'chromium', baseURL: 'http://localhost:8788' }, testMatch: /service\.spec/ },
    { name: 'kit', use: { browserName: 'chromium', baseURL: 'http://127.0.0.1:8791' }, testMatch: /kit\.spec/ },
  ],
});
