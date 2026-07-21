import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function resolveReportPath(outputDir: string, runDir?: string): string {
  const resolvedRunDir = runDir
    ? path.resolve(runDir)
    : findLatestRun(path.resolve(outputDir));
  const reportPath = path.join(resolvedRunDir, 'index.html');
  if (!fs.existsSync(reportPath)) throw new Error(`Report not found: ${reportPath}`);
  return pathToFileURL(reportPath).toString();
}

function findLatestRun(outputDir: string): string {
  if (!fs.existsSync(outputDir)) throw new Error(`Output directory not found: ${outputDir}`);
  const directories = fs.readdirSync(outputDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a));
  if (directories.length === 0) throw new Error(`No Site Check Pro runs found in ${outputDir}`);
  return path.join(outputDir, directories[0]);
}
