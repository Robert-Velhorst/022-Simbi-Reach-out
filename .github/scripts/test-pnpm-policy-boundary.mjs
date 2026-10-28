import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const helper = fileURLToPath(new URL('verify-pnpm-policy.mjs', import.meta.url));
const beforeFile = new URL('../../artifacts/pnpm-policy/before.json', import.meta.url);
const afterFile = new URL('../../artifacts/pnpm-policy/after.json', import.meta.url);
const redirectedRoot = new URL('../../artifacts/unused-temp-root/', import.meta.url);
assert.equal(existsSync(beforeFile), false, 'Boundary test needs a fresh checkout');
assert.equal(existsSync(afterFile), false);
assert.equal(existsSync(redirectedRoot), false);

function invoke(phase) {
  const result = spawnSync(process.execPath, [helper, phase], {
    encoding: 'utf8',
    env: {...process.env, RUNNER_TEMP: fileURLToPath(redirectedRoot)},
  });
  assert.equal(result.error, undefined);
  return result;
}

for (const phase of ['../before', '/before', 'C:\\before', '', 'BEFORE']) {
  assert.notEqual(invoke(phase).status, 0, 'Invalid phases must be rejected');
  assert.equal(existsSync(beforeFile), false);
  assert.equal(existsSync(afterFile), false);
  assert.equal(existsSync(redirectedRoot), false);
}
for (const phase of ['before', 'after']) {
  const result = invoke(phase);
  assert.equal(result.status, 0, result.stderr);
}
assert.equal(JSON.parse(readFileSync(beforeFile, 'utf8')).phase, 'before');
assert.equal(JSON.parse(readFileSync(afterFile, 'utf8')).phase, 'after');
assert.equal(existsSync(redirectedRoot), false, 'RUNNER_TEMP must not select the output root');
console.log('Policy output boundary: invalid phases rejected and fixed-path controls passed');
