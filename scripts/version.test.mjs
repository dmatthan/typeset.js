// The release version (version.mjs): every manifest that carries it agrees, and a tag
// names it: node --test scripts/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { versions, tagProblem } from './version.mjs';

test('every manifest carries the one version', () => {
  const found = versions();
  assert.equal(new Set(Object.values(found)).size, 1, JSON.stringify(found));
});

test('a release tag is v and the version, nothing else', () => {
  assert.equal(tagProblem('v0.4.0', '0.4.0'), null);
  assert.match(tagProblem('v0.3.0', '0.4.0') ?? '', /0\.3\.0.*0\.4\.0/);
  assert.match(tagProblem('typeset.js-v0.4.0', '0.4.0') ?? '', /v0\.4\.0/);
});
