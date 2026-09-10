import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const root = new URL('../../', import.meta.url);
test('HTML and response CSP both allow every browser API recovery origin', () => {
  const recovery = readFileSync(new URL('app/auth-route-recovery.js', root), 'utf8');
  const origins = [...new Set([...recovery.matchAll(/https:\/\/([a-z0-9.]+)\/api\/v1/g)].map(match => `https://${match[1]}`))];
  assert.equal(origins.length, 2);
  for (const path of ['app/index.html', 'dist/app/index.html', '_headers', 'dist/_headers']) {
    const content = readFileSync(new URL(path, root), 'utf8');
    const policy = content.match(/connect-src ([^;]+)/)?.[1].split(/\s+/) || [];
    for (const origin of origins) assert.ok(policy.includes(origin), `${path} blocks ${origin}`);
  }
});
