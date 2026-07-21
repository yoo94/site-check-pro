import { spawn, type ChildProcess } from 'node:child_process';
import process from 'node:process';
import type { ResolvedSiteCheckProConfig } from '../types.js';

export interface StartedWebServer {
  reused: boolean;
  close: () => Promise<void>;
}

async function isReachable(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1_000);
  try {
    const response = await fetch(url, { method: 'GET', signal: controller.signal, redirect: 'manual' });
    return response.status > 0;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function terminateProcess(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null) return;

  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.once('exit', () => resolve());
      killer.once('error', () => resolve());
    });
    return;
  }

  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }

  await Promise.race([
    new Promise<void>((resolve) => child.once('exit', () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 3_000)),
  ]);

  if (child.exitCode === null) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
}

export async function startConfiguredWebServer(
  config: ResolvedSiteCheckProConfig,
): Promise<StartedWebServer | undefined> {
  if (!config.webServer) return undefined;

  const targetUrl = config.webServer.url;
  if (config.webServer.reuseExisting && await isReachable(targetUrl)) {
    return { reused: true, close: async () => undefined };
  }

  const child = spawn(config.webServer.command, {
    cwd: config.webServer.cwd,
    env: { ...process.env, ...config.webServer.env },
    shell: true,
    detached: process.platform !== 'win32',
    stdio: 'inherit',
    windowsHide: false,
  });

  const startedAt = Date.now();
  while (Date.now() - startedAt < config.webServer.timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`Web server command exited with code ${child.exitCode}: ${config.webServer.command}`);
    }
    if (await isReachable(targetUrl)) {
      return {
        reused: false,
        close: () => terminateProcess(child),
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  await terminateProcess(child);
  throw new Error(`Timed out after ${config.webServer.timeoutMs}ms waiting for ${targetUrl}`);
}
