import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AuditEvent, CheckResult, RunSummary } from '../types.js';
import type { AuditEventBus } from '../core/eventBus.js';
import { renderReportHtml } from '../reporter/htmlReporter.js';

const emptySummary = (baseURL: string): RunSummary => ({
  runId: 'running', baseURL, startedAt: new Date().toISOString(), finishedAt: '', durationMs: 0,
  discoveredRoutes: 0, routeInstances: 0, completedChecks: 0, passedChecks: 0, warningChecks: 0,
  failedChecks: 0, affectedRoutes: 0, affectedRouteRate: 0, checkFailureRate: 0,
  byCategory: {}, byBrowser: {}, byProfile: {},
});

function liveSummary(input: {
  baseURL: string;
  runId: string;
  startedAt: string;
  results: CheckResult[];
  discoveredRoutes: Set<string>;
  routeInstances: Set<string>;
}): RunSummary {
  const failed = input.results.filter((result) => result.status === 'failed');
  const affected = new Set(
    input.results
      .filter((result) => result.status === 'failed' && result.browser !== 'node' && result.category !== 'browser' && result.category !== 'authentication')
      .map((result) => `${result.browser}:${result.profile}:${result.route}`),
  );
  const countBy = (key: 'category' | 'browser' | 'profile') =>
    failed.reduce<Record<string, number>>((acc, result) => {
      const value = String(result[key]);
      acc[value] = (acc[value] ?? 0) + 1;
      return acc;
    }, {});
  const startedAtMs = Date.parse(input.startedAt);
  return {
    runId: input.runId,
    baseURL: input.baseURL,
    startedAt: input.startedAt,
    finishedAt: '',
    durationMs: Number.isNaN(startedAtMs) ? 0 : Date.now() - startedAtMs,
    discoveredRoutes: input.discoveredRoutes.size,
    routeInstances: input.routeInstances.size,
    completedChecks: input.results.length,
    passedChecks: input.results.filter((result) => result.status === 'passed').length,
    warningChecks: input.results.filter((result) => result.status === 'warning').length,
    failedChecks: failed.length,
    affectedRoutes: affected.size,
    affectedRouteRate: input.routeInstances.size === 0 ? 0 : Number(((affected.size / input.routeInstances.size) * 100).toFixed(2)),
    checkFailureRate: input.results.length === 0 ? 0 : Number(((failed.length / input.results.length) * 100).toFixed(2)),
    byCategory: countBy('category'),
    byBrowser: countBy('browser'),
    byProfile: countBy('profile'),
  };
}

export async function startDashboard(input: {
  port: number;
  baseURL: string;
  eventBus: AuditEventBus;
  getRunDir: () => string | undefined;
}): Promise<{ url: string; close: () => Promise<void> }> {
  const clients = new Set<http.ServerResponse>();
  const results: CheckResult[] = [];
  const discoveredRoutes = new Set<string>();
  const routeInstances = new Set<string>();
  let summary = emptySummary(input.baseURL);
  let runId = 'running';
  let startedAt = summary.startedAt;
  let currentRunDir: string | undefined;
  let finished = false;

  const unsubscribe = input.eventBus.subscribe((event: AuditEvent) => {
    if (event.type === 'run.started') {
      results.length = 0;
      discoveredRoutes.clear();
      routeInstances.clear();
      runId = event.runId;
      startedAt = event.startedAt;
      currentRunDir = event.runDir;
      finished = false;
    }
    if (event.type === 'route.discovered') {
      discoveredRoutes.add(event.route);
      routeInstances.add(`${event.browser}:${event.profile}:${event.route}`);
    }
    if (event.type === 'check.finished') results.push(event.result);
    if (event.type === 'run.finished') {
      summary = event.summary;
      finished = true;
    }
    for (const client of clients) {
      client.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    }
  });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    if (url.pathname === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });
      res.write(': connected\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (url.pathname === '/') {
      const currentSummary = finished ? summary : liveSummary({
        baseURL: input.baseURL,
        runId,
        startedAt,
        results,
        discoveredRoutes,
        routeInstances,
      });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderReportHtml(currentSummary, results, true, {
        discoveredRoutes: [...discoveredRoutes],
        routeInstances: [...routeInstances],
      }));
      return;
    }
    const runDir = currentRunDir ?? input.getRunDir();
    if (runDir && ['/summary.json', '/result.json'].includes(url.pathname)) {
      const filename = url.pathname.slice(1);
      const candidate = path.join(runDir, filename);
      if (fs.existsSync(candidate)) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        fs.createReadStream(candidate).pipe(res);
        return;
      }
    }
    if (runDir && url.pathname.startsWith('/artifacts/')) {
      const candidate = path.resolve(runDir, `.${url.pathname}`);
      const relative = path.relative(path.resolve(runDir), candidate);
      if (!relative.startsWith('..') && !path.isAbsolute(relative) && fs.existsSync(candidate)) {
        const extension = path.extname(candidate).toLowerCase();
        const contentTypes: Record<string, string> = {
          '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
          '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.zip': 'application/zip',
        };
        res.writeHead(200, { 'Content-Type': contentTypes[extension] ?? 'application/octet-stream' });
        fs.createReadStream(candidate).pipe(res);
        return;
      }
    }
    res.writeHead(404).end('Not found');
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(input.port, '127.0.0.1', resolve);
  });

  return {
    url: `http://127.0.0.1:${input.port}`,
    close: async () => {
      unsubscribe();
      for (const client of clients) client.end();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
