import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { resolveConfig, runAudit } from '../dist/index.js';

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('starts a configured web server, continues after API failure, and writes reports', { timeout: 30_000 }, async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-check-pro-api-'));
  const serverFile = path.join(tempDir, 'server.mjs');
  const port = await freePort();
  const baseURL = `http://127.0.0.1:${port}`;

  fs.writeFileSync(serverFile, `
    import http from 'node:http';
    const port = Number(process.argv[2]);
    const server = http.createServer((req, res) => {
      if (req.url === '/broken') {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end('{"ok":false}');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
    server.listen(port, '127.0.0.1');
    const close = () => server.close(() => process.exit(0));
    process.on('SIGTERM', close);
    process.on('SIGINT', close);
  `, 'utf8');

  const config = resolveConfig({
    baseURL,
    browsers: [],
    outputDir: path.join(tempDir, 'runs'),
    dashboard: { enabled: false, open: false },
    webServer: {
      command: `${JSON.stringify(process.execPath)} ${JSON.stringify(serverFile)} ${port}`,
      url: baseURL,
      timeoutMs: 10_000,
      reuseExisting: false,
    },
    api: [
      { name: 'healthy API', url: `${baseURL}/health`, expectedStatus: [200] },
      { name: 'broken API', url: `${baseURL}/broken`, expectedStatus: [200] },
    ],
  });

  const result = await runAudit(config);
  assert.equal(result.summary.completedChecks, 2);
  assert.equal(result.summary.passedChecks, 1);
  assert.equal(result.summary.failedChecks, 1);
  assert.equal(result.summary.checkFailureRate, 50);
  assert.ok(fs.existsSync(path.join(result.runDir, 'index.html')));
  assert.ok(fs.existsSync(path.join(result.runDir, 'summary.json')));
  assert.ok(fs.existsSync(path.join(result.runDir, 'result.json')));
  assert.ok(!fs.existsSync(path.join(result.runDir, 'results.json')));
  const reportHtml = fs.readFileSync(path.join(result.runDir, 'index.html'), 'utf8');
  assert.ok(reportHtml.includes('broken API'));
  assert.ok(reportHtml.includes('요약 분석'));
  assert.ok(reportHtml.includes('실시간 상세 결과'));
  assert.ok(reportHtml.includes('data-view="finalView"'));
  assert.ok(reportHtml.includes("status.value='failed'"));
  assert.ok(reportHtml.includes('id="showRoutes"'));
  assert.ok(!reportHtml.includes('id="finalModal"'));
  assert.ok(reportHtml.includes('품질 분석'));
  assert.ok(!reportHtml.includes('href="result.json"'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(result.runDir, 'result.json'), 'utf8')).length, 2);
});
