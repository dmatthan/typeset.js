// How tangled each function is: its cyclomatic complexity (one, and one more for each
// branch: if, a case, a loop, a catch, ?:, &&, ||, ??), over the app's TypeScript and its
// components' scripts. Lists the most tangled; fails when one is past the limit, so that
// none grows past it.
//
//   node scripts/complexity.mjs [--all] [limit]
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createRequire } from 'node:module';

const root = new URL('..', import.meta.url).pathname;
const ts = createRequire(join(root, 'app/package.json'))('typescript');
const args = process.argv.slice(2);
const all = args.includes('--all');
const LIMIT = Number(args.find(a => /^\d+$/.test(a))) || 30;

const files = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) {
      if (f !== 'pkg') walk(p);
    } else if (/\.(ts|svelte)$/.test(f) && !f.endsWith('.d.ts')) files.push(p);
  }
})(join(root, 'app/src'));

const BRANCH = new Set([
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.CaseClause,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.CatchClause,
  ts.SyntaxKind.ConditionalExpression,
]);
const LOGIC = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
]);
const isFn = n =>
  ts.isFunctionDeclaration(n) ||
  ts.isMethodDeclaration(n) ||
  ts.isArrowFunction(n) ||
  ts.isFunctionExpression(n) ||
  ts.isConstructorDeclaration(n) ||
  ts.isGetAccessor(n) ||
  ts.isSetAccessor(n);

const found = [];
for (const file of files) {
  let text = readFileSync(file, 'utf8');
  // a component: its script, the rest of the file blanked so that lines keep their numbers
  if (file.endsWith('.svelte')) {
    const m = [...text.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
    if (!m.length) continue;
    text = m
      .map(
        x =>
          text.slice(0, x.index).replace(/[^\n]/g, ' ') + x[0].replace(/<\/?script[^>]*>/g, s => ' '.repeat(s.length)),
      )
      .join('\n');
  }
  const src = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const name = n =>
    (n.name && n.name.getText(src)) ||
    (ts.isVariableDeclaration(n.parent)
      ? n.parent.name.getText(src)
      : ts.isPropertyAssignment(n.parent)
        ? n.parent.name.getText(src)
        : '(arrow)');
  // a function's own branches: not those of functions inside it, which are counted apart
  const count = fn => {
    let c = 1;
    const visit = n => {
      if (n !== fn && isFn(n)) return;
      if (BRANCH.has(n.kind)) c++;
      if (ts.isBinaryExpression(n) && LOGIC.has(n.operatorToken.kind)) c++;
      ts.forEachChild(n, visit);
    };
    visit(fn);
    return c;
  };
  const visit = n => {
    if (isFn(n))
      found.push({
        c: count(n),
        at: `${relative(root, file)}:${src.getLineAndCharacterOfPosition(n.getStart(src)).line + 1}`,
        name: name(n),
      });
    ts.forEachChild(n, visit);
  };
  visit(src);
}

found.sort((a, b) => b.c - a.c);
const over = found.filter(f => f.c > LIMIT);
for (const f of all ? found : found.slice(0, 25)) console.log(`${String(f.c).padStart(4)}  ${f.name}  ${f.at}`);
console.log(`${found.length} functions; ${over.length} over ${LIMIT}`);
if (over.length) process.exit(1);
