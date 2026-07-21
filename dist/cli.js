#!/usr/bin/env node

// src/cli.ts
import pc from "picocolors";
import { Command } from "commander";

// src/config.ts
import path from "path";
import { pathToFileURL } from "url";
import { createJiti } from "jiti";
import { z } from "zod";
var configSchema = z.object({
  baseURL: z.string().url(),
  browsers: z.array(z.enum(["chromium", "firefox", "webkit"])).optional(),
  headless: z.boolean().optional(),
  browserLaunchOptions: z.partialRecord(z.enum(["chromium", "firefox", "webkit"]), z.object({
    executablePath: z.string().optional(),
    args: z.array(z.string()).optional()
  })).optional(),
  outputDir: z.string().optional(),
  webServer: z.object({
    command: z.string().min(1),
    url: z.string().url().optional(),
    cwd: z.string().optional(),
    timeoutMs: z.number().int().positive().optional(),
    reuseExisting: z.boolean().optional(),
    env: z.record(z.string(), z.string()).optional()
  }).optional(),
  profiles: z.record(z.string(), z.object({
    storageState: z.string().optional(),
    seeds: z.array(z.string()).optional()
  })).optional(),
  crawl: z.object({
    maxPages: z.number().int().positive().optional(),
    maxDepth: z.number().int().min(0).optional(),
    sameOriginOnly: z.boolean().optional(),
    include: z.array(z.string()).optional(),
    exclude: z.array(z.string()).optional(),
    selectors: z.array(z.string()).optional(),
    linkAttributes: z.array(z.string()).optional(),
    ignoreQueryParams: z.array(z.string()).optional(),
    settleTimeMs: z.number().int().min(0).optional()
  }).optional(),
  checks: z.object({
    reload: z.boolean().optional(),
    history: z.boolean().optional(),
    minVisibleTextLength: z.number().int().min(0).optional(),
    failOnConsoleError: z.boolean().optional(),
    failOnHttpStatus: z.number().int().min(100).max(599).optional(),
    ignoreNetworkPatterns: z.array(z.string()).optional()
  }).optional(),
  api: z.array(z.object({
    name: z.string(),
    url: z.string().url(),
    method: z.enum(["GET", "HEAD", "POST"]).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.string().optional(),
    expectedStatus: z.array(z.number().int()).optional(),
    timeoutMs: z.number().int().positive().optional()
  })).optional(),
  dashboard: z.object({
    enabled: z.boolean().optional(),
    port: z.number().int().positive().optional(),
    open: z.boolean().optional()
  }).optional()
});
function resolveConfig(config) {
  const parsed = configSchema.parse(config);
  return {
    baseURL: parsed.baseURL.replace(/\/$/, ""),
    browsers: parsed.browsers ?? ["chromium"],
    headless: parsed.headless ?? true,
    browserLaunchOptions: parsed.browserLaunchOptions ?? {},
    outputDir: parsed.outputDir ?? ".site-check-pro/runs",
    webServer: parsed.webServer ? {
      command: parsed.webServer.command,
      url: parsed.webServer.url ?? parsed.baseURL,
      cwd: parsed.webServer.cwd,
      timeoutMs: parsed.webServer.timeoutMs ?? 12e4,
      reuseExisting: parsed.webServer.reuseExisting ?? true,
      env: parsed.webServer.env
    } : void 0,
    profiles: parsed.profiles ?? { guest: {} },
    crawl: {
      maxPages: parsed.crawl?.maxPages ?? 100,
      maxDepth: parsed.crawl?.maxDepth ?? 5,
      sameOriginOnly: parsed.crawl?.sameOriginOnly ?? true,
      include: parsed.crawl?.include ?? ["/**"],
      exclude: parsed.crawl?.exclude ?? [
        "/logout",
        "/signout",
        "/delete/**",
        "/remove/**",
        "/withdraw/**",
        "/payment/**",
        "/purchase/**",
        "/admin/delete/**"
      ],
      selectors: parsed.crawl?.selectors ?? ["a[href]", '[role="link"]'],
      linkAttributes: parsed.crawl?.linkAttributes ?? ["href", "data-href", "data-route", "data-url"],
      ignoreQueryParams: parsed.crawl?.ignoreQueryParams ?? ["utm_source", "utm_medium", "utm_campaign"],
      settleTimeMs: parsed.crawl?.settleTimeMs ?? 300
    },
    checks: {
      reload: parsed.checks?.reload ?? true,
      history: parsed.checks?.history ?? true,
      minVisibleTextLength: parsed.checks?.minVisibleTextLength ?? 1,
      failOnConsoleError: parsed.checks?.failOnConsoleError ?? true,
      failOnHttpStatus: parsed.checks?.failOnHttpStatus ?? 400,
      ignoreNetworkPatterns: parsed.checks?.ignoreNetworkPatterns ?? []
    },
    api: parsed.api ?? [],
    dashboard: {
      enabled: parsed.dashboard?.enabled ?? false,
      port: parsed.dashboard?.port ?? 4177,
      open: parsed.dashboard?.open ?? true
    }
  };
}
async function loadConfig(configPath = "site-check-pro.config.ts") {
  const absolutePath = path.resolve(process.cwd(), configPath);
  const jiti = createJiti(pathToFileURL(import.meta.url).href, { interopDefault: true });
  const loaded = await jiti.import(absolutePath, { default: true });
  return resolveConfig(loaded);
}

// src/core/runner.ts
import { randomUUID as randomUUID2 } from "crypto";
import path5 from "path";
import { chromium, firefox, webkit } from "playwright";

// src/core/eventBus.ts
import { EventEmitter } from "events";
var AuditEventBus = class extends EventEmitter {
  publish(event) {
    this.emit("event", event);
  }
  subscribe(listener) {
    this.on("event", listener);
    return () => this.off("event", listener);
  }
};

// src/store/jsonlStore.ts
import fs from "fs";
import path2 from "path";
var JsonlStore = class {
  runDir;
  artifactsDir;
  eventFile;
  results = [];
  constructor(outputDir, runId) {
    this.runDir = path2.resolve(outputDir, runId);
    this.artifactsDir = path2.join(this.runDir, "artifacts");
    this.eventFile = path2.join(this.runDir, "events.jsonl");
    fs.mkdirSync(this.artifactsDir, { recursive: true });
  }
  appendEvent(event) {
    fs.appendFileSync(this.eventFile, `${JSON.stringify(event)}
`, "utf8");
    if (event.type === "check.finished") this.results.push(event.result);
  }
  getResults() {
    return [...this.results];
  }
  saveSummary(summary) {
    fs.writeFileSync(path2.join(this.runDir, "summary.json"), JSON.stringify(summary, null, 2));
    fs.writeFileSync(path2.join(this.runDir, "result.json"), JSON.stringify(this.results, null, 2));
  }
};

// src/core/pageAuditor.ts
import path3 from "path";

// src/core/check.ts
import { randomUUID } from "crypto";
function makeCheckResult(input2) {
  return {
    id: randomUUID(),
    runId: input2.runId,
    route: input2.route,
    finalUrl: input2.finalUrl,
    profile: input2.profile,
    browser: input2.browser,
    category: input2.category,
    check: input2.check,
    status: input2.status,
    severity: input2.severity,
    startedAt: new Date(input2.startedAt).toISOString(),
    finishedAt: (/* @__PURE__ */ new Date()).toISOString(),
    durationMs: Date.now() - input2.startedAt,
    message: input2.message,
    details: input2.details,
    artifact: input2.artifact
  };
}

// src/utils/pattern.ts
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function globToRegExp(glob) {
  const token = "__DOUBLE_STAR__";
  const escaped = escapeRegExp(glob).replace(/\\\*\\\*/g, token).replace(/\\\*/g, "[^/]*").replaceAll(token, ".*");
  return new RegExp(`^${escaped}$`);
}
function matchesAny(value, patterns) {
  return patterns.some((pattern) => globToRegExp(pattern).test(value));
}

