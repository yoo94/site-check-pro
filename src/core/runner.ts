import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { chromium, firefox, webkit, type BrowserType } from 'playwright';
import type { Browser, BrowserContextOptions } from 'playwright';
import type { BrowserName, CheckResult, ResolvedSiteCheckProConfig, RunSummary } from '../types.js';
import { AuditEventBus } from './eventBus.js';
import { JsonlStore } from '../store/jsonlStore.js';
import { auditPage } from './pageAuditor.js';
import { auditApis } from './apiAuditor.js';
import { createSummary } from './summary.js';
import { writeHtmlReport } from '../reporter/htmlReporter.js';
import { startConfiguredWebServer, type StartedWebServer } from './webServer.js';
import { makeCheckResult } from './check.js';

const browserTypes: Record<BrowserName, BrowserType> = { chromium, firefox, webkit };

export interface RunResult {
  summary: RunSummary;
  runDir: string;
  eventBus: AuditEventBus;
}

class AuditCancelledError extends Error {
  constructor() {
    super('사이트 점검이 중지되었습니다.');
    this.name = 'AuditCancelledError';
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AuditCancelledError();
}

function isAuditCancelled(error: unknown): boolean {
  return error instanceof AuditCancelledError;
}

export async function runAudit(
  config: ResolvedSiteCheckProConfig,
  eventBus = new AuditEventBus(),
  options: { signal?: AbortSignal } = {},
): Promise<RunResult> {
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const startedAt = Date.now();
  const store = new JsonlStore(config.outputDir, runId);
  const results: CheckResult[] = [];
  const discoveredRoutes = new Set<string>();
  let webServer: StartedWebServer | undefined;

  const unsubscribe = eventBus.subscribe((event) => {
    if (event.type === 'check.started' || event.type === 'check.finished' || event.type === 'route.discovered') {
      store.appendEvent(event);
      if (event.type === 'check.finished') results.push(event.result);
    }
  });

  const startEvent = {
    type: 'run.started' as const,
    runId,
    runDir: store.runDir,
    baseURL: config.baseURL,
    startedAt: new Date(startedAt).toISOString(),
  };
  store.appendEvent(startEvent);
  eventBus.publish(startEvent);
  let status: RunSummary['status'] = 'completed';

  const publishFailure = (input: {
    browser: BrowserName;
    profile: string;
    category: 'browser' | 'authentication';
    check: string;
    message: string;
  }) => {
    const checkStartedAt = Date.now();
    eventBus.publish({
      type: 'check.started',
      runId,
      route: config.baseURL,
      browser: input.browser,
      profile: input.profile,
      check: input.check,
    });
    const result = makeCheckResult({
      runId,
      route: config.baseURL,
      finalUrl: config.baseURL,
      profile: input.profile,
      browser: input.browser,
      category: input.category,
      check: input.check,
      startedAt: checkStartedAt,
      status: 'failed',
      severity: 'critical',
      message: input.message,
    });
    eventBus.publish({ type: 'check.finished', runId, result });
  };

  try {
    throwIfAborted(options.signal);
    webServer = await startConfiguredWebServer(config);

    for (const browserName of config.browsers) {
      throwIfAborted(options.signal);
      let browser: Browser;
      try {
        browser = await browserTypes[browserName].launch({
          headless: config.headless,
          ...config.browserLaunchOptions[browserName],
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        publishFailure({
          browser: browserName,
          profile: 'system',
          category: 'browser',
          check: `launch ${browserName}`,
          message: `Could not launch ${browserName}. Run "npx site-check-pro install-browsers ${browserName}". ${message}`,
        });
        continue;
      }

      const closeBrowserOnAbort = () => {
        void browser.close().catch(() => undefined);
      };
      options.signal?.addEventListener('abort', closeBrowserOnAbort, { once: true });

      try {
        for (const [profileName, profile] of Object.entries(config.profiles)) {
          throwIfAborted(options.signal);
          const contextOptions: BrowserContextOptions = {};
          if (profile.storageState) contextOptions.storageState = path.resolve(profile.storageState);

          let context;
          try {
            context = await browser.newContext(contextOptions);
          } catch (error) {
            publishFailure({
              browser: browserName,
              profile: profileName,
              category: 'authentication',
              check: 'load authentication state',
              message: error instanceof Error ? error.message : String(error),
            });
            continue;
          }

          try {
            const queue = (profile.seeds?.length ? profile.seeds : ['/']).map((seed) => ({
              url: new URL(seed, config.baseURL).toString(),
              depth: 0,
            }));
            const seen = new Set<string>();

            while (queue.length > 0 && seen.size < config.crawl.maxPages) {
              throwIfAborted(options.signal);
              const item = queue.shift();
              if (!item || seen.has(item.url) || item.depth > config.crawl.maxDepth) continue;
              seen.add(item.url);
              discoveredRoutes.add(item.url);
              eventBus.publish({
                type: 'route.discovered',
                runId,
                route: item.url,
                browser: browserName,
                profile: profileName,
                depth: item.depth,
              });

              const routeResult = await auditPage({
                runId,
                route: item.url,
                depth: item.depth,
                browser: browserName,
                profile: profileName,
                context,
                config,
                eventBus,
                artifactsDir: store.artifactsDir,
              });
              throwIfAborted(options.signal);

              for (const link of routeResult.discoveredLinks) {
                if (!seen.has(link) && seen.size + queue.length < config.crawl.maxPages) {
                  queue.push({ url: link, depth: item.depth + 1 });
                }
              }
            }
          } finally {
            await context.close().catch(() => undefined);
          }
        }
      } finally {
        options.signal?.removeEventListener('abort', closeBrowserOnAbort);
        await browser.close().catch(() => undefined);
      }
    }

    throwIfAborted(options.signal);
    await auditApis(runId, config, eventBus, options.signal);
    throwIfAborted(options.signal);
  } catch (error) {
    if (!isAuditCancelled(error) && !options.signal?.aborted) throw error;
    status = 'cancelled';
  } finally {
    unsubscribe();
    await webServer?.close();
  }

  const summary = createSummary({ runId, baseURL: config.baseURL, startedAt, results, discoveredRoutes, status });
  store.saveSummary(summary);
  writeHtmlReport(store.runDir, summary, results);
  const finishEvent = status === 'cancelled'
    ? { type: 'run.cancelled' as const, runId, summary }
    : { type: 'run.finished' as const, runId, summary };
  store.appendEvent(finishEvent);
  eventBus.publish(finishEvent);
  return { summary, runDir: store.runDir, eventBus };
}
