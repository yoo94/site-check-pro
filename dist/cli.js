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
    seeds: z.array(z.string()).optional(),
    exclude: z.array(z.string()).optional()
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

// src/dashboard/controlServer.ts
import fs4 from "fs";
import http2 from "http";
import path7 from "path";

// src/auth/capture.ts
import fs from "fs";
import http from "http";
import path2 from "path";
import { chromium } from "playwright";
function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function profileFilename(profile) {
  const normalized = profile.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!normalized) throw new Error("\uD504\uB85C\uD544 \uC774\uB984\uC740 \uC601\uBB38, \uC22B\uC790, ., _, - \uC911 \uD558\uB098\uB97C \uD3EC\uD568\uD574\uC57C \uD569\uB2C8\uB2E4.");
  return normalized;
}
async function createCaptureServer(input) {
  let settled = false;
  let resolveDone;
  let rejectDone;
  const done = new Promise((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  const finish = async (res, action) => {
    if (settled) {
      res.writeHead(409, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, message: "\uC774\uBBF8 \uCC98\uB9AC\uB418\uC5C8\uC2B5\uB2C8\uB2E4." }));
      return;
    }
    settled = true;
    if (action === "cancel") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, message: "\uCDE8\uC18C\uB418\uC5C8\uC2B5\uB2C8\uB2E4." }));
      rejectDone(new Error("\uC778\uC99D \uC0C1\uD0DC \uC800\uC7A5\uC774 \uCDE8\uC18C\uB418\uC5C8\uC2B5\uB2C8\uB2E4."));
      return;
    }
    try {
      await input.context.storageState({ path: input.authPath, indexedDB: true });
      const manifest = {
        profile: input.profile,
        storageState: input.configStorageState,
        baseURL: input.baseURL,
        loginURL: input.loginURL,
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        configSnippet: `${input.profile}: { storageState: '${input.configStorageState}', seeds: ['/'] }`
      };
      fs.writeFileSync(input.manifestPath, `${JSON.stringify(manifest, null, 2)}
`, "utf8");
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, authPath: input.authPath, manifestPath: input.manifestPath }));
      resolveDone({
        profile: input.profile,
        authPath: input.authPath,
        configStorageState: input.configStorageState,
        manifestPath: input.manifestPath
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, message }));
      rejectDone(new Error(message));
    }
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    if (url.pathname === "/save" && req.method === "POST") {
      void finish(res, "save");
      return;
    }
    if (url.pathname === "/cancel" && req.method === "POST") {
      void finish(res, "cancel");
      return;
    }
    if (url.pathname === "/status") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ settled }));
      return;
    }
    if (url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(renderAuthCaptureHtml(input));
      return;
    }
    res.writeHead(404).end("Not found");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("\uC778\uC99D \uCEA1\uCC98 \uC11C\uBC84\uB97C \uC2DC\uC791\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
  return {
    url: `http://127.0.0.1:${address.port}`,
    done,
    close: async () => {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  };
}
function renderAuthCaptureHtml(input) {
  const configSnippet = `${input.profile}: { storageState: '${input.configStorageState}', seeds: ['/'] }`;
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Site Check Pro auth capture</title>
<style>
:root{font-family:Inter,Pretendard,system-ui,sans-serif;color:#1f2937;background:#f6f7f9}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}.shell{width:min(760px,100%);background:#fff;border:1px solid #d9dee7;border-radius:8px;box-shadow:0 16px 40px #20304014;padding:26px}.eyebrow{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#2563eb;font-weight:900}h1{margin:8px 0 12px;font-size:28px}.muted{color:#687385;line-height:1.55}.grid{display:grid;grid-template-columns:150px 1fr;gap:10px 16px;margin:22px 0;padding:16px;background:#f8fafc;border:1px solid #e4e9f0;border-radius:8px}dt{color:#687385}dd{margin:0;word-break:break-all;font-weight:750}.snippet{margin-top:16px}.snippet-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px}.snippet strong{font-size:14px}.snippet pre{margin:0;padding:14px;border-radius:8px;background:#171d29;color:#d6dde8;overflow:auto;white-space:pre-wrap}.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:20px}button,a{height:42px;border-radius:8px;padding:0 14px;font-weight:850;text-decoration:none;display:inline-flex;align-items:center;border:1px solid #cfd6e2;cursor:pointer;background:#fff;color:#27364a}.primary{background:#2563eb;border-color:#2563eb;color:#fff}.danger{color:#b42318}.small{height:34px;font-size:12px}.notice{margin-top:18px;padding:12px 14px;border-radius:8px;background:#fff7ed;color:#9a4d00}.done{background:#eaf8f1;color:#067647}.error{background:#fff0f0;color:#b42318}
</style>
</head>
<body>
<main class="shell">
  <div class="eyebrow">Site Check Pro Auth Capture</div>
  <h1>\uB85C\uADF8\uC778 \uC0C1\uD0DC\uB97C \uC800\uC7A5\uD569\uB2C8\uB2E4</h1>
  <p class="muted">\uBA3C\uC800 \uB85C\uADF8\uC778 \uD398\uC774\uC9C0\uB97C \uC5F4\uC5B4 \uB300\uC0C1 \uC11C\uBE44\uC2A4\uC5D0 \uB85C\uADF8\uC778\uD558\uC138\uC694. \uB85C\uADF8\uC778\uC774 \uB05D\uB098\uBA74 \uC774 \uD0ED\uC73C\uB85C \uB3CC\uC544\uC640 \uC800\uC7A5 \uBC84\uD2BC\uC744 \uB204\uB974\uBA74 \uC810\uAC80\uC5D0 \uC0AC\uC6A9\uD560 \uC778\uC99D JSON\uC774 \uC0DD\uC131\uB429\uB2C8\uB2E4.</p>
  <dl class="grid">
    <dt>\uD504\uB85C\uD544</dt><dd>${escapeHtml(input.profile)}</dd>
    <dt>\uB300\uC0C1 URL</dt><dd>${escapeHtml(input.baseURL)}</dd>
    <dt>\uB85C\uADF8\uC778 URL</dt><dd>${escapeHtml(input.loginURL)}</dd>
    <dt>\uC800\uC7A5 \uACBD\uB85C</dt><dd>${escapeHtml(input.authPath)}</dd>
    <dt>config \uACBD\uB85C</dt><dd>${escapeHtml(input.configStorageState)}</dd>
  </dl>
  <section class="snippet">
    <div class="snippet-head">
      <strong>site-check-pro.config.ts\uC5D0 \uB123\uC744 profile \uC124\uC815</strong>
      <button id="copySnippet" class="small" type="button">\uBCF5\uC0AC</button>
    </div>
    <pre id="configSnippet">${escapeHtml(configSnippet)}</pre>
  </section>
  <div class="actions">
    <a class="primary" href="${escapeHtml(input.loginURL)}" target="_blank" rel="noreferrer">\uB85C\uADF8\uC778 \uD398\uC774\uC9C0 \uC5F4\uAE30</a>
    <button id="save" type="button">\uB85C\uADF8\uC778 \uC644\uB8CC \uD6C4 \uC800\uC7A5\uD558\uAE30</button>
    <button id="cancel" class="danger" type="button">\uCDE8\uC18C</button>
  </div>
  <div id="message" class="notice">\uB85C\uADF8\uC778 \uD398\uC774\uC9C0\uB97C \uC5F4\uC5B4 \uC6D0\uD558\uB294 \uAD8C\uD55C\uC758 \uACC4\uC815\uC73C\uB85C \uB85C\uADF8\uC778\uD55C \uB4A4, \uC774 \uD0ED\uC73C\uB85C \uB3CC\uC544\uC640 \uC800\uC7A5\uD558\uC138\uC694.</div>
</main>
<script>
const message=document.querySelector('#message');
async function send(action){for(const button of document.querySelectorAll('button'))button.disabled=true;message.className='notice';message.textContent=action==='save'?'\uC800\uC7A5 \uC911\uC785\uB2C8\uB2E4...':'\uCDE8\uC18C \uC911\uC785\uB2C8\uB2E4...';try{const response=await fetch('/'+action,{method:'POST'}),data=await response.json();if(!response.ok||!data.ok)throw new Error(data.message||'\uCC98\uB9AC \uC2E4\uD328');message.className=action==='save'?'notice done':'notice';message.textContent=action==='save'?'\uC800\uC7A5\uB418\uC5C8\uC2B5\uB2C8\uB2E4. \uC774 \uCC3D\uC740 \uB2EB\uC544\uB3C4 \uB429\uB2C8\uB2E4.':'\uCDE8\uC18C\uB418\uC5C8\uC2B5\uB2C8\uB2E4.'}catch(error){message.className='notice error';message.textContent=error instanceof Error?error.message:String(error);for(const button of document.querySelectorAll('button'))button.disabled=false}}
document.querySelector('#save').addEventListener('click',()=>send('save'));
document.querySelector('#cancel').addEventListener('click',()=>send('cancel'));
document.querySelector('#copySnippet').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(document.querySelector('#configSnippet').textContent);message.className='notice done';message.textContent='profile \uC124\uC815\uC744 \uBCF5\uC0AC\uD588\uC2B5\uB2C8\uB2E4.'}catch{message.className='notice';message.textContent='\uBCF5\uC0AC\uAC00 \uB9C9\uD600 \uC788\uC73C\uBA74 \uCF54\uB4DC \uBE14\uB85D\uC744 \uC9C1\uC811 \uC120\uD0DD\uD574\uC11C \uBCF5\uC0AC\uD558\uC138\uC694.'}});
</script>
</body>
</html>`;
}
async function captureAuth(config, profile, loginUrl) {
  const profileName = profileFilename(profile);
  const authPath = path2.resolve(".site-check-pro/auth", `${profileName}.json`);
  const configStorageState = path2.relative(process.cwd(), authPath);
  const manifestPath = path2.resolve(".site-check-pro/auth", `${profileName}.profile.json`);
  fs.mkdirSync(path2.dirname(authPath), { recursive: true });
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const targetURL = loginUrl ? new URL(loginUrl, config.baseURL).toString() : config.baseURL;
  const captureServer = await createCaptureServer({
    context,
    authPath,
    configStorageState,
    manifestPath,
    profile: profileName,
    baseURL: config.baseURL,
    loginURL: targetURL
  });
  try {
    const controlPage = await context.newPage();
    await controlPage.goto(captureServer.url);
    await controlPage.bringToFront();
    return await captureServer.done;
  } finally {
    await captureServer.close();
    await browser.close();
  }
}

// src/core/runner.ts
import { randomUUID as randomUUID2 } from "crypto";
import path6 from "path";
import { chromium as chromium2, firefox, webkit } from "playwright";

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
import fs2 from "fs";
import path3 from "path";
var JsonlStore = class {
  runDir;
  artifactsDir;
  eventFile;
  results = [];
  constructor(outputDir, runId) {
    this.runDir = path3.resolve(outputDir, runId);
    this.artifactsDir = path3.join(this.runDir, "artifacts");
    this.eventFile = path3.join(this.runDir, "events.jsonl");
    fs2.mkdirSync(this.artifactsDir, { recursive: true });
  }
  appendEvent(event) {
    fs2.appendFileSync(this.eventFile, `${JSON.stringify(event)}
