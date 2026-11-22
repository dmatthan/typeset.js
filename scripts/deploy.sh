#!/usr/bin/env bash
# Volumen on Cloudflare: the web app and its sharing service, one Worker (service/) at a
# domain of your own, else at https://typeset.<your subdomain>.workers.dev.
#
#   npx wrangler login         once (opens Cloudflare in the browser)
#   scripts/deploy.sh          checks, makes what is missing, builds, deploys
#
# A deployment's own values are kept in service/deploy.env (never committed):
#   TYPESET_DOMAIN=example.org          a custom domain (optional; else workers.dev)
#   TYPESET_D1_ID=…                     the database's id (written by the first run)
#   TYPESET_TURNSTILE_SITEKEY=…         Turnstile's site key (public; see below)
# Each run writes service/wrangler.local.jsonc from them and service/wrangler.jsonc, and
# deploys that; the committed config is never changed.
#
# The first run makes the D1 database and applies the schema; later runs apply new
# migrations. Writers' invitations and readers' notes need Turnstile: until its site key
# is in deploy.env and its secret is set (`cd service && npx wrangler secret put
# TURNSTILE_SECRET -c wrangler.local.jsonc`), the service refuses them and says so;
# reading shared books works without it.
#
# Nothing it makes can be billed on the Workers Free plan: requests past the free
# allowance are refused, D1 refuses work past its limits, static assets are free, and
# no paid product (R2, KV writes past free, Durable Objects) is used.
set -euo pipefail
cd "$(dirname "$0")/../service"
W="npx wrangler"
[[ -d node_modules ]] || npm install --no-audit --no-fund

$W whoami >/dev/null 2>&1 || { echo "Not signed in to Cloudflare: run  npx wrangler login  first." >&2; exit 1; }

touch deploy.env
# shellcheck disable=SC1091
source deploy.env
# the database: made once, its id kept in deploy.env
if [[ -z "${TYPESET_D1_ID:-}" ]]; then
  id="$($W d1 list --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s).find(x=>x.name==="typeset");process.stdout.write(d?d.uuid:"")})')"
  if [[ -z "$id" ]]; then
    $W d1 create typeset >/dev/null
    id="$($W d1 list --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).find(x=>x.name==="typeset").uuid))')"
  fi
  [[ "$id" =~ ^[0-9a-f-]{36}$ ]] || { echo "Could not find the D1 database's id." >&2; exit 1; }
  echo "TYPESET_D1_ID=$id" >> deploy.env
  TYPESET_D1_ID="$id"
  echo "D1 database typeset: $id (kept in service/deploy.env)"
fi
# the config deployed: the committed one with this deployment's values in it
TYPESET_D1_ID="$TYPESET_D1_ID" TYPESET_DOMAIN="${TYPESET_DOMAIN:-}" TYPESET_TURNSTILE_SITEKEY="${TYPESET_TURNSTILE_SITEKEY:-}" node -e '
  const fs = require("fs"), e = process.env;
  let s = fs.readFileSync("wrangler.jsonc", "utf8");
  const put = (re, to) => { if (!re.test(s)) throw new Error("wrangler.jsonc: " + re + " not found"); s = s.replace(re, to); };
  put(/"database_id": "0{8}-0{4}-0{4}-0{4}-0{12}"/, `"database_id": "${e.TYPESET_D1_ID}"`);
  put(/"TURNSTILE_SITEKEY": ""/, `"TURNSTILE_SITEKEY": ${JSON.stringify(e.TYPESET_TURNSTILE_SITEKEY)}`);
  if (e.TYPESET_DOMAIN) put(/"workers_dev": true,/, `"routes": [{ "pattern": ${JSON.stringify(e.TYPESET_DOMAIN)}, "custom_domain": true }],\n  "workers_dev": false,`);
  fs.writeFileSync("wrangler.local.jsonc", "// written by scripts/deploy.sh: edit wrangler.jsonc and deploy.env instead\n" + s);'
W="npx wrangler -c wrangler.local.jsonc"
$W d1 migrations apply typeset --remote

npm --prefix ../app run check
(cd ../app && TYPESET_WEB=1 npx vite build --outDir dist-web --emptyOutDir --logLevel warn)
npm run -s check

out="$($W deploy 2>&1 | tee /dev/stderr)"
# the custom domain if there is one, else workers.dev
url="${TYPESET_DOMAIN:+https://$TYPESET_DOMAIN}"
[[ -n "$url" ]] || url="$(grep -o 'https://[a-z0-9.-]*\.workers\.dev' <<<"$out" | head -1 || true)"
[[ -n "$url" ]] && echo "$url" > .origin && echo "Live at $url"

[[ -n "${TYPESET_TURNSTILE_SITEKEY:-}" ]] || echo "
Turnstile is not set up yet, so invitations and readers' notes are refused for now:
  1. Cloudflare dashboard → Turnstile → Add widget: hostname ${url#https://}, mode Managed.
  2. Put its site key in service/deploy.env (TYPESET_TURNSTILE_SITEKEY=…).
  3. cd service && npx wrangler secret put TURNSTILE_SECRET -c wrangler.local.jsonc   (its secret key)
  4. scripts/deploy.sh again."
exit 0
