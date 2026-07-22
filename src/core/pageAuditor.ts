import path from 'node:path';
import type { BrowserContext, ConsoleMessage, Page, Request, Response } from 'playwright';
import type { AuditEventBus } from './eventBus.js';
import type { BrowserName, CheckResult, ResolvedSiteCheckProConfig, RouteResult } from '../types.js';
import { makeCheckResult } from './check.js';
import { normalizeUrl } from '../utils/url.js';

interface AuditPageInput {
  runId: string;
  route: string;
  depth: number;
  browser: BrowserName;
  profile: string;
  context: BrowserContext;
  config: ResolvedSiteCheckProConfig;
  eventBus: AuditEventBus;
  artifactsDir: string;
}

function ignored(url: string, patterns: string[]): boolean {
  return patterns.some((pattern) => url.includes(pattern));
}

async function collectLinks(page: Page, config: ResolvedSiteCheckProConfig, profileExclude: string[]): Promise<string[]> {
  const hrefs = new Set<string>();
  for (const selector of config.crawl.selectors) {
    const values = await page.locator(selector).evaluateAll((nodes, attributes) =>
      nodes.map((node) => {
        const element = node as HTMLElement;
        if (element instanceof HTMLAnchorElement && element.href) return element.href;
        for (const attribute of attributes) {
          const value = element.getAttribute(attribute);
          if (value) return value;
        }
        return '';
      }).filter(Boolean),
      config.crawl.linkAttributes,
    ).catch(() => [] as string[]);
    for (const value of values) hrefs.add(value);
  }

  return [...hrefs]
    .map((href) => normalizeUrl(href, page.url(), config, profileExclude))
    .filter((value): value is string => Boolean(value));
}

