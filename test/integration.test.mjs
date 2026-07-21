import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveConfig, runAudit } from '../dist/index.js';

const chromiumPath = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']
  .find((candidate) => fs.existsSync(candidate));

test('crawls a rendered site and continues after page failures', { skip: !chromiumPath, timeout: 90_000 }, async (t) => {
  const server = http.createServer((req, res) => {
    if (req.url === '/broken') {
      res.writeHead(500, { 'content-type': 'text/html' });
      res.end('<h1>broken</h1>');
      return;
    }
    if (req.url === '/api/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
      return;
    }
    if (req.url === '/about') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<main><h1>About</h1><a href="/">Home</a></main>');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<main id="app"><h1>Home</h1><a href="/about">About</a><a href="/broken">Broken</a></main>');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseURL = `http://127.0.0.1:${address.port}`;
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-check-pro-test-'));

  try {
    const config = resolveConfig({
      baseURL,
      browsers: ['chromium'],
      browserLaunchOptions: { chromium: { executablePath: chromiumPath, args: ['--no-sandbox'] } },
      outputDir,
      dashboard: { enabled: false, open: false },
      crawl: { maxPages: 10, maxDepth: 2, settleTimeMs: 0 },
      checks: { history: true, reload: true },
      api: [{ name: 'health', url: `${baseURL}/api/health`, expectedStatus: [200] }],
    });

    const result = await runAudit(config);
    const results = JSON.parse(fs.readFileSync(path.join(result.runDir, 'result.json'), 'utf8'));
    if (results.some((item) => String(item.message).includes('ERR_BLOCKED_BY_ADMINISTRATOR'))) {
      t.skip('This execution sandbox blocks browser network navigation.');
      return;
    }
    assert.ok(result.summary.discoveredRoutes >= 3);
    assert.ok(result.summary.completedChecks > 0);
    assert.ok(result.summary.failedChecks >= 1);
    assert.ok(fs.existsSync(path.join(result.runDir, 'index.html')));
    assert.ok(fs.existsSync(path.join(result.runDir, 'summary.json')));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
