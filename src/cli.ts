import pc from 'picocolors';
import { Command } from 'commander';
import { loadConfig, resolveConfig } from './config.js';
import { runAudit } from './core/runner.js';
import { AuditEventBus } from './core/eventBus.js';
import { startDashboard } from './dashboard/server.js';
import { openBrowser } from './cli/openBrowser.js';
import { initProject } from './cli/init.js';
import { resolveReportPath } from './cli/report.js';
import { captureAuth } from './auth/capture.js';
import { readPackageMeta } from './packageMeta.js';
import type { BrowserName } from './types.js';
import {
  ALL_BROWSERS,
  getMissingBrowsers,
  installBrowsers,
  isSupportedBrowser,
  parseBrowserNames,
} from './cli/browserInstaller.js';
import {
  isInteractiveTerminal,
  promptBrowserSelection,
  promptInstallMissingBrowsers,
} from './cli/browserPrompt.js';

const packageMeta = readPackageMeta();
const program = new Command();
program
  .name('site-check-pro')
  .description('Framework-agnostic website inspection powered by Playwright')
  .version(packageMeta.version);

async function ensureBrowsers(
  browsers: BrowserName[],
  options: { assumeYes?: boolean; withDeps?: boolean } = {},
): Promise<void> {
  const missing = getMissingBrowsers(browsers);
  if (missing.length === 0) return;

  console.log(pc.yellow(`설치되지 않은 브라우저: ${missing.join(', ')}`));

  let shouldInstall = Boolean(options.assumeYes);
  if (!shouldInstall && isInteractiveTerminal()) {
    shouldInstall = await promptInstallMissingBrowsers(missing);
  }

  if (shouldInstall) {
    await installBrowsers(missing, { withDeps: options.withDeps });
    console.log(pc.green(`Installed: ${missing.join(', ')}`));
    return;
  }

  console.log(
    `설치 명령: ${pc.cyan(`npx site-check-pro install-browsers ${missing.join(' ')}`)}`,
  );
}

program.command('init')
  .argument('[baseURL]', 'target URL', 'http://localhost:3000')
  .option('--browser <names>', 'comma-separated chromium,firefox,webkit')
  .option('--all-browsers', 'configure and install Chromium, Firefox, and WebKit')
  .option('--skip-browser-install', 'create config without downloading browser binaries')
  .option('-y, --yes', 'download selected browsers without confirmation')
  .action(async (baseURL, options) => {
    let browsers: BrowserName[] = ['chromium'];
    let installNow = false;
    let installConfirmed = false;
    const interactive = isInteractiveTerminal();

    if (options.allBrowsers) {
      browsers = [...ALL_BROWSERS];
      installNow = !options.skipBrowserInstall && (interactive || options.yes);
    } else if (options.browser) {
      browsers = parseBrowserNames(options.browser);
      if (browsers.length === 0) browsers = ['chromium'];
      installNow = !options.skipBrowserInstall && (interactive || options.yes);
    } else if (interactive) {
      const selection = await promptBrowserSelection();
      browsers = selection.browsers;
      installNow = selection.installNow && !options.skipBrowserInstall;
      installConfirmed = selection.installNow;
    }

    if (options.yes && !options.skipBrowserInstall) {
      installNow = true;
      installConfirmed = true;
    }

    const file = initProject(baseURL, packageMeta.name, browsers);
    console.log(pc.green(`Created ${file}`));

    if (installNow) {
      await ensureBrowsers(browsers, { assumeYes: installConfirmed });
    } else {
      console.log(pc.yellow('브라우저 다운로드를 건너뛰었습니다.'));
      console.log(
        `나중에 실행: ${pc.cyan(`npx site-check-pro install-browsers ${browsers.join(' ')}`)}`,
      );
    }

    console.log(`Next: ${pc.cyan('npx site-check-pro run --ui')}`);
  });

