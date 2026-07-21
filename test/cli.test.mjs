import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('CLI exposes the expected commands', () => {
  const result = spawnSync(process.execPath, ['dist/cli.js', '--help'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /site-check-pro/);
  assert.match(result.stdout, /install-browsers/);
  assert.match(result.stdout, /report/);
  assert.match(result.stdout, /auth/);
});
