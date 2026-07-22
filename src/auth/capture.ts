import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';
import type { BrowserContext } from 'playwright';
import type { ResolvedSiteCheckProConfig } from '../types.js';

export interface AuthCaptureResult {
  profile: string;
  authPath: string;
  configStorageState: string;
  manifestPath: string;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function profileFilename(profile: string): string {
  const normalized = profile.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!normalized) throw new Error('프로필 이름은 영문, 숫자, ., _, - 중 하나를 포함해야 합니다.');
  return normalized;
}

async function createCaptureServer(input: {
  context: BrowserContext;
  authPath: string;
  configStorageState: string;
  manifestPath: string;
  profile: string;
  baseURL: string;
  loginURL: string;
}): Promise<{ url: string; done: Promise<AuthCaptureResult>; close: () => Promise<void> }> {
  let settled = false;
  let resolveDone!: (result: AuthCaptureResult) => void;
  let rejectDone!: (error: Error) => void;
  const done = new Promise<AuthCaptureResult>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });

  const finish = async (res: http.ServerResponse, action: 'save' | 'cancel') => {
    if (settled) {
      res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, message: '이미 처리되었습니다.' }));
      return;
    }
    settled = true;

    if (action === 'cancel') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, message: '취소되었습니다.' }));
      rejectDone(new Error('인증 상태 저장이 취소되었습니다.'));
      return;
    }

    try {
      await input.context.storageState({ path: input.authPath, indexedDB: true });
      const manifest = {
        profile: input.profile,
        storageState: input.configStorageState,
        baseURL: input.baseURL,
        loginURL: input.loginURL,
        createdAt: new Date().toISOString(),
        configSnippet: `${input.profile}: { storageState: '${input.configStorageState}', seeds: ['/'] }`,
      };
      fs.writeFileSync(input.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, authPath: input.authPath, manifestPath: input.manifestPath }));
      resolveDone({
        profile: input.profile,
        authPath: input.authPath,
        configStorageState: input.configStorageState,
        manifestPath: input.manifestPath,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, message }));
      rejectDone(new Error(message));
    }
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    if (url.pathname === '/save' && req.method === 'POST') {
      void finish(res, 'save');
      return;
    }
    if (url.pathname === '/cancel' && req.method === 'POST') {
      void finish(res, 'cancel');
      return;
    }
    if (url.pathname === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ settled }));
      return;
    }
    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(renderAuthCaptureHtml(input));
      return;
    }
    res.writeHead(404).end('Not found');
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('인증 캡처 서버를 시작하지 못했습니다.');

  return {
    url: `http://127.0.0.1:${address.port}`,
    done,
    close: async () => {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

function renderAuthCaptureHtml(input: {
  profile: string;
  authPath: string;
  configStorageState: string;
  loginURL: string;
  baseURL: string;
}): string {
  const configSnippet = `${input.profile}: { storageState: '${input.configStorageState}', seeds: ['/'] }`;
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Site Check Pro auth capture</title>
<style>
:root{font-family:Inter,Pretendard,system-ui,sans-serif;color:#1f2937;background:#f6f7f9}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}.shell{width:min(760px,100%);background:#fff;border:1px solid #d9dee7;border-radius:8px;box-shadow:0 16px 40px #20304014;padding:26px}.eyebrow{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#2563eb;font-weight:900}h1{margin:8px 0 12px;font-size:28px}.muted{color:#687385;line-height:1.55}.grid{display:grid;grid-template-columns:150px 1fr;gap:10px 16px;margin:22px 0;padding:16px;background:#f8fafc;border:1px solid #e4e9f0;border-radius:8px}dt{color:#687385}dd{margin:0;word-break:break-all;font-weight:750}.snippet{margin-top:16px}.snippet-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px}.snippet strong{font-size:14px}.snippet pre{margin:0;padding:14px;border-radius:8px;background:#171d29;color:#d6dde8;overflow:auto;white-space:pre-wrap}.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:20px}button,a{height:42px;border-radius:8px;padding:0 14px;font-weight:850;text-decoration:none;display:inline-flex;align-items:center;border:1px solid #cfd6e2;cursor:pointer;background:#fff;color:#27364a}.primary{background:#2563eb;border-color:#2563eb;color:#fff}.danger{color:#b42318}.small{height:34px;font-size:12px}.notice{margin-top:18px;padding:12px 14px;border-radius:8px;background:#fff7ed;color:#9a4d00}.done{background:#eaf8f1;color:#067647}.error{background:#fff0f0;color:#b42318}
</style>
</head>
<body>
<main class="shell">
  <div class="eyebrow">Site Check Pro Auth Capture</div>
  <h1>로그인 상태를 저장합니다</h1>
  <p class="muted">먼저 로그인 페이지를 열어 대상 서비스에 로그인하세요. 로그인이 끝나면 이 탭으로 돌아와 저장 버튼을 누르면 점검에 사용할 인증 JSON이 생성됩니다.</p>
  <dl class="grid">
    <dt>프로필</dt><dd>${escapeHtml(input.profile)}</dd>
    <dt>대상 URL</dt><dd>${escapeHtml(input.baseURL)}</dd>
    <dt>로그인 URL</dt><dd>${escapeHtml(input.loginURL)}</dd>
    <dt>저장 경로</dt><dd>${escapeHtml(input.authPath)}</dd>
    <dt>config 경로</dt><dd>${escapeHtml(input.configStorageState)}</dd>
  </dl>
  <section class="snippet">
    <div class="snippet-head">
      <strong>site-check-pro.config.ts에 넣을 profile 설정</strong>
      <button id="copySnippet" class="small" type="button">복사</button>
    </div>
    <pre id="configSnippet">${escapeHtml(configSnippet)}</pre>
  </section>
  <div class="actions">
    <a class="primary" href="${escapeHtml(input.loginURL)}" target="_blank" rel="noreferrer">로그인 페이지 열기</a>
    <button id="save" type="button">로그인 완료 후 저장하기</button>
    <button id="cancel" class="danger" type="button">취소</button>
  </div>
  <div id="message" class="notice">로그인 페이지를 열어 원하는 권한의 계정으로 로그인한 뒤, 이 탭으로 돌아와 저장하세요.</div>
</main>
<script>
const message=document.querySelector('#message');
async function send(action){for(const button of document.querySelectorAll('button'))button.disabled=true;message.className='notice';message.textContent=action==='save'?'저장 중입니다...':'취소 중입니다...';try{const response=await fetch('/'+action,{method:'POST'}),data=await response.json();if(!response.ok||!data.ok)throw new Error(data.message||'처리 실패');message.className=action==='save'?'notice done':'notice';message.textContent=action==='save'?'저장되었습니다. 이 창은 닫아도 됩니다.':'취소되었습니다.'}catch(error){message.className='notice error';message.textContent=error instanceof Error?error.message:String(error);for(const button of document.querySelectorAll('button'))button.disabled=false}}
document.querySelector('#save').addEventListener('click',()=>send('save'));
document.querySelector('#cancel').addEventListener('click',()=>send('cancel'));
document.querySelector('#copySnippet').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(document.querySelector('#configSnippet').textContent);message.className='notice done';message.textContent='profile 설정을 복사했습니다.'}catch{message.className='notice';message.textContent='복사가 막혀 있으면 코드 블록을 직접 선택해서 복사하세요.'}});
</script>
</body>
</html>`;
}

export async function captureAuth(config: ResolvedSiteCheckProConfig, profile: string, loginUrl?: string): Promise<AuthCaptureResult> {
  const profileName = profileFilename(profile);
  const authPath = path.resolve('.site-check-pro/auth', `${profileName}.json`);
  const configStorageState = path.relative(process.cwd(), authPath);
  const manifestPath = path.resolve('.site-check-pro/auth', `${profileName}.profile.json`);
  fs.mkdirSync(path.dirname(authPath), { recursive: true });
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const targetURL = loginUrl ? new URL(loginUrl, config.baseURL).toString() : config.baseURL;
  const captureServer = await createCaptureServer({
    context,
    authPath,
    configStorageState,
    manifestPath,
    profile: profileName,
    baseURL: config.baseURL,
    loginURL: targetURL,
  });

  try {
    const controlPage = await context.newPage();
    await controlPage.goto(captureServer.url);
    await controlPage.bringToFront();
    return await captureServer.done;
  } finally {
    await captureServer.close();
    await browser.close();
  }
}
