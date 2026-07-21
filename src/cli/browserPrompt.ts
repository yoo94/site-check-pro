import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import type { BrowserName } from '../types.js';
import { ALL_BROWSERS } from './browserInstaller.js';

export interface BrowserSelection {
  browsers: BrowserName[];
  installNow: boolean;
}

export function isInteractiveTerminal(): boolean {
  return Boolean(stdin.isTTY && stdout.isTTY && !process.env.CI);
}

async function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

export async function confirmPrompt(
  message: string,
  defaultValue = true,
): Promise<boolean> {
  const hint = defaultValue ? 'Y/n' : 'y/N';
  const answer = (await ask(`${message} (${hint}) `)).toLowerCase();
  if (!answer) return defaultValue;
  return answer === 'y' || answer === 'yes' || answer === '예';
}

function parseIndexes(value: string): BrowserName[] {
  const map: Record<string, BrowserName> = {
    '1': 'chromium',
    '2': 'firefox',
    '3': 'webkit',
  };

  const indexes = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const selected = indexes.map((index) => map[index]).filter(Boolean);
  return [...new Set(selected)];
}

export async function promptBrowserSelection(): Promise<BrowserSelection> {
  stdout.write(`\n설치할 브라우저를 선택하세요.\n`);
  stdout.write(`  1) Chromium만 설치 (Chrome 계열, 권장)\n`);
  stdout.write(`  2) 모든 브라우저 설치 (Chromium, Firefox, WebKit)\n`);
  stdout.write(`  3) 직접 선택\n`);
  stdout.write(`  4) 지금은 설치하지 않음\n\n`);

  const mode = (await ask('선택 [1]: ')) || '1';

  if (mode === '4') {
    return { browsers: ['chromium'], installNow: false };
  }

  let browsers: BrowserName[];
  if (mode === '2') {
    browsers = [...ALL_BROWSERS];
  } else if (mode === '3') {
    stdout.write(`  1) Chromium\n  2) Firefox\n  3) WebKit\n`);
    const custom = await ask('번호를 쉼표로 선택하세요 [1]: ');
    browsers = parseIndexes(custom || '1');
    if (browsers.length === 0) browsers = ['chromium'];
  } else {
    browsers = ['chromium'];
  }

  const installNow = await confirmPrompt(
    `${browsers.join(', ')} 브라우저를 지금 다운로드할까요?`,
    true,
  );

  return { browsers, installNow };
}

export async function promptInstallMissingBrowsers(
  browsers: BrowserName[],
): Promise<boolean> {
  return confirmPrompt(
    `설치되지 않은 브라우저(${browsers.join(', ')})를 지금 다운로드할까요?`,
    true,
  );
}
