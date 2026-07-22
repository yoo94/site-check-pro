import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { captureAuth } from '../auth/capture.js';
import { runAudit } from '../core/runner.js';
import { AuditEventBus } from '../core/eventBus.js';
import { renderReportHtml } from '../reporter/htmlReporter.js';
import type { AuditEvent, BrowserName, CheckResult, ResolvedSiteCheckProConfig, RunSummary } from '../types.js';

const emptySummary = (baseURL: string): RunSummary => ({
  runId: 'ready',
  baseURL,
  startedAt: new Date().toISOString(),
  finishedAt: '',
  durationMs: 0,
  discoveredRoutes: 0,
  routeInstances: 0,
  completedChecks: 0,
  passedChecks: 0,
  warningChecks: 0,
  failedChecks: 0,
  affectedRoutes: 0,
  affectedRouteRate: 0,
  checkFailureRate: 0,
  byCategory: {},
  byBrowser: {},
  byProfile: {},
});

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function profileFilename(profile: string): string {
  return profile.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'member';
}

function authPathFor(profile: string): string {
  return path.resolve('.site-check-pro/auth', `${profileFilename(profile)}.json`);
}

function authStorageStateFor(profile: string): string {
  return path.relative(process.cwd(), authPathFor(profile));
}

function listProfiles(config: ResolvedSiteCheckProConfig): string[] {
  const profiles = new Set(['guest', 'member', ...Object.keys(config.profiles)]);
  const authDir = path.resolve('.site-check-pro/auth');
  if (fs.existsSync(authDir)) {
    for (const file of fs.readdirSync(authDir)) {
      if (file.endsWith('.json') && !file.endsWith('.profile.json')) {
        profiles.add(path.basename(file, '.json'));
      }
    }
  }
  return [...profiles];
}

function authExists(profile: string): boolean {
  return profile === 'guest' || fs.existsSync(authPathFor(profile));
}

function selectedConfig(input: {
  config: ResolvedSiteCheckProConfig;
  profiles: string[];
  browsers?: BrowserName[];
  headed?: boolean;
}): ResolvedSiteCheckProConfig {
  const profiles = input.profiles.reduce<ResolvedSiteCheckProConfig['profiles']>((acc, profile) => {
    const baseProfile = input.config.profiles[profile] ?? {};
    acc[profile] = profile === 'guest'
      ? { ...baseProfile, storageState: undefined }
      : {
        ...baseProfile,
        storageState: baseProfile.storageState ?? authStorageStateFor(profile),
        seeds: baseProfile.seeds ?? ['/'],
      };
    return acc;
  }, {});

  return {
    ...input.config,
    ...(input.headed ? { headless: false } : {}),
    browsers: input.browsers?.length ? input.browsers : input.config.browsers,
    profiles,
    dashboard: {
      ...input.config.dashboard,
      enabled: false,
      open: false,
    },
  };
}

function liveSummary(input: {
  baseURL: string;
  runId: string;
  startedAt: string;
  results: CheckResult[];
  discoveredRoutes: Set<string>;
  routeInstances: Set<string>;
}): RunSummary {
  const failed = input.results.filter((result) => result.status === 'failed');
  const affected = new Set(
    input.results
      .filter((result) => result.status === 'failed' && result.browser !== 'node' && result.category !== 'browser' && result.category !== 'authentication')
      .map((result) => `${result.browser}:${result.profile}:${result.route}`),
  );
  const countBy = (key: 'category' | 'browser' | 'profile') =>
    failed.reduce<Record<string, number>>((acc, result) => {
      const value = String(result[key]);
      acc[value] = (acc[value] ?? 0) + 1;
      return acc;
    }, {});
  const startedAtMs = Date.parse(input.startedAt);
  return {
    runId: input.runId,
    baseURL: input.baseURL,
    startedAt: input.startedAt,
    finishedAt: '',
    durationMs: Number.isNaN(startedAtMs) ? 0 : Date.now() - startedAtMs,
    discoveredRoutes: input.discoveredRoutes.size,
    routeInstances: input.routeInstances.size,
    completedChecks: input.results.length,
    passedChecks: input.results.filter((result) => result.status === 'passed').length,
    warningChecks: input.results.filter((result) => result.status === 'warning').length,
    failedChecks: failed.length,
    affectedRoutes: affected.size,
    affectedRouteRate: input.routeInstances.size === 0 ? 0 : Number(((affected.size / input.routeInstances.size) * 100).toFixed(2)),
    checkFailureRate: input.results.length === 0 ? 0 : Number(((failed.length / input.results.length) * 100).toFixed(2)),
    byCategory: countBy('category'),
    byBrowser: countBy('browser'),
    byProfile: countBy('profile'),
  };
}

