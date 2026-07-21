import fs from 'node:fs';
import path from 'node:path';
import type { AuditEvent, CheckResult, RunSummary } from '../types.js';

export class JsonlStore {
  readonly runDir: string;
  readonly artifactsDir: string;
  private readonly eventFile: string;
  private readonly results: CheckResult[] = [];

  constructor(outputDir: string, runId: string) {
    this.runDir = path.resolve(outputDir, runId);
    this.artifactsDir = path.join(this.runDir, 'artifacts');
    this.eventFile = path.join(this.runDir, 'events.jsonl');
    fs.mkdirSync(this.artifactsDir, { recursive: true });
  }

  appendEvent(event: AuditEvent): void {
    fs.appendFileSync(this.eventFile, `${JSON.stringify(event)}\n`, 'utf8');
    if (event.type === 'check.finished') this.results.push(event.result);
  }

  getResults(): CheckResult[] {
    return [...this.results];
  }

  saveSummary(summary: RunSummary): void {
    fs.writeFileSync(path.join(this.runDir, 'summary.json'), JSON.stringify(summary, null, 2));
    fs.writeFileSync(path.join(this.runDir, 'result.json'), JSON.stringify(this.results, null, 2));
  }
}
