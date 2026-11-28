// A pull request title (the squash-merged commit's message) in the repository's convention,
// `type(scope): summary` (CONTRIBUTING.md), or what is wrong with it.
//
//   node scripts/title.mjs "fix(press): break web addresses after slashes"
//
// Exits 1 and names the problem when the title is not in the convention.

export const TYPES = ['feat', 'fix', 'perf', 'refactor', 'test', 'docs', 'build', 'ci', 'chore'];
export const SCOPES = [
  'model',
  'ingest',
  'press',
  'engine',
  'wasm',
  'reader',
  'ui',
  'package',
  'desktop',
  'service',
  'site',
  'deps',
  'repo',
];
const MAX = 72;

/** What is wrong with `title`, or null. */
export function titleProblem(title) {
  const m = /^(\w+)\(([\w-]+)\)!?: (.+)$/.exec(title);
  if (!m) return 'not in the form type(scope): summary';
  const [, type, scope, summary] = m;
  if (!TYPES.includes(type)) return `type "${type}" is not one of ${TYPES.join(', ')}`;
  if (!SCOPES.includes(scope)) return `scope "${scope}" is not one of ${SCOPES.join(', ')}`;
  if (!/^[a-z0-9`]/.test(summary)) return 'the summary begins in lower case';
  if (/\.$/.test(summary)) return 'the summary ends without a full stop';
  if (title.length > MAX) return `${title.length} characters; at most ${MAX}`;
  return null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const problem = titleProblem(process.argv[2] ?? '');
  if (problem) {
    console.error(`Title: ${problem}.\nSee CONTRIBUTING.md, "Commits and titles".`);
    process.exit(1);
  }
}
