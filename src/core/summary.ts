import type { CheckResult, RunSummary } from '../types.js';

export function createSummary(input: {
  runId: string;
  baseURL: string;
  startedAt: number;
  results: CheckResult[];
  discoveredRoutes: Set<string>;
}): RunSummary {
  const { runId, baseURL, startedAt, results, discoveredRoutes } = input;
  const failed = results.filter((result) => result.status === 'failed');
  const warnings = results.filter((result) => result.status === 'warning');
  const passed = results.filter((result) => result.status === 'passed');
  const routeResults = results.filter((result) => result.browser !== 'node' && result.category !== 'browser' && result.category !== 'authentication');
  const affected = new Set(routeResults.filter((result) => result.status === 'failed').map((result) => `${result.browser}:${result.profile}:${result.route}`));
  const routeInstances = new Set(routeResults.map((result) => `${result.browser}:${result.profile}:${result.route}`));

  const countBy = (key: 'category' | 'browser' | 'profile') =>
    failed.reduce<Record<string, number>>((acc, result) => {
      const value = String(result[key]);
      acc[value] = (acc[value] ?? 0) + 1;
      return acc;
    }, {});

  const finishedAt = Date.now();
  return {
    runId,
    baseURL,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date(finishedAt).toISOString(),
    durationMs: finishedAt - startedAt,
    discoveredRoutes: discoveredRoutes.size,
    routeInstances: routeInstances.size,
    completedChecks: results.length,
    passedChecks: passed.length,
    warningChecks: warnings.length,
    failedChecks: failed.length,
    affectedRoutes: affected.size,
    affectedRouteRate: routeInstances.size === 0 ? 0 : Number(((affected.size / routeInstances.size) * 100).toFixed(2)),
    checkFailureRate: results.length === 0 ? 0 : Number(((failed.length / results.length) * 100).toFixed(2)),
    byCategory: countBy('category'),
    byBrowser: countBy('browser'),
    byProfile: countBy('profile'),
  };
}
