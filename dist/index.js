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
function defineConfig(config) {
  return config;
}
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
function makeCheckResult(input) {
  return {
    id: randomUUID(),
    runId: input.runId,
    route: input.route,
    finalUrl: input.finalUrl,
    profile: input.profile,
    browser: input.browser,
    category: input.category,
    check: input.check,
    status: input.status,
    severity: input.severity,
    startedAt: new Date(input.startedAt).toISOString(),
    finishedAt: (/* @__PURE__ */ new Date()).toISOString(),
    durationMs: Date.now() - input.startedAt,
    message: input.message,
    details: input.details,
    artifact: input.artifact
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
async function auditPage(input) {
  const { runId, route, browser, profile, context, config, eventBus, artifactsDir } = input;
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
  return { route, finalUrl, browser, profile, depth: input.depth, checks, discoveredLinks };
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
function createSummary(input) {
  const { runId, baseURL, startedAt, results, discoveredRoutes } = input;
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
function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  if (ms < 1e3) return `${ms}ms`;
  const seconds = Math.round(ms / 1e3);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
function formatKst(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}
function runLabel(summary) {
  const suffix = summary.runId.split("-").at(-1);
  return `${formatKst(summary.startedAt)}${suffix ? ` #${suffix}` : ""}`;
}
function barRows(data) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return '<p class="empty">No failures</p>';
  const max = Math.max(1, ...entries.map(([, value]) => value));
  return entries.map(([label, value]) => `
    <div class="bar-row">
      <span title="${escapeHtml(label)}">${escapeHtml(label)}</span>
      <div class="bar-track"><i style="width:${value / max * 100}%"></i></div>
      <b>${value}</b>
    </div>`).join("");
}
function resultRows(results) {
  return results.map((result) => `
    <tr class="${escapeHtml(result.status)}">
      <td><span class="status-badge">${escapeHtml(result.status)}</span></td>
      <td>${escapeHtml(result.browser)}</td>
      <td>${escapeHtml(result.profile)}</td>
      <td>${escapeHtml(result.category)}</td>
      <td class="route">${escapeHtml(result.route)}</td>
      <td>${escapeHtml(result.check)}</td>
      <td>${escapeHtml(result.message)}</td>
      <td>${escapeHtml(result.durationMs)}ms</td>
      <td>${result.artifact ? `<button class="evidence-button detail-button" data-result-id="${escapeHtml(result.id)}"><img src="${escapeHtml(result.artifact)}" alt="\uC2E4\uD328 \uD654\uBA74"><span>Evidence</span></button>` : '<span class="no-evidence">-</span>'}</td>
      <td><button class="detail-button" data-result-id="${escapeHtml(result.id)}">\uC0C1\uC138 \uACB0\uACFC</button></td>
    </tr>`).join("");
}
function renderReportHtml(summary, results, live = false, liveState) {
  const routeResults = results.filter((result) => result.browser !== "node" && result.category !== "browser" && result.category !== "authentication");
  const initialRouteUrls = liveState?.discoveredRoutes ?? [...new Set(routeResults.map((result) => result.route))];
  const initialRouteInstances = liveState?.routeInstances ?? [...new Set(routeResults.map((result) => `${result.browser}:${result.profile}:${result.route}`))];
  const initialAffectedInstances = [...new Set(routeResults.filter((result) => result.status === "failed").map((result) => `${result.browser}:${result.profile}:${result.route}`))];
  const failed = results.filter((result) => result.status === "failed");
  const totalStatus = Math.max(1, summary.completedChecks);
  const passedPercent = summary.passedChecks / totalStatus * 100;
  const warningPercent = summary.warningChecks / totalStatus * 100;
  const failedPercent = summary.failedChecks / totalStatus * 100;
  const verdictClass = summary.failedChecks === 0 ? "healthy" : summary.checkFailureRate >= 25 ? "critical" : "attention";
  const verdictText = summary.failedChecks === 0 ? "\uB9B4\uB9AC\uC2A4 \uCC28\uB2E8 \uC774\uC288 \uC5C6\uC74C" : summary.checkFailureRate >= 25 ? "\uB9B4\uB9AC\uC2A4 \uC804 \uC6B0\uC120 \uC870\uCE58 \uD544\uC694" : "\uD655\uC778 \uD6C4 \uB9B4\uB9AC\uC2A4 \uAC00\uB2A5";
  const isRunning = live && !summary.finishedAt;
  const reportStatus = isRunning ? "\uC810\uAC80 \uC911" : "\uC810\uAC80 \uC644\uB8CC";
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Site Check Pro report</title>
<style>
:root{font-family:Inter,Pretendard,system-ui,sans-serif;color:#1f2937;background:#f6f7f9;--line:#d9dee7;--text:#1f2937;--muted:#687385;--panel:#fff;--green:#179b68;--amber:#c77700;--red:#d14343;--blue:#2563eb;--ink:#202633}
*{box-sizing:border-box}body{margin:0}.app{display:grid;grid-template-columns:280px minmax(0,1fr);min-height:100vh}.sidebar{position:sticky;top:0;height:100vh;padding:22px 18px;background:#202633;color:#f7f8fb;display:flex;flex-direction:column;gap:18px}.brand{display:flex;align-items:center;gap:10px;padding-bottom:14px;border-bottom:1px solid #ffffff1f}.mark{width:34px;height:34px;border-radius:8px;background:#4f8cff;display:grid;place-items:center;font-weight:900}.brand strong{display:block}.brand span,.side-label,.side-meta,.side-foot{color:#b9c2d1}.side-card{border:1px solid #ffffff1a;border-radius:8px;padding:14px;background:#ffffff0c}.side-label{font-size:11px;text-transform:uppercase;letter-spacing:.08em}.side-url{margin-top:8px;word-break:break-all;font-weight:750}.side-meta{display:grid;gap:7px;font-size:12px}.side-meta b{color:#fff}.nav{display:grid;gap:8px}.view-button{display:flex;align-items:center;justify-content:space-between;border:1px solid transparent;background:transparent;color:#dce4f0;border-radius:8px;padding:11px 12px;cursor:pointer;font-weight:750;text-align:left}.view-button:hover{background:#ffffff10}.view-button.active{background:#fff;color:#202633}.connection,.run-state{display:inline-flex;align-items:center;gap:7px;width:max-content;border:1px solid #ffffff24;border-radius:999px;padding:7px 10px;font-size:12px;color:#d8f7e7}.connection:before,.run-state:before{content:'';width:7px;height:7px;border-radius:50%;background:#32d583}.run-state{background:#fff;color:#27364a;border-color:#d9dee7;font-weight:850}.run-state.running{color:#067647;background:#eaf8f1;border-color:#abefc6}.run-state.running:before{background:#12b76a;animation:pulse-dot 1s ease-in-out infinite}.run-state.done{color:#067647;background:#eaf8f1;border-color:#abefc6}.run-state.done:before{background:#12b76a}.side-foot{margin-top:auto;font-size:12px;line-height:1.5}.main{padding:30px 34px 42px}.topbar{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;margin-bottom:22px}.eyebrow{font-size:12px;font-weight:900;color:#2563eb;letter-spacing:.08em;text-transform:uppercase}.topbar h1{margin:6px 0 8px;font-size:30px;line-height:1.15}.muted,.empty{color:var(--muted)}.view{display:none}.view.active{display:block}.section-head{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;margin:26px 0 12px}.section-head h2{margin:0 0 5px;font-size:20px}.section-head p{margin:0}.verdict{display:grid;grid-template-columns:auto 1fr auto;gap:16px;align-items:center;border:1px solid var(--line);border-radius:8px;background:var(--panel);padding:18px;box-shadow:0 8px 22px #2030400a}.verdict-mark{width:44px;height:44px;border-radius:8px;display:grid;place-items:center;font-weight:900}.verdict.healthy .verdict-mark{background:#eaf8f1;color:var(--green)}.verdict.attention .verdict-mark{background:#fff5df;color:var(--amber)}.verdict.critical .verdict-mark{background:#fff0f0;color:var(--red)}.verdict strong{display:block;margin-bottom:3px}.verdict-score{font-size:28px;font-weight:900}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.metric,.panel,.table-shell,.route-discovery{border:1px solid var(--line);background:var(--panel);border-radius:8px;box-shadow:0 8px 22px #2030400a}.metric{padding:16px;min-height:112px}.metric span{display:block;color:var(--muted);font-size:13px}.metric strong{display:block;margin-top:11px;font-size:30px;letter-spacing:-.02em}.metric-button{width:100%;height:100%;padding:0;border:0;background:transparent;color:inherit;text-align:left;cursor:pointer}.metric-button:hover strong{color:var(--blue)}.metric.success{border-left:4px solid var(--green)}.metric.warning{border-left:4px solid var(--amber)}.metric.danger{border-left:4px solid var(--red)}.route-discovery{margin-top:12px;padding:16px}.route-discovery[hidden]{display:none}.route-discovery h3{margin:0 0 12px;font-size:15px}.route-discovery ul{margin:0;padding-left:18px;columns:2}.route-discovery li{margin:7px 0;word-break:break-all}.analysis-grid{display:grid;grid-template-columns:1.15fr repeat(3,minmax(0,1fr));gap:12px}.panel{padding:18px;min-height:230px}.panel h3{margin:0 0 16px;font-size:15px}.status-chart{display:grid;grid-template-columns:142px 1fr;gap:20px;align-items:center}.donut{width:142px;height:142px;border-radius:50%;display:grid;place-items:center}.donut:after{content:'';width:84px;height:84px;border-radius:50%;background:#fff;box-shadow:inset 0 0 0 1px var(--line)}.legend{display:grid;gap:9px}.legend span{display:flex;align-items:center;justify-content:space-between;gap:12px}.legend i{width:10px;height:10px;border-radius:50%;display:inline-block;margin-right:8px}.legend label{display:flex;align-items:center;color:var(--muted)}.bar-row{display:grid;grid-template-columns:minmax(72px,92px) 1fr 32px;align-items:center;gap:10px;margin:12px 0}.bar-row span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted)}.bar-track{height:8px;border-radius:99px;background:#eef1f5;overflow:hidden}.bar-track i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#f59e0b,#d14343)}.toolbar{display:flex;gap:8px;align-items:center}.toolbar input,.toolbar select{height:40px;border:1px solid #cfd6e2;border-radius:8px;background:#fff;padding:0 11px;color:var(--text)}.toolbar input{min-width:320px}.table-shell{overflow:auto}table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:12px;border-bottom:1px solid #e7ebf1;text-align:left;vertical-align:top}th{position:sticky;top:0;background:#fafbfc;color:#596579;font-size:12px;z-index:1}tbody tr:hover{background:#f7f9fd}.sortable{cursor:pointer;user-select:none;white-space:nowrap}.sortable:after{content:' \u21C5';color:#98a2b3}.sortable.asc:after{content:' \u2191';color:var(--blue)}.sortable.desc:after{content:' \u2193';color:var(--blue)}.status-badge{display:inline-flex;align-items:center;border-radius:999px;padding:4px 8px;font-size:11px;font-weight:900;text-transform:uppercase;background:#eef2f7;color:#536073}.failed .status-badge{background:#fff0f0;color:#b42318}.passed .status-badge{background:#eaf8f1;color:#067647}.warning .status-badge{background:#fff5df;color:#b54708}.route{max-width:320px;word-break:break-all}.detail-button{border:1px solid #cfd6e2;background:#fff;color:#27364a;border-radius:8px;padding:8px 10px;cursor:pointer;font-weight:750}.detail-button:hover{border-color:#86a9ff;color:var(--blue)}.evidence-button{display:grid;gap:5px;padding:5px;font-size:10px}.evidence-button img{width:76px;height:46px;object-fit:cover;border-radius:6px}.no-evidence{color:#9aa4b5}.final-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}.final-metrics div{padding:14px;border:1px solid var(--line);border-radius:8px;background:#fff}.final-metrics b{display:block;margin-top:5px;font-size:24px}.route-summary{display:grid;gap:10px}.route-group{border:1px solid var(--line);border-radius:8px;background:#fff;overflow:hidden}.route-group summary{cursor:pointer;padding:14px 16px;background:#fafbfc;display:flex;gap:10px;align-items:center}.route-group summary strong{flex:1;word-break:break-all}.route-group ul{margin:0;padding:12px 18px 16px 36px}.route-group li{margin:8px 0}.result-pill{font-size:11px;font-weight:900;padding:4px 8px;border-radius:999px}.result-pill.failed{background:#fff0f0;color:#b42318}.result-pill.warning{background:#fff5df;color:#b54708}.result-pill.passed{background:#eaf8f1;color:#067647}.issue-link{border:0;background:none;color:#2563eb;cursor:pointer;padding:0;text-align:left;font-weight:750}.modal{position:fixed;inset:0;background:#151a23b8;display:none;align-items:center;justify-content:center;padding:24px;z-index:20;backdrop-filter:blur(4px)}.modal.open{display:flex}.dialog{width:min(980px,100%);max-height:90vh;overflow:auto;background:#fff;border-radius:8px;box-shadow:0 24px 60px #10182855}.dialog-head{position:sticky;top:0;z-index:1;background:#fff;border-bottom:1px solid #e7ebf1;padding:18px 22px;display:flex;justify-content:space-between;align-items:center}.dialog-body{padding:22px}.close{border:0;background:#eef2f7;border-radius:50%;font-size:21px;width:36px;height:36px;cursor:pointer}.detail-grid{display:grid;grid-template-columns:150px 1fr;gap:10px 18px;margin-bottom:20px}.detail-grid dt{color:var(--muted)}.detail-grid dd{margin:0;word-break:break-word}.details-json{white-space:pre-wrap;word-break:break-word;background:#171d29;color:#d6dde8;padding:16px;border-radius:8px;overflow:auto}.artifact-preview{display:block;max-width:100%;max-height:520px;margin:12px auto;border:1px solid var(--line);border-radius:8px}@keyframes pulse-dot{0%,100%{opacity:1;box-shadow:0 0 0 0 #12b76a66}50%{opacity:.35;box-shadow:0 0 0 5px #12b76a00}}
@media(max-width:1180px){.analysis-grid{grid-template-columns:1fr 1fr}.grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:820px){.app{grid-template-columns:1fr}.sidebar{position:relative;height:auto}.main{padding:22px 18px 34px}.topbar,.section-head{align-items:flex-start;flex-direction:column}.grid,.analysis-grid,.final-metrics{grid-template-columns:1fr}.route-discovery ul{columns:1}.toolbar{width:100%;flex-direction:column;align-items:stretch}.toolbar input{min-width:0}.status-chart{grid-template-columns:1fr}.detail-grid{grid-template-columns:1fr}.route-group summary{align-items:flex-start;flex-direction:column}}
</style>
</head>
<body>
<div class="app">
  <aside class="sidebar">
    <div class="brand"><div class="mark">SC</div><div><strong>Site Check Pro</strong><span>${live ? "Live dashboard" : "Static report"}</span></div></div>
    <div class="side-card">
      <div class="side-label">Target</div>
      <div class="side-url">${escapeHtml(summary.baseURL)}</div>
    </div>
    <div class="side-meta">
      <span>\uC0C1\uD0DC <b id="reportStatus">${escapeHtml(reportStatus)}</b></span>
      <span>\uC2E4\uD589 <b>${escapeHtml(runLabel(summary))}</b></span>
      <span>\uC2DC\uC791 <b>${escapeHtml(formatKst(summary.startedAt))}</b></span>
      <span>Duration <b id="duration">${formatDuration(summary.durationMs)}</b></span>
    </div>
    <nav class="nav" aria-label="Report views">
      <button class="view-button active" data-view="summaryView">\uC694\uC57D \uBD84\uC11D <span id="sideFailed">${summary.failedChecks}</span></button>
      <button class="view-button" data-view="detailView">\uC2E4\uC2DC\uAC04 \uC0C1\uC138 \uACB0\uACFC <span id="detailCount">${failed.length}</span></button>
      <button class="view-button" data-view="finalView">\uCD5C\uC885 \uACB0\uACFC <span>${summary.completedChecks}</span></button>
    </nav>
    <span id="connection" class="connection">${live ? "\uC5F0\uACB0 \uC911" : "\uCCB4\uD06C \uC644\uB8CC"}</span>
    <div class="side-foot">QA, \uAD00\uB9AC\uC790, \uAC1C\uBC1C\uC790\uAC00 \uAC19\uC740 \uB9AC\uD3EC\uD2B8\uB97C \uBCF4\uACE0 \uC2E4\uD328 \uC99D\uAC70\uC640 \uACBD\uB85C \uC601\uD5A5\uC744 \uD568\uAED8 \uCD94\uC801\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.</div>
  </aside>
  <main class="main">
    <header class="topbar">
      <div><div class="eyebrow">Automated Quality Report</div><h1>${live ? "\uC2E4\uC2DC\uAC04 \uC810\uAC80 \uB300\uC2DC\uBCF4\uB4DC" : "\uC0AC\uC774\uD2B8 \uC810\uAC80 \uB9AC\uD3EC\uD2B8"}</h1><div class="muted">\uC911\uBCF5 \uC5C6\uB294 \uC694\uC57D, \uC2E4\uD328 \uC9D1\uC911\uB3C4, \uACBD\uB85C\uBCC4 \uCD5C\uC885 \uACB0\uACFC\uB97C \uD55C \uD654\uBA74 \uD750\uB984\uC73C\uB85C \uC815\uB9AC\uD588\uC2B5\uB2C8\uB2E4.</div></div>
      <span id="runState" class="run-state ${isRunning ? "running" : "done"}">${escapeHtml(reportStatus)}</span>
    </header>
    <section id="summaryView" class="view active">
      <div id="verdict" class="verdict ${verdictClass}">
        <div id="verdictMark" class="verdict-mark">${summary.failedChecks === 0 ? "OK" : "!"}</div>
        <div><strong id="verdictTitle">${escapeHtml(verdictText)}</strong><span id="verdictText" class="muted">${summary.affectedRoutes}\uAC1C \uACBD\uB85C\uC5D0 \uC601\uD5A5 \xB7 \uC804\uCCB4 \uCCB4\uD06C \uC2E4\uD328\uC728 ${summary.checkFailureRate}%</span></div>
        <div id="verdictScore" class="verdict-score">${Math.max(0, Math.round(100 - summary.checkFailureRate))}</div>
      </div>
      <div class="section-head"><div><h2>\uC2E4\uD589 \uC694\uC57D</h2><p class="muted">\uACBD\uB85C, \uCCB4\uD06C \uC218, \uC2E4\uD328\uC728\uB9CC \uB0A8\uACA8 \uBE60\uB974\uAC8C \uC0C1\uD0DC\uB97C \uD310\uB2E8\uD569\uB2C8\uB2E4.</p></div></div>
      <section class="grid">
        <div class="metric"><button id="showRoutes" class="metric-button" type="button"><span>\uBC1C\uACAC \uACBD\uB85C \xB7 \uB20C\uB7EC\uC11C \uBCF4\uAE30</span><strong id="discovered">${summary.discoveredRoutes}</strong></button></div>
        <div class="metric"><span>\uC810\uAC80 \uACBD\uB85C \uC778\uC2A4\uD134\uC2A4</span><strong id="routeInstances">${summary.routeInstances}</strong></div>
        <div class="metric"><span>\uC9C4\uD589\uB41C \uCCB4\uD06C</span><strong id="completed">${summary.completedChecks}</strong></div>
        <div class="metric success"><span>\uD1B5\uACFC</span><strong id="passed">${summary.passedChecks}</strong></div>
        <div class="metric warning"><span>\uACBD\uACE0</span><strong id="warning">${summary.warningChecks}</strong></div>
        <div class="metric danger"><button id="showFailed" class="metric-button" type="button"><span>\uC2E4\uD328 \xB7 \uC0C1\uC138\uC5D0\uC11C \uBCF4\uAE30</span><strong id="failed">${summary.failedChecks}</strong></button></div>
        <div class="metric danger"><span>\uBB38\uC81C \uACBD\uB85C</span><strong id="affected">${summary.affectedRoutes}</strong></div>
        <div class="metric danger"><span>\uCCB4\uD06C \uC2E4\uD328\uC728</span><strong id="failureRate">${summary.checkFailureRate}%</strong></div>
      </section>
      <section id="routeDiscovery" class="route-discovery" hidden><h3>\uD0D0\uC0C9\uD55C \uACBD\uB85C</h3><ul id="routeDiscoveryList">${initialRouteUrls.map((route) => `<li>${escapeHtml(route)}</li>`).join("") || '<li class="empty">\uC544\uC9C1 \uBC1C\uACAC\uB41C \uACBD\uB85C\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.</li>'}</ul></section>
      <div class="section-head"><div><h2>\uD488\uC9C8 \uBD84\uC11D</h2><p class="muted">\uC0C1\uD0DC \uBD84\uD3EC\uC640 \uC2E4\uD328 \uC9D1\uC911 \uAD6C\uAC04\uC744 \uBE44\uAD50\uD569\uB2C8\uB2E4.</p></div></div>
      <section class="analysis-grid">
        <div class="panel"><h3>\uC810\uAC80 \uC0C1\uD0DC</h3><div class="status-chart"><div id="statusDonut" class="donut" style="background:conic-gradient(#179b68 0 ${passedPercent}%,#c77700 ${passedPercent}% ${passedPercent + warningPercent}%,#d14343 ${passedPercent + warningPercent}% ${passedPercent + warningPercent + failedPercent}%,#dfe5ee 0)"></div><div class="legend"><span><label><i style="background:#179b68"></i>\uD1B5\uACFC</label><b id="legendPassed">${summary.passedChecks}</b></span><span><label><i style="background:#c77700"></i>\uACBD\uACE0</label><b id="legendWarning">${summary.warningChecks}</b></span><span><label><i style="background:#d14343"></i>\uC2E4\uD328</label><b id="legendFailed">${summary.failedChecks}</b></span></div></div></div>
        <div class="panel"><h3>\uBB38\uC81C \uC720\uD615</h3><div id="categoryBars">${barRows(summary.byCategory)}</div></div>
        <div class="panel"><h3>\uBE0C\uB77C\uC6B0\uC800\uBCC4 \uC2E4\uD328</h3><div id="browserBars">${barRows(summary.byBrowser)}</div></div>
        <div class="panel"><h3>\uD504\uB85C\uD544\uBCC4 \uC2E4\uD328</h3><div id="profileBars">${barRows(summary.byProfile)}</div></div>
      </section>
    </section>
    <section id="detailView" class="view">
      <div class="section-head"><div><h2>\uC2E4\uC2DC\uAC04 \uC0C1\uC138 \uACB0\uACFC</h2><p class="muted">\uC5F4 \uC81C\uBAA9\uC73C\uB85C \uC815\uB82C\uD558\uACE0 \uC2E4\uD328 \uC99D\uAC70\uB97C \uBC14\uB85C \uD655\uC778\uD569\uB2C8\uB2E4.</p></div><div class="toolbar"><input id="search" placeholder="URL, \uC810\uAC80\uBA85 \uB610\uB294 \uC624\uB958 \uBA54\uC2DC\uC9C0 \uAC80\uC0C9"><select id="status"><option value="">all status</option><option value="failed">failed</option><option value="warning">warning</option><option value="passed">passed</option><option value="skipped">skipped</option></select></div></div>
      <div class="table-shell"><table><thead><tr><th class="sortable" data-sort="status">\uC0C1\uD0DC</th><th class="sortable" data-sort="browser">\uBE0C\uB77C\uC6B0\uC800</th><th class="sortable" data-sort="profile">\uD504\uB85C\uD544</th><th class="sortable" data-sort="category">\uBD84\uB958</th><th class="sortable" data-sort="route">\uACBD\uB85C</th><th class="sortable" data-sort="check">\uC810\uAC80</th><th class="sortable" data-sort="message">\uC9C4\uB2E8 \uB0B4\uC6A9</th><th class="sortable" data-sort="durationMs" data-type="number">\uC2DC\uAC04</th><th>Evidence</th><th>\uBD84\uC11D</th></tr></thead><tbody id="results">${resultRows(results)}</tbody></table></div>
    </section>
    <section id="finalView" class="view"><div class="section-head"><div><h2>\uCD5C\uC885 \uC810\uAC80 \uACB0\uACFC</h2><p class="muted">\uACBD\uB85C\uBCC4 \uD1B5\uACFC \uD56D\uBAA9\uACFC \uBB38\uC81C \uC6D0\uC778\uC744 \uD55C\uB208\uC5D0 \uD655\uC778\uD569\uB2C8\uB2E4.</p></div></div><div id="finalBody"></div></section>
  </main>
</div>
<div id="detailModal" class="modal" role="dialog" aria-modal="true" aria-labelledby="detailTitle"><section class="dialog"><header class="dialog-head"><div><strong id="detailTitle">\uC0C1\uC138 \uACB0\uACFC</strong><div id="detailSubtitle" class="muted"></div></div><button id="closeDetail" class="close" aria-label="\uB2EB\uAE30">x</button></header><div id="detailBody" class="dialog-body"></div></section></div>
<script>
const resultData=${safeJson(results)};
const search=document.querySelector('#search'),status=document.querySelector('#status');
function activateView(viewId){document.querySelectorAll('.view-button').forEach(item=>item.classList.toggle('active',item.dataset.view===viewId));document.querySelectorAll('.view').forEach(view=>view.classList.toggle('active',view.id===viewId));if(viewId==='finalView')renderFinal()}
for(const button of document.querySelectorAll('.view-button'))button.addEventListener('click',()=>activateView(button.dataset.view));
function filter(){for(const row of document.querySelectorAll('#results tr')){const text=row.textContent.toLowerCase();const okText=text.includes(search.value.toLowerCase());const okStatus=!status.value||row.classList.contains(status.value);row.style.display=okText&&okStatus?'':'none'}}search.addEventListener('input',filter);status.addEventListener('change',filter);
document.querySelector('#showFailed').addEventListener('click',()=>{status.value='failed';search.value='';filter();activateView('detailView')});
const routeDiscovery=document.querySelector('#routeDiscovery'),routeDiscoveryList=document.querySelector('#routeDiscoveryList');document.querySelector('#showRoutes').addEventListener('click',()=>{routeDiscovery.hidden=!routeDiscovery.hidden;if(!routeDiscovery.hidden)routeDiscovery.scrollIntoView({behavior:'smooth',block:'nearest'})});
const modal=document.querySelector('#detailModal'),detailBody=document.querySelector('#detailBody'),detailSubtitle=document.querySelector('#detailSubtitle');
function textElement(tag,text,className){const el=document.createElement(tag);if(className)el.className=className;el.textContent=String(text??'');return el}
function formatKstText(value){const date=new Date(value);if(Number.isNaN(date.getTime()))return String(value??'');return new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(date)}
function showDetail(id){const r=resultData.find(item=>item.id===id);if(!r)return;detailSubtitle.textContent=r.status+' \xB7 '+r.category+' \xB7 '+r.check;detailBody.replaceChildren();const dl=document.createElement('dl');dl.className='detail-grid';for(const [label,value] of [['\uC810\uAC80 \uACBD\uB85C',r.route],['\uCD5C\uC885 \uB3C4\uCC29 URL',r.finalUrl],['\uC2E4\uD589 \uBE0C\uB77C\uC6B0\uC800',r.browser],['\uC0AC\uC6A9\uC790 \uD504\uB85C\uD544',r.profile],['\uC704\uD5D8\uB3C4',r.severity||'-'],['\uC9C4\uB2E8 \uBA54\uC2DC\uC9C0',r.message||'-'],['\uC18C\uC694 \uC2DC\uAC04',r.durationMs+'ms'],['\uC2DC\uC791 \uC2DC\uAC01',formatKstText(r.startedAt)],['\uC885\uB8CC \uC2DC\uAC01',formatKstText(r.finishedAt)]]){dl.append(textElement('dt',label),textElement('dd',value))}detailBody.appendChild(dl);if(r.details&&Object.keys(r.details).length){detailBody.append(textElement('h3','\uAE30\uC220 \uC9C4\uB2E8 \uC815\uBCF4'));detailBody.append(textElement('pre',JSON.stringify(r.details,null,2),'details-json'))}if(r.artifact){detailBody.append(textElement('h3','\uC2E4\uD328 \uC99D\uAC70 \uC790\uB8CC'));const img=document.createElement('img');img.className='artifact-preview';img.src=r.artifact;img.alt=r.check+' \uC2E4\uD328 \uD654\uBA74';img.loading='lazy';detailBody.append(img)}modal.classList.add('open');document.body.style.overflow='hidden'}
function closeDetail(){modal.classList.remove('open');document.body.style.overflow=''}
document.addEventListener('click',event=>{const button=event.target.closest?.('.detail-button');if(button)showDetail(button.dataset.resultId)});document.querySelector('#closeDetail').addEventListener('click',closeDetail);modal.addEventListener('click',event=>{if(event.target===modal)closeDetail()});document.addEventListener('keydown',event=>{if(event.key==='Escape')closeDetail()});
let sortKey='',sortDirection=1;
for(const header of document.querySelectorAll('.sortable'))header.addEventListener('click',()=>{const key=header.dataset.sort;sortDirection=sortKey===key?-sortDirection:1;sortKey=key;document.querySelectorAll('.sortable').forEach(item=>item.classList.remove('asc','desc'));header.classList.add(sortDirection===1?'asc':'desc');const body=document.querySelector('#results');const rows=[...body.querySelectorAll('tr')];rows.sort((a,b)=>{const aResult=resultData.find(item=>item.id===a.querySelector('.detail-button')?.dataset.resultId),bResult=resultData.find(item=>item.id===b.querySelector('.detail-button')?.dataset.resultId);const av=aResult?.[key]??'',bv=bResult?.[key]??'';return (typeof av==='number'&&typeof bv==='number'?av-bv:String(av).localeCompare(String(bv),'en',{numeric:true,sensitivity:'base'}))*sortDirection});body.append(...rows)});
const finalBody=document.querySelector('#finalBody');
function routeLabel(route){try{const url=new URL(route);return url.pathname+(url.search||'')}catch{return route}}
function renderFinal(){finalBody.replaceChildren();const metrics=document.createElement('div');metrics.className='final-metrics';const counts={passed:resultData.filter(r=>r.status==='passed').length,warning:resultData.filter(r=>r.status==='warning').length,failed:resultData.filter(r=>r.status==='failed').length};for(const [label,value] of [['Tested checks',resultData.length],['Passed',counts.passed],['Warning',counts.warning],['Failed',counts.failed]]){const box=document.createElement('div');box.append(textElement('span',label,'muted'),textElement('b',value));metrics.appendChild(box)}finalBody.appendChild(metrics);const groups=new Map();for(const r of resultData){const key=r.route||'system';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r)}const list=document.createElement('div');list.className='route-summary';for(const [route,items] of [...groups.entries()].sort((a,b)=>routeLabel(a[0]).localeCompare(routeLabel(b[0])))){const failed=items.filter(r=>r.status==='failed'),warning=items.filter(r=>r.status==='warning'),passed=items.filter(r=>r.status==='passed');const group=document.createElement('details');group.className='route-group';group.open=failed.length>0||warning.length>0;const routeSummary=document.createElement('summary');routeSummary.append(textElement('strong',routeLabel(route)));for(const [statusName,statusItems] of [['failed',failed],['warning',warning],['passed',passed]])if(statusItems.length)routeSummary.append(textElement('span',statusItems.length+' '+statusName,'result-pill '+statusName));group.appendChild(routeSummary);const ul=document.createElement('ul');for(const item of items){const li=document.createElement('li');li.append(textElement('span',item.status.toUpperCase()+' \xB7 ','status-badge'));const button=document.createElement('button');button.className='issue-link';button.textContent=item.check+(item.message?' - '+item.message:'');button.addEventListener('click',()=>showDetail(item.id));li.appendChild(button);if(item.artifact)li.append(textElement('span',' \xB7 Evidence available','muted'));ul.appendChild(li)}group.appendChild(ul);list.appendChild(group)}finalBody.appendChild(list)}
${live ? `
const source=new EventSource('/events');const connection=document.querySelector('#connection');
const routeUrls=new Set(${safeJson(initialRouteUrls)}),routeInstances=new Set(${safeJson(initialRouteInstances)}),affectedInstances=new Set(${safeJson(initialAffectedInstances)});
let completed=${summary.completedChecks},passed=${summary.passedChecks},failedCount=${summary.failedChecks},warning=${summary.warningChecks};
const categoryCounts=new Map(Object.entries(${safeJson(summary.byCategory)})),browserCounts=new Map(Object.entries(${safeJson(summary.byBrowser)})),profileCounts=new Map(Object.entries(${safeJson(summary.byProfile)}));
function setText(id,value){const node=document.querySelector('#'+id);if(node)node.textContent=String(value)}
function updateStatusChart(){const total=Math.max(1,completed),p=passed/total*100,w=warning/total*100,f=failedCount/total*100;document.querySelector('#statusDonut').style.background='conic-gradient(#179b68 0 '+p+'%,#c77700 '+p+'% '+(p+w)+'%,#d14343 '+(p+w)+'% '+(p+w+f)+'%,#dfe5ee 0)';setText('legendPassed',passed);setText('legendWarning',warning);setText('legendFailed',failedCount)}
function updateRates(){const affectedRate=routeInstances.size?((affectedInstances.size/routeInstances.size)*100).toFixed(2):'0',failureRate=completed?((failedCount/completed)*100).toFixed(2):'0';setText('affected',affectedInstances.size);setText('failureRate',failureRate+'%');setText('detailCount',failedCount);setText('sideFailed',failedCount);setText('verdictTitle',failedCount===0?'\uB9B4\uB9AC\uC2A4 \uCC28\uB2E8 \uC774\uC288 \uC5C6\uC74C':Number(failureRate)>=25?'\uB9B4\uB9AC\uC2A4 \uC804 \uC6B0\uC120 \uC870\uCE58 \uD544\uC694':'\uD655\uC778 \uD6C4 \uB9B4\uB9AC\uC2A4 \uAC00\uB2A5');setText('verdictText',affectedInstances.size+'\uAC1C \uACBD\uB85C\uC5D0 \uC601\uD5A5 \xB7 \uC804\uCCB4 \uCCB4\uD06C \uC2E4\uD328\uC728 '+failureRate+'%');setText('verdictMark',failedCount===0?'OK':'!');setText('verdictScore',Math.max(0,Math.round(100-Number(failureRate))));const verdict=document.querySelector('#verdict');verdict.classList.toggle('healthy',failedCount===0);verdict.classList.toggle('attention',failedCount>0&&Number(failureRate)<25);verdict.classList.toggle('critical',Number(failureRate)>=25);updateStatusChart()}
function cell(value,className){const td=document.createElement('td');if(className)td.className=className;td.textContent=String(value??'');return td}
function renderBars(id,counts){const container=document.querySelector('#'+id);container.replaceChildren();const entries=[...counts.entries()].sort((a,b)=>Number(b[1])-Number(a[1]));if(!entries.length){container.appendChild(textElement('p','No failures','empty'));return}const max=Math.max(1,...entries.map(([,value])=>Number(value)));for(const [label,value] of entries){const row=document.createElement('div');row.className='bar-row';const name=document.createElement('span');name.textContent=label;name.title=label;const bar=document.createElement('div');bar.className='bar-track';const fill=document.createElement('i');fill.style.width=(Number(value)/max*100)+'%';bar.appendChild(fill);const count=document.createElement('b');count.textContent=String(value);row.append(name,bar,count);container.appendChild(row)}}
function increment(counts,key){counts.set(key,Number(counts.get(key)||0)+1)}
function setRunState(text,state){setText('reportStatus',text);const node=document.querySelector('#runState');if(!node)return;node.textContent=text;node.classList.toggle('running',state==='running');node.classList.toggle('done',state==='done')}
connection.textContent='live';source.onopen=()=>connection.textContent='\uC2E4\uC2DC\uAC04 \uC5F0\uACB0\uB428';source.onerror=()=>connection.textContent='\uC5F0\uACB0 \uC7AC\uC2DC\uB3C4 \uC911';
source.addEventListener('route.discovered',event=>{const e=JSON.parse(event.data),isNew=!routeUrls.has(e.route);routeUrls.add(e.route);routeInstances.add(e.browser+':'+e.profile+':'+e.route);if(isNew){if(routeDiscoveryList.querySelector('.empty'))routeDiscoveryList.replaceChildren();routeDiscoveryList.appendChild(textElement('li',e.route))}setText('discovered',routeUrls.size);setText('routeInstances',routeInstances.size);updateRates()});
source.addEventListener('check.finished',event=>{const e=JSON.parse(event.data),r=e.result;resultData.push(r);completed++;if(r.status==='passed')passed++;if(r.status==='failed'){failedCount++;increment(categoryCounts,r.category);increment(browserCounts,r.browser);increment(profileCounts,r.profile);renderBars('categoryBars',categoryCounts);renderBars('browserBars',browserCounts);renderBars('profileBars',profileCounts);if(r.browser!=='node'&&r.category!=='browser'&&r.category!=='authentication')affectedInstances.add(r.browser+':'+r.profile+':'+r.route)}if(r.status==='warning')warning++;setText('completed',completed);setText('passed',passed);setText('warning',warning);setText('failed',failedCount);updateRates();const tr=document.createElement('tr');tr.className=r.status;const statusCell=document.createElement('td');const badge=document.createElement('span');badge.className='status-badge';badge.textContent=r.status;statusCell.appendChild(badge);tr.append(statusCell,cell(r.browser),cell(r.profile),cell(r.category),cell(r.route,'route'),cell(r.check),cell(r.message||''),cell(r.durationMs+'ms'));const evidenceCell=document.createElement('td');evidenceCell.innerHTML=r.artifact?'<button class="evidence-button detail-button" data-result-id="'+r.id+'"><img src="'+r.artifact+'" alt="\uC2E4\uD328 \uD654\uBA74"><span>Evidence</span></button>':'<span class="no-evidence">-</span>';tr.appendChild(evidenceCell);const detailCell=document.createElement('td'),button=document.createElement('button');button.className='detail-button';button.dataset.resultId=r.id;button.textContent='\uC0C1\uC138 \uACB0\uACFC';detailCell.appendChild(button);tr.appendChild(detailCell);document.querySelector('#results').prepend(tr);filter()});
source.addEventListener('run.finished',async event=>{const s=JSON.parse(event.data).summary;completed=s.completedChecks;passed=s.passedChecks;warning=s.warningChecks;failedCount=s.failedChecks;for(const [id,key] of [['discovered','discoveredRoutes'],['routeInstances','routeInstances'],['completed','completedChecks'],['passed','passedChecks'],['warning','warningChecks'],['failed','failedChecks'],['affected','affectedRoutes']])setText(id,s[key]);setText('failureRate',s.checkFailureRate+'%');categoryCounts.clear();for(const [key,value] of Object.entries(s.byCategory))categoryCounts.set(key,value);browserCounts.clear();for(const [key,value] of Object.entries(s.byBrowser))browserCounts.set(key,value);profileCounts.clear();for(const [key,value] of Object.entries(s.byProfile))profileCounts.set(key,value);renderBars('categoryBars',categoryCounts);renderBars('browserBars',browserCounts);renderBars('profileBars',profileCounts);updateRates();setRunState('\uC810\uAC80 \uC644\uB8CC','done');connection.textContent='\uCCB4\uD06C \uC644\uB8CC';source.close();try{const saved=await fetch('/result.json',{cache:'no-store'}).then(response=>response.json());resultData.splice(0,resultData.length,...saved);for(const row of document.querySelectorAll('#results tr')){const id=row.querySelector('.detail-button')?.dataset.resultId,r=resultData.find(item=>item.id===id);if(!r?.artifact)continue;const evidence=row.children[8];evidence.replaceChildren();const button=document.createElement('button');button.className='evidence-button detail-button';button.dataset.resultId=r.id;const img=document.createElement('img');img.src=r.artifact;img.alt='\uC2E4\uD328 \uD654\uBA74';button.append(img,textElement('span','Evidence'));evidence.appendChild(button)}}catch{}renderFinal()});` : ""}
</script>
</body>
</html>`;
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
  const publishFailure = (input) => {
    const checkStartedAt = Date.now();
    eventBus.publish({
      type: "check.started",
      runId,
      route: config.baseURL,
      browser: input.browser,
      profile: input.profile,
      check: input.check
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
      status: "failed",
      severity: "critical",
      message: input.message
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
export {
  AuditEventBus,
  defineConfig,
  loadConfig,
  resolveConfig,
  runAudit
};
//# sourceMappingURL=index.js.map