function readJsonBody<T>(req: http.IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) as T : {} as T);
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function formatKst(value?: string): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

function runDirectory(outputDir: string, runId: string): string | undefined {
  const root = path.resolve(outputDir);
  const candidate = path.resolve(root, runId);
  const relative = path.relative(root, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return undefined;
  return candidate;
}

function listSavedRuns(outputDir: string): Array<{
  runId: string;
  baseURL?: string;
  startedAt?: string;
  startedAtKst?: string;
  finishedAt?: string;
  finishedAtKst?: string;
  completedChecks?: number;
  failedChecks?: number;
}> {
  const root = path.resolve(outputDir);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const runId = entry.name;
      const summaryPath = path.join(root, runId, 'summary.json');
      if (!fs.existsSync(summaryPath)) return { runId };
      try {
        const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8')) as Partial<RunSummary>;
        return {
          runId,
          baseURL: summary.baseURL,
          startedAt: summary.startedAt,
          startedAtKst: formatKst(summary.startedAt),
          finishedAt: summary.finishedAt,
          finishedAtKst: formatKst(summary.finishedAt),
          completedChecks: summary.completedChecks,
          failedChecks: summary.failedChecks,
        };
      } catch {
        return { runId };
      }
    })
    .sort((a, b) => String(b.startedAt ?? b.runId).localeCompare(String(a.startedAt ?? a.runId)));
}

function readSavedRun(outputDir: string, runId: string): {
  summary: RunSummary & { startedAtKst: string; finishedAtKst: string };
  results: Array<CheckResult & { startedAtKst: string; finishedAtKst: string }>;
} {
  const runDir = runDirectory(outputDir, runId);
  if (!runDir) throw new Error('잘못된 실행 결과 경로입니다.');
  const summaryPath = path.join(runDir, 'summary.json');
  const resultPath = path.join(runDir, 'result.json');
  if (!fs.existsSync(summaryPath) || !fs.existsSync(resultPath)) {
    throw new Error('실행 결과 파일을 찾을 수 없습니다.');
  }
  return {
    summary: (() => {
      const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8')) as RunSummary;
      return {
        ...summary,
        startedAtKst: formatKst(summary.startedAt),
        finishedAtKst: formatKst(summary.finishedAt),
      };
    })(),
    results: (JSON.parse(fs.readFileSync(resultPath, 'utf8')) as CheckResult[]).map((result) => ({
      ...result,
      startedAtKst: formatKst(result.startedAt),
      finishedAtKst: formatKst(result.finishedAt),
    })),
  };
}

