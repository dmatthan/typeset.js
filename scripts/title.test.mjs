// The pull request title rule (title.mjs), case by case: node --test 'scripts/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { titleProblem } from './title.mjs';

test('titles in the convention pass', () => {
  for (const t of [
    'fix(press): break web addresses after slashes',
    'docs(repo): add contributing guide, security policy and templates',
    'build(deps): bump zip from 9.0.2 to 9.1.0',
    'feat(reader)!: drop the first notes format',
    'refactor(press): lift `fill_pre` out of set_paras',
  ])
    assert.equal(titleProblem(t), null, t);
});

test('each way a title can be wrong is named', () => {
  const cases = {
    'Fix the press': /type\(scope\): summary/,
    'feature(press): add a thing': /type "feature"/,
    'fix(printer): add a thing': /scope "printer"/,
    'fix: add a thing': /type\(scope\): summary/,
    'fix(press): Add a thing': /lower case/,
    'fix(press): add a thing.': /full stop/,
    [`fix(press): ${'a'.repeat(70)}`]: /72/,
  };
  for (const [t, why] of Object.entries(cases)) assert.match(titleProblem(t) ?? '', why, t);
});
