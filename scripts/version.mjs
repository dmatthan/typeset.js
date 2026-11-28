// The release version: one number for the npm package, the desktop app and the zip, kept in
// `packages/typeset.js/package.json` (the desktop app's tauri.conf.json reads it from
// there; its crate repeats it). A release is the tag `v` + that version.
//
//   node scripts/version.mjs              the version, if every manifest agrees
//   node scripts/version.mjs --tag v0.4.0 and that the tag names it (the release workflows)
//
// Exits 1 and names the disagreement otherwise.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(root, p), 'utf8');

/** The version each manifest carries, by file. */
export function versions() {
  const pkg = JSON.parse(read('packages/typeset.js/package.json')).version;
  const conf = JSON.parse(read('src-tauri/tauri.conf.json')).version;
  // (tauri.conf.json's version may be a path to a package.json, read from its folder)
  const desktop = conf.endsWith('.json') ? JSON.parse(read(join('src-tauri', conf))).version : conf;
  const crate = /^version\s*=\s*"([^"]+)"/m.exec(read('src-tauri/Cargo.toml'))?.[1];
  return {
    'packages/typeset.js/package.json': pkg,
    'src-tauri/tauri.conf.json': desktop,
    'src-tauri/Cargo.toml': crate,
  };
}

/** What is wrong with releasing `tag` as `version`, or null. */
export function tagProblem(tag, version) {
  return tag === `v${version}` ? null : `the tag ${tag} does not name the version ${version} (v${version})`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const found = versions();
  const all = [...new Set(Object.values(found))];
  if (all.length !== 1) {
    console.error(
      `The manifests disagree:\n${Object.entries(found)
        .map(([f, v]) => `  ${f}: ${v}`)
        .join('\n')}`,
    );
    process.exit(1);
  }
  const tag = process.argv[process.argv.indexOf('--tag') + 1];
  const problem = process.argv.includes('--tag') ? tagProblem(tag, all[0]) : null;
  if (problem) {
    console.error(`${problem}.`);
    process.exit(1);
  }
  console.log(all[0]);
}