// src/utils/url.ts
var BLOCKED_PROTOCOLS = /* @__PURE__ */ new Set(["mailto:", "tel:", "javascript:", "data:"]);
function normalizeUrl(raw, currentURL, config) {
  try {
    const url = new URL(raw, currentURL);
    const base = new URL(config.baseURL);
    if (BLOCKED_PROTOCOLS.has(url.protocol)) return null;
    if (config.crawl.sameOriginOnly && url.origin !== base.origin) return null;
    url.hash = "";
    for (const key of config.crawl.ignoreQueryParams) url.searchParams.delete(key);
    url.searchParams.sort();
    const pathname = url.pathname || "/";
    if (!matchesAny(pathname, config.crawl.include)) return null;
    if (matchesAny(pathname, config.crawl.exclude)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

// src/core/pageAuditor.ts
function ignored(url, patterns) {
  return patterns.some((pattern) => url.includes(pattern));
}
async function collectLinks(page, config) {
  const hrefs = /* @__PURE__ */ new Set();
  for (const selector of config.crawl.selectors) {
    const values = await page.locator(selector).evaluateAll(
      (nodes, attributes) => nodes.map((node) => {
        const element = node;
        if (element instanceof HTMLAnchorElement && element.href) return element.href;
        for (const attribute of attributes) {
          const value = element.getAttribute(attribute);
          if (value) return value;
        }
        return "";
      }).filter(Boolean),
      config.crawl.linkAttributes
    ).catch(() => []);
    for (const value of values) hrefs.add(value);
  }
  return [...hrefs].map((href) => normalizeUrl(href, page.url(), config)).filter((value) => Boolean(value));
}
async function auditPage(input2) {
  const { runId, route, browser, profile, context, config, eventBus, artifactsDir } = input2;
  const page = await context.newPage();
  const checks = [];
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  const badResponses = [];
  const onConsole = (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  };
  const onPageError = (error) => pageErrors.push(error.message);
  const onRequestFailed = (request) => {
    if (!ignored(request.url(), config.checks.ignoreNetworkPatterns)) {
      failedRequests.push({ url: request.url(), error: request.failure()?.errorText });
    }
  };
  const onResponse = (response) => {
    if (response.status() >= config.checks.failOnHttpStatus && !ignored(response.url(), config.checks.ignoreNetworkPatterns)) {
      badResponses.push({ url: response.url(), status: response.status() });
    }
  };
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("requestfailed", onRequestFailed);
  page.on("response", onResponse);
  const publish = (result) => {
    checks.push(result);
    eventBus.publish({ type: "check.finished", runId, result });
  };
  const startCheck = (check) => {
    eventBus.publish({ type: "check.started", runId, route, browser, profile, check });
    return Date.now();
  };
  let finalUrl = route;
  let discoveredLinks = [];
  let pageFailed = false;
  const navigationStartedAt = startCheck("page navigation");
  try {
    const response = await page.goto(route, { waitUntil: "domcontentloaded", timeout: 3e4 });
    await page.waitForLoadState("networkidle", { timeout: 3e3 }).catch(() => void 0);
    if (config.crawl.settleTimeMs > 0) await page.waitForTimeout(config.crawl.settleTimeMs);
    finalUrl = page.url();
    const status = response?.status();
    const failed = status !== void 0 && status >= config.checks.failOnHttpStatus;
    pageFailed ||= failed;
    publish(makeCheckResult({
      runId,
      route,
      finalUrl,
      profile,
      browser,
      category: "navigation",
      check: "page navigation",
      startedAt: navigationStartedAt,
      status: failed ? "failed" : "passed",
      severity: failed ? "critical" : void 0,
      message: failed ? `Document returned HTTP ${status}` : `Opened ${finalUrl}`,
      details: { status }
    }));
  } catch (error) {
    pageFailed = true;
    publish(makeCheckResult({
      runId,
      route,
      finalUrl,
      profile,
      browser,
      category: "navigation",
      check: "page navigation",
      startedAt: navigationStartedAt,
      status: "failed",
      severity: "critical",
      message: error instanceof Error ? error.message : String(error)
    }));
  }
  if (!pageFailed) {
    const startedAt = startCheck("rendered content");
    try {
      const snapshot = await page.locator("body").evaluate((body) => {
        const element = body;
        return {
          textLength: (element.innerText || "").trim().length,
          childCount: element.children.length
        };
      });
      const rendered = snapshot.childCount > 0 && snapshot.textLength >= config.checks.minVisibleTextLength;
      pageFailed ||= !rendered;
      publish(makeCheckResult({
        runId,
        route,
        finalUrl,
        profile,
        browser,
        category: "render",
        check: "rendered content",
        startedAt,
        status: rendered ? "passed" : "failed",
        severity: rendered ? void 0 : "high",
        message: rendered ? "Body contains rendered content" : "Page appears blank or incomplete",
        details: snapshot
      }));
    } catch (error) {
      pageFailed = true;
      publish(makeCheckResult({
        runId,
        route,
        finalUrl,
        profile,
        browser,
        category: "render",
        check: "rendered content",
        startedAt,
        status: "failed",
        severity: "high",
        message: error instanceof Error ? error.message : String(error)
      }));
    }
    discoveredLinks = await collectLinks(page, config);
    const consoleStarted = startCheck("console errors");
    const consoleFailed = config.checks.failOnConsoleError && (consoleErrors.length > 0 || pageErrors.length > 0);
    pageFailed ||= consoleFailed;
    publish(makeCheckResult({
      runId,
      route,
      finalUrl,
      profile,
      browser,
      category: "console",
      check: "console errors",
      startedAt: consoleStarted,
      status: consoleFailed ? "failed" : "passed",
      severity: consoleFailed ? "high" : void 0,
      message: consoleFailed ? `${consoleErrors.length + pageErrors.length} runtime error(s)` : "No runtime errors",
      details: { consoleErrors, pageErrors }
    }));
    const networkStarted = startCheck("network requests");
    const networkFailed = failedRequests.length > 0 || badResponses.length > 0;
    pageFailed ||= networkFailed;
    publish(makeCheckResult({
      runId,
      route,
      finalUrl,
      profile,
      browser,
      category: "network",
      check: "network requests",
      startedAt: networkStarted,
      status: networkFailed ? "failed" : "passed",
      severity: networkFailed ? "medium" : void 0,
      message: networkFailed ? `${failedRequests.length} failed request(s), ${badResponses.length} bad response(s)` : "No failed requests",
      details: { failedRequests, badResponses }
    }));
    if (config.checks.reload) {
      const startedAt2 = startCheck("reload");
      try {
        const before = page.url();
        const response = await page.reload({ waitUntil: "domcontentloaded", timeout: 3e4 });
        await page.waitForLoadState("networkidle", { timeout: 3e3 }).catch(() => void 0);
        const after = page.url();
        const status = response?.status();
        const failed = before !== after || status !== void 0 && status >= config.checks.failOnHttpStatus;
        pageFailed ||= failed;
        publish(makeCheckResult({
          runId,
          route,
          finalUrl: after,
          profile,
          browser,
          category: "reload",
          check: "reload",
          startedAt: startedAt2,
          status: failed ? "failed" : "passed",
          severity: failed ? "high" : void 0,
          message: failed ? `Reload changed URL or failed (${before} -> ${after})` : "Reload completed successfully",
          details: { before, after, status }
        }));
      } catch (error) {
        pageFailed = true;
        publish(makeCheckResult({
          runId,
          route,
          finalUrl: page.url(),
          profile,
          browser,
          category: "reload",
          check: "reload",
          startedAt: startedAt2,
          status: "failed",
          severity: "high",
          message: error instanceof Error ? error.message : String(error)
        }));
      }
    }
    const normalizedRoute = normalizeUrl(route, route, config);
    const normalizedBase = normalizeUrl(config.baseURL, config.baseURL, config);
    if (config.checks.history && normalizedRoute !== normalizedBase && new URL(route).origin === new URL(config.baseURL).origin) {
      const startedAt2 = startCheck("browser history");
      try {
        await page.goto(config.baseURL, { waitUntil: "domcontentloaded", timeout: 3e4 });
        await page.goto(route, { waitUntil: "domcontentloaded", timeout: 3e4 });
        await page.goBack({ waitUntil: "domcontentloaded", timeout: 3e4 });
        const backUrl = page.url();
        await page.goForward({ waitUntil: "domcontentloaded", timeout: 3e4 });
        const forwardUrl = page.url();
        const failed = normalizeUrl(backUrl, backUrl, config) !== normalizeUrl(config.baseURL, config.baseURL, config) || normalizeUrl(forwardUrl, forwardUrl, config) !== normalizeUrl(route, route, config);
        pageFailed ||= failed;
        publish(makeCheckResult({
          runId,
          route,
          finalUrl: forwardUrl,
          profile,
          browser,
          category: "history",
          check: "browser history",
          startedAt: startedAt2,
          status: failed ? "failed" : "passed",
          severity: failed ? "medium" : void 0,
          message: failed ? "Back/forward navigation did not restore expected URLs" : "Back/forward navigation succeeded",
          details: { backUrl, forwardUrl }
        }));
      } catch (error) {
        pageFailed = true;
        publish(makeCheckResult({
          runId,
          route,
          finalUrl: page.url(),
          profile,
          browser,
          category: "history",
          check: "browser history",
          startedAt: startedAt2,
          status: "failed",
          severity: "medium",
          message: error instanceof Error ? error.message : String(error)
        }));
      }
    }
  }
  if (pageFailed) {
    const filename = `${browser}-${profile}-${encodeURIComponent(new URL(route).pathname || "root")}-${Date.now()}.png`.replaceAll("%", "_").replaceAll("/", "_");
    const screenshotPath = path3.join(artifactsDir, filename);
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => void 0);
    const lastFailed = [...checks].reverse().find((check) => check.status === "failed");
    if (lastFailed) lastFailed.artifact = `artifacts/${filename}`;
  }
  await page.close();
  return { route, finalUrl, browser, profile, depth: input2.depth, checks, discoveredLinks };
}

// src/core/apiAuditor.ts
async function auditApis(runId, config, eventBus) {
  const results = [];
  for (const api of config.api) {
    eventBus.publish({ type: "check.started", runId, route: api.url, browser: "node", profile: "api", check: api.name });
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), api.timeoutMs ?? 5e3);
    try {
      const response = await fetch(api.url, {
        method: api.method ?? "GET",
        headers: api.headers,
        body: api.body,
        signal: controller.signal
      });
      const expected = api.expectedStatus ?? [200];
      const passed = expected.includes(response.status);
      const result = makeCheckResult({
        runId,
        route: api.url,
        finalUrl: response.url,
        profile: "api",
        browser: "node",
        category: "api",
        check: api.name,
        startedAt,
        status: passed ? "passed" : "failed",
        severity: passed ? void 0 : "critical",
        message: passed ? `HTTP ${response.status}` : `Expected ${expected.join(", ")}, received ${response.status}`,
        details: { status: response.status }
      });
      results.push(result);
      eventBus.publish({ type: "check.finished", runId, result });
    } catch (error) {
      const result = makeCheckResult({
        runId,
        route: api.url,
        finalUrl: api.url,
        profile: "api",
        browser: "node",
        category: "api",
        check: api.name,
        startedAt,
        status: "failed",
        severity: "critical",
        message: error instanceof Error ? error.message : String(error)
      });
      results.push(result);
      eventBus.publish({ type: "check.finished", runId, result });
    } finally {
      clearTimeout(timer);
    }
  }
  return results;
}

