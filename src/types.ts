export type BrowserName = 'chromium' | 'firefox' | 'webkit';
export type CheckStatus = 'passed' | 'failed' | 'warning' | 'skipped';
export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type CheckCategory =
  | 'browser'
  | 'authentication'
  | 'navigation'
  | 'render'
  | 'console'
  | 'network'
  | 'reload'
  | 'history'
  | 'api';

export interface AuthProfileConfig {
  storageState?: string;
  seeds?: string[];
}

export interface ApiCheckConfig {
  name: string;
  url: string;
  method?: 'GET' | 'HEAD' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  expectedStatus?: number[];
  timeoutMs?: number;
}

export interface WebServerConfig {
  command: string;
  url?: string;
  cwd?: string;
  timeoutMs?: number;
  reuseExisting?: boolean;
  env?: Record<string, string>;
}

export interface SiteCheckProConfig {
  baseURL: string;
  browsers?: BrowserName[];
  headless?: boolean;
  browserLaunchOptions?: Partial<Record<BrowserName, { executablePath?: string; args?: string[] }>>;
  outputDir?: string;
  webServer?: WebServerConfig;
  profiles?: Record<string, AuthProfileConfig>;
  crawl?: {
    maxPages?: number;
    maxDepth?: number;
    sameOriginOnly?: boolean;
    include?: string[];
    exclude?: string[];
    selectors?: string[];
    linkAttributes?: string[];
    ignoreQueryParams?: string[];
    settleTimeMs?: number;
  };
  checks?: {
    reload?: boolean;
    history?: boolean;
    minVisibleTextLength?: number;
    failOnConsoleError?: boolean;
    failOnHttpStatus?: number;
    ignoreNetworkPatterns?: string[];
  };
  api?: ApiCheckConfig[];
  dashboard?: {
    enabled?: boolean;
    port?: number;
    open?: boolean;
  };
}

export interface ResolvedSiteCheckProConfig {
  baseURL: string;
  browsers: BrowserName[];
  headless: boolean;
  browserLaunchOptions: Partial<Record<BrowserName, { executablePath?: string; args?: string[] }>>;
  outputDir: string;
  webServer?: {
    command: string;
    url: string;
    cwd?: string;
    timeoutMs: number;
    reuseExisting: boolean;
    env?: Record<string, string>;
  };
  profiles: Record<string, AuthProfileConfig>;
  crawl: {
    maxPages: number;
    maxDepth: number;
    sameOriginOnly: boolean;
    include: string[];
    exclude: string[];
    selectors: string[];
    linkAttributes: string[];
    ignoreQueryParams: string[];
    settleTimeMs: number;
  };
  checks: {
    reload: boolean;
    history: boolean;
    minVisibleTextLength: number;
    failOnConsoleError: boolean;
    failOnHttpStatus: number;
    ignoreNetworkPatterns: string[];
  };
  api: ApiCheckConfig[];
  dashboard: {
    enabled: boolean;
    port: number;
    open: boolean;
  };
}

export interface CheckResult {
  id: string;
  runId: string;
  route: string;
  finalUrl: string;
  profile: string;
  browser: BrowserName | 'node';
  category: CheckCategory;
  check: string;
  status: CheckStatus;
  severity?: Severity;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  message?: string;
  details?: Record<string, unknown>;
  artifact?: string;
}

export interface RouteResult {
  route: string;
  finalUrl: string;
  browser: BrowserName;
  profile: string;
  depth: number;
  checks: CheckResult[];
  discoveredLinks: string[];
}

export interface RunSummary {
  runId: string;
  baseURL: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  discoveredRoutes: number;
  routeInstances: number;
  completedChecks: number;
  passedChecks: number;
  warningChecks: number;
  failedChecks: number;
  affectedRoutes: number;
  affectedRouteRate: number;
  checkFailureRate: number;
  byCategory: Record<string, number>;
  byBrowser: Record<string, number>;
  byProfile: Record<string, number>;
}

export type AuditEvent =
  | { type: 'run.started'; runId: string; runDir: string; baseURL: string; startedAt: string }
  | { type: 'route.discovered'; runId: string; route: string; browser: BrowserName; profile: string; depth: number }
  | { type: 'check.started'; runId: string; route: string; browser: BrowserName | 'node'; profile: string; check: string }
  | { type: 'check.finished'; runId: string; result: CheckResult }
  | { type: 'run.finished'; runId: string; summary: RunSummary };
