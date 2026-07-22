import fs from 'node:fs';
import path from 'node:path';
import type { BrowserName } from '../types.js';

export function initProject(
  baseURL: string,
  packageName: string,
  browsers: BrowserName[] = ['chromium'],
): string {
  const configPath = path.resolve('site-check-pro.config.ts');
  if (fs.existsSync(configPath)) throw new Error('site-check-pro.config.ts already exists');

  const browserConfig = browsers.length > 0 ? browsers : ['chromium'];
  const content = `import { defineConfig } from '${packageName}';\n\nexport default defineConfig({\n  baseURL: '${baseURL}',\n  browsers: ${JSON.stringify(browserConfig)},\n  // webServer: { command: 'npm run dev', url: '${baseURL}', reuseExisting: true },\n  crawl: {\n    maxPages: 100,\n    maxDepth: 5,\n    exclude: ['/logout', '/delete/**', '/payment/**'],\n    linkAttributes: ['href', 'data-href', 'data-route', 'data-url'],\n  },\n  checks: {\n    reload: true,\n    history: true,\n  },\n  dashboard: { enabled: false, port: 4177, open: true },\n});\n`;

  fs.writeFileSync(configPath, content, 'utf8');
  const gitignore = path.resolve('.gitignore');
  const line = '\n# Site Check Pro auth and reports\n.site-check-pro/\n';
  if (!fs.existsSync(gitignore) || !fs.readFileSync(gitignore, 'utf8').includes('.site-check-pro/')) {
    fs.appendFileSync(gitignore, line, 'utf8');
  }
  return configPath;
}