// src/core/summary.ts
function createSummary(input2) {
  const { runId, baseURL, startedAt, results, discoveredRoutes } = input2;
  const failed = results.filter((result) => result.status === "failed");
  const warnings = results.filter((result) => result.status === "warning");
  const passed = results.filter((result) => result.status === "passed");
  const routeResults = results.filter((result) => result.browser !== "node" && result.category !== "browser" && result.category !== "authentication");
  const affected = new Set(routeResults.filter((result) => result.status === "failed").map((result) => `${result.browser}:${result.profile}:${result.route}`));
  const routeInstances = new Set(routeResults.map((result) => `${result.browser}:${result.profile}:${result.route}`));
  const countBy = (key) => failed.reduce((acc, result) => {
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
    affectedRouteRate: routeInstances.size === 0 ? 0 : Number((affected.size / routeInstances.size * 100).toFixed(2)),
    checkFailureRate: results.length === 0 ? 0 : Number((failed.length / results.length * 100).toFixed(2)),
    byCategory: countBy("category"),
    byBrowser: countBy("browser"),
    byProfile: countBy("profile")
  };
}

// src/reporter/htmlReporter.ts
import fs2 from "fs";
import path4 from "path";
function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function safeJson(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e").replaceAll("&", "\\u0026");
}
function bars(data) {
  const max = Math.max(1, ...Object.values(data));
  return Object.entries(data).sort((a, b) => b[1] - a[1]).map(([label, value]) => `<div class="bar-row"><span>${escapeHtml(label)}</span><div class="bar"><i style="width:${value / max * 100}%"></i></div><b>${value}</b></div>`).join("") || '<p class="muted">No failures</p>';
}
function renderReportHtml(summary, results, live = false, liveState) {
  const routeResults = results.filter((result) => result.browser !== "node" && result.category !== "browser" && result.category !== "authentication");
  const initialRouteUrls = liveState?.discoveredRoutes ?? [...new Set(routeResults.map((result) => result.route))];
  const initialRouteInstances = liveState?.routeInstances ?? [...new Set(routeResults.map((result) => `${result.browser}:${result.profile}:${result.route}`))];
  const initialAffectedInstances = [...new Set(routeResults.filter((result) => result.status === "failed").map((result) => `${result.browser}:${result.profile}:${result.route}`))];
  const failed = results.filter((result) => result.status === "failed");
  const rows = results.map((result) => `
    <tr class="${result.status}">
      <td><span class="status">${escapeHtml(result.status)}</span></td>
      <td>${escapeHtml(result.browser)}</td>
      <td>${escapeHtml(result.profile)}</td>
      <td>${escapeHtml(result.category)}</td>
      <td class="route">${escapeHtml(result.route)}</td>
      <td>${escapeHtml(result.check)}</td>
      <td>${escapeHtml(result.message)}</td>
      <td>${result.durationMs}ms</td>
      <td>${result.artifact ? `<button class="evidence-button detail-button" data-result-id="${escapeHtml(result.id)}"><img src="${escapeHtml(result.artifact)}" alt="\uC2E4\uD328 \uD654\uBA74"><span>Evidence</span></button>` : '<span class="no-evidence">\u2014</span>'}</td>
      <td><button class="detail-button" data-result-id="${escapeHtml(result.id)}">\uC0C1\uC138 \uACB0\uACFC</button></td>
    </tr>`).join("");
  const totalStatus = Math.max(1, summary.completedChecks);
  const passedPercent = summary.passedChecks / totalStatus * 100;
  const warningPercent = summary.warningChecks / totalStatus * 100;
  const failedPercent = summary.failedChecks / totalStatus * 100;
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Site Check Pro report</title>
<style>
:root{font-family:Inter,Pretendard,system-ui,sans-serif;color:#182230;background:#f5f7fb}*{box-sizing:border-box}body{margin:0}.topline{height:4px;background:linear-gradient(90deg,#155eef,#7f56d9,#12b76a)}.wrap{max-width:1440px;margin:auto;padding:32px}.head{display:flex;justify-content:space-between;gap:24px;align-items:center}.eyebrow{color:#155eef;font-weight:800;font-size:12px;letter-spacing:.12em}.head h1{font-size:30px;margin:6px 0 8px;letter-spacing:-.04em}.head-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end}.view-button,.detail-button{border:1px solid #d0d5dd;background:#fff;color:#344054;border-radius:10px;padding:10px 14px;cursor:pointer;font-weight:750;box-shadow:0 1px 2px #1018280d}.view-button:hover,.detail-button:hover{border-color:#84adff;color:#155eef}.view-button.active{border-color:#155eef;background:#155eef;color:#fff;box-shadow:0 3px 10px #155eef33}.connection{padding:7px 10px;border-radius:999px;background:#ecfdf3;color:#067647;font-size:12px;font-weight:750}.muted{color:#667085}.view{display:none}.view.active{display:block}.section-head{display:flex;align-items:end;justify-content:space-between;gap:20px;margin:30px 0 14px}.section-head h2{margin:0 0 5px;font-size:21px;letter-spacing:-.02em}.section-head p{margin:0}.verdict{margin-top:26px;padding:18px 20px;border:1px solid #e4e7ec;background:#fff;border-radius:14px;display:flex;align-items:center;gap:14px;box-shadow:0 2px 10px #1018280a}.verdict-mark{width:40px;height:40px;border-radius:12px;display:grid;place-items:center;background:#fef3f2;color:#b42318;font-weight:900}.verdict.clean .verdict-mark{background:#ecfdf3;color:#067647}.verdict strong{display:block;margin-bottom:3px}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.card,.panel,.table-shell{background:#fff;border:1px solid #e4e7ec;border-radius:14px;box-shadow:0 2px 10px #1018280a}.card{padding:18px;position:relative;overflow:hidden}.card:before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:#b2ccff}.card.danger:before{background:#f97066}.card.success:before{background:#32d583}.card span{font-size:13px;color:#667085}.card strong{font-size:29px;display:block;margin-top:9px;letter-spacing:-.03em}.panels{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.panel{padding:20px;min-height:220px}.panel h3{margin:0 0 18px;font-size:15px}.status-chart{display:flex;align-items:center;gap:24px}.donut{width:132px;height:132px;border-radius:50%;display:grid;place-items:center;flex:0 0 auto}.donut::after{content:'';width:78px;height:78px;background:#fff;border-radius:50%}.legend{display:grid;gap:10px}.legend span{display:flex;align-items:center;gap:8px}.dot{width:10px;height:10px;border-radius:50%}.bar-row{display:grid;grid-template-columns:100px 1fr 40px;align-items:center;gap:10px;margin:12px 0}.bar{height:8px;background:#eef1f5;border-radius:99px;overflow:hidden}.bar i{height:100%;display:block;background:linear-gradient(90deg,#f97066,#d92d20);border-radius:99px}.table-shell{overflow:auto}table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:12px;border-bottom:1px solid #eaecf0;text-align:left;vertical-align:top}th{position:sticky;top:0;background:#f9fafb;color:#475467;font-size:12px;z-index:1}tbody tr:hover{background:#f8faff}.status{font-weight:800;text-transform:uppercase;font-size:11px}.failed .status{color:#b42318}.passed .status{color:#067647}.warning .status{color:#b54708}.route{max-width:300px;word-break:break-all}.toolbar{display:flex;gap:8px}.toolbar input{min-width:300px}.toolbar input,.toolbar select{padding:11px 12px;border:1px solid #d0d5dd;border-radius:9px;background:white}.modal{position:fixed;inset:0;background:#101828b3;display:none;align-items:center;justify-content:center;padding:24px;z-index:20;backdrop-filter:blur(3px)}.modal.open{display:flex}.dialog{background:#fff;border-radius:16px;width:min(980px,100%);max-height:90vh;overflow:auto;box-shadow:0 24px 60px #10182855}.dialog-head{position:sticky;top:0;background:#fff;border-bottom:1px solid #eaecf0;padding:18px 22px;display:flex;justify-content:space-between;align-items:center;z-index:1}.dialog-body{padding:22px}.close{border:0;background:#f2f4f7;border-radius:50%;font-size:22px;width:36px;height:36px;cursor:pointer}.detail-grid{display:grid;grid-template-columns:140px 1fr;gap:10px 18px;margin-bottom:20px}.detail-grid dt{color:#667085}.detail-grid dd{margin:0;word-break:break-word}.details-json{white-space:pre-wrap;word-break:break-word;background:#101828;color:#d0d5dd;padding:16px;border-radius:10px;overflow:auto}.artifact-preview{display:block;max-width:100%;max-height:520px;margin:12px auto;border:1px solid #e4e7ec;border-radius:10px}.artifact-link{display:inline-block;margin-top:8px;color:#155eef;font-weight:700}@media(max-width:1050px){.panels{grid-template-columns:1fr 1fr}}@media(max-width:900px){.grid{grid-template-columns:repeat(2,1fr)}.panels{grid-template-columns:1fr}.wrap{padding:20px}.head{align-items:flex-start;flex-direction:column}.head-actions{justify-content:flex-start}.section-head{align-items:flex-start;flex-direction:column}.toolbar{width:100%}.toolbar input{min-width:0;flex:1}.detail-grid{grid-template-columns:1fr}.detail-grid dd{margin-bottom:8px}}
</style><style>
.sortable{cursor:pointer;user-select:none;white-space:nowrap}.sortable:after{content:' \u21C5';color:#98a2b3}.sortable.asc:after{content:' \u2191';color:#155eef}.sortable.desc:after{content:' \u2193';color:#155eef}.evidence-button{display:grid;gap:5px;padding:5px;font-size:10px}.evidence-button img{width:76px;height:46px;object-fit:cover;border-radius:6px}.no-evidence{color:#98a2b3}.metric-button{width:100%;border:0;background:transparent;text-align:left;padding:0;color:inherit;cursor:pointer}.metric-button:hover strong{color:#155eef}.route-discovery{margin-top:12px;padding:16px 18px}.route-discovery[hidden]{display:none}.route-discovery h3{margin:0 0 12px;font-size:15px}.route-discovery ul{margin:0;padding-left:20px;columns:2}.route-discovery li{margin:7px 0;word-break:break-all}.route-summary{display:grid;gap:10px}.route-group{border:1px solid #e4e7ec;border-radius:12px;overflow:hidden}.route-group summary{cursor:pointer;padding:15px 16px;background:#f9fafb;display:flex;gap:10px;align-items:center}.route-group summary strong{flex:1;word-break:break-all}.route-group ul{margin:0;padding:12px 18px 16px 38px}.route-group li{margin:8px 0}.result-pill{font-size:11px;font-weight:800;padding:4px 8px;border-radius:99px}.result-pill.failed{background:#fef3f2;color:#b42318}.result-pill.warning{background:#fffaeb;color:#b54708}.result-pill.passed{background:#ecfdf3;color:#067647}.final-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px}.final-metrics div{padding:14px;border:1px solid #e4e7ec;border-radius:10px}.final-metrics b{display:block;font-size:24px;margin-top:4px}.issue-link{border:0;background:none;color:#155eef;cursor:pointer;padding:0;text-align:left;font-weight:700}@media(max-width:700px){.route-discovery ul{columns:1}.final-metrics{grid-template-columns:repeat(2,1fr)}}
</style></head><body><div class="topline"></div><main class="wrap">
<div class="head"><div><div class="eyebrow">AUTOMATED QUALITY REPORT</div><h1>Site Check Pro ${live ? "\uC2E4\uC2DC\uAC04 \uC810\uAC80 \uB300\uC2DC\uBCF4\uB4DC" : "\uC0AC\uC774\uD2B8 \uC810\uAC80 \uB9AC\uD3EC\uD2B8"}</h1><div class="muted">${escapeHtml(summary.baseURL)} \xB7 Run ${escapeHtml(summary.runId)}</div></div><div class="head-actions"><button class="view-button active" data-view="summaryView">\uC694\uC57D \uBD84\uC11D</button><button class="view-button" data-view="detailView">\uC2E4\uC2DC\uAC04 \uC0C1\uC138 \uACB0\uACFC <span id="detailCount">${failed.length}</span></button><button class="view-button" data-view="finalView">\uCD5C\uC885 \uACB0\uACFC</button><span id="connection" class="connection">${live ? "\uC5F0\uACB0 \uC911" : "\uCCB4\uD06C \uC644\uB8CC"}</span></div></div>
<section id="summaryView" class="view active">
<div id="verdict" class="verdict ${summary.failedChecks === 0 ? "clean" : ""}"><div id="verdictMark" class="verdict-mark">${summary.failedChecks === 0 ? "\u2713" : "!"}</div><div><strong id="verdictTitle">${summary.failedChecks === 0 ? "\uCE58\uBA85\uC801\uC778 \uBB38\uC81C\uAC00 \uBC1C\uACAC\uB418\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4" : `${summary.failedChecks}\uAC1C\uC758 \uC2E4\uD328 \uD56D\uBAA9\uC744 \uD655\uC778\uD574\uC57C \uD569\uB2C8\uB2E4`}</strong><span id="verdictText" class="muted">${summary.affectedRoutes}\uAC1C \uACBD\uB85C\uC5D0 \uC601\uD5A5 \xB7 \uC804\uCCB4 \uCCB4\uD06C \uC2E4\uD328\uC728 ${summary.checkFailureRate}%</span></div></div>
<div class="section-head"><div><h2>\uC2E4\uD589 \uC694\uC57D</h2><p class="muted">\uC218\uC9D1\uB41C \uC810\uAC80 \uACB0\uACFC\uB97C \uD575\uC2EC \uC9C0\uD45C\uB85C \uC694\uC57D\uD588\uC2B5\uB2C8\uB2E4.</p></div></div>
<section class="grid">
<div class="card"><button id="showRoutes" class="metric-button" type="button"><span>\uBC1C\uACAC \uACBD\uB85C \xB7 \uB20C\uB7EC\uC11C \uBCF4\uAE30</span><strong id="discovered">${summary.discoveredRoutes}</strong></button></div>
<div class="card"><span>\uC810\uAC80 \uACBD\uB85C \uC778\uC2A4\uD134\uC2A4</span><strong id="routeInstances">${summary.routeInstances}</strong></div>
<div class="card"><span>\uC9C4\uD589\uB41C \uCCB4\uD06C</span><strong id="completed">${summary.completedChecks}</strong></div>
<div class="card success"><span>\uD1B5\uACFC</span><strong id="passed">${summary.passedChecks}</strong></div>
<div class="card danger"><button id="showFailed" class="metric-button" type="button"><span>\uC2E4\uD328 \xB7 \uC0C1\uC138\uC5D0\uC11C \uBCF4\uAE30</span><strong id="failed">${summary.failedChecks}</strong></button></div>
<div class="card danger"><span>\uBB38\uC81C \uACBD\uB85C</span><strong id="affected">${summary.affectedRoutes}</strong></div>
<div class="card danger"><span>\uACBD\uB85C \uC601\uD5A5\uB960</span><strong id="affectedRate">${summary.affectedRouteRate}%</strong></div>
<div class="card danger"><span>\uCCB4\uD06C \uC2E4\uD328\uC728</span><strong id="failureRate">${summary.checkFailureRate}%</strong></div>
</section>
<section id="routeDiscovery" class="route-discovery panel" hidden><h3>\uD0D0\uC0C9\uD55C \uACBD\uB85C</h3><ul id="routeDiscoveryList">${initialRouteUrls.map((route) => `<li>${escapeHtml(route)}</li>`).join("") || '<li class="muted">\uC544\uC9C1 \uBC1C\uACAC\uB41C \uACBD\uB85C\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.</li>'}</ul></section>
<div class="section-head"><div><h2>\uD488\uC9C8 \uBD84\uC11D</h2><p class="muted">\uC0C1\uD0DC \uBD84\uD3EC\uC640 \uC2E4\uD328 \uC9D1\uC911 \uAD6C\uAC04\uC744 \uBE44\uAD50\uD569\uB2C8\uB2E4.</p></div></div>
<section class="panels"><div class="panel"><h3>\uC810\uAC80 \uC0C1\uD0DC</h3><div class="status-chart"><div id="statusDonut" class="donut" style="background:conic-gradient(#12b76a 0 ${passedPercent}%,#f79009 ${passedPercent}% ${passedPercent + warningPercent}%,#f04438 ${passedPercent + warningPercent}% ${passedPercent + warningPercent + failedPercent}%,#e4e7ec 0)"></div><div class="legend"><span><i class="dot" style="background:#12b76a"></i>\uD1B5\uACFC <b id="legendPassed">${summary.passedChecks}</b></span><span><i class="dot" style="background:#f79009"></i>\uACBD\uACE0 <b id="legendWarning">${summary.warningChecks}</b></span><span><i class="dot" style="background:#f04438"></i>\uC2E4\uD328 <b id="legendFailed">${summary.failedChecks}</b></span></div></div></div><div class="panel"><h3>\uBB38\uC81C \uC720\uD615</h3><div id="categoryBars">${bars(summary.byCategory)}</div></div><div class="panel"><h3>\uBE0C\uB77C\uC6B0\uC800\uBCC4 \uC2E4\uD328</h3><div id="browserBars">${bars(summary.byBrowser)}</div></div><div class="panel"><h3>\uD504\uB85C\uD544\uBCC4 \uC2E4\uD328</h3><div id="profileBars">${bars(summary.byProfile)}</div></div></section>
</section>
<section id="detailView" class="view"><div class="section-head"><div><h2>\uC2E4\uC2DC\uAC04 \uC0C1\uC138 \uACB0\uACFC</h2><p class="muted">\uC5F4 \uC81C\uBAA9\uC744 \uB20C\uB7EC \uC624\uB984\uCC28\uC21C\xB7\uB0B4\uB9BC\uCC28\uC21C\uC73C\uB85C \uC815\uB82C\uD558\uACE0 \uC2E4\uD328 \uC99D\uAC70\uB97C \uBC14\uB85C \uD655\uC778\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.</p></div><div class="toolbar"><input id="search" placeholder="URL, \uC810\uAC80\uBA85 \uB610\uB294 \uC624\uB958 \uBA54\uC2DC\uC9C0 \uAC80\uC0C9"><select id="status"><option value="">all status</option><option value="failed">failed</option><option value="warning">warning</option><option value="passed">passed</option><option value="skipped">skipped</option></select></div></div>
<div class="table-shell"><table><thead><tr><th class="sortable" data-sort="status">\uC0C1\uD0DC</th><th class="sortable" data-sort="browser">\uBE0C\uB77C\uC6B0\uC800</th><th class="sortable" data-sort="profile">\uD504\uB85C\uD544</th><th class="sortable" data-sort="category">\uBD84\uB958</th><th class="sortable" data-sort="route">\uACBD\uB85C</th><th class="sortable" data-sort="check">\uC810\uAC80</th><th class="sortable" data-sort="message">\uC9C4\uB2E8 \uB0B4\uC6A9</th><th class="sortable" data-sort="durationMs" data-type="number">\uC2DC\uAC04</th><th>Evidence</th><th>\uBD84\uC11D</th></tr></thead><tbody id="results">${rows}</tbody></table></div></section>
<section id="finalView" class="view"><div class="section-head"><div><h2>\uCD5C\uC885 \uC810\uAC80 \uACB0\uACFC</h2><p class="muted">\uACBD\uB85C\uBCC4 \uD1B5\uACFC \uD56D\uBAA9\uACFC \uBB38\uC81C \uC6D0\uC778\uC744 \uD55C\uB208\uC5D0 \uD655\uC778\uD569\uB2C8\uB2E4.</p></div></div><div id="finalBody"></div></section>
</main>
<div id="detailModal" class="modal" role="dialog" aria-modal="true" aria-labelledby="detailTitle"><section class="dialog"><header class="dialog-head"><div><strong id="detailTitle">\uC0C1\uC138 \uACB0\uACFC</strong><div id="detailSubtitle" class="muted"></div></div><button id="closeDetail" class="close" aria-label="\uB2EB\uAE30">\xD7</button></header><div id="detailBody" class="dialog-body"></div></section></div>
<script>
const resultData=${safeJson(results)};
const search=document.querySelector('#search'), status=document.querySelector('#status');
function activateView(viewId){document.querySelectorAll('.view-button').forEach(item=>item.classList.toggle('active',item.dataset.view===viewId));document.querySelectorAll('.view').forEach(view=>view.classList.toggle('active',view.id===viewId));if(viewId==='finalView')renderFinal()}
for(const button of document.querySelectorAll('.view-button'))button.addEventListener('click',()=>activateView(button.dataset.view));
function filter(){for(const row of document.querySelectorAll('#results tr')){const text=row.textContent.toLowerCase();const okText=text.includes(search.value.toLowerCase());const okStatus=!status.value||row.classList.contains(status.value);row.style.display=okText&&okStatus?'':'none'}}search.addEventListener('input',filter);status.addEventListener('change',filter);
document.querySelector('#showFailed').addEventListener('click',()=>{status.value='failed';search.value='';filter();activateView('detailView')});
const routeDiscovery=document.querySelector('#routeDiscovery'),routeDiscoveryList=document.querySelector('#routeDiscoveryList');document.querySelector('#showRoutes').addEventListener('click',()=>{routeDiscovery.hidden=!routeDiscovery.hidden;if(!routeDiscovery.hidden)routeDiscovery.scrollIntoView({behavior:'smooth',block:'nearest'})});
const modal=document.querySelector('#detailModal'),detailBody=document.querySelector('#detailBody'),detailSubtitle=document.querySelector('#detailSubtitle');
function textElement(tag,text,className){const el=document.createElement(tag);if(className)el.className=className;el.textContent=String(text??'');return el}
function showDetail(id){const r=resultData.find(item=>item.id===id);if(!r)return;detailSubtitle.textContent=r.status+' \xB7 '+r.category+' \xB7 '+r.check;detailBody.replaceChildren();const dl=document.createElement('dl');dl.className='detail-grid';for(const [label,value] of [['\uC810\uAC80 \uACBD\uB85C',r.route],['\uCD5C\uC885 \uB3C4\uCC29 URL',r.finalUrl],['\uC2E4\uD589 \uBE0C\uB77C\uC6B0\uC800',r.browser],['\uC0AC\uC6A9\uC790 \uD504\uB85C\uD544',r.profile],['\uC704\uD5D8\uB3C4',r.severity||'-'],['\uC9C4\uB2E8 \uBA54\uC2DC\uC9C0',r.message||'-'],['\uC18C\uC694 \uC2DC\uAC04',r.durationMs+'ms'],['\uC2DC\uC791 \uC2DC\uAC01',r.startedAt],['\uC885\uB8CC \uC2DC\uAC01',r.finishedAt]]){dl.append(textElement('dt',label),textElement('dd',value))}detailBody.appendChild(dl);if(r.details&&Object.keys(r.details).length){detailBody.append(textElement('h3','\uAE30\uC220 \uC9C4\uB2E8 \uC815\uBCF4'));detailBody.append(textElement('pre',JSON.stringify(r.details,null,2),'details-json'))}if(r.artifact){detailBody.append(textElement('h3','\uC2E4\uD328 \uC99D\uAC70 \uC790\uB8CC'));const img=document.createElement('img');img.className='artifact-preview';img.src=r.artifact;img.alt=r.check+' \uC2E4\uD328 \uD654\uBA74';img.loading='lazy';const link=document.createElement('a');link.className='artifact-link';link.href=r.artifact;link.target='_blank';link.textContent='\uC99D\uAC70 \uC774\uBBF8\uC9C0 \uC6D0\uBCF8 \uBCF4\uAE30';detailBody.append(img,link)}modal.classList.add('open');document.body.style.overflow='hidden'}
function closeDetail(){modal.classList.remove('open');document.body.style.overflow=''}
document.addEventListener('click',event=>{const button=event.target.closest?.('.detail-button');if(button)showDetail(button.dataset.resultId)});document.querySelector('#closeDetail').addEventListener('click',closeDetail);modal.addEventListener('click',event=>{if(event.target===modal)closeDetail()});document.addEventListener('keydown',event=>{if(event.key==='Escape')closeDetail()});
let sortKey='',sortDirection=1;
for(const header of document.querySelectorAll('.sortable'))header.addEventListener('click',()=>{const key=header.dataset.sort;sortDirection=sortKey===key?-sortDirection:1;sortKey=key;document.querySelectorAll('.sortable').forEach(item=>item.classList.remove('asc','desc'));header.classList.add(sortDirection===1?'asc':'desc');const body=document.querySelector('#results');const rows=[...body.querySelectorAll('tr')];rows.sort((a,b)=>{const aResult=resultData.find(item=>item.id===a.querySelector('.detail-button')?.dataset.resultId),bResult=resultData.find(item=>item.id===b.querySelector('.detail-button')?.dataset.resultId);const av=aResult?.[key]??'',bv=bResult?.[key]??'';return (typeof av==='number'&&typeof bv==='number'?av-bv:String(av).localeCompare(String(bv),'en',{numeric:true,sensitivity:'base'}))*sortDirection});body.append(...rows)});
const finalBody=document.querySelector('#finalBody');
function routeLabel(route){try{const url=new URL(route);return url.pathname+(url.search||'')}catch{return route}}
function renderFinal(){finalBody.replaceChildren();const metrics=document.createElement('div');metrics.className='final-metrics';const counts={passed:resultData.filter(r=>r.status==='passed').length,warning:resultData.filter(r=>r.status==='warning').length,failed:resultData.filter(r=>r.status==='failed').length};for(const [label,value] of [['Tested checks',resultData.length],['Passed',counts.passed],['Warning',counts.warning],['Failed',counts.failed]]){const box=document.createElement('div');box.append(textElement('span',label,'muted'),textElement('b',value));metrics.appendChild(box)}finalBody.appendChild(metrics);const groups=new Map();for(const r of resultData){const key=r.route||'system';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r)}const list=document.createElement('div');list.className='route-summary';for(const [route,items] of [...groups.entries()].sort((a,b)=>routeLabel(a[0]).localeCompare(routeLabel(b[0])))){const failed=items.filter(r=>r.status==='failed'),warning=items.filter(r=>r.status==='warning'),passed=items.filter(r=>r.status==='passed');const group=document.createElement('details');group.className='route-group';group.open=failed.length>0||warning.length>0;const routeSummary=document.createElement('summary');routeSummary.append(textElement('strong',routeLabel(route)));for(const [statusName,statusItems] of [['failed',failed],['warning',warning],['passed',passed]])if(statusItems.length)routeSummary.append(textElement('span',statusItems.length+' '+statusName,'result-pill '+statusName));group.appendChild(routeSummary);const ul=document.createElement('ul');for(const item of items){const li=document.createElement('li');li.append(textElement('span',item.status.toUpperCase()+' \xB7 ','status'));const button=document.createElement('button');button.className='issue-link';button.textContent=item.check+(item.message?' \u2014 '+item.message:'');button.addEventListener('click',()=>showDetail(item.id));li.appendChild(button);if(item.artifact)li.append(textElement('span',' \xB7 Evidence available','muted'));ul.appendChild(li)}group.appendChild(ul);list.appendChild(group)}finalBody.appendChild(list)}
${live ? `
const source=new EventSource('/events');const connection=document.querySelector('#connection');
const routeUrls=new Set(${safeJson(initialRouteUrls)}),routeInstances=new Set(${safeJson(initialRouteInstances)}),affectedInstances=new Set(${safeJson(initialAffectedInstances)});
let completed=${summary.completedChecks},passed=${summary.passedChecks},failedCount=${summary.failedChecks},warning=${summary.warningChecks};
const categoryCounts=new Map(Object.entries(${safeJson(summary.byCategory)})),browserCounts=new Map(Object.entries(${safeJson(summary.byBrowser)})),profileCounts=new Map(Object.entries(${safeJson(summary.byProfile)}));
function setText(id,value){document.querySelector('#'+id).textContent=String(value)}
function updateStatusChart(){const total=Math.max(1,completed),p=passed/total*100,w=warning/total*100,f=failedCount/total*100;document.querySelector('#statusDonut').style.background='conic-gradient(#12b76a 0 '+p+'%,#f79009 '+p+'% '+(p+w)+'%,#f04438 '+(p+w)+'% '+(p+w+f)+'%,#e4e7ec 0)';setText('legendPassed',passed);setText('legendWarning',warning);setText('legendFailed',failedCount)}
function updateRates(){const affectedRate=routeInstances.size?((affectedInstances.size/routeInstances.size)*100).toFixed(2):'0',failureRate=completed?((failedCount/completed)*100).toFixed(2):'0';setText('affected',affectedInstances.size);setText('affectedRate',affectedRate+'%');setText('failureRate',failureRate+'%');setText('detailCount',failedCount);setText('verdictTitle',failedCount===0?'\uCE58\uBA85\uC801\uC778 \uBB38\uC81C\uAC00 \uBC1C\uACAC\uB418\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4':failedCount+'\uAC1C\uC758 \uC2E4\uD328 \uD56D\uBAA9\uC744 \uD655\uC778\uD574\uC57C \uD569\uB2C8\uB2E4');setText('verdictText',affectedInstances.size+'\uAC1C \uACBD\uB85C\uC5D0 \uC601\uD5A5 \xB7 \uC804\uCCB4 \uCCB4\uD06C \uC2E4\uD328\uC728 '+failureRate+'%');setText('verdictMark',failedCount===0?'\u2713':'!');document.querySelector('#verdict').classList.toggle('clean',failedCount===0);updateStatusChart()}
function cell(value,className){const td=document.createElement('td');if(className)td.className=className;td.textContent=String(value??'');return td}
function renderBars(id,counts){const container=document.querySelector('#'+id);container.replaceChildren();const entries=[...counts.entries()].sort((a,b)=>Number(b[1])-Number(a[1]));if(!entries.length){const empty=document.createElement('p');empty.className='muted';empty.textContent='No failures';container.appendChild(empty);return}const max=Math.max(1,...entries.map(([,value])=>Number(value)));for(const [label,value] of entries){const row=document.createElement('div');row.className='bar-row';const name=document.createElement('span');name.textContent=label;const bar=document.createElement('div');bar.className='bar';const fill=document.createElement('i');fill.style.width=(Number(value)/max*100)+'%';bar.appendChild(fill);const count=document.createElement('b');count.textContent=String(value);row.append(name,bar,count);container.appendChild(row)}}
function increment(counts,key){counts.set(key,Number(counts.get(key)||0)+1)}
connection.textContent='live';source.onopen=()=>connection.textContent='\uC2E4\uC2DC\uAC04 \uC5F0\uACB0\uB428';source.onerror=()=>connection.textContent='\uC5F0\uACB0 \uC7AC\uC2DC\uB3C4 \uC911';
source.addEventListener('route.discovered',event=>{const e=JSON.parse(event.data),isNew=!routeUrls.has(e.route);routeUrls.add(e.route);routeInstances.add(e.browser+':'+e.profile+':'+e.route);if(isNew){if(routeDiscoveryList.querySelector('.muted'))routeDiscoveryList.replaceChildren();routeDiscoveryList.appendChild(textElement('li',e.route))}setText('discovered',routeUrls.size);setText('routeInstances',routeInstances.size);updateRates()});
source.addEventListener('check.finished',event=>{const e=JSON.parse(event.data),r=e.result;resultData.push(r);completed++;if(r.status==='passed')passed++;if(r.status==='failed'){failedCount++;increment(categoryCounts,r.category);increment(browserCounts,r.browser);increment(profileCounts,r.profile);renderBars('categoryBars',categoryCounts);renderBars('browserBars',browserCounts);renderBars('profileBars',profileCounts);if(r.browser!=='node'&&r.category!=='browser'&&r.category!=='authentication')affectedInstances.add(r.browser+':'+r.profile+':'+r.route)}if(r.status==='warning')warning++;setText('completed',completed);setText('passed',passed);setText('failed',failedCount);updateRates();const tr=document.createElement('tr');tr.className=r.status;const statusCell=document.createElement('td');const badge=document.createElement('span');badge.className='status';badge.textContent=r.status;statusCell.appendChild(badge);tr.append(statusCell,cell(r.browser),cell(r.profile),cell(r.category),cell(r.route,'route'),cell(r.check),cell(r.message||''),cell(r.durationMs+'ms'));const evidenceCell=document.createElement('td');evidenceCell.innerHTML=r.artifact?'<button class="evidence-button detail-button" data-result-id="'+r.id+'"><img src="'+r.artifact+'" alt="\uC2E4\uD328 \uD654\uBA74"><span>Evidence</span></button>':'<span class="no-evidence">\u2014</span>';tr.appendChild(evidenceCell);const detailCell=document.createElement('td'),button=document.createElement('button');button.className='detail-button';button.dataset.resultId=r.id;button.textContent='\uC0C1\uC138 \uACB0\uACFC';detailCell.appendChild(button);tr.appendChild(detailCell);document.querySelector('#results').prepend(tr);filter()});
source.addEventListener('run.finished',async event=>{const s=JSON.parse(event.data).summary;completed=s.completedChecks;passed=s.passedChecks;warning=s.warningChecks;failedCount=s.failedChecks;for(const [id,key] of [['discovered','discoveredRoutes'],['routeInstances','routeInstances'],['completed','completedChecks'],['passed','passedChecks'],['failed','failedChecks'],['affected','affectedRoutes']])setText(id,s[key]);setText('affectedRate',s.affectedRouteRate+'%');setText('failureRate',s.checkFailureRate+'%');categoryCounts.clear();for(const [key,value] of Object.entries(s.byCategory))categoryCounts.set(key,value);browserCounts.clear();for(const [key,value] of Object.entries(s.byBrowser))browserCounts.set(key,value);profileCounts.clear();for(const [key,value] of Object.entries(s.byProfile))profileCounts.set(key,value);renderBars('categoryBars',categoryCounts);renderBars('browserBars',browserCounts);renderBars('profileBars',profileCounts);updateStatusChart();connection.textContent='\uCCB4\uD06C \uC644\uB8CC';source.close();try{const saved=await fetch('/result.json',{cache:'no-store'}).then(response=>response.json());resultData.splice(0,resultData.length,...saved);for(const row of document.querySelectorAll('#results tr')){const id=row.querySelector('.detail-button')?.dataset.resultId,r=resultData.find(item=>item.id===id);if(!r?.artifact)continue;const evidence=row.children[8];evidence.replaceChildren();const button=document.createElement('button');button.className='evidence-button detail-button';button.dataset.resultId=r.id;const img=document.createElement('img');img.src=r.artifact;img.alt='\uC2E4\uD328 \uD654\uBA74';button.append(img,textElement('span','Evidence'));evidence.appendChild(button)}}catch{}renderFinal()});` : ""}
</script></body></html>`;
}
function writeHtmlReport(runDir, summary, results) {
  fs2.writeFileSync(path4.join(runDir, "index.html"), renderReportHtml(summary, results), "utf8");
}

// src/core/webServer.ts
import { spawn } from "child_process";
import process2 from "process";
async function isReachable(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1e3);
  try {
    const response = await fetch(url, { method: "GET", signal: controller.signal, redirect: "manual" });
    return response.status > 0;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
async function terminateProcess(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process2.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true
      });
      killer.once("exit", () => resolve());
      killer.once("error", () => resolve());
    });
    return;
  }
  try {
    process2.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  await Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve())),
    new Promise((resolve) => setTimeout(resolve, 3e3))
  ]);
  if (child.exitCode === null) {
    try {
      process2.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}
async function startConfiguredWebServer(config) {
  if (!config.webServer) return void 0;
  const targetUrl = config.webServer.url;
  if (config.webServer.reuseExisting && await isReachable(targetUrl)) {
    return { reused: true, close: async () => void 0 };
  }
  const child = spawn(config.webServer.command, {
    cwd: config.webServer.cwd,
    env: { ...process2.env, ...config.webServer.env },
    shell: true,
    detached: process2.platform !== "win32",
    stdio: "inherit",
    windowsHide: false
  });
  const startedAt = Date.now();
  while (Date.now() - startedAt < config.webServer.timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`Web server command exited with code ${child.exitCode}: ${config.webServer.command}`);
    }
    if (await isReachable(targetUrl)) {
      return {
        reused: false,
        close: () => terminateProcess(child)
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  await terminateProcess(child);
  throw new Error(`Timed out after ${config.webServer.timeoutMs}ms waiting for ${targetUrl}`);
}

// src/core/runner.ts
var browserTypes = { chromium, firefox, webkit };
async function runAudit(config, eventBus = new AuditEventBus()) {
  const runId = `${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}-${randomUUID2().slice(0, 8)}`;
  const startedAt = Date.now();
  const store = new JsonlStore(config.outputDir, runId);
  const results = [];
  const discoveredRoutes = /* @__PURE__ */ new Set();
  let webServer;
  const unsubscribe = eventBus.subscribe((event) => {
    if (event.type === "check.started" || event.type === "check.finished" || event.type === "route.discovered") {
      store.appendEvent(event);
      if (event.type === "check.finished") results.push(event.result);
    }
  });
  const startEvent = {
    type: "run.started",
    runId,
    runDir: store.runDir,
    baseURL: config.baseURL,
    startedAt: new Date(startedAt).toISOString()
  };
  store.appendEvent(startEvent);
  eventBus.publish(startEvent);
  const publishFailure = (input2) => {
    const checkStartedAt = Date.now();
    eventBus.publish({
      type: "check.started",
      runId,
      route: config.baseURL,
      browser: input2.browser,
      profile: input2.profile,
      check: input2.check
    });
    const result = makeCheckResult({
      runId,
      route: config.baseURL,
      finalUrl: config.baseURL,
      profile: input2.profile,
      browser: input2.browser,
      category: input2.category,
      check: input2.check,
      startedAt: checkStartedAt,
      status: "failed",
      severity: "critical",
      message: input2.message
    });
    eventBus.publish({ type: "check.finished", runId, result });
  };
  try {
    webServer = await startConfiguredWebServer(config);
    for (const browserName of config.browsers) {
      let browser;
      try {
        browser = await browserTypes[browserName].launch({
          headless: config.headless,
          ...config.browserLaunchOptions[browserName]
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        publishFailure({
          browser: browserName,
          profile: "system",
          category: "browser",
          check: `launch ${browserName}`,
          message: `Could not launch ${browserName}. Run "npx site-check-pro install-browsers ${browserName}". ${message}`
        });
        continue;
      }
      try {
        for (const [profileName, profile] of Object.entries(config.profiles)) {
          const contextOptions = {};
          if (profile.storageState) contextOptions.storageState = path5.resolve(profile.storageState);
          let context;
          try {
            context = await browser.newContext(contextOptions);
          } catch (error) {
            publishFailure({
              browser: browserName,
              profile: profileName,
              category: "authentication",
              check: "load authentication state",
              message: error instanceof Error ? error.message : String(error)
            });
            continue;
          }
          try {
            const queue = (profile.seeds?.length ? profile.seeds : ["/"]).map((seed) => ({
              url: new URL(seed, config.baseURL).toString(),
              depth: 0
            }));
            const seen = /* @__PURE__ */ new Set();
            while (queue.length > 0 && seen.size < config.crawl.maxPages) {
              const item = queue.shift();
              if (!item || seen.has(item.url) || item.depth > config.crawl.maxDepth) continue;
              seen.add(item.url);
              discoveredRoutes.add(item.url);
              eventBus.publish({
                type: "route.discovered",
                runId,
                route: item.url,
                browser: browserName,
                profile: profileName,
                depth: item.depth
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
                artifactsDir: store.artifactsDir
              });
              for (const link of routeResult.discoveredLinks) {
                if (!seen.has(link) && seen.size + queue.length < config.crawl.maxPages) {
                  queue.push({ url: link, depth: item.depth + 1 });
                }
              }
            }
          } finally {
            await context.close();
          }
        }
      } finally {
        await browser.close();
      }
    }
    await auditApis(runId, config, eventBus);
  } finally {
    unsubscribe();
    await webServer?.close();
  }
  const summary = createSummary({ runId, baseURL: config.baseURL, startedAt, results, discoveredRoutes });
  store.saveSummary(summary);
  writeHtmlReport(store.runDir, summary, results);
  const finishEvent = { type: "run.finished", runId, summary };
  store.appendEvent(finishEvent);
  eventBus.publish(finishEvent);
  return { summary, runDir: store.runDir, eventBus };
}

// src/dashboard/server.ts
import fs3 from "fs";
import http from "http";
import path6 from "path";
var emptySummary = (baseURL) => ({
  runId: "running",
  baseURL,
  startedAt: (/* @__PURE__ */ new Date()).toISOString(),
  finishedAt: "",
  durationMs: 0,
  discoveredRoutes: 0,
  routeInstances: 0,
  completedChecks: 0,
  passedChecks: 0,
  warningChecks: 0,
  failedChecks: 0,
  affectedRoutes: 0,
  affectedRouteRate: 0,
  checkFailureRate: 0,
  byCategory: {},
  byBrowser: {},
  byProfile: {}
});
function liveSummary(input2) {
  const failed = input2.results.filter((result) => result.status === "failed");
  const affected = new Set(
    input2.results.filter((result) => result.status === "failed" && result.browser !== "node" && result.category !== "browser" && result.category !== "authentication").map((result) => `${result.browser}:${result.profile}:${result.route}`)
  );
  const countBy = (key) => failed.reduce((acc, result) => {
    const value = String(result[key]);
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
  const startedAtMs = Date.parse(input2.startedAt);
  return {
    runId: input2.runId,
    baseURL: input2.baseURL,
    startedAt: input2.startedAt,
    finishedAt: "",
    durationMs: Number.isNaN(startedAtMs) ? 0 : Date.now() - startedAtMs,
    discoveredRoutes: input2.discoveredRoutes.size,
    routeInstances: input2.routeInstances.size,
    completedChecks: input2.results.length,
    passedChecks: input2.results.filter((result) => result.status === "passed").length,
    warningChecks: input2.results.filter((result) => result.status === "warning").length,
    failedChecks: failed.length,
    affectedRoutes: affected.size,
    affectedRouteRate: input2.routeInstances.size === 0 ? 0 : Number((affected.size / input2.routeInstances.size * 100).toFixed(2)),
    checkFailureRate: input2.results.length === 0 ? 0 : Number((failed.length / input2.results.length * 100).toFixed(2)),
    byCategory: countBy("category"),
    byBrowser: countBy("browser"),
    byProfile: countBy("profile")
  };
}
async function startDashboard(input2) {
  const clients = /* @__PURE__ */ new Set();
  const results = [];
  const discoveredRoutes = /* @__PURE__ */ new Set();
  const routeInstances = /* @__PURE__ */ new Set();
  let summary = emptySummary(input2.baseURL);
  let runId = "running";
  let startedAt = summary.startedAt;
  let currentRunDir;
  let finished = false;
  const unsubscribe = input2.eventBus.subscribe((event) => {
    if (event.type === "run.started") {
      results.length = 0;
      discoveredRoutes.clear();
      routeInstances.clear();
      runId = event.runId;
      startedAt = event.startedAt;
      currentRunDir = event.runDir;
      finished = false;
    }
    if (event.type === "route.discovered") {
      discoveredRoutes.add(event.route);
      routeInstances.add(`${event.browser}:${event.profile}:${event.route}`);
    }
    if (event.type === "check.finished") results.push(event.result);
    if (event.type === "run.finished") {
      summary = event.summary;
      finished = true;
    }
    for (const client of clients) {
      client.write(`event: ${event.type}
data: ${JSON.stringify(event)}

`);
    }
  });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    if (url.pathname === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*"
      });
      res.write(": connected\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    if (url.pathname === "/") {
      const currentSummary = finished ? summary : liveSummary({
        baseURL: input2.baseURL,
        runId,
        startedAt,
        results,
        discoveredRoutes,
        routeInstances
      });
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderReportHtml(currentSummary, results, true, {
        discoveredRoutes: [...discoveredRoutes],
        routeInstances: [...routeInstances]
      }));
      return;
    }
    const runDir = currentRunDir ?? input2.getRunDir();
    if (runDir && ["/summary.json", "/result.json"].includes(url.pathname)) {
      const filename = url.pathname.slice(1);
      const candidate = path6.join(runDir, filename);
      if (fs3.existsSync(candidate)) {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        fs3.createReadStream(candidate).pipe(res);
        return;
      }
    }
    if (runDir && url.pathname.startsWith("/artifacts/")) {
      const candidate = path6.resolve(runDir, `.${url.pathname}`);
      const relative = path6.relative(path6.resolve(runDir), candidate);
      if (!relative.startsWith("..") && !path6.isAbsolute(relative) && fs3.existsSync(candidate)) {
        const extension = path6.extname(candidate).toLowerCase();
        const contentTypes = {
          ".png": "image/png",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".webp": "image/webp",
          ".json": "application/json; charset=utf-8",
          ".txt": "text/plain; charset=utf-8",
          ".zip": "application/zip"
        };
        res.writeHead(200, { "Content-Type": contentTypes[extension] ?? "application/octet-stream" });
        fs3.createReadStream(candidate).pipe(res);
        return;
      }
    }
    res.writeHead(404).end("Not found");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(input2.port, "127.0.0.1", resolve);
  });
  return {
    url: `http://127.0.0.1:${input2.port}`,
    close: async () => {
      unsubscribe();
      for (const client of clients) client.end();
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  };
}

// src/cli/openBrowser.ts
import { spawn as spawn2 } from "child_process";
function openBrowser(url) {
  const platform = process.platform;
  const command = platform === "win32" ? "cmd" : platform === "darwin" ? "open" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn2(command, args, { detached: true, stdio: "ignore" });
  child.unref();
}

// src/cli/init.ts
import fs4 from "fs";
import path7 from "path";
function initProject(baseURL, packageName, browsers = ["chromium"]) {
  const configPath = path7.resolve("site-check-pro.config.ts");
  if (fs4.existsSync(configPath)) throw new Error("site-check-pro.config.ts already exists");
  const browserConfig = browsers.length > 0 ? browsers : ["chromium"];
  const content = `import { defineConfig } from '${packageName}';

export default defineConfig({
  baseURL: '${baseURL}',
  browsers: ${JSON.stringify(browserConfig)},
  // webServer: { command: 'npm run dev', url: '${baseURL}', reuseExisting: true },
  profiles: {
    guest: {},
    // member: { storageState: '.site-check-pro/auth/member.json', seeds: ['/mypage'] },
  },
  crawl: {
    maxPages: 100,
    maxDepth: 5,
    exclude: ['/logout', '/delete/**', '/payment/**'],
    linkAttributes: ['href', 'data-href', 'data-route', 'data-url'],
  },
  checks: {
    reload: true,
    history: true,
  },
  dashboard: { enabled: false, port: 4177, open: true },
});
`;
  fs4.writeFileSync(configPath, content, "utf8");
  const gitignore = path7.resolve(".gitignore");
  const line = "\n# Site Check Pro auth and reports\n.site-check-pro/\n";
  if (!fs4.existsSync(gitignore) || !fs4.readFileSync(gitignore, "utf8").includes(".site-check-pro/")) {
    fs4.appendFileSync(gitignore, line, "utf8");
  }
  return configPath;
}

// src/cli/report.ts
import fs5 from "fs";
import path8 from "path";
import { pathToFileURL as pathToFileURL2 } from "url";
function resolveReportPath(outputDir, runDir) {
  const resolvedRunDir = runDir ? path8.resolve(runDir) : findLatestRun(path8.resolve(outputDir));
  const reportPath = path8.join(resolvedRunDir, "index.html");
  if (!fs5.existsSync(reportPath)) throw new Error(`Report not found: ${reportPath}`);
  return pathToFileURL2(reportPath).toString();
}
function findLatestRun(outputDir) {
  if (!fs5.existsSync(outputDir)) throw new Error(`Output directory not found: ${outputDir}`);
  const directories = fs5.readdirSync(outputDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort((a, b) => b.localeCompare(a));
  if (directories.length === 0) throw new Error(`No Site Check Pro runs found in ${outputDir}`);
  return path8.join(outputDir, directories[0]);
}

// src/auth/capture.ts
import fs6 from "fs";
import path9 from "path";
import readline from "readline/promises";
import { stdin as input, stdout as output } from "process";
import { chromium as chromium2 } from "playwright";
async function captureAuth(config, profile, loginUrl) {
  const authPath = path9.resolve(".site-check-pro/auth", `${profile}.json`);
  fs6.mkdirSync(path9.dirname(authPath), { recursive: true });
  const browser = await chromium2.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(loginUrl ? new URL(loginUrl, config.baseURL).toString() : config.baseURL);
  const rl = readline.createInterface({ input, output });
  await rl.question("\uBE0C\uB77C\uC6B0\uC800\uC5D0\uC11C \uB85C\uADF8\uC778\uC744 \uC644\uB8CC\uD55C \uB4A4 Enter\uB97C \uB204\uB974\uC138\uC694: ");
  rl.close();
  await context.storageState({ path: authPath, indexedDB: true });
  await browser.close();
  return authPath;
}

// src/packageMeta.ts
import fs7 from "fs";
function readPackageMeta() {
  const url = new URL("../package.json", import.meta.url);
  return JSON.parse(fs7.readFileSync(url, "utf8"));
}

// src/cli/browserInstaller.ts
import fs8 from "fs";
import path10 from "path";
import { spawn as spawn3 } from "child_process";
import { createRequire } from "module";
import { chromium as chromium3, firefox as firefox2, webkit as webkit2 } from "playwright";
var ALL_BROWSERS = ["chromium", "firefox", "webkit"];
var browserTypes2 = {
  chromium: chromium3,
  firefox: firefox2,
  webkit: webkit2
};
function isSupportedBrowser(value) {
  return ALL_BROWSERS.includes(value);
}
function parseBrowserNames(value) {
  const names = value.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  const invalid = names.filter((name) => !isSupportedBrowser(name));
  if (invalid.length > 0) {
    throw new Error(
      `\uC9C0\uC6D0\uD558\uC9C0 \uC54A\uB294 \uBE0C\uB77C\uC6B0\uC800: ${invalid.join(", ")}. \uC0AC\uC6A9 \uAC00\uB2A5: ${ALL_BROWSERS.join(", ")}`
    );
  }
  return [...new Set(names)];
}
function getMissingBrowsers(browsers) {
  return browsers.filter((browserName) => {
    try {
      return !fs8.existsSync(browserTypes2[browserName].executablePath());
    } catch {
      return true;
    }
  });
}
function resolvePlaywrightCli() {
  const require2 = createRequire(import.meta.url);
  const packagePath = require2.resolve("playwright/package.json");
  return path10.join(path10.dirname(packagePath), "cli.js");
}
async function installBrowsers(browsers, options = {}) {
  const uniqueBrowsers = [...new Set(browsers)];
  if (uniqueBrowsers.length === 0) return;
  const args = [
    resolvePlaywrightCli(),
    "install",
    ...options.withDeps ? ["--with-deps"] : [],
    ...uniqueBrowsers
  ];
  await new Promise((resolve, reject) => {
    const child = spawn3(process.execPath, args, {
      stdio: "inherit",
      env: process.env
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(
        `Playwright \uBE0C\uB77C\uC6B0\uC800 \uC124\uCE58 \uC2E4\uD328 (code=${code ?? "null"}, signal=${signal ?? "none"})`
      ));
    });
  });
}

// src/cli/browserPrompt.ts
import readline2 from "readline/promises";
import { stdin, stdout } from "process";
function isInteractiveTerminal() {
  return Boolean(stdin.isTTY && stdout.isTTY && !process.env.CI);
}
async function ask(question) {
  const rl = readline2.createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}
async function confirmPrompt(message, defaultValue = true) {
  const hint = defaultValue ? "Y/n" : "y/N";
  const answer = (await ask(`${message} (${hint}) `)).toLowerCase();
  if (!answer) return defaultValue;
  return answer === "y" || answer === "yes" || answer === "\uC608";
}
function parseIndexes(value) {
  const map = {
    "1": "chromium",
    "2": "firefox",
    "3": "webkit"
  };
  const indexes = value.split(",").map((item) => item.trim()).filter(Boolean);
  const selected = indexes.map((index) => map[index]).filter(Boolean);
  return [...new Set(selected)];
}
async function promptBrowserSelection() {
  stdout.write(`
\uC124\uCE58\uD560 \uBE0C\uB77C\uC6B0\uC800\uB97C \uC120\uD0DD\uD558\uC138\uC694.
`);
  stdout.write(`  1) Chromium\uB9CC \uC124\uCE58 (Chrome \uACC4\uC5F4, \uAD8C\uC7A5)
`);
  stdout.write(`  2) \uBAA8\uB4E0 \uBE0C\uB77C\uC6B0\uC800 \uC124\uCE58 (Chromium, Firefox, WebKit)
`);
  stdout.write(`  3) \uC9C1\uC811 \uC120\uD0DD
`);
  stdout.write(`  4) \uC9C0\uAE08\uC740 \uC124\uCE58\uD558\uC9C0 \uC54A\uC74C

`);
  const mode = await ask("\uC120\uD0DD [1]: ") || "1";
  if (mode === "4") {
    return { browsers: ["chromium"], installNow: false };
  }
  let browsers;
  if (mode === "2") {
    browsers = [...ALL_BROWSERS];
  } else if (mode === "3") {
    stdout.write(`  1) Chromium
  2) Firefox
  3) WebKit
`);
    const custom = await ask("\uBC88\uD638\uB97C \uC27C\uD45C\uB85C \uC120\uD0DD\uD558\uC138\uC694 [1]: ");
    browsers = parseIndexes(custom || "1");
    if (browsers.length === 0) browsers = ["chromium"];
  } else {
    browsers = ["chromium"];
  }
  const installNow = await confirmPrompt(
    `${browsers.join(", ")} \uBE0C\uB77C\uC6B0\uC800\uB97C \uC9C0\uAE08 \uB2E4\uC6B4\uB85C\uB4DC\uD560\uAE4C\uC694?`,
    true
  );
  return { browsers, installNow };
}
async function promptInstallMissingBrowsers(browsers) {
  return confirmPrompt(
    `\uC124\uCE58\uB418\uC9C0 \uC54A\uC740 \uBE0C\uB77C\uC6B0\uC800(${browsers.join(", ")})\uB97C \uC9C0\uAE08 \uB2E4\uC6B4\uB85C\uB4DC\uD560\uAE4C\uC694?`,
    true
  );
}

// src/cli.ts
var packageMeta = readPackageMeta();
var program = new Command();
program.name("site-check-pro").description("Framework-agnostic website inspection powered by Playwright").version(packageMeta.version);
async function ensureBrowsers(browsers, options = {}) {
  const missing = getMissingBrowsers(browsers);
  if (missing.length === 0) return;
  console.log(pc.yellow(`\uC124\uCE58\uB418\uC9C0 \uC54A\uC740 \uBE0C\uB77C\uC6B0\uC800: ${missing.join(", ")}`));
  let shouldInstall = Boolean(options.assumeYes);
  if (!shouldInstall && isInteractiveTerminal()) {
    shouldInstall = await promptInstallMissingBrowsers(missing);
  }
  if (shouldInstall) {
    await installBrowsers(missing, { withDeps: options.withDeps });
    console.log(pc.green(`Installed: ${missing.join(", ")}`));
    return;
  }
  console.log(
    `\uC124\uCE58 \uBA85\uB839: ${pc.cyan(`npx site-check-pro install-browsers ${missing.join(" ")}`)}`
  );
}
program.command("init").argument("[baseURL]", "target URL", "http://localhost:3000").option("--browser <names>", "comma-separated chromium,firefox,webkit").option("--all-browsers", "configure and install Chromium, Firefox, and WebKit").option("--skip-browser-install", "create config without downloading browser binaries").option("-y, --yes", "download selected browsers without confirmation").action(async (baseURL, options) => {
  let browsers = ["chromium"];
  let installNow = false;
  let installConfirmed = false;
  const interactive = isInteractiveTerminal();
  if (options.allBrowsers) {
    browsers = [...ALL_BROWSERS];
    installNow = !options.skipBrowserInstall && (interactive || options.yes);
  } else if (options.browser) {
    browsers = parseBrowserNames(options.browser);
    if (browsers.length === 0) browsers = ["chromium"];
    installNow = !options.skipBrowserInstall && (interactive || options.yes);
  } else if (interactive) {
    const selection = await promptBrowserSelection();
    browsers = selection.browsers;
    installNow = selection.installNow && !options.skipBrowserInstall;
    installConfirmed = selection.installNow;
  }
  if (options.yes && !options.skipBrowserInstall) {
    installNow = true;
    installConfirmed = true;
  }
  const file = initProject(baseURL, packageMeta.name, browsers);
  console.log(pc.green(`Created ${file}`));
  if (installNow) {
    await ensureBrowsers(browsers, { assumeYes: installConfirmed });
  } else {
    console.log(pc.yellow("\uBE0C\uB77C\uC6B0\uC800 \uB2E4\uC6B4\uB85C\uB4DC\uB97C \uAC74\uB108\uB6F0\uC5C8\uC2B5\uB2C8\uB2E4."));
    console.log(
      `\uB098\uC911\uC5D0 \uC2E4\uD589: ${pc.cyan(`npx site-check-pro install-browsers ${browsers.join(" ")}`)}`
    );
  }
  console.log(`Next: ${pc.cyan("npx site-check-pro run --ui")}`);
});
program.command("run").argument("[url]", "override base URL").option("-c, --config <path>", "config file", "site-check-pro.config.ts").option("--ui", "enable live dashboard").option("--headed", "show browser windows").option("--browser <names>", "comma-separated chromium,firefox,webkit").option("-y, --yes", "install missing configured browsers without confirmation").action(async (url, options) => {
  const loaded = await loadConfig(options.config);
  const browsers = options.browser ? parseBrowserNames(options.browser) : loaded.browsers;
  const config = resolveConfig({
    ...loaded,
    ...url ? { baseURL: url } : {},
    ...options.headed ? { headless: false } : {},
    browsers,
    dashboard: { ...loaded.dashboard, enabled: Boolean(options.ui) || loaded.dashboard.enabled }
  });
  await ensureBrowsers(config.browsers, { assumeYes: Boolean(options.yes) });
  const eventBus = new AuditEventBus();
  let runDir;
  let dashboard;
  if (config.dashboard.enabled) {
    dashboard = await startDashboard({
      port: config.dashboard.port,
      baseURL: config.baseURL,
      eventBus,
      getRunDir: () => runDir
    });
    console.log(pc.cyan(`Live dashboard: ${dashboard.url}`));
    if (config.dashboard.open) openBrowser(dashboard.url);
  }
  try {
    const result = await runAudit(config, eventBus);
    runDir = result.runDir;
    console.log(pc.bold("\nSite Check Pro completed"));
    console.log(`Report: ${pc.cyan(`${result.runDir}/index.html`)}`);
    console.log(`Checks: ${result.summary.completedChecks}, failed: ${pc.red(String(result.summary.failedChecks))}, affected: ${result.summary.affectedRouteRate}%`);
    console.log(`Open later: ${pc.cyan(`npx site-check-pro report open "${result.runDir}"`)}`);
    process.exitCode = result.summary.failedChecks > 0 ? 1 : 0;
  } finally {
    if (dashboard) await dashboard.close();
  }
});
program.command("auth").description("capture an authenticated browser state").argument("<profile>", "profile name, e.g. member or admin").option("-c, --config <path>", "config file", "site-check-pro.config.ts").option("--url <url>", "login URL").option("-y, --yes", "install Chromium without confirmation when missing").action(async (profile, options) => {
  await ensureBrowsers(["chromium"], { assumeYes: Boolean(options.yes) });
  const config = await loadConfig(options.config);
  const saved = await captureAuth(config, profile, options.url);
  console.log(pc.green(`Saved auth state: ${saved}`));
});
var report = program.command("report").description("open generated reports");
report.command("open").argument("[runDir]", "specific run directory; defaults to latest").option("-c, --config <path>", "config file", "site-check-pro.config.ts").action(async (runDir, options) => {
  const config = await loadConfig(options.config);
  const reportUrl = resolveReportPath(config.outputDir, runDir);
  console.log(pc.cyan(`Opening ${reportUrl}`));
  openBrowser(reportUrl);
});
program.command("install-browsers").description("install Playwright-managed browser binaries").argument("[browsers...]", "chromium, firefox, webkit").option("--all", "install Chromium, Firefox, and WebKit").option("--with-deps", "also install Linux system dependencies").action(async (browserArguments, options) => {
  let browsers;
  if (options.all) {
    browsers = [...ALL_BROWSERS];
  } else if (browserArguments.length > 0) {
    const invalid = browserArguments.filter((browser) => !isSupportedBrowser(browser));
    if (invalid.length > 0) {
      throw new Error(
        `\uC9C0\uC6D0\uD558\uC9C0 \uC54A\uB294 \uBE0C\uB77C\uC6B0\uC800: ${invalid.join(", ")}. \uC0AC\uC6A9 \uAC00\uB2A5: ${ALL_BROWSERS.join(", ")}`
      );
    }
    browsers = [...new Set(browserArguments)];
  } else if (isInteractiveTerminal()) {
    const selection = await promptBrowserSelection();
    browsers = selection.browsers;
    if (!selection.installNow) {
      console.log(pc.yellow("\uBE0C\uB77C\uC6B0\uC800 \uC124\uCE58\uB97C \uCDE8\uC18C\uD588\uC2B5\uB2C8\uB2E4."));
      return;
    }
  } else {
    browsers = ["chromium"];
  }
  await installBrowsers(browsers, { withDeps: Boolean(options.withDeps) });
  console.log(pc.green(`Installed: ${browsers.join(", ")}`));
});
program.parseAsync().catch((error) => {
  console.error(pc.red(error instanceof Error ? error.stack ?? error.message : String(error)));
  process.exitCode = 1;
});
//# sourceMappingURL=cli.js.map