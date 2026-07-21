import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { chromium } from 'playwright';
import type { ResolvedSiteCheckProConfig } from '../types.js';

export async function captureAuth(config: ResolvedSiteCheckProConfig, profile: string, loginUrl?: string): Promise<string> {
  const authPath = path.resolve('.site-check-pro/auth', `${profile}.json`);
  fs.mkdirSync(path.dirname(authPath), { recursive: true });
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(loginUrl ? new URL(loginUrl, config.baseURL).toString() : config.baseURL);
  const rl = readline.createInterface({ input, output });
  await rl.question('브라우저에서 로그인을 완료한 뒤 Enter를 누르세요: ');
  rl.close();
  await context.storageState({ path: authPath, indexedDB: true });
  await browser.close();
  return authPath;
}
