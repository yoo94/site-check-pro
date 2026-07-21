import { randomUUID } from 'node:crypto';
import type { BrowserName, CheckCategory, CheckResult, CheckStatus, Severity } from '../types.js';

interface CheckInput {
  runId: string;
  route: string;
  finalUrl: string;
  profile: string;
  browser: BrowserName | 'node';
  category: CheckCategory;
  check: string;
  startedAt: number;
  status: CheckStatus;
  severity?: Severity;
  message?: string;
  details?: Record<string, unknown>;
  artifact?: string;
}

export function makeCheckResult(input: CheckInput): CheckResult {
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
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - input.startedAt,
    message: input.message,
    details: input.details,
    artifact: input.artifact,
  };
}