program.command('run')
  .argument('[url]', 'override base URL')
  .option('-c, --config <path>', 'config file', 'site-check-pro.config.ts')
  .option('--ui', 'enable live dashboard')
  .option('--headed', 'show browser windows')
  .option('--browser <names>', 'comma-separated chromium,firefox,webkit')
  .option('-y, --yes', 'install missing configured browsers without confirmation')
  .action(async (url, options) => {
    const loaded = await loadConfig(options.config);
    const browsers = options.browser
      ? parseBrowserNames(options.browser)
      : loaded.browsers;

    const config = resolveConfig({
      ...loaded,
      ...(url ? { baseURL: url } : {}),
      ...(options.headed ? { headless: false } : {}),
      browsers,
      dashboard: { ...loaded.dashboard, enabled: Boolean(options.ui) || loaded.dashboard.enabled },
    });

    await ensureBrowsers(config.browsers, { assumeYes: Boolean(options.yes) });

    const eventBus = new AuditEventBus();
    let runDir: string | undefined;
    let dashboard: Awaited<ReturnType<typeof startDashboard>> | undefined;
    if (config.dashboard.enabled) {
      dashboard = await startDashboard({
        port: config.dashboard.port,
        baseURL: config.baseURL,
        eventBus,
        getRunDir: () => runDir,
      });
      console.log(pc.cyan(`Live dashboard: ${dashboard.url}`));
      if (config.dashboard.open) openBrowser(dashboard.url);
    }

    try {
      const result = await runAudit(config, eventBus);
      runDir = result.runDir;
      console.log(pc.bold('\nSite Check Pro completed'));
      console.log(`Report: ${pc.cyan(`${result.runDir}/index.html`)}`);
      console.log(`Checks: ${result.summary.completedChecks}, failed: ${pc.red(String(result.summary.failedChecks))}, affected: ${result.summary.affectedRouteRate}%`);
      console.log(`Open later: ${pc.cyan(`npx site-check-pro report open "${result.runDir}"`)}`);
      process.exitCode = result.summary.failedChecks > 0 ? 1 : 0;
    } finally {
      if (dashboard) await dashboard.close();
    }
  });

program.command('auth')
  .description('capture an authenticated browser state')
  .argument('<profile>', 'profile name, e.g. member or admin')
  .option('-c, --config <path>', 'config file', 'site-check-pro.config.ts')
  .option('--url <url>', 'login URL')
  .option('-y, --yes', 'install Chromium without confirmation when missing')
  .action(async (profile, options) => {
    await ensureBrowsers(['chromium'], { assumeYes: Boolean(options.yes) });
    const config = await loadConfig(options.config);
    const saved = await captureAuth(config, profile, options.url);
    console.log(pc.green(`Saved auth state: ${saved}`));
  });

const report = program.command('report').description('open generated reports');
report.command('open')
  .argument('[runDir]', 'specific run directory; defaults to latest')
  .option('-c, --config <path>', 'config file', 'site-check-pro.config.ts')
  .action(async (runDir, options) => {
    const config = await loadConfig(options.config);
    const reportUrl = resolveReportPath(config.outputDir, runDir);
    console.log(pc.cyan(`Opening ${reportUrl}`));
    openBrowser(reportUrl);
  });

program.command('install-browsers')
  .description('install Playwright-managed browser binaries')
  .argument('[browsers...]', 'chromium, firefox, webkit')
  .option('--all', 'install Chromium, Firefox, and WebKit')
  .option('--with-deps', 'also install Linux system dependencies')
  .action(async (browserArguments: string[], options) => {
    let browsers: BrowserName[];

    if (options.all) {
      browsers = [...ALL_BROWSERS];
    } else if (browserArguments.length > 0) {
      const invalid = browserArguments.filter((browser) => !isSupportedBrowser(browser));
      if (invalid.length > 0) {
        throw new Error(
          `지원하지 않는 브라우저: ${invalid.join(', ')}. ` +
          `사용 가능: ${ALL_BROWSERS.join(', ')}`,
        );
      }
      browsers = [...new Set(browserArguments)] as BrowserName[];
    } else if (isInteractiveTerminal()) {
      const selection = await promptBrowserSelection();
      browsers = selection.browsers;
      if (!selection.installNow) {
        console.log(pc.yellow('브라우저 설치를 취소했습니다.'));
        return;
      }
    } else {
      browsers = ['chromium'];
    }

    await installBrowsers(browsers, { withDeps: Boolean(options.withDeps) });
    console.log(pc.green(`Installed: ${browsers.join(', ')}`));
  });

program.parseAsync().catch((error) => {
  console.error(pc.red(error instanceof Error ? error.stack ?? error.message : String(error)));
  process.exitCode = 1;
});
