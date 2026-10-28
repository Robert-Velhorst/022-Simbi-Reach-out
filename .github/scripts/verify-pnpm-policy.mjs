import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';

assert.equal(process.env.GITHUB_ACTIONS, 'true', 'This check runs on the owned CI worker');
assert.equal(process.env.GITHUB_REPOSITORY, 'Robert-Velhorst/022-Simbi-Reach-out');
const phase = process.argv[2];
assert.ok(['before', 'after'].includes(phase));

function pnpm(args) {
  assert.ok(args.every(value => /^[A-Za-z0-9-]+$/.test(value)));
  const options = {cwd: new URL('../../frontend/', import.meta.url), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']};
  return (process.platform === 'win32'
    ? execFileSync('cmd.exe', ['/d', '/s', '/c', ['pnpm', ...args].join(' ')], options)
    : execFileSync('pnpm', args, options)).trim();
}

const expected = {
  minimumReleaseAge: 1440,
  minimumReleaseAgeStrict: true,
  minimumReleaseAgeIgnoreMissingTime: false,
  minimumReleaseAgeExclude: [],
  strictPeerDependencies: true,
  trustLockfile: false,
  verifyStoreIntegrity: true,
};
const policy = {};
for (const key of Object.keys(expected)) {
  const value = pnpm(['config', 'get', key, '--json']);
  policy[key] = value === 'undefined' || value === '' ? null : JSON.parse(value);
}
const manifest = JSON.parse(readFileSync(new URL('../../frontend/package.json', import.meta.url), 'utf8'));
const declared = /^pnpm@([^+]+)/.exec(manifest.packageManager)?.[1];
const record = {
  phase,
  checkout: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: new URL('../../', import.meta.url), encoding: 'utf8'}).trim(),
  actualNode: process.version,
  actualPnpm: pnpm(['--version']),
  declaredPnpm: declared,
  workspaceSha256: createHash('sha256').update(readFileSync(new URL('../../frontend/pnpm-workspace.yaml', import.meta.url))).digest('hex'),
  policy,
};
const directory = new URL('../../artifacts/pnpm-policy/', import.meta.url);
const beforeFile = new URL('before.json', directory);
const afterFile = new URL('after.json', directory);
mkdirSync(directory, {recursive: true});
writeFileSync(phase === 'before' ? beforeFile : afterFile, `${JSON.stringify(record, null, 2)}\n`);
assert.deepEqual(policy, expected, 'The effective policy must match every explicit requirement');
assert.equal(record.actualPnpm, declared, 'CI must use the package manager declared by this source');
if (phase === 'after') {
  const before = JSON.parse(readFileSync(beforeFile, 'utf8'));
  assert.equal(record.workspaceSha256, before.workspaceSha256, 'Installation must not rewrite the policy');
  assert.deepEqual(record.policy, before.policy);
  assert.equal(record.actualPnpm, before.actualPnpm);
  assert.equal(record.checkout, before.checkout);
}
console.log(JSON.stringify({phase, actualPnpm: record.actualPnpm, policy}));
