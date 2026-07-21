import test from 'node:test';
import assert from 'node:assert/strict';
import { defineConfig, resolveConfig } from '../dist/index.js';

test('resolves framework-agnostic defaults', () => {
  const config = resolveConfig(defineConfig({ baseURL: 'http://localhost:3000/' }));
  assert.equal(config.baseURL, 'http://localhost:3000');
  assert.deepEqual(config.browsers, ['chromium']);
  assert.ok(config.profiles.guest);
  assert.equal(config.checks.reload, true);
  assert.equal(config.checks.history, true);
  assert.equal(config.dashboard.enabled, false);
  assert.deepEqual(config.crawl.linkAttributes, ['href', 'data-href', 'data-route', 'data-url']);
});