export async function auditPage(input: AuditPageInput): Promise<RouteResult> {
  const { runId, route, browser, profile, context, config, eventBus, artifactsDir } = input;
  const profileExclude = config.profiles[profile]?.exclude ?? [];
  const page = await context.newPage();
  const checks: CheckResult[] = [];
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: Array<{ url: string; error?: string }> = [];
  const badResponses: Array<{ url: string; status: number }> = [];

  const onConsole = (message: ConsoleMessage) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  };
  const onPageError = (error: Error) => pageErrors.push(error.message);
  const onRequestFailed = (request: Request) => {
    if (!ignored(request.url(), config.checks.ignoreNetworkPatterns)) {
      failedRequests.push({ url: request.url(), error: request.failure()?.errorText });
    }
  };
  const onResponse = (response: Response) => {
    if (response.status() >= config.checks.failOnHttpStatus && !ignored(response.url(), config.checks.ignoreNetworkPatterns)) {
      badResponses.push({ url: response.url(), status: response.status() });
    }
  };

  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  page.on('requestfailed', onRequestFailed);
  page.on('response', onResponse);

  const publish = (result: CheckResult) => {
    checks.push(result);
    eventBus.publish({ type: 'check.finished', runId, result });
  };

  const startCheck = (check: string) => {
    eventBus.publish({ type: 'check.started', runId, route, browser, profile, check });
    return Date.now();
  };

  let finalUrl = route;
  let discoveredLinks: string[] = [];
  let pageFailed = false;

  const navigationStartedAt = startCheck('page navigation');
  try {
    const response = await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => undefined);
    if (config.crawl.settleTimeMs > 0) await page.waitForTimeout(config.crawl.settleTimeMs);
    finalUrl = page.url();
    const status = response?.status();
    const failed = status !== undefined && status >= config.checks.failOnHttpStatus;
    pageFailed ||= failed;
    publish(makeCheckResult({
      runId, route, finalUrl, profile, browser,
      category: 'navigation', check: 'page navigation', startedAt: navigationStartedAt,
      status: failed ? 'failed' : 'passed', severity: failed ? 'critical' : undefined,
      message: failed ? `Document returned HTTP ${status}` : `Opened ${finalUrl}`,
      details: { status },
    }));
  } catch (error) {
    pageFailed = true;
    publish(makeCheckResult({
      runId, route, finalUrl, profile, browser,
      category: 'navigation', check: 'page navigation', startedAt: navigationStartedAt,
      status: 'failed', severity: 'critical',
      message: error instanceof Error ? error.message : String(error),
    }));
  }

  if (!pageFailed) {
    const startedAt = startCheck('rendered content');
    try {
      const snapshot = await page.locator('body').evaluate((body) => {
        const element = body as HTMLElement;
        return {
          textLength: (element.innerText || '').trim().length,
          childCount: element.children.length,
        };
      });
      const rendered = snapshot.childCount > 0 && snapshot.textLength >= config.checks.minVisibleTextLength;
      pageFailed ||= !rendered;
      publish(makeCheckResult({
        runId, route, finalUrl, profile, browser,
        category: 'render', check: 'rendered content', startedAt,
        status: rendered ? 'passed' : 'failed', severity: rendered ? undefined : 'high',
        message: rendered ? 'Body contains rendered content' : 'Page appears blank or incomplete',
        details: snapshot,
      }));
    } catch (error) {
      pageFailed = true;
      publish(makeCheckResult({
        runId, route, finalUrl, profile, browser,
        category: 'render', check: 'rendered content', startedAt,
        status: 'failed', severity: 'high',
        message: error instanceof Error ? error.message : String(error),
      }));
    }

    discoveredLinks = await collectLinks(page, config, profileExclude);

    const consoleStarted = startCheck('console errors');
    const consoleFailed = config.checks.failOnConsoleError && (consoleErrors.length > 0 || pageErrors.length > 0);
    pageFailed ||= consoleFailed;
    publish(makeCheckResult({
      runId, route, finalUrl, profile, browser,
      category: 'console', check: 'console errors', startedAt: consoleStarted,
      status: consoleFailed ? 'failed' : 'passed', severity: consoleFailed ? 'high' : undefined,
      message: consoleFailed ? `${consoleErrors.length + pageErrors.length} runtime error(s)` : 'No runtime errors',
      details: { consoleErrors, pageErrors },
    }));

    const networkStarted = startCheck('network requests');
    const networkFailed = failedRequests.length > 0 || badResponses.length > 0;
    pageFailed ||= networkFailed;
    publish(makeCheckResult({
      runId, route, finalUrl, profile, browser,
      category: 'network', check: 'network requests', startedAt: networkStarted,
      status: networkFailed ? 'failed' : 'passed', severity: networkFailed ? 'medium' : undefined,
      message: networkFailed ? `${failedRequests.length} failed request(s), ${badResponses.length} bad response(s)` : 'No failed requests',
      details: { failedRequests, badResponses },
    }));

    if (config.checks.reload) {
      const startedAt = startCheck('reload');
      try {
        const before = page.url();
        const response = await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
        await page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => undefined);
        const after = page.url();
        const status = response?.status();
        const failed = before !== after || (status !== undefined && status >= config.checks.failOnHttpStatus);
        pageFailed ||= failed;
        publish(makeCheckResult({
          runId, route, finalUrl: after, profile, browser,
          category: 'reload', check: 'reload', startedAt,
          status: failed ? 'failed' : 'passed', severity: failed ? 'high' : undefined,
          message: failed ? `Reload changed URL or failed (${before} -> ${after})` : 'Reload completed successfully',
          details: { before, after, status },
        }));
      } catch (error) {
        pageFailed = true;
        publish(makeCheckResult({
          runId, route, finalUrl: page.url(), profile, browser,
          category: 'reload', check: 'reload', startedAt,
          status: 'failed', severity: 'high',
          message: error instanceof Error ? error.message : String(error),
        }));
      }
    }

    const normalizedRoute = normalizeUrl(route, route, config);
    const normalizedBase = normalizeUrl(config.baseURL, config.baseURL, config);
    if (config.checks.history && normalizedRoute !== normalizedBase && new URL(route).origin === new URL(config.baseURL).origin) {
      const startedAt = startCheck('browser history');
      try {
        await page.goto(config.baseURL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await page.goBack({ waitUntil: 'domcontentloaded', timeout: 30_000 });
        const backUrl = page.url();
        await page.goForward({ waitUntil: 'domcontentloaded', timeout: 30_000 });
        const forwardUrl = page.url();
        const failed = normalizeUrl(backUrl, backUrl, config) !== normalizeUrl(config.baseURL, config.baseURL, config)
          || normalizeUrl(forwardUrl, forwardUrl, config) !== normalizeUrl(route, route, config);
        pageFailed ||= failed;
        publish(makeCheckResult({
          runId, route, finalUrl: forwardUrl, profile, browser,
          category: 'history', check: 'browser history', startedAt,
          status: failed ? 'failed' : 'passed', severity: failed ? 'medium' : undefined,
          message: failed ? 'Back/forward navigation did not restore expected URLs' : 'Back/forward navigation succeeded',
          details: { backUrl, forwardUrl },
        }));
      } catch (error) {
        pageFailed = true;
        publish(makeCheckResult({
          runId, route, finalUrl: page.url(), profile, browser,
          category: 'history', check: 'browser history', startedAt,
          status: 'failed', severity: 'medium',
          message: error instanceof Error ? error.message : String(error),
        }));
      }
    }
  }

  if (pageFailed) {
    const filename = `${browser}-${profile}-${encodeURIComponent(new URL(route).pathname || 'root')}-${Date.now()}.png`
      .replaceAll('%', '_')
      .replaceAll('/', '_');
    const screenshotPath = path.join(artifactsDir, filename);
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
    const lastFailed = [...checks].reverse().find((check) => check.status === 'failed');
    if (lastFailed) lastFailed.artifact = `artifacts/${filename}`;
  }

  await page.close();
  return { route, finalUrl, browser, profile, depth: input.depth, checks, discoveredLinks };
}