function renderControlHtml(input: {
  baseURL: string;
  profiles: string[];
  port: number;
}): string {
  const profileControls = input.profiles.map((profile) =>
    `<label class="check"><input type="checkbox" name="profile" value="${escapeHtml(profile)}" ${profile === 'guest' ? 'checked' : ''}> <span>${escapeHtml(profile)}</span></label>`,
  ).join('');
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Site Check Pro</title>
<style>
:root{font-family:Inter,Pretendard,system-ui,sans-serif;color:#1f2937;background:#f6f7f9}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}.shell{width:min(920px,100%);background:#fff;border:1px solid #d9dee7;border-radius:8px;box-shadow:0 18px 48px #20304014;padding:28px}.eyebrow{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#2563eb;font-weight:900}h1{margin:8px 0 10px;font-size:30px}.muted{color:#687385;line-height:1.55}.panel{display:grid;gap:18px;margin-top:24px}.field{display:grid;gap:10px}.field>label{font-weight:850}.checks{display:flex;gap:10px;flex-wrap:wrap}.check{height:44px;display:inline-flex;align-items:center;gap:8px;border:1px solid #cfd6e2;border-radius:8px;padding:0 13px;background:#fff;font-weight:850}.check input{width:16px;height:16px}.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:4px}button,a{height:42px;border-radius:8px;padding:0 14px;font-weight:850;text-decoration:none;display:inline-flex;align-items:center;border:1px solid #cfd6e2;cursor:pointer;background:#fff;color:#27364a}.primary{background:#2563eb;border-color:#2563eb;color:#fff}.danger{color:#b42318}.status{padding:13px 14px;border-radius:8px;background:#f8fafc;border:1px solid #e4e9f0}.status.warning{background:#fff7ed;color:#9a4d00}.status.error{background:#fff0f0;color:#b42318}.status.done{background:#eaf8f1;color:#067647}.meta{display:grid;grid-template-columns:140px 1fr;gap:10px 16px;margin-top:20px;padding:16px;background:#f8fafc;border:1px solid #e4e9f0;border-radius:8px}.meta dt{color:#687385}.meta dd{margin:0;word-break:break-all;font-weight:750}.modal{position:fixed;inset:0;background:#151a23b8;display:none;align-items:center;justify-content:center;padding:24px}.modal.open{display:flex}.dialog{width:min(1040px,100%);max-height:88vh;overflow:hidden;background:#fff;border-radius:8px;display:grid;grid-template-rows:auto 1fr}.dialog-head{padding:18px 22px;border-bottom:1px solid #e7ebf1;display:flex;justify-content:space-between;align-items:center}.dialog-body{display:grid;grid-template-columns:330px 1fr;min-height:520px;overflow:hidden}.run-list{border-right:1px solid #e7ebf1;overflow:auto;padding:12px}.run-button{height:auto;width:100%;display:block;text-align:left;margin-bottom:8px;padding:12px;line-height:1.45}.run-detail{overflow:auto;padding:18px}.summary-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:12px 0}.summary-grid div{border:1px solid #e7ebf1;border-radius:8px;padding:10px}.summary-grid b{display:block;font-size:22px;margin-top:4px}.result-table{width:100%;border-collapse:collapse;font-size:12px}.result-table th,.result-table td{padding:9px;border-bottom:1px solid #e7ebf1;text-align:left;vertical-align:top}.result-table th{background:#f8fafc}.failed{color:#b42318}.passed{color:#067647}.warning-text{color:#9a4d00}@media(max-width:760px){.dialog-body{grid-template-columns:1fr}.run-list{border-right:0;border-bottom:1px solid #e7ebf1;max-height:260px}.summary-grid{grid-template-columns:repeat(2,1fr)}}
</style>
</head>
<body>
<main class="shell">
  <div class="eyebrow">Site Check Pro Console</div>
  <h1>사이트 점검 콘솔</h1>
  <p class="muted">점검할 프로필을 체크한 뒤 시작하세요. guest는 비로그인, member는 로그인 상태까지 점검합니다.</p>
  <dl class="meta">
    <dt>대상 URL</dt><dd>${escapeHtml(input.baseURL)}</dd>
    <dt>대시보드</dt><dd>http://127.0.0.1:${input.port}</dd>
  </dl>
  <section class="panel">
    <div class="field">
      <label>점검 프로필</label>
      <div class="checks">${profileControls}</div>
    </div>
    <div id="runStatus" class="status">대기 중입니다.</div>
    <div id="authStatus" class="status">로그인 정보 상태를 확인하고 있습니다.</div>
    <div class="actions">
      <button id="saveAuth" type="button">로그인 정보 저장</button>
      <button id="start" class="primary" type="button">점검 시작</button>
      <button id="currentReport" type="button">현재 점검 확인</button>
      <button id="history" type="button">이전 점검 결과 보기</button>
    </div>
  </section>
</main>
<div id="historyModal" class="modal" role="dialog" aria-modal="true">
  <section class="dialog">
    <header class="dialog-head"><strong>이전 점검 결과</strong><button id="closeHistory" type="button">닫기</button></header>
    <div class="dialog-body">
      <div id="runList" class="run-list"></div>
      <div id="runDetail" class="run-detail muted">왼쪽에서 결과를 선택하세요.</div>
    </div>
  </section>
</div>
<script>
const authStatus=document.querySelector('#authStatus'),runStatus=document.querySelector('#runStatus'),startButton=document.querySelector('#start'),currentReportButton=document.querySelector('#currentReport'),saveAuthButton=document.querySelector('#saveAuth'),historyButton=document.querySelector('#history'),historyModal=document.querySelector('#historyModal'),runList=document.querySelector('#runList'),runDetail=document.querySelector('#runDetail');
function selectedProfiles(){return [...document.querySelectorAll('input[name="profile"]:checked')].map(input=>input.value)}
function firstLoginProfile(){return selectedProfiles().find(profile=>profile!=='guest')||'member'}
function setBox(node,type,message){node.className='status '+(type||'');node.textContent=message}
async function refreshStatus(){const profiles=selectedProfiles();if(!profiles.length){setBox(authStatus,'error','하나 이상의 프로필을 선택하세요.');return}const response=await fetch('/profile-status?profiles='+encodeURIComponent(profiles.join(',')),{cache:'no-store'});const data=await response.json();if(!data.missing.length){setBox(authStatus,'done','선택한 프로필을 점검할 준비가 되었습니다.');return}setBox(authStatus,'warning',data.missing.join(', ')+' 로그인 정보가 없습니다. 점검 시작 전에 로그인 정보 저장을 진행하세요.')}
async function refreshRunStatus(){const response=await fetch('/run-status',{cache:'no-store'});const data=await response.json();currentReportButton.disabled=!(data.running||data.finished||data.hasReport);if(data.running){setBox(runStatus,'warning','점검 중입니다. 완료될 때까지 잠시 기다려주세요.');startButton.disabled=true;return}if(data.finished){setBox(runStatus,data.failedChecks>0?'warning':'done','점검 완료: '+data.completedChecks+'개 체크, 실패 '+data.failedChecks+'개');startButton.disabled=false;return}setBox(runStatus,'','대기 중입니다.');startButton.disabled=false}
for(const input of document.querySelectorAll('input[name="profile"]'))input.addEventListener('change',refreshStatus);
saveAuthButton.addEventListener('click',async()=>{const profile=firstLoginProfile();setBox(authStatus,'warning',profile+' 로그인 정보 저장 화면을 여는 중입니다. 저장이 끝날 때까지 이 창을 닫지 마세요.');saveAuthButton.disabled=true;try{const response=await fetch('/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({profile})});const data=await response.json();if(!response.ok)throw new Error(data.message||'로그인 정보 저장 실패');setBox(authStatus,'done','로그인 정보가 저장되었습니다. 저장 경로: '+data.authPath)}catch(error){setBox(authStatus,'error',error instanceof Error?error.message:String(error))}finally{saveAuthButton.disabled=false;refreshStatus()}});
startButton.addEventListener('click',async()=>{const profiles=selectedProfiles();setBox(runStatus,'warning','점검을 시작하는 중입니다.');startButton.disabled=true;try{const response=await fetch('/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({profiles})});const data=await response.json();if(!response.ok)throw new Error(data.message||'점검 시작 실패');window.location.href='/report'}catch(error){setBox(runStatus,'error',error instanceof Error?error.message:String(error));startButton.disabled=false}});
currentReportButton.addEventListener('click',()=>{window.location.href='/report'});
function esc(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]))}
async function openHistory(){historyModal.classList.add('open');runList.textContent='불러오는 중입니다.';runDetail.textContent='왼쪽에서 결과를 선택하세요.';const runs=await fetch('/runs',{cache:'no-store'}).then(response=>response.json());if(!runs.length){runList.textContent='저장된 결과가 없습니다.';return}runList.replaceChildren();for(const run of runs){const button=document.createElement('button');button.className='run-button';button.type='button';button.innerHTML='<strong>'+esc(run.runId)+'</strong><br><span class="muted">'+esc(run.startedAtKst||'-')+'</span><br><span>checks '+esc(run.completedChecks??'-')+' · failed '+esc(run.failedChecks??'-')+'</span>';button.addEventListener('click',()=>loadRun(run.runId));runList.appendChild(button)}}
async function loadRun(runId){runDetail.textContent='불러오는 중입니다.';try{const data=await fetch('/runs/'+encodeURIComponent(runId),{cache:'no-store'}).then(response=>{if(!response.ok)throw new Error('결과를 불러오지 못했습니다.');return response.json()});const s=data.summary,rows=data.results.slice(0,80).map(r=>'<tr><td class="'+esc(r.status)+'">'+esc(r.status)+'</td><td>'+esc(r.profile)+'</td><td>'+esc(r.category)+'</td><td>'+esc(r.route)+'</td><td>'+esc(r.check)+'</td><td>'+esc(r.message||'')+'</td></tr>').join('');runDetail.innerHTML='<h3>'+esc(s.runId)+'</h3><p class="muted">'+esc(s.baseURL)+' · '+esc(s.startedAtKst||'-')+'</p><div class="summary-grid"><div><span>체크</span><b>'+esc(s.completedChecks)+'</b></div><div><span>통과</span><b>'+esc(s.passedChecks)+'</b></div><div><span>경고</span><b>'+esc(s.warningChecks)+'</b></div><div><span>실패</span><b>'+esc(s.failedChecks)+'</b></div></div><table class="result-table"><thead><tr><th>상태</th><th>프로필</th><th>분류</th><th>경로</th><th>점검</th><th>메시지</th></tr></thead><tbody>'+rows+'</tbody></table>'}catch(error){runDetail.textContent=error instanceof Error?error.message:String(error)}}
historyButton.addEventListener('click',openHistory);document.querySelector('#closeHistory').addEventListener('click',()=>historyModal.classList.remove('open'));historyModal.addEventListener('click',event=>{if(event.target===historyModal)historyModal.classList.remove('open')});
refreshStatus();refreshRunStatus();setInterval(refreshRunStatus,2000);
</script>
</body>
</html>`;
}

export async function startControlDashboard(input: {
  port: number;
  config: ResolvedSiteCheckProConfig;
  browsers?: BrowserName[];
  headed?: boolean;
}): Promise<{ url: string; close: () => Promise<void> }> {
  const clients = new Set<http.ServerResponse>();
  const results: CheckResult[] = [];
  const discoveredRoutes = new Set<string>();
  const routeInstances = new Set<string>();
  const eventBus = new AuditEventBus();
  let summary = emptySummary(input.config.baseURL);
  let runId = summary.runId;
  let startedAt = summary.startedAt;
  let currentRunDir: string | undefined;
  let running = false;
  let finished = false;

  const unsubscribe = eventBus.subscribe((event: AuditEvent) => {
    if (event.type === 'run.started') {
      results.length = 0;
      discoveredRoutes.clear();
      routeInstances.clear();
      runId = event.runId;
      startedAt = event.startedAt;
      currentRunDir = event.runDir;
      finished = false;
      running = true;
    }
    if (event.type === 'route.discovered') {
      discoveredRoutes.add(event.route);
      routeInstances.add(`${event.browser}:${event.profile}:${event.route}`);
    }
    if (event.type === 'check.finished') results.push(event.result);
    if (event.type === 'run.finished') {
      summary = event.summary;
      finished = true;
      running = false;
    }
    for (const client of clients) {
      client.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    }
  });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(renderControlHtml({
        baseURL: input.config.baseURL,
        profiles: listProfiles(input.config),
        port: input.port,
      }));
      return;
    }
    if (url.pathname === '/profile-status') {
      const profiles = (url.searchParams.get('profiles') ?? 'member')
        .split(',')
        .map((profile) => profileFilename(profile))
        .filter(Boolean);
      const missing = profiles.filter((profile) => !authExists(profile));
      sendJson(res, 200, {
        profiles,
        missing,
        auth: profiles.reduce<Record<string, { authExists: boolean; authPath: string }>>((acc, profile) => {
          acc[profile] = { authExists: authExists(profile), authPath: authStorageStateFor(profile) };
          return acc;
        }, {}),
      });
      return;
    }
    if (url.pathname === '/run-status') {
      sendJson(res, 200, {
        running,
        finished,
        hasReport: results.length > 0 || Boolean(currentRunDir),
        runId,
        runDir: currentRunDir,
        completedChecks: summary.completedChecks,
        failedChecks: summary.failedChecks,
      });
      return;
    }
    if (url.pathname === '/runs') {
      sendJson(res, 200, listSavedRuns(input.config.outputDir));
      return;
    }
    if (url.pathname.startsWith('/runs/')) {
      try {
        const runId = decodeURIComponent(url.pathname.slice('/runs/'.length));
        sendJson(res, 200, readSavedRun(input.config.outputDir, runId));
      } catch (error) {
        sendJson(res, 404, {
          success: false,
          message: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }
    if (url.pathname === '/auth' && req.method === 'POST') {
      void readJsonBody<{ profile?: string }>(req)
        .then(async (body) => {
          const profile = profileFilename(body.profile ?? 'member');
          const saved = await captureAuth(input.config, profile);
          sendJson(res, 200, saved);
        })
        .catch((error) => sendJson(res, 500, {
          success: false,
          message: error instanceof Error ? error.message : String(error),
        }));
      return;
    }
    if (url.pathname === '/start' && req.method === 'POST') {
      void readJsonBody<{ profile?: string; profiles?: string[] }>(req)
        .then((body) => {
          if (running) {
            sendJson(res, 409, { success: false, message: '이미 사이트 점검이 실행 중입니다.' });
            return;
          }
          const profiles = (body.profiles?.length ? body.profiles : [body.profile ?? 'member'])
            .map((profile) => profileFilename(profile))
            .filter(Boolean);
          if (profiles.length === 0) {
            sendJson(res, 400, { success: false, message: '하나 이상의 프로필을 선택하세요.' });
            return;
          }
          const missing = profiles.filter((profile) => !authExists(profile));
          if (missing.length > 0) {
            sendJson(res, 400, {
              success: false,
              message: `${missing.join(', ')} 로그인 정보가 없습니다. 먼저 로그인 정보 저장을 진행하세요.`,
            });
            return;
          }
          const runConfig = selectedConfig({
            config: input.config,
            profiles,
            browsers: input.browsers,
            headed: input.headed,
          });
          running = true;
          void runAudit(runConfig, eventBus).catch((error) => {
            running = false;
            for (const client of clients) {
              client.write(`event: run.error\ndata: ${JSON.stringify({
                message: error instanceof Error ? error.message : String(error),
              })}\n\n`);
            }
          });
          sendJson(res, 202, { success: true, profiles });
        })
        .catch((error) => sendJson(res, 500, {
          success: false,
          message: error instanceof Error ? error.message : String(error),
        }));
      return;
    }
    if (url.pathname === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });
      res.write(': connected\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (url.pathname === '/report') {
      const currentSummary = finished ? summary : liveSummary({
        baseURL: input.config.baseURL,
        runId,
        startedAt,
        results,
        discoveredRoutes,
        routeInstances,
      });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(renderReportHtml(currentSummary, results, true, {
        discoveredRoutes: [...discoveredRoutes],
        routeInstances: [...routeInstances],
      }));
      return;
    }
    if (currentRunDir && ['/summary.json', '/result.json'].includes(url.pathname)) {
      const candidate = path.join(currentRunDir, url.pathname.slice(1));
      if (fs.existsSync(candidate)) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        fs.createReadStream(candidate).pipe(res);
        return;
      }
    }
    if (currentRunDir && url.pathname.startsWith('/artifacts/')) {
      const candidate = path.resolve(currentRunDir, `.${url.pathname}`);
      const relative = path.relative(path.resolve(currentRunDir), candidate);
      if (!relative.startsWith('..') && !path.isAbsolute(relative) && fs.existsSync(candidate)) {
        const extension = path.extname(candidate).toLowerCase();
        const contentTypes: Record<string, string> = {
          '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
          '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.zip': 'application/zip',
        };
        res.writeHead(200, { 'Content-Type': contentTypes[extension] ?? 'application/octet-stream' });
        fs.createReadStream(candidate).pipe(res);
        return;
      }
    }
    res.writeHead(404).end('Not found');
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(input.port, '127.0.0.1', resolve);
  });

  return {
    url: `http://127.0.0.1:${input.port}`,
    close: async () => {
      unsubscribe();
      for (const client of clients) client.end();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
