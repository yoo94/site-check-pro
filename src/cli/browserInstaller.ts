import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { chromium, firefox, webkit } from 'playwright';
import type { BrowserName } from '../types.js';

export const ALL_BROWSERS: BrowserName[] = ['chromium', 'firefox', 'webkit'];

const browserTypes = {
  chromium,
  firefox,
  webkit,
};

export function isSupportedBrowser(value: string): value is BrowserName {
  return ALL_BROWSERS.includes(value as BrowserName);
}

export function parseBrowserNames(value: string): BrowserName[] {
  const names = value
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  const invalid = names.filter((name) => !isSupportedBrowser(name));
  if (invalid.length > 0) {
    throw new Error(
      `지원하지 않는 브라우저: ${invalid.join(', ')}. ` +
      `사용 가능: ${ALL_BROWSERS.join(', ')}`,
    );
  }

  return [...new Set(names)] as BrowserName[];
}

export function getMissingBrowsers(browsers: BrowserName[]): BrowserName[] {
  return browsers.filter((browserName) => {
    try {
      return !fs.existsSync(browserTypes[browserName].executablePath());
    } catch {
      return true;
    }
  });
}

function resolvePlaywrightCli(): string {
  const require = createRequire(import.meta.url);
  const packagePath = require.resolve('playwright/package.json');
  return path.join(path.dirname(packagePath), 'cli.js');
}

export async function installBrowsers(
  browsers: BrowserName[],
  options: { withDeps?: boolean } = {},
): Promise<void> {
  const uniqueBrowsers = [...new Set(browsers)];
  if (uniqueBrowsers.length === 0) return;

  const args = [
    resolvePlaywrightCli(),
    'install',
    ...(options.withDeps ? ['--with-deps'] : []),
    ...uniqueBrowsers,
  ];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      stdio: 'inherit',
      env: process.env,
    });

    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(
        `Playwright 브라우저 설치 실패 ` +
        `(code=${code ?? 'null'}, signal=${signal ?? 'none'})`,
      ));
    });
  });
}
