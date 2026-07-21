import { EventEmitter } from 'node:events';

type BrowserName = 'chromium' | 'firefox' | 'webkit';
type CheckStatus = 'passed' | 'failed' | 'warning' | 'skipped';
type Severity = 'critical' | 'high' | 'medium' | 'low';
type CheckCategory = 'browser' | 'authentication' | 'navigation' | 'render' | 'console' | 'network' | 'reload' | 'history' | 'api';
interface AuthProfileConfig {
    storageState?: string;
    seeds?: string[];
}
interface ApiCheckConfig {
    name: string;
    url: string;
    method?: 'GET' | 'HEAD' | 'POST';
    headers?: Record<string, string>;
    body?: string;
    expectedStatus?: number[];
    timeoutMs?: number;
}
interface WebServerConfig {
    command: string;
    url?: string;
    cwd?: string;
    timeoutMs?: number;
    reuseExisting?: boolean;
    env?: Record<string, string>;
}
interface SiteCheckProConfig {
    baseURL: string;
    browsers?: BrowserName[];
    headless?: boolean;
    browserLaunchOptions?: Partial<Record<BrowserName, {
        executablePath?: string;
        args?: string[];
    }>>;
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
interface ResolvedSiteCheckProConfig {
    baseURL: string;
    browsers: BrowserName[];
    headless: boolean;
    browserLaunchOptions: Partial<Record<BrowserName, {
        executablePath?: string;
        args?: string[];
    }>>;
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
interface CheckResult {
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
interface RunSummary {
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
type AuditEvent = {
    type: 'run.started';
    runId: string;
    runDir: string;
    baseURL: string;
    startedAt: string;
} | {
    type: 'route.discovered';
    runId: string;
    route: string;
    browser: BrowserName;
    profile: string;
    depth: number;
} | {
    type: 'check.started';
    runId: string;
    route: string;
    browser: BrowserName | 'node';
    profile: string;
    check: string;
} | {
    type: 'check.finished';
    runId: string;
    result: CheckResult;
} | {
    type: 'run.finished';
    runId: string;
    summary: RunSummary;
};

declare function defineConfig(config: SiteCheckProConfig): SiteCheckProConfig;
declare function resolveConfig(config: SiteCheckProConfig): ResolvedSiteCheckProConfig;
declare function loadConfig(configPath?: string): Promise<ResolvedSiteCheckProConfig>;

declare class AuditEventBus extends EventEmitter {
    publish(event: AuditEvent): void;
    subscribe(listener: (event: AuditEvent) => void): () => void;
}

interface RunResult {
    summary: RunSummary;
    runDir: string;
    eventBus: AuditEventBus;
}
declare function runAudit(config: ResolvedSiteCheckProConfig, eventBus?: AuditEventBus): Promise<RunResult>;

export { type ApiCheckConfig, type AuditEvent, AuditEventBus, type AuthProfileConfig, type BrowserName, type CheckResult, type ResolvedSiteCheckProConfig, type RunSummary, type SiteCheckProConfig, type WebServerConfig, defineConfig, loadConfig, resolveConfig, runAudit };