`, "utf8");
    if (event.type === "check.finished") this.results.push(event.result);
  }
  getResults() {
    return [...this.results];
  }
  saveSummary(summary) {
    fs2.writeFileSync(path3.join(this.runDir, "summary.json"), JSON.stringify(summary, null, 2));
    fs2.writeFileSync(path3.join(this.runDir, "result.json"), JSON.stringify(this.results, null, 2));
  }
};

// src/core/pageAuditor.ts
import path4 from "path";

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
function normalizeUrl(raw, currentURL, config, profileExclude = []) {
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
    if (matchesAny(pathname, [...config.crawl.exclude, ...profileExclude])) return null;
    return url.toString();
  } catch {
    return null;
  }
}

// src/core/pageAuditor.ts
function ignored(url, patterns) {
  return patterns.some((pattern) => url.includes(pattern));
}
async function collectLinks(page, config, profileExclude) {
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
  return [...hrefs].map((href) => normalizeUrl(href, page.url(), config, profileExclude)).filter((value) => Boolean(value));
}
async function auditPage(input) {
  const { runId, route, browser, profile, context, config, eventBus, artifactsDir } = input;
  const profileExclude = config.profiles[profile]?.exclude ?? [];
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
    discoveredLinks = await collectLinks(page, config, profileExclude);
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
    const screenshotPath = path4.join(artifactsDir, filename);
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => void 0);
    const lastFailed = [...checks].reverse().find((check) => check.status === "failed");
    if (lastFailed) lastFailed.artifact = `artifacts/${filename}`;
  }
  await page.close();
  return { route, finalUrl, browser, profile, depth: input.depth, checks, discoveredLinks };
}

// src/core/apiAuditor.ts
async function auditApis(runId, config, eventBus, signal) {
  const results = [];
  for (const api of config.api) {
    if (signal?.aborted) break;
    eventBus.publish({ type: "check.started", runId, route: api.url, browser: "node", profile: "api", check: api.name });
    const startedAt = Date.now();
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
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
      signal?.removeEventListener("abort", abort);
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
    status: input.status ?? "completed",
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
import fs3 from "fs";
import path5 from "path";
function escapeHtml2(value) {
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
      <span title="${escapeHtml2(label)}">${escapeHtml2(label)}</span>
      <div class="bar-track"><i style="width:${value / max * 100}%"></i></div>
      <b>${value}</b>
    </div>`).join("");
}
function resultRows(results) {
  return results.map((result) => `
    <tr class="${escapeHtml2(result.status)}">
      <td><span class="status-badge">${escapeHtml2(result.status)}</span></td>
      <td>${escapeHtml2(result.browser)}</td>
      <td>${escapeHtml2(result.profile)}</td>
      <td>${escapeHtml2(result.category)}</td>
      <td class="route">${escapeHtml2(result.route)}</td>
      <td>${escapeHtml2(result.check)}</td>
      <td>${escapeHtml2(result.message)}</td>
      <td>${escapeHtml2(result.durationMs)}ms</td>
      <td>${result.artifact ? `<button class="evidence-button detail-button" data-result-id="${escapeHtml2(result.id)}"><img src="${escapeHtml2(result.artifact)}" alt="\uC2E4\uD328 \uD654\uBA74"><span>Evidence</span></button>` : '<span class="no-evidence">-</span>'}</td>
      <td><button class="detail-button" data-result-id="${escapeHtml2(result.id)}">\uC0C1\uC138 \uACB0\uACFC</button></td>
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
  const reportState = summary.status ?? (live && !summary.finishedAt ? "running" : "completed");
  const isRunning = reportState === "running";
  const reportStatus = reportState === "cancelled" ? "\uC810\uAC80 \uC911\uC9C0\uB428" : isRunning ? "\uC810\uAC80 \uC911" : "\uC810\uAC80 \uC644\uB8CC";
  const runStateClass = reportState === "cancelled" ? "cancelled" : isRunning ? "running" : "done";
  const stopButtonHtml = live ? `<button id="stopRun" class="stop-run" type="button" ${isRunning ? "" : "disabled"}>\uC810\uAC80 \uC911\uC9C0</button>` : "";
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Site Check Pro report</title>
<style>
:root{font-family:Inter,Pretendard,system-ui,sans-serif;color:#1f2937;background:#f6f7f9;--line:#d9dee7;--text:#1f2937;--muted:#687385;--panel:#fff;--green:#179b68;--amber:#c77700;--red:#d14343;--blue:#2563eb;--ink:#202633}
*{box-sizing:border-box}body{margin:0}.app{display:grid;grid-template-columns:280px minmax(0,1fr);min-height:100vh}.sidebar{position:sticky;top:0;height:100vh;padding:22px 18px;background:#202633;color:#f7f8fb;display:flex;flex-direction:column;gap:18px}.brand{display:flex;align-items:center;gap:10px;padding-bottom:14px;border-bottom:1px solid #ffffff1f}.mark{width:34px;height:34px;border-radius:8px;background:#4f8cff;display:grid;place-items:center;font-weight:900}.brand strong{display:block}.brand span,.side-label,.side-meta,.side-foot{color:#b9c2d1}.side-card{border:1px solid #ffffff1a;border-radius:8px;padding:14px;background:#ffffff0c}.side-label{font-size:11px;text-transform:uppercase;letter-spacing:.08em}.side-url{margin-top:8px;word-break:break-all;font-weight:750}.side-meta{display:grid;gap:7px;font-size:12px}.side-meta b{color:#fff}.nav{display:grid;gap:8px}.view-button{display:flex;align-items:center;justify-content:space-between;border:1px solid transparent;background:transparent;color:#dce4f0;border-radius:8px;padding:11px 12px;cursor:pointer;font-weight:750;text-align:left}.view-button:hover{background:#ffffff10}.view-button.active{background:#fff;color:#202633}.connection,.run-state{display:inline-flex;align-items:center;gap:7px;width:max-content;border:1px solid #ffffff24;border-radius:999px;padding:7px 10px;font-size:12px;color:#d8f7e7}.connection:before,.run-state:before{content:'';width:7px;height:7px;border-radius:50%;background:#32d583}.run-state{background:#fff;color:#27364a;border-color:#d9dee7;font-weight:850}.run-state.running{color:#067647;background:#eaf8f1;border-color:#abefc6}.run-state.running:before{background:#12b76a;animation:pulse-dot 1s ease-in-out infinite}.run-state.done{color:#067647;background:#eaf8f1;border-color:#abefc6}.run-state.done:before{background:#12b76a}.run-state.cancelled{color:#667085;background:#f2f4f7;border-color:#d0d5dd}.run-state.cancelled:before{background:#98a2b3}.stop-run{height:34px;border:1px solid #fecdca;background:#fff0f0;color:#b42318;border-radius:8px;padding:0 12px;font-weight:850;cursor:pointer}.stop-run:disabled{opacity:.65;cursor:not-allowed}.top-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}.side-foot{margin-top:auto;font-size:12px;line-height:1.5}.main{padding:30px 34px 42px}.topbar{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;margin-bottom:22px}.eyebrow{font-size:12px;font-weight:900;color:#2563eb;letter-spacing:.08em;text-transform:uppercase}.topbar h1{margin:6px 0 8px;font-size:30px;line-height:1.15}.muted,.empty{color:var(--muted)}.view{display:none}.view.active{display:block}.section-head{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;margin:26px 0 12px}.section-head h2{margin:0 0 5px;font-size:20px}.section-head p{margin:0}.verdict{display:grid;grid-template-columns:auto 1fr auto;gap:16px;align-items:center;border:1px solid var(--line);border-radius:8px;background:var(--panel);padding:18px;box-shadow:0 8px 22px #2030400a}.verdict-mark{width:44px;height:44px;border-radius:8px;display:grid;place-items:center;font-weight:900}.verdict.healthy .verdict-mark{background:#eaf8f1;color:var(--green)}.verdict.attention .verdict-mark{background:#fff5df;color:var(--amber)}.verdict.critical .verdict-mark{background:#fff0f0;color:var(--red)}.verdict strong{display:block;margin-bottom:3px}.verdict-score{font-size:28px;font-weight:900}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.metric,.panel,.table-shell,.route-discovery{border:1px solid var(--line);background:var(--panel);border-radius:8px;box-shadow:0 8px 22px #2030400a}.metric{padding:16px;min-height:112px}.metric span{display:block;color:var(--muted);font-size:13px}.metric strong{display:block;margin-top:11px;font-size:30px;letter-spacing:-.02em}.metric-button{width:100%;height:100%;padding:0;border:0;background:transparent;color:inherit;text-align:left;cursor:pointer}.metric-button:hover strong{color:var(--blue)}.metric.success{border-left:4px solid var(--green)}.metric.warning{border-left:4px solid var(--amber)}.metric.danger{border-left:4px solid var(--red)}.route-discovery{margin-top:12px;padding:16px}.route-discovery[hidden]{display:none}.route-discovery h3{margin:0 0 12px;font-size:15px}.route-discovery ul{margin:0;padding-left:18px;columns:2}.route-discovery li{margin:7px 0;word-break:break-all}.analysis-grid{display:grid;grid-template-columns:1.15fr repeat(3,minmax(0,1fr));gap:12px}.panel{padding:18px;min-height:230px}.panel h3{margin:0 0 16px;font-size:15px}.status-chart{display:grid;grid-template-columns:142px 1fr;gap:20px;align-items:center}.donut{width:142px;height:142px;border-radius:50%;display:grid;place-items:center}.donut:after{content:'';width:84px;height:84px;border-radius:50%;background:#fff;box-shadow:inset 0 0 0 1px var(--line)}.legend{display:grid;gap:9px}.legend span{display:flex;align-items:center;justify-content:space-between;gap:12px}.legend i{width:10px;height:10px;border-radius:50%;display:inline-block;margin-right:8px}.legend label{display:flex;align-items:center;color:var(--muted)}.bar-row{display:grid;grid-template-columns:minmax(72px,92px) 1fr 32px;align-items:center;gap:10px;margin:12px 0}.bar-row span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted)}.bar-track{height:8px;border-radius:99px;background:#eef1f5;overflow:hidden}.bar-track i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#f59e0b,#d14343)}.toolbar{display:flex;gap:8px;align-items:center}.toolbar input,.toolbar select{height:40px;border:1px solid #cfd6e2;border-radius:8px;background:#fff;padding:0 11px;color:var(--text)}.toolbar input{min-width:320px}.table-shell{overflow:auto}table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:12px;border-bottom:1px solid #e7ebf1;text-align:left;vertical-align:top}th{position:sticky;top:0;background:#fafbfc;color:#596579;font-size:12px;z-index:1}tbody tr:hover{background:#f7f9fd}.sortable{cursor:pointer;user-select:none;white-space:nowrap}.sortable:after{content:' \u21C5';color:#98a2b3}.sortable.asc:after{content:' \u2191';color:var(--blue)}.sortable.desc:after{content:' \u2193';color:var(--blue)}.status-badge{display:inline-flex;align-items:center;border-radius:999px;padding:4px 8px;font-size:11px;font-weight:900;text-transform:uppercase;background:#eef2f7;color:#536073}.failed .status-badge{background:#fff0f0;color:#b42318}.passed .status-badge{background:#eaf8f1;color:#067647}.warning .status-badge{background:#fff5df;color:#b54708}.route{max-width:320px;word-break:break-all}.detail-button{border:1px solid #cfd6e2;background:#fff;color:#27364a;border-radius:8px;padding:8px 10px;cursor:pointer;font-weight:750}.detail-button:hover{border-color:#86a9ff;color:var(--blue)}.evidence-button{display:grid;gap:5px;padding:5px;font-size:10px}.evidence-button img{width:76px;height:46px;object-fit:cover;border-radius:6px}.no-evidence{color:#9aa4b5}.final-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}.final-metrics div{padding:14px;border:1px solid var(--line);border-radius:8px;background:#fff}.final-metrics b{display:block;margin-top:5px;font-size:24px}.route-summary{display:grid;gap:10px}.route-group{border:1px solid var(--line);border-radius:8px;background:#fff;overflow:hidden}.route-group summary{cursor:pointer;padding:14px 16px;background:#fafbfc;display:flex;gap:10px;align-items:center}.route-group summary strong{flex:1;word-break:break-all}.route-group ul{margin:0;padding:12px 18px 16px 36px}.route-group li{margin:8px 0}.result-pill{font-size:11px;font-weight:900;padding:4px 8px;border-radius:999px}.result-pill.failed{background:#fff0f0;color:#b42318}.result-pill.warning{background:#fff5df;color:#b54708}.result-pill.passed{background:#eaf8f1;color:#067647}.issue-link{border:0;background:none;color:#2563eb;cursor:pointer;padding:0;text-align:left;font-weight:750}.modal{position:fixed;inset:0;background:#151a23b8;display:none;align-items:center;justify-content:center;padding:24px;z-index:20;backdrop-filter:blur(4px)}.modal.open{display:flex}.dialog{width:min(980px,100%);max-height:90vh;overflow:auto;background:#fff;border-radius:8px;box-shadow:0 24px 60px #10182855}.dialog-head{position:sticky;top:0;z-index:1;background:#fff;border-bottom:1px solid #e7ebf1;padding:18px 22px;display:flex;justify-content:space-between;align-items:center}.dialog-body{padding:22px}.close{border:0;background:#eef2f7;border-radius:50%;font-size:21px;width:36px;height:36px;cursor:pointer}.detail-grid{display:grid;grid-template-columns:150px 1fr;gap:10px 18px;margin-bottom:20px}.detail-grid dt{color:var(--muted)}.detail-grid dd{margin:0;word-break:break-word}.details-json{white-space:pre-wrap;word-break:break-word;background:#171d29;color:#d6dde8;padding:16px;border-radius:8px;overflow:auto}.artifact-preview{display:block;max-width:100%;max-height:520px;margin:12px auto;border:1px solid var(--line);border-radius:8px}@keyframes pulse-dot{0%,100%{opacity:1;box-shadow:0 0 0 0 #12b76a66}50%{opacity:.35;box-shadow:0 0 0 5px #12b76a00}}
@media(max-width:1180px){.analysis-grid{grid-template-columns:1fr 1fr}.grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:820px){.app{grid-template-columns:1fr}.sidebar{position:relative;height:auto}.main{padding:22px 18px 34px}.topbar,.section-head{align-items:flex-start;flex-direction:column}.grid,.analysis-grid,.final-metrics{grid-template-columns:1fr}.route-discovery ul{columns:1}.toolbar{width:100%;flex-direction:column;align-items:stretch}.toolbar input{min-width:0}.status-chart{grid-template-columns:1fr}.detail-grid{grid-template-columns:1fr}.route-group summary{align-items:flex-start;flex-direction:column}}
</style>
</head>
<body>
<div class="app">
  <aside class="sidebar">
    <div class="brand"><div class="mark">SC</div><div><strong>Site Check Pro</strong><span>${live ? "Live dashboard" : "Static report"}</span></div></div>
    <div class="side-card">
      <div class="side-label">Target</div>
      <div class="side-url">${escapeHtml2(summary.baseURL)}</div>
    </div>
    <div class="side-meta">
      <span>\uC0C1\uD0DC <b id="reportStatus">${escapeHtml2(reportStatus)}</b></span>
      <span>\uC2E4\uD589 <b>${escapeHtml2(runLabel(summary))}</b></span>
      <span>\uC2DC\uC791 <b>${escapeHtml2(formatKst(summary.startedAt))}</b></span>
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
      <div class="top-actions">${stopButtonHtml}<span id="runState" class="run-state ${runStateClass}">${escapeHtml2(reportStatus)}</span></div>
    </header>
    <section id="summaryView" class="view active">
      <div id="verdict" class="verdict ${verdictClass}">
        <div id="verdictMark" class="verdict-mark">${summary.failedChecks === 0 ? "OK" : "!"}</div>
        <div><strong id="verdictTitle">${escapeHtml2(verdictText)}</strong><span id="verdictText" class="muted">${summary.affectedRoutes}\uAC1C \uACBD\uB85C\uC5D0 \uC601\uD5A5 \xB7 \uC804\uCCB4 \uCCB4\uD06C \uC2E4\uD328\uC728 ${summary.checkFailureRate}%</span></div>
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
      <section id="routeDiscovery" class="route-discovery" hidden><h3>\uD0D0\uC0C9\uD55C \uACBD\uB85C</h3><ul id="routeDiscoveryList">${initialRouteUrls.map((route) => `<li>${escapeHtml2(route)}</li>`).join("") || '<li class="empty">\uC544\uC9C1 \uBC1C\uACAC\uB41C \uACBD\uB85C\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.</li>'}</ul></section>
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
function setRunState(text,state){setText('reportStatus',text);const node=document.querySelector('#runState');if(!node)return;node.textContent=text;node.classList.toggle('running',state==='running');node.classList.toggle('done',state==='done');node.classList.toggle('cancelled',state==='cancelled')}
connection.textContent='live';source.onopen=()=>connection.textContent='\uC2E4\uC2DC\uAC04 \uC5F0\uACB0\uB428';source.onerror=()=>connection.textContent='\uC5F0\uACB0 \uC7AC\uC2DC\uB3C4 \uC911';
const stopRunButton=document.querySelector('#stopRun');if(stopRunButton)stopRunButton.addEventListener('click',async()=>{stopRunButton.disabled=true;setRunState('\uC911\uC9C0 \uC694\uCCAD\uB428','running');try{const response=await fetch('/stop',{method:'POST'});const data=await response.json();if(!response.ok)throw new Error(data.message||'\uC810\uAC80 \uC911\uC9C0 \uC2E4\uD328')}catch(error){setRunState(error instanceof Error?error.message:String(error),'running');stopRunButton.disabled=false}});
source.addEventListener('route.discovered',event=>{const e=JSON.parse(event.data),isNew=!routeUrls.has(e.route);routeUrls.add(e.route);routeInstances.add(e.browser+':'+e.profile+':'+e.route);if(isNew){if(routeDiscoveryList.querySelector('.empty'))routeDiscoveryList.replaceChildren();routeDiscoveryList.appendChild(textElement('li',e.route))}setText('discovered',routeUrls.size);setText('routeInstances',routeInstances.size);updateRates()});
source.addEventListener('check.finished',event=>{const e=JSON.parse(event.data),r=e.result;resultData.push(r);completed++;if(r.status==='passed')passed++;if(r.status==='failed'){failedCount++;increment(categoryCounts,r.category);increment(browserCounts,r.browser);increment(profileCounts,r.profile);renderBars('categoryBars',categoryCounts);renderBars('browserBars',browserCounts);renderBars('profileBars',profileCounts);if(r.browser!=='node'&&r.category!=='browser'&&r.category!=='authentication')affectedInstances.add(r.browser+':'+r.profile+':'+r.route)}if(r.status==='warning')warning++;setText('completed',completed);setText('passed',passed);setText('warning',warning);setText('failed',failedCount);updateRates();const tr=document.createElement('tr');tr.className=r.status;const statusCell=document.createElement('td');const badge=document.createElement('span');badge.className='status-badge';badge.textContent=r.status;statusCell.appendChild(badge);tr.append(statusCell,cell(r.browser),cell(r.profile),cell(r.category),cell(r.route,'route'),cell(r.check),cell(r.message||''),cell(r.durationMs+'ms'));const evidenceCell=document.createElement('td');evidenceCell.innerHTML=r.artifact?'<button class="evidence-button detail-button" data-result-id="'+r.id+'"><img src="'+r.artifact+'" alt="\uC2E4\uD328 \uD654\uBA74"><span>Evidence</span></button>':'<span class="no-evidence">-</span>';tr.appendChild(evidenceCell);const detailCell=document.createElement('td'),button=document.createElement('button');button.className='detail-button';button.dataset.resultId=r.id;button.textContent='\uC0C1\uC138 \uACB0\uACFC';detailCell.appendChild(button);tr.appendChild(detailCell);document.querySelector('#results').prepend(tr);filter()});
source.addEventListener('run.finished',async event=>{const s=JSON.parse(event.data).summary;completed=s.completedChecks;passed=s.passedChecks;warning=s.warningChecks;failedCount=s.failedChecks;for(const [id,key] of [['discovered','discoveredRoutes'],['routeInstances','routeInstances'],['completed','completedChecks'],['passed','passedChecks'],['warning','warningChecks'],['failed','failedChecks'],['affected','affectedRoutes']])setText(id,s[key]);setText('failureRate',s.checkFailureRate+'%');categoryCounts.clear();for(const [key,value] of Object.entries(s.byCategory))categoryCounts.set(key,value);browserCounts.clear();for(const [key,value] of Object.entries(s.byBrowser))browserCounts.set(key,value);profileCounts.clear();for(const [key,value] of Object.entries(s.byProfile))profileCounts.set(key,value);renderBars('categoryBars',categoryCounts);renderBars('browserBars',browserCounts);renderBars('profileBars',profileCounts);updateRates();setRunState('\uC810\uAC80 \uC644\uB8CC','done');if(stopRunButton)stopRunButton.disabled=true;connection.textContent='\uCCB4\uD06C \uC644\uB8CC';source.close();try{const saved=await fetch('/result.json',{cache:'no-store'}).then(response=>response.json());resultData.splice(0,resultData.length,...saved);for(const row of document.querySelectorAll('#results tr')){const id=row.querySelector('.detail-button')?.dataset.resultId,r=resultData.find(item=>item.id===id);if(!r?.artifact)continue;const evidence=row.children[8];evidence.replaceChildren();const button=document.createElement('button');button.className='evidence-button detail-button';button.dataset.resultId=r.id;const img=document.createElement('img');img.src=r.artifact;img.alt='\uC2E4\uD328 \uD654\uBA74';button.append(img,textElement('span','Evidence'));evidence.appendChild(button)}}catch{}renderFinal()});` : ""}
${live ? `source.addEventListener('run.cancelled',event=>{const s=JSON.parse(event.data).summary;completed=s.completedChecks;passed=s.passedChecks;warning=s.warningChecks;failedCount=s.failedChecks;for(const [id,key] of [['discovered','discoveredRoutes'],['routeInstances','routeInstances'],['completed','completedChecks'],['passed','passedChecks'],['warning','warningChecks'],['failed','failedChecks'],['affected','affectedRoutes']])setText(id,s[key]);setText('failureRate',s.checkFailureRate+'%');setRunState('\uC810\uAC80 \uC911\uC9C0\uB428','cancelled');if(stopRunButton)stopRunButton.disabled=true;connection.textContent='\uC911\uC9C0\uB428';source.close();renderFinal()});` : ""}
</script>
</body>
</html>`;
}
function writeHtmlReport(runDir, summary, results) {
  fs3.writeFileSync(path5.join(runDir, "index.html"), renderReportHtml(summary, results), "utf8");
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
var browserTypes = { chromium: chromium2, firefox, webkit };
var AuditCancelledError = class extends Error {
  constructor() {
    super("\uC0AC\uC774\uD2B8 \uC810\uAC80\uC774 \uC911\uC9C0\uB418\uC5C8\uC2B5\uB2C8\uB2E4.");
    this.name = "AuditCancelledError";
  }
};
function throwIfAborted(signal) {
  if (signal?.aborted) throw new AuditCancelledError();
}
function isAuditCancelled(error) {
  return error instanceof AuditCancelledError;
}
async function runAudit(config, eventBus = new AuditEventBus(), options = {}) {
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
  let status = "completed";
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
    throwIfAborted(options.signal);
    webServer = await startConfiguredWebServer(config);
    for (const browserName of config.browsers) {
      throwIfAborted(options.signal);
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
      const closeBrowserOnAbort = () => {
        void browser.close().catch(() => void 0);
      };
      options.signal?.addEventListener("abort", closeBrowserOnAbort, { once: true });
      try {
        for (const [profileName, profile] of Object.entries(config.profiles)) {
          throwIfAborted(options.signal);
          const contextOptions = {};
          if (profile.storageState) contextOptions.storageState = path6.resolve(profile.storageState);
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
              throwIfAborted(options.signal);
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
              throwIfAborted(options.signal);
              for (const link of routeResult.discoveredLinks) {
                if (!seen.has(link) && seen.size + queue.length < config.crawl.maxPages) {
                  queue.push({ url: link, depth: item.depth + 1 });
                }
              }
            }
          } finally {
            await context.close().catch(() => void 0);
          }
        }
      } finally {
        options.signal?.removeEventListener("abort", closeBrowserOnAbort);
        await browser.close().catch(() => void 0);
      }
    }
    throwIfAborted(options.signal);
    await auditApis(runId, config, eventBus, options.signal);
    throwIfAborted(options.signal);
  } catch (error) {
    if (!isAuditCancelled(error) && !options.signal?.aborted) throw error;
    status = "cancelled";
  } finally {
    unsubscribe();
    await webServer?.close();
  }
  const summary = createSummary({ runId, baseURL: config.baseURL, startedAt, results, discoveredRoutes, status });
  store.saveSummary(summary);
  writeHtmlReport(store.runDir, summary, results);
  const finishEvent = status === "cancelled" ? { type: "run.cancelled", runId, summary } : { type: "run.finished", runId, summary };
  store.appendEvent(finishEvent);
  eventBus.publish(finishEvent);
  return { summary, runDir: store.runDir, eventBus };
}

// src/dashboard/controlServer.ts
var emptySummary = (baseURL) => ({
  runId: "ready",
  baseURL,
  status: "ready",
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
function escapeHtml3(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function profileFilename2(profile) {
  return profile.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "member";
}
function authPathFor(profile) {
  return path7.resolve(".site-check-pro/auth", `${profileFilename2(profile)}.json`);
}
function authStorageStateFor(profile) {
  return path7.relative(process.cwd(), authPathFor(profile));
}
function listProfiles(config) {
  const profiles = /* @__PURE__ */ new Set(["guest", "member", ...Object.keys(config.profiles)]);
  const authDir = path7.resolve(".site-check-pro/auth");
  if (fs4.existsSync(authDir)) {
    for (const file of fs4.readdirSync(authDir)) {
      if (file.endsWith(".json") && !file.endsWith(".profile.json")) {
        profiles.add(path7.basename(file, ".json"));
      }
    }
  }
  return [...profiles];
}
function authExists(profile) {
  return profile === "guest" || fs4.existsSync(authPathFor(profile));
}
function selectedConfig(input) {
  const profiles = input.profiles.reduce((acc, profile) => {
    const baseProfile = input.config.profiles[profile] ?? {};
    acc[profile] = profile === "guest" ? { ...baseProfile, storageState: void 0 } : {
      ...baseProfile,
      storageState: baseProfile.storageState ?? authStorageStateFor(profile),
      seeds: baseProfile.seeds ?? ["/"]
    };
    return acc;
  }, {});
  return {
    ...input.config,
    ...input.headed ? { headless: false } : {},
    browsers: input.browsers?.length ? input.browsers : input.config.browsers,
    profiles,
    dashboard: {
      ...input.config.dashboard,
      enabled: false,
      open: false
    }
  };
}
function liveSummary(input) {
  const failed = input.results.filter((result) => result.status === "failed");
  const affected = new Set(
    input.results.filter((result) => result.status === "failed" && result.browser !== "node" && result.category !== "browser" && result.category !== "authentication").map((result) => `${result.browser}:${result.profile}:${result.route}`)
  );
  const countBy = (key) => failed.reduce((acc, result) => {
    const value = String(result[key]);
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
  const startedAtMs = Date.parse(input.startedAt);
  return {
    runId: input.runId,
    baseURL: input.baseURL,
    status: "running",
    startedAt: input.startedAt,
    finishedAt: "",
    durationMs: Number.isNaN(startedAtMs) ? 0 : Date.now() - startedAtMs,
    discoveredRoutes: input.discoveredRoutes.size,
    routeInstances: input.routeInstances.size,
    completedChecks: input.results.length,
    passedChecks: input.results.filter((result) => result.status === "passed").length,
    warningChecks: input.results.filter((result) => result.status === "warning").length,
    failedChecks: failed.length,
    affectedRoutes: affected.size,
    affectedRouteRate: input.routeInstances.size === 0 ? 0 : Number((affected.size / input.routeInstances.size * 100).toFixed(2)),
    checkFailureRate: input.results.length === 0 ? 0 : Number((failed.length / input.results.length * 100).toFixed(2)),
    byCategory: countBy("category"),
    byBrowser: countBy("browser"),
    byProfile: countBy("profile")
  };
}
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}
function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}
function formatKst2(value) {
  if (!value) return "-";
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
function runDirectory(outputDir, runId) {
  const root = path7.resolve(outputDir);
  const candidate = path7.resolve(root, runId);
  const relative = path7.relative(root, candidate);
  if (relative.startsWith("..") || path7.isAbsolute(relative)) return void 0;
  return candidate;
}
function listSavedRuns(outputDir) {
  const root = path7.resolve(outputDir);
  if (!fs4.existsSync(root)) return [];
  return fs4.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => {
    const runId = entry.name;
    const summaryPath = path7.join(root, runId, "summary.json");
    if (!fs4.existsSync(summaryPath)) return { runId };
    try {
      const summary = JSON.parse(fs4.readFileSync(summaryPath, "utf8"));
      return {
        runId,
        baseURL: summary.baseURL,
        startedAt: summary.startedAt,
        startedAtKst: formatKst2(summary.startedAt),
        finishedAt: summary.finishedAt,
        finishedAtKst: formatKst2(summary.finishedAt),
        completedChecks: summary.completedChecks,
        failedChecks: summary.failedChecks
      };
    } catch {
      return { runId };
    }
  }).sort((a, b) => String(b.startedAt ?? b.runId).localeCompare(String(a.startedAt ?? a.runId)));
}
function readSavedRun(outputDir, runId) {
  const runDir = runDirectory(outputDir, runId);
  if (!runDir) throw new Error("\uC798\uBABB\uB41C \uC2E4\uD589 \uACB0\uACFC \uACBD\uB85C\uC785\uB2C8\uB2E4.");
  const summaryPath = path7.join(runDir, "summary.json");
  const resultPath = path7.join(runDir, "result.json");
  if (!fs4.existsSync(summaryPath) || !fs4.existsSync(resultPath)) {
    throw new Error("\uC2E4\uD589 \uACB0\uACFC \uD30C\uC77C\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.");
  }
  return {
    summary: (() => {
      const summary = JSON.parse(fs4.readFileSync(summaryPath, "utf8"));
      return {
        ...summary,
        startedAtKst: formatKst2(summary.startedAt),
        finishedAtKst: formatKst2(summary.finishedAt)
      };
    })(),
    results: JSON.parse(fs4.readFileSync(resultPath, "utf8")).map((result) => ({
      ...result,
      startedAtKst: formatKst2(result.startedAt),
      finishedAtKst: formatKst2(result.finishedAt)
    }))
  };
}
function renderControlHtml(input) {
  const profileControls = input.profiles.map(
    (profile) => `<label class="check"><input type="checkbox" name="profile" value="${escapeHtml3(profile)}" ${profile === "guest" ? "checked" : ""}> <span>${escapeHtml3(profile)}</span></label>`
  ).join("");
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Site Check Pro</title>
<style>
:root{font-family:Inter,Pretendard,system-ui,sans-serif;color:#1f2937;background:#f6f7f9}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}.shell{width:min(920px,100%);background:#fff;border:1px solid #d9dee7;border-radius:8px;box-shadow:0 18px 48px #20304014;padding:28px}.eyebrow{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#2563eb;font-weight:900}h1{margin:8px 0 10px;font-size:30px}.muted{color:#687385;line-height:1.55}.panel{display:grid;gap:18px;margin-top:24px}.field{display:grid;gap:10px}.field>label{font-weight:850}.checks{display:flex;gap:10px;flex-wrap:wrap}.check{height:44px;display:inline-flex;align-items:center;gap:8px;border:1px solid #cfd6e2;border-radius:8px;padding:0 13px;background:#fff;font-weight:850}.check input{width:16px;height:16px}.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:4px}button,a{height:42px;border-radius:8px;padding:0 14px;font-weight:850;text-decoration:none;display:inline-flex;align-items:center;border:1px solid #cfd6e2;cursor:pointer;background:#fff;color:#27364a}.primary{background:#2563eb;border-color:#2563eb;color:#fff}.danger{background:#fff0f0;border-color:#fecdca;color:#b42318}.danger:disabled{opacity:.6;cursor:not-allowed}.status{padding:13px 14px;border-radius:8px;background:#f8fafc;border:1px solid #e4e9f0}.status.warning{background:#fff7ed;color:#9a4d00}.status.error{background:#fff0f0;color:#b42318}.status.done{background:#eaf8f1;color:#067647}.meta{display:grid;grid-template-columns:140px 1fr;gap:10px 16px;margin-top:20px;padding:16px;background:#f8fafc;border:1px solid #e4e9f0;border-radius:8px}.meta dt{color:#687385}.meta dd{margin:0;word-break:break-all;font-weight:750}.modal{position:fixed;inset:0;background:#151a23b8;display:none;align-items:center;justify-content:center;padding:24px}.modal.open{display:flex}.dialog{width:min(1040px,100%);max-height:88vh;overflow:hidden;background:#fff;border-radius:8px;display:grid;grid-template-rows:auto 1fr}.dialog-head{padding:18px 22px;border-bottom:1px solid #e7ebf1;display:flex;justify-content:space-between;align-items:center}.dialog-body{display:grid;grid-template-columns:330px 1fr;min-height:520px;overflow:hidden}.run-list{border-right:1px solid #e7ebf1;overflow:auto;padding:12px}.run-button{height:auto;width:100%;display:block;text-align:left;margin-bottom:8px;padding:12px;line-height:1.45}.run-detail{overflow:auto;padding:18px}.summary-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:12px 0}.summary-grid div{border:1px solid #e7ebf1;border-radius:8px;padding:10px}.summary-grid b{display:block;font-size:22px;margin-top:4px}.result-table{width:100%;border-collapse:collapse;font-size:12px}.result-table th,.result-table td{padding:9px;border-bottom:1px solid #e7ebf1;text-align:left;vertical-align:top}.result-table th{background:#f8fafc}.failed{color:#b42318}.passed{color:#067647}.warning-text{color:#9a4d00}@media(max-width:760px){.dialog-body{grid-template-columns:1fr}.run-list{border-right:0;border-bottom:1px solid #e7ebf1;max-height:260px}.summary-grid{grid-template-columns:repeat(2,1fr)}}
</style>
</head>
<body>
<main class="shell">
  <div class="eyebrow">Site Check Pro Console</div>
  <h1>\uC0AC\uC774\uD2B8 \uC810\uAC80 \uCF58\uC194</h1>
  <p class="muted">\uC810\uAC80\uD560 \uD504\uB85C\uD544\uC744 \uCCB4\uD06C\uD55C \uB4A4 \uC2DC\uC791\uD558\uC138\uC694. guest\uB294 \uBE44\uB85C\uADF8\uC778, member\uB294 \uB85C\uADF8\uC778 \uC0C1\uD0DC\uAE4C\uC9C0 \uC810\uAC80\uD569\uB2C8\uB2E4.</p>
  <dl class="meta">
    <dt>\uB300\uC0C1 URL</dt><dd>${escapeHtml3(input.baseURL)}</dd>
    <dt>\uB300\uC2DC\uBCF4\uB4DC</dt><dd>http://127.0.0.1:${input.port}</dd>
  </dl>
  <section class="panel">
    <div class="field">
      <label>\uC810\uAC80 \uD504\uB85C\uD544</label>
      <div class="checks">${profileControls}</div>
    </div>
    <div id="runStatus" class="status">\uB300\uAE30 \uC911\uC785\uB2C8\uB2E4.</div>
    <div id="authStatus" class="status">\uB85C\uADF8\uC778 \uC815\uBCF4 \uC0C1\uD0DC\uB97C \uD655\uC778\uD558\uACE0 \uC788\uC2B5\uB2C8\uB2E4.</div>
    <div class="actions">
      <button id="saveAuth" type="button">\uB85C\uADF8\uC778 \uC815\uBCF4 \uC800\uC7A5</button>
      <button id="start" class="primary" type="button">\uC810\uAC80 \uC2DC\uC791</button>
      <button id="stop" class="danger" type="button" disabled>\uC810\uAC80 \uC911\uC9C0</button>
      <button id="currentReport" type="button">\uD604\uC7AC \uC810\uAC80 \uD655\uC778</button>
      <button id="history" type="button">\uC774\uC804 \uC810\uAC80 \uACB0\uACFC \uBCF4\uAE30</button>
    </div>
  </section>
</main>
<div id="historyModal" class="modal" role="dialog" aria-modal="true">
  <section class="dialog">
    <header class="dialog-head"><strong>\uC774\uC804 \uC810\uAC80 \uACB0\uACFC</strong><button id="closeHistory" type="button">\uB2EB\uAE30</button></header>
    <div class="dialog-body">
      <div id="runList" class="run-list"></div>
      <div id="runDetail" class="run-detail muted">\uC67C\uCABD\uC5D0\uC11C \uACB0\uACFC\uB97C \uC120\uD0DD\uD558\uC138\uC694.</div>
    </div>
  </section>
</div>
<script>
const authStatus=document.querySelector('#authStatus'),runStatus=document.querySelector('#runStatus'),startButton=document.querySelector('#start'),stopButton=document.querySelector('#stop'),currentReportButton=document.querySelector('#currentReport'),saveAuthButton=document.querySelector('#saveAuth'),historyButton=document.querySelector('#history'),historyModal=document.querySelector('#historyModal'),runList=document.querySelector('#runList'),runDetail=document.querySelector('#runDetail');
function selectedProfiles(){return [...document.querySelectorAll('input[name="profile"]:checked')].map(input=>input.value)}
function firstLoginProfile(){return selectedProfiles().find(profile=>profile!=='guest')||'member'}
function setBox(node,type,message){node.className='status '+(type||'');node.textContent=message}
async function refreshStatus(){const profiles=selectedProfiles();if(!profiles.length){setBox(authStatus,'error','\uD558\uB098 \uC774\uC0C1\uC758 \uD504\uB85C\uD544\uC744 \uC120\uD0DD\uD558\uC138\uC694.');return}const response=await fetch('/profile-status?profiles='+encodeURIComponent(profiles.join(',')),{cache:'no-store'});const data=await response.json();if(!data.missing.length){setBox(authStatus,'done','\uC120\uD0DD\uD55C \uD504\uB85C\uD544\uC744 \uC810\uAC80\uD560 \uC900\uBE44\uAC00 \uB418\uC5C8\uC2B5\uB2C8\uB2E4.');return}setBox(authStatus,'warning',data.missing.join(', ')+' \uB85C\uADF8\uC778 \uC815\uBCF4\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4. \uC810\uAC80 \uC2DC\uC791 \uC804\uC5D0 \uB85C\uADF8\uC778 \uC815\uBCF4 \uC800\uC7A5\uC744 \uC9C4\uD589\uD558\uC138\uC694.')}
async function refreshRunStatus(){const response=await fetch('/run-status',{cache:'no-store'});const data=await response.json();currentReportButton.disabled=!(data.running||data.finished||data.cancelled||data.hasReport);stopButton.disabled=!data.running;if(data.running){setBox(runStatus,'warning','\uC810\uAC80 \uC911\uC785\uB2C8\uB2E4. \uC644\uB8CC\uB420 \uB54C\uAE4C\uC9C0 \uC7A0\uC2DC \uAE30\uB2E4\uB824\uC8FC\uC138\uC694.');startButton.disabled=true;return}if(data.cancelled){setBox(runStatus,'warning','\uC810\uAC80\uC774 \uC911\uC9C0\uB418\uC5C8\uC2B5\uB2C8\uB2E4. \uD604\uC7AC\uAE4C\uC9C0 \uC800\uC7A5\uB41C \uACB0\uACFC\uB97C \uD655\uC778\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.');startButton.disabled=false;return}if(data.finished){setBox(runStatus,data.failedChecks>0?'warning':'done','\uC810\uAC80 \uC644\uB8CC: '+data.completedChecks+'\uAC1C \uCCB4\uD06C, \uC2E4\uD328 '+data.failedChecks+'\uAC1C');startButton.disabled=false;return}setBox(runStatus,'','\uB300\uAE30 \uC911\uC785\uB2C8\uB2E4.');startButton.disabled=false}
for(const input of document.querySelectorAll('input[name="profile"]'))input.addEventListener('change',refreshStatus);
saveAuthButton.addEventListener('click',async()=>{const profile=firstLoginProfile();setBox(authStatus,'warning',profile+' \uB85C\uADF8\uC778 \uC815\uBCF4 \uC800\uC7A5 \uD654\uBA74\uC744 \uC5EC\uB294 \uC911\uC785\uB2C8\uB2E4. \uC800\uC7A5\uC774 \uB05D\uB0A0 \uB54C\uAE4C\uC9C0 \uC774 \uCC3D\uC744 \uB2EB\uC9C0 \uB9C8\uC138\uC694.');saveAuthButton.disabled=true;try{const response=await fetch('/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({profile})});const data=await response.json();if(!response.ok)throw new Error(data.message||'\uB85C\uADF8\uC778 \uC815\uBCF4 \uC800\uC7A5 \uC2E4\uD328');setBox(authStatus,'done','\uB85C\uADF8\uC778 \uC815\uBCF4\uAC00 \uC800\uC7A5\uB418\uC5C8\uC2B5\uB2C8\uB2E4. \uC800\uC7A5 \uACBD\uB85C: '+data.authPath)}catch(error){setBox(authStatus,'error',error instanceof Error?error.message:String(error))}finally{saveAuthButton.disabled=false;refreshStatus()}});
startButton.addEventListener('click',async()=>{const profiles=selectedProfiles();setBox(runStatus,'warning','\uC810\uAC80\uC744 \uC2DC\uC791\uD558\uB294 \uC911\uC785\uB2C8\uB2E4.');startButton.disabled=true;try{const response=await fetch('/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({profiles})});const data=await response.json();if(!response.ok)throw new Error(data.message||'\uC810\uAC80 \uC2DC\uC791 \uC2E4\uD328');window.location.href='/report'}catch(error){setBox(runStatus,'error',error instanceof Error?error.message:String(error));startButton.disabled=false}});
stopButton.addEventListener('click',async()=>{if(stopButton.disabled)return;setBox(runStatus,'warning','\uC810\uAC80 \uC911\uC9C0\uB97C \uC694\uCCAD\uD588\uC2B5\uB2C8\uB2E4. \uD604\uC7AC \uC791\uC5C5\uC744 \uC815\uB9AC\uD558\uB294 \uC911\uC785\uB2C8\uB2E4.');stopButton.disabled=true;try{const response=await fetch('/stop',{method:'POST'});const data=await response.json();if(!response.ok)throw new Error(data.message||'\uC810\uAC80 \uC911\uC9C0 \uC2E4\uD328')}catch(error){setBox(runStatus,'error',error instanceof Error?error.message:String(error));refreshRunStatus()}});
currentReportButton.addEventListener('click',()=>{window.location.href='/report'});
function esc(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]))}
async function openHistory(){historyModal.classList.add('open');runList.textContent='\uBD88\uB7EC\uC624\uB294 \uC911\uC785\uB2C8\uB2E4.';runDetail.textContent='\uC67C\uCABD\uC5D0\uC11C \uACB0\uACFC\uB97C \uC120\uD0DD\uD558\uC138\uC694.';const runs=await fetch('/runs',{cache:'no-store'}).then(response=>response.json());if(!runs.length){runList.textContent='\uC800\uC7A5\uB41C \uACB0\uACFC\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.';return}runList.replaceChildren();for(const run of runs){const button=document.createElement('button');button.className='run-button';button.type='button';button.innerHTML='<strong>'+esc(run.runId)+'</strong><br><span class="muted">'+esc(run.startedAtKst||'-')+'</span><br><span>checks '+esc(run.completedChecks??'-')+' \xB7 failed '+esc(run.failedChecks??'-')+'</span>';button.addEventListener('click',()=>loadRun(run.runId));runList.appendChild(button)}}
async function loadRun(runId){runDetail.textContent='\uBD88\uB7EC\uC624\uB294 \uC911\uC785\uB2C8\uB2E4.';try{const data=await fetch('/runs/'+encodeURIComponent(runId),{cache:'no-store'}).then(response=>{if(!response.ok)throw new Error('\uACB0\uACFC\uB97C \uBD88\uB7EC\uC624\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.');return response.json()});const s=data.summary,rows=data.results.slice(0,80).map(r=>'<tr><td class="'+esc(r.status)+'">'+esc(r.status)+'</td><td>'+esc(r.profile)+'</td><td>'+esc(r.category)+'</td><td>'+esc(r.route)+'</td><td>'+esc(r.check)+'</td><td>'+esc(r.message||'')+'</td></tr>').join('');runDetail.innerHTML='<h3>'+esc(s.runId)+'</h3><p class="muted">'+esc(s.baseURL)+' \xB7 '+esc(s.startedAtKst||'-')+'</p><div class="summary-grid"><div><span>\uCCB4\uD06C</span><b>'+esc(s.completedChecks)+'</b></div><div><span>\uD1B5\uACFC</span><b>'+esc(s.passedChecks)+'</b></div><div><span>\uACBD\uACE0</span><b>'+esc(s.warningChecks)+'</b></div><div><span>\uC2E4\uD328</span><b>'+esc(s.failedChecks)+'</b></div></div><table class="result-table"><thead><tr><th>\uC0C1\uD0DC</th><th>\uD504\uB85C\uD544</th><th>\uBD84\uB958</th><th>\uACBD\uB85C</th><th>\uC810\uAC80</th><th>\uBA54\uC2DC\uC9C0</th></tr></thead><tbody>'+rows+'</tbody></table>'}catch(error){runDetail.textContent=error instanceof Error?error.message:String(error)}}
historyButton.addEventListener('click',openHistory);document.querySelector('#closeHistory').addEventListener('click',()=>historyModal.classList.remove('open'));historyModal.addEventListener('click',event=>{if(event.target===historyModal)historyModal.classList.remove('open')});
refreshStatus();refreshRunStatus();setInterval(refreshRunStatus,2000);
</script>
</body>
</html>`;
}
async function startControlDashboard(input) {
  const clients = /* @__PURE__ */ new Set();
  const results = [];
  const discoveredRoutes = /* @__PURE__ */ new Set();
  const routeInstances = /* @__PURE__ */ new Set();
  const eventBus = new AuditEventBus();
  let summary = emptySummary(input.config.baseURL);
  let runId = summary.runId;
  let startedAt = summary.startedAt;
  let currentRunDir;
  let currentAbortController;
  let running = false;
  let finished = false;
  let cancelled = false;
  const unsubscribe = eventBus.subscribe((event) => {
    if (event.type === "run.started") {
      results.length = 0;
      discoveredRoutes.clear();
      routeInstances.clear();
      runId = event.runId;
      startedAt = event.startedAt;
      currentRunDir = event.runDir;
      finished = false;
      cancelled = false;
      running = true;
    }
    if (event.type === "route.discovered") {
      discoveredRoutes.add(event.route);
      routeInstances.add(`${event.browser}:${event.profile}:${event.route}`);
    }
    if (event.type === "check.finished") results.push(event.result);
    if (event.type === "run.finished") {
      summary = event.summary;
      finished = true;
      cancelled = false;
      currentAbortController = void 0;
      running = false;
    }
    if (event.type === "run.cancelled") {
      summary = event.summary;
      finished = false;
      cancelled = true;
      currentAbortController = void 0;
      running = false;
    }
    for (const client of clients) {
      client.write(`event: ${event.type}
data: ${JSON.stringify(event)}

`);
    }
  });
  const server = http2.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    if (url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(renderControlHtml({
        baseURL: input.config.baseURL,
        profiles: listProfiles(input.config),
        port: input.port
      }));
      return;
    }
    if (url.pathname === "/profile-status") {
      const profiles = (url.searchParams.get("profiles") ?? "member").split(",").map((profile) => profileFilename2(profile)).filter(Boolean);
      const missing = profiles.filter((profile) => !authExists(profile));
      sendJson(res, 200, {
        profiles,
        missing,
        auth: profiles.reduce((acc, profile) => {
          acc[profile] = { authExists: authExists(profile), authPath: authStorageStateFor(profile) };
          return acc;
        }, {})
      });
      return;
    }
    if (url.pathname === "/run-status") {
      sendJson(res, 200, {
        running,
        finished,
        cancelled,
        hasReport: results.length > 0 || Boolean(currentRunDir),
        runId,
        runDir: currentRunDir,
        completedChecks: summary.completedChecks,
        failedChecks: summary.failedChecks
      });
      return;
    }
    if (url.pathname === "/runs") {
      sendJson(res, 200, listSavedRuns(input.config.outputDir));
      return;
    }
    if (url.pathname.startsWith("/runs/")) {
      try {
        const runId2 = decodeURIComponent(url.pathname.slice("/runs/".length));
        sendJson(res, 200, readSavedRun(input.config.outputDir, runId2));
      } catch (error) {
        sendJson(res, 404, {
          success: false,
          message: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }
    if (url.pathname === "/auth" && req.method === "POST") {
      void readJsonBody(req).then(async (body) => {
        const profile = profileFilename2(body.profile ?? "member");
        const saved = await captureAuth(input.config, profile);
        sendJson(res, 200, saved);
      }).catch((error) => sendJson(res, 500, {
        success: false,
        message: error instanceof Error ? error.message : String(error)
      }));
      return;
    }
    if (url.pathname === "/start" && req.method === "POST") {
      void readJsonBody(req).then((body) => {
        if (running) {
          sendJson(res, 409, { success: false, message: "\uC774\uBBF8 \uC0AC\uC774\uD2B8 \uC810\uAC80\uC774 \uC2E4\uD589 \uC911\uC785\uB2C8\uB2E4." });
          return;
        }
        const profiles = (body.profiles?.length ? body.profiles : [body.profile ?? "member"]).map((profile) => profileFilename2(profile)).filter(Boolean);
        if (profiles.length === 0) {
          sendJson(res, 400, { success: false, message: "\uD558\uB098 \uC774\uC0C1\uC758 \uD504\uB85C\uD544\uC744 \uC120\uD0DD\uD558\uC138\uC694." });
          return;
        }
        const missing = profiles.filter((profile) => !authExists(profile));
        if (missing.length > 0) {
          sendJson(res, 400, {
            success: false,
            message: `${missing.join(", ")} \uB85C\uADF8\uC778 \uC815\uBCF4\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4. \uBA3C\uC800 \uB85C\uADF8\uC778 \uC815\uBCF4 \uC800\uC7A5\uC744 \uC9C4\uD589\uD558\uC138\uC694.`
          });
          return;
        }
        const runConfig = selectedConfig({
          config: input.config,
          profiles,
          browsers: input.browsers,
          headed: input.headed
        });
        const controller = new AbortController();
        currentAbortController = controller;
        running = true;
        finished = false;
        cancelled = false;
        void runAudit(runConfig, eventBus, { signal: controller.signal }).catch((error) => {
          running = false;
          currentAbortController = void 0;
          for (const client of clients) {
            client.write(`event: run.error
data: ${JSON.stringify({
              message: error instanceof Error ? error.message : String(error)
            })}

`);
          }
        });
        sendJson(res, 202, { success: true, profiles });
      }).catch((error) => sendJson(res, 500, {
        success: false,
        message: error instanceof Error ? error.message : String(error)
      }));
      return;
    }
    if (url.pathname === "/stop" && req.method === "POST") {
      if (!running || !currentAbortController) {
        sendJson(res, 409, { success: false, message: "\uC2E4\uD589 \uC911\uC778 \uC810\uAC80\uC774 \uC5C6\uC2B5\uB2C8\uB2E4." });
        return;
      }
      currentAbortController.abort();
      sendJson(res, 202, { success: true, message: "\uC810\uAC80 \uC911\uC9C0\uB97C \uC694\uCCAD\uD588\uC2B5\uB2C8\uB2E4." });
      return;
    }
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
    if (url.pathname === "/report") {
      const currentSummary = finished || cancelled ? summary : liveSummary({
        baseURL: input.config.baseURL,
        runId,
        startedAt,
        results,
        discoveredRoutes,
        routeInstances
      });
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(renderReportHtml(currentSummary, results, true, {
        discoveredRoutes: [...discoveredRoutes],
        routeInstances: [...routeInstances]
      }));
      return;
    }
    if (currentRunDir && ["/summary.json", "/result.json"].includes(url.pathname)) {
      const candidate = path7.join(currentRunDir, url.pathname.slice(1));
      if (fs4.existsSync(candidate)) {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        fs4.createReadStream(candidate).pipe(res);
        return;
      }
    }
    if (currentRunDir && url.pathname.startsWith("/artifacts/")) {
      const candidate = path7.resolve(currentRunDir, `.${url.pathname}`);
      const relative = path7.relative(path7.resolve(currentRunDir), candidate);
      if (!relative.startsWith("..") && !path7.isAbsolute(relative) && fs4.existsSync(candidate)) {
        const extension = path7.extname(candidate).toLowerCase();
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
        fs4.createReadStream(candidate).pipe(res);
        return;
      }
    }
    res.writeHead(404).end("Not found");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(input.port, "127.0.0.1", resolve);
  });
  return {
    url: `http://127.0.0.1:${input.port}`,
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
import fs5 from "fs";
import path8 from "path";
function initProject(baseURL, packageName, browsers = ["chromium"]) {
  const configPath = path8.resolve("site-check-pro.config.ts");
  if (fs5.existsSync(configPath)) throw new Error("site-check-pro.config.ts already exists");
  const browserConfig = browsers.length > 0 ? browsers : ["chromium"];
  const content = `import { defineConfig } from '${packageName}';

export default defineConfig({
  baseURL: '${baseURL}',
  browsers: ${JSON.stringify(browserConfig)},
  // webServer: { command: 'npm run dev', url: '${baseURL}', reuseExisting: true },
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
  fs5.writeFileSync(configPath, content, "utf8");
  const gitignore = path8.resolve(".gitignore");
  const line = "\n# Site Check Pro auth and reports\n.site-check-pro/\n";
  if (!fs5.existsSync(gitignore) || !fs5.readFileSync(gitignore, "utf8").includes(".site-check-pro/")) {
    fs5.appendFileSync(gitignore, line, "utf8");
  }
  return configPath;
}

// src/cli/report.ts
import fs6 from "fs";
import path9 from "path";
import { pathToFileURL as pathToFileURL2 } from "url";
function resolveReportPath(outputDir, runDir) {
  const resolvedRunDir = runDir ? path9.resolve(runDir) : findLatestRun(path9.resolve(outputDir));
  const reportPath = path9.join(resolvedRunDir, "index.html");
  if (!fs6.existsSync(reportPath)) throw new Error(`Report not found: ${reportPath}`);
  return pathToFileURL2(reportPath).toString();
}
function findLatestRun(outputDir) {
  if (!fs6.existsSync(outputDir)) throw new Error(`Output directory not found: ${outputDir}`);
  const directories = fs6.readdirSync(outputDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort((a, b) => b.localeCompare(a));
  if (directories.length === 0) throw new Error(`No Site Check Pro runs found in ${outputDir}`);
  return path9.join(outputDir, directories[0]);
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
import readline from "readline/promises";
import { stdin, stdout } from "process";
function isInteractiveTerminal() {
  return Boolean(stdin.isTTY && stdout.isTTY && !process.env.CI);
}
async function ask(question) {
  const rl = readline.createInterface({ input: stdin, output: stdout });
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
  console.log(`Next: ${pc.cyan("npx site-check-pro run")}`);
});
program.command("run").argument("[url]", "override base URL").option("-c, --config <path>", "config file", "site-check-pro.config.ts").option("--headed", "show browser windows").option("--browser <names>", "comma-separated chromium,firefox,webkit").option("-y, --yes", "install missing configured browsers without confirmation").action(async (url, options) => {
  const loaded = await loadConfig(options.config);
  const browsers = options.browser ? parseBrowserNames(options.browser) : loaded.browsers;
  const config = resolveConfig({
    ...loaded,
    ...url ? { baseURL: url } : {},
    ...options.headed ? { headless: false } : {},
    browsers
  });
  await ensureBrowsers(config.browsers, { assumeYes: Boolean(options.yes) });
  const dashboard = await startControlDashboard({
    port: config.dashboard.port,
    config,
    browsers,
    headed: Boolean(options.headed)
  });
  console.log(pc.cyan(`Site Check Pro: ${dashboard.url}`));
  if (config.dashboard.open) openBrowser(dashboard.url);
  await new Promise((resolve) => {
    const close = () => {
      void dashboard.close().finally(resolve);
    };
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
  });
});
program.command("auth").description("capture an authenticated browser state").argument("[profile]", "profile name, e.g. member or admin", "member").option("-c, --config <path>", "config file", "site-check-pro.config.ts").option("--url <url>", "login URL").option("-y, --yes", "install Chromium without confirmation when missing").action(async (profile, options) => {
  await ensureBrowsers(["chromium"], { assumeYes: Boolean(options.yes) });
  const config = await loadConfig(options.config);
  const saved = await captureAuth(config, profile, options.url);
  console.log(pc.green(`Saved auth state: ${saved.authPath}`));
  console.log(pc.cyan(`Profile manifest: ${saved.manifestPath}`));
  console.log(`Config profile: ${pc.cyan(`${saved.profile}: { storageState: '${saved.configStorageState}', seeds: ['/'] }`)}`);
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