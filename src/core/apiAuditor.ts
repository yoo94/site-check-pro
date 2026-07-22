import type { AuditEventBus } from './eventBus.js';
import type { CheckResult, ResolvedSiteCheckProConfig } from '../types.js';
import { makeCheckResult } from './check.js';

export async function auditApis(
  runId: string,
  config: ResolvedSiteCheckProConfig,
  eventBus: AuditEventBus,
  signal?: AbortSignal,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  for (const api of config.api) {
    if (signal?.aborted) break;
    eventBus.publish({ type: 'check.started', runId, route: api.url, browser: 'node', profile: 'api', check: api.name });
    const startedAt = Date.now();
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(), api.timeoutMs ?? 5_000);

    try {
      const response = await fetch(api.url, {
        method: api.method ?? 'GET',
        headers: api.headers,
        body: api.body,
        signal: controller.signal,
      });
      const expected = api.expectedStatus ?? [200];
      const passed = expected.includes(response.status);
      const result = makeCheckResult({
        runId,
        route: api.url,
        finalUrl: response.url,
        profile: 'api',
        browser: 'node',
        category: 'api',
        check: api.name,
        startedAt,
        status: passed ? 'passed' : 'failed',
        severity: passed ? undefined : 'critical',
        message: passed ? `HTTP ${response.status}` : `Expected ${expected.join(', ')}, received ${response.status}`,
        details: { status: response.status },
      });
      results.push(result);
      eventBus.publish({ type: 'check.finished', runId, result });
    } catch (error) {
      const result = makeCheckResult({
        runId,
        route: api.url,
        finalUrl: api.url,
        profile: 'api',
        browser: 'node',
        category: 'api',
        check: api.name,
        startedAt,
        status: 'failed',
        severity: 'critical',
        message: error instanceof Error ? error.message : String(error),
      });
      results.push(result);
      eventBus.publish({ type: 'check.finished', runId, result });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  return results;
}
