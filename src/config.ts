import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createJiti } from 'jiti';
import { z } from 'zod';
import type { SiteCheckProConfig, ResolvedSiteCheckProConfig } from './types.js';

const configSchema = z.object({
  baseURL: z.string().url(),
  browsers: z.array(z.enum(['chromium', 'firefox', 'webkit'])).optional(),
  headless: z.boolean().optional(),
  browserLaunchOptions: z.partialRecord(z.enum(['chromium', 'firefox', 'webkit']), z.object({
    executablePath: z.string().optional(),
    args: z.array(z.string()).optional(),
  })).optional(),
  outputDir: z.string().optional(),
  webServer: z.object({
    command: z.string().min(1),
    url: z.string().url().optional(),
    cwd: z.string().optional(),
    timeoutMs: z.number().int().positive().optional(),
    reuseExisting: z.boolean().optional(),
    env: z.record(z.string(), z.string()).optional(),
  }).optional(),
  profiles: z.record(z.string(), z.object({
    storageState: z.string().optional(),
    seeds: z.array(z.string()).optional(),
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
    settleTimeMs: z.number().int().min(0).optional(),
  }).optional(),
  checks: z.object({
    reload: z.boolean().optional(),
    history: z.boolean().optional(),
    minVisibleTextLength: z.number().int().min(0).optional(),
    failOnConsoleError: z.boolean().optional(),
    failOnHttpStatus: z.number().int().min(100).max(599).optional(),
    ignoreNetworkPatterns: z.array(z.string()).optional(),
  }).optional(),
  api: z.array(z.object({
    name: z.string(),
    url: z.string().url(),
    method: z.enum(['GET', 'HEAD', 'POST']).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.string().optional(),
    expectedStatus: z.array(z.number().int()).optional(),
    timeoutMs: z.number().int().positive().optional(),
  })).optional(),
  dashboard: z.object({
    enabled: z.boolean().optional(),
    port: z.number().int().positive().optional(),
    open: z.boolean().optional(),
  }).optional(),
});

export function defineConfig(config: SiteCheckProConfig): SiteCheckProConfig {
  return config;
}

export function resolveConfig(config: SiteCheckProConfig): ResolvedSiteCheckProConfig {
  const parsed = configSchema.parse(config);
  return {
    baseURL: parsed.baseURL.replace(/\/$/, ''),
    browsers: parsed.browsers ?? ['chromium'],
    headless: parsed.headless ?? true,
    browserLaunchOptions: parsed.browserLaunchOptions ?? {},
    outputDir: parsed.outputDir ?? '.site-check-pro/runs',
    webServer: parsed.webServer ? {
      command: parsed.webServer.command,
      url: parsed.webServer.url ?? parsed.baseURL,
      cwd: parsed.webServer.cwd,
      timeoutMs: parsed.webServer.timeoutMs ?? 120_000,
      reuseExisting: parsed.webServer.reuseExisting ?? true,
      env: parsed.webServer.env,
    } : undefined,
    profiles: parsed.profiles ?? { guest: {} },
    crawl: {
      maxPages: parsed.crawl?.maxPages ?? 100,
      maxDepth: parsed.crawl?.maxDepth ?? 5,
      sameOriginOnly: parsed.crawl?.sameOriginOnly ?? true,
      include: parsed.crawl?.include ?? ['/**'],
      exclude: parsed.crawl?.exclude ?? [
        '/logout', '/signout', '/delete/**', '/remove/**', '/withdraw/**',
        '/payment/**', '/purchase/**', '/admin/delete/**',
      ],
      selectors: parsed.crawl?.selectors ?? ['a[href]', '[role="link"]'],
      linkAttributes: parsed.crawl?.linkAttributes ?? ['href', 'data-href', 'data-route', 'data-url'],
      ignoreQueryParams: parsed.crawl?.ignoreQueryParams ?? ['utm_source', 'utm_medium', 'utm_campaign'],
      settleTimeMs: parsed.crawl?.settleTimeMs ?? 300,
    },
    checks: {
      reload: parsed.checks?.reload ?? true,
      history: parsed.checks?.history ?? true,
      minVisibleTextLength: parsed.checks?.minVisibleTextLength ?? 1,
      failOnConsoleError: parsed.checks?.failOnConsoleError ?? true,
      failOnHttpStatus: parsed.checks?.failOnHttpStatus ?? 400,
      ignoreNetworkPatterns: parsed.checks?.ignoreNetworkPatterns ?? [],
    },
    api: parsed.api ?? [],
    dashboard: {
      enabled: parsed.dashboard?.enabled ?? false,
      port: parsed.dashboard?.port ?? 4177,
      open: parsed.dashboard?.open ?? true,
    },
  };
}

export async function loadConfig(configPath = 'site-check-pro.config.ts'): Promise<ResolvedSiteCheckProConfig> {
  const absolutePath = path.resolve(process.cwd(), configPath);
  const jiti = createJiti(pathToFileURL(import.meta.url).href, { interopDefault: true });
  const loaded = await jiti.import<SiteCheckProConfig>(absolutePath, { default: true });
  return resolveConfig(loaded);
}
