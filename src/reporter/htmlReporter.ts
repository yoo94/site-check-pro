import fs from 'node:fs';
import path from 'node:path';
import type { CheckResult, RunSummary } from '../types.js';

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function safeJson(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026');
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function formatKst(value: string): string {
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

function runLabel(summary: RunSummary): string {
  const suffix = summary.runId.split('-').at(-1);
  return `${formatKst(summary.startedAt)}${suffix ? ` #${suffix}` : ''}`;
}

function pathLabel(route: string): string {
  try {
    const url = new URL(route);
    return `${url.pathname}${url.search}`;
  } catch {
    return route;
  }
}

function barRows(data: Record<string, number>): string {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return '<p class="empty">No failures</p>';
  const max = Math.max(1, ...entries.map(([, value]) => value));
  return entries.map(([label, value]) => `
    <div class="bar-row">
      <span title="${escapeHtml(label)}">${escapeHtml(label)}</span>
      <div class="bar-track"><i style="width:${(value / max) * 100}%"></i></div>
      <b>${value}</b>
    </div>`).join('');
}

function resultRows(results: CheckResult[]): string {
  return results.map((result) => `
    <tr class="${escapeHtml(result.status)}">
      <td><span class="status-badge">${escapeHtml(result.status)}</span></td>
      <td>${escapeHtml(result.browser)}</td>
      <td>${escapeHtml(result.profile)}</td>
      <td>${escapeHtml(result.category)}</td>
      <td class="route">${escapeHtml(result.route)}</td>
      <td>${escapeHtml(result.check)}</td>
      <td>${escapeHtml(result.message)}</td>
      <td>${escapeHtml(result.durationMs)}ms</td>
      <td>${result.artifact ? `<button class="evidence-button detail-button" data-result-id="${escapeHtml(result.id)}"><img src="${escapeHtml(result.artifact)}" alt="실패 화면"><span>Evidence</span></button>` : '<span class="no-evidence">-</span>'}</td>
      <td><button class="detail-button" data-result-id="${escapeHtml(result.id)}">상세 결과</button></td>
    </tr>`).join('');
}

export function renderReportHtml(
  summary: RunSummary,
  results: CheckResult[],
  live = false,
  liveState?: { discoveredRoutes: string[]; routeInstances: string[] },
): string {
  const routeResults = results.filter((result) => result.browser !== 'node' && result.category !== 'browser' && result.category !== 'authentication');
  const initialRouteUrls = liveState?.discoveredRoutes ?? [...new Set(routeResults.map((result) => result.route))];
  const initialRouteInstances = liveState?.routeInstances ?? [...new Set(routeResults.map((result) => `${result.browser}:${result.profile}:${result.route}`))];
  const initialAffectedInstances = [...new Set(routeResults.filter((result) => result.status === 'failed').map((result) => `${result.browser}:${result.profile}:${result.route}`))];
  const failed = results.filter((result) => result.status === 'failed');
  const totalStatus = Math.max(1, summary.completedChecks);
  const passedPercent = (summary.passedChecks / totalStatus) * 100;
  const warningPercent = (summary.warningChecks / totalStatus) * 100;
  const failedPercent = (summary.failedChecks / totalStatus) * 100;
  const verdictClass = summary.failedChecks === 0 ? 'healthy' : summary.checkFailureRate >= 25 ? 'critical' : 'attention';
  const verdictText = summary.failedChecks === 0
    ? '릴리스 차단 이슈 없음'
    : summary.checkFailureRate >= 25
      ? '릴리스 전 우선 조치 필요'
      : '확인 후 릴리스 가능';
  const reportState = summary.status ?? (live && !summary.finishedAt ? 'running' : 'completed');
  const isRunning = reportState === 'running';
  const reportStatus = reportState === 'cancelled' ? '점검 중지됨' : isRunning ? '점검 중' : '점검 완료';
  const runStateClass = reportState === 'cancelled' ? 'cancelled' : isRunning ? 'running' : 'done';
  const stopButtonHtml = live
    ? `<button id="stopRun" class="stop-run" type="button" ${isRunning ? '' : 'disabled'}>점검 중지</button>`
    : '';

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Site Check Pro report</title>
<style>
:root{font-family:Inter,Pretendard,system-ui,sans-serif;color:#1f2937;background:#f6f7f9;--line:#d9dee7;--text:#1f2937;--muted:#687385;--panel:#fff;--green:#179b68;--amber:#c77700;--red:#d14343;--blue:#2563eb;--ink:#202633}
*{box-sizing:border-box}body{margin:0}.app{display:grid;grid-template-columns:280px minmax(0,1fr);min-height:100vh}.sidebar{position:sticky;top:0;height:100vh;padding:22px 18px;background:#202633;color:#f7f8fb;display:flex;flex-direction:column;gap:18px}.brand{display:flex;align-items:center;gap:10px;padding-bottom:14px;border-bottom:1px solid #ffffff1f}.mark{width:34px;height:34px;border-radius:8px;background:#4f8cff;display:grid;place-items:center;font-weight:900}.brand strong{display:block}.brand span,.side-label,.side-meta,.side-foot{color:#b9c2d1}.side-card{border:1px solid #ffffff1a;border-radius:8px;padding:14px;background:#ffffff0c}.side-label{font-size:11px;text-transform:uppercase;letter-spacing:.08em}.side-url{margin-top:8px;word-break:break-all;font-weight:750}.side-meta{display:grid;gap:7px;font-size:12px}.side-meta b{color:#fff}.nav{display:grid;gap:8px}.view-button{display:flex;align-items:center;justify-content:space-between;border:1px solid transparent;background:transparent;color:#dce4f0;border-radius:8px;padding:11px 12px;cursor:pointer;font-weight:750;text-align:left}.view-button:hover{background:#ffffff10}.view-button.active{background:#fff;color:#202633}.connection,.run-state{display:inline-flex;align-items:center;gap:7px;width:max-content;border:1px solid #ffffff24;border-radius:999px;padding:7px 10px;font-size:12px;color:#d8f7e7}.connection:before,.run-state:before{content:'';width:7px;height:7px;border-radius:50%;background:#32d583}.run-state{background:#fff;color:#27364a;border-color:#d9dee7;font-weight:850}.run-state.running{color:#067647;background:#eaf8f1;border-color:#abefc6}.run-state.running:before{background:#12b76a;animation:pulse-dot 1s ease-in-out infinite}.run-state.done{color:#067647;background:#eaf8f1;border-color:#abefc6}.run-state.done:before{background:#12b76a}.run-state.cancelled{color:#667085;background:#f2f4f7;border-color:#d0d5dd}.run-state.cancelled:before{background:#98a2b3}.stop-run{height:34px;border:1px solid #fecdca;background:#fff0f0;color:#b42318;border-radius:8px;padding:0 12px;font-weight:850;cursor:pointer}.stop-run:disabled{opacity:.65;cursor:not-allowed}.top-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}.side-foot{margin-top:auto;font-size:12px;line-height:1.5}.main{padding:30px 34px 42px}.topbar{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;margin-bottom:22px}.eyebrow{font-size:12px;font-weight:900;color:#2563eb;letter-spacing:.08em;text-transform:uppercase}.topbar h1{margin:6px 0 8px;font-size:30px;line-height:1.15}.muted,.empty{color:var(--muted)}.view{display:none}.view.active{display:block}.section-head{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;margin:26px 0 12px}.section-head h2{margin:0 0 5px;font-size:20px}.section-head p{margin:0}.verdict{display:grid;grid-template-columns:auto 1fr auto;gap:16px;align-items:center;border:1px solid var(--line);border-radius:8px;background:var(--panel);padding:18px;box-shadow:0 8px 22px #2030400a}.verdict-mark{width:44px;height:44px;border-radius:8px;display:grid;place-items:center;font-weight:900}.verdict.healthy .verdict-mark{background:#eaf8f1;color:var(--green)}.verdict.attention .verdict-mark{background:#fff5df;color:var(--amber)}.verdict.critical .verdict-mark{background:#fff0f0;color:var(--red)}.verdict strong{display:block;margin-bottom:3px}.verdict-score{font-size:28px;font-weight:900}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.metric,.panel,.table-shell,.route-discovery{border:1px solid var(--line);background:var(--panel);border-radius:8px;box-shadow:0 8px 22px #2030400a}.metric{padding:16px;min-height:112px}.metric span{display:block;color:var(--muted);font-size:13px}.metric strong{display:block;margin-top:11px;font-size:30px;letter-spacing:-.02em}.metric-button{width:100%;height:100%;padding:0;border:0;background:transparent;color:inherit;text-align:left;cursor:pointer}.metric-button:hover strong{color:var(--blue)}.metric.success{border-left:4px solid var(--green)}.metric.warning{border-left:4px solid var(--amber)}.metric.danger{border-left:4px solid var(--red)}.route-discovery{margin-top:12px;padding:16px}.route-discovery[hidden]{display:none}.route-discovery h3{margin:0 0 12px;font-size:15px}.route-discovery ul{margin:0;padding-left:18px;columns:2}.route-discovery li{margin:7px 0;word-break:break-all}.analysis-grid{display:grid;grid-template-columns:1.15fr repeat(3,minmax(0,1fr));gap:12px}.panel{padding:18px;min-height:230px}.panel h3{margin:0 0 16px;font-size:15px}.status-chart{display:grid;grid-template-columns:142px 1fr;gap:20px;align-items:center}.donut{width:142px;height:142px;border-radius:50%;display:grid;place-items:center}.donut:after{content:'';width:84px;height:84px;border-radius:50%;background:#fff;box-shadow:inset 0 0 0 1px var(--line)}.legend{display:grid;gap:9px}.legend span{display:flex;align-items:center;justify-content:space-between;gap:12px}.legend i{width:10px;height:10px;border-radius:50%;display:inline-block;margin-right:8px}.legend label{display:flex;align-items:center;color:var(--muted)}.bar-row{display:grid;grid-template-columns:minmax(72px,92px) 1fr 32px;align-items:center;gap:10px;margin:12px 0}.bar-row span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted)}.bar-track{height:8px;border-radius:99px;background:#eef1f5;overflow:hidden}.bar-track i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#f59e0b,#d14343)}.toolbar{display:flex;gap:8px;align-items:center}.toolbar input,.toolbar select{height:40px;border:1px solid #cfd6e2;border-radius:8px;background:#fff;padding:0 11px;color:var(--text)}.toolbar input{min-width:320px}.table-shell{overflow:auto}table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:12px;border-bottom:1px solid #e7ebf1;text-align:left;vertical-align:top}th{position:sticky;top:0;background:#fafbfc;color:#596579;font-size:12px;z-index:1}tbody tr:hover{background:#f7f9fd}.sortable{cursor:pointer;user-select:none;white-space:nowrap}.sortable:after{content:' ⇅';color:#98a2b3}.sortable.asc:after{content:' ↑';color:var(--blue)}.sortable.desc:after{content:' ↓';color:var(--blue)}.status-badge{display:inline-flex;align-items:center;border-radius:999px;padding:4px 8px;font-size:11px;font-weight:900;text-transform:uppercase;background:#eef2f7;color:#536073}.failed .status-badge{background:#fff0f0;color:#b42318}.passed .status-badge{background:#eaf8f1;color:#067647}.warning .status-badge{background:#fff5df;color:#b54708}.route{max-width:320px;word-break:break-all}.detail-button{border:1px solid #cfd6e2;background:#fff;color:#27364a;border-radius:8px;padding:8px 10px;cursor:pointer;font-weight:750}.detail-button:hover{border-color:#86a9ff;color:var(--blue)}.evidence-button{display:grid;gap:5px;padding:5px;font-size:10px}.evidence-button img{width:76px;height:46px;object-fit:cover;border-radius:6px}.no-evidence{color:#9aa4b5}.final-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}.final-metrics div{padding:14px;border:1px solid var(--line);border-radius:8px;background:#fff}.final-metrics b{display:block;margin-top:5px;font-size:24px}.route-summary{display:grid;gap:10px}.route-group{border:1px solid var(--line);border-radius:8px;background:#fff;overflow:hidden}.route-group summary{cursor:pointer;padding:14px 16px;background:#fafbfc;display:flex;gap:10px;align-items:center}.route-group summary strong{flex:1;word-break:break-all}.route-group ul{margin:0;padding:12px 18px 16px 36px}.route-group li{margin:8px 0}.result-pill{font-size:11px;font-weight:900;padding:4px 8px;border-radius:999px}.result-pill.failed{background:#fff0f0;color:#b42318}.result-pill.warning{background:#fff5df;color:#b54708}.result-pill.passed{background:#eaf8f1;color:#067647}.issue-link{border:0;background:none;color:#2563eb;cursor:pointer;padding:0;text-align:left;font-weight:750}.modal{position:fixed;inset:0;background:#151a23b8;display:none;align-items:center;justify-content:center;padding:24px;z-index:20;backdrop-filter:blur(4px)}.modal.open{display:flex}.dialog{width:min(980px,100%);max-height:90vh;overflow:auto;background:#fff;border-radius:8px;box-shadow:0 24px 60px #10182855}.dialog-head{position:sticky;top:0;z-index:1;background:#fff;border-bottom:1px solid #e7ebf1;padding:18px 22px;display:flex;justify-content:space-between;align-items:center}.dialog-body{padding:22px}.close{border:0;background:#eef2f7;border-radius:50%;font-size:21px;width:36px;height:36px;cursor:pointer}.detail-grid{display:grid;grid-template-columns:150px 1fr;gap:10px 18px;margin-bottom:20px}.detail-grid dt{color:var(--muted)}.detail-grid dd{margin:0;word-break:break-word}.details-json{white-space:pre-wrap;word-break:break-word;background:#171d29;color:#d6dde8;padding:16px;border-radius:8px;overflow:auto}.artifact-preview{display:block;max-width:100%;max-height:520px;margin:12px auto;border:1px solid var(--line);border-radius:8px}@keyframes pulse-dot{0%,100%{opacity:1;box-shadow:0 0 0 0 #12b76a66}50%{opacity:.35;box-shadow:0 0 0 5px #12b76a00}}
@media(max-width:1180px){.analysis-grid{grid-template-columns:1fr 1fr}.grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:820px){.app{grid-template-columns:1fr}.sidebar{position:relative;height:auto}.main{padding:22px 18px 34px}.topbar,.section-head{align-items:flex-start;flex-direction:column}.grid,.analysis-grid,.final-metrics{grid-template-columns:1fr}.route-discovery ul{columns:1}.toolbar{width:100%;flex-direction:column;align-items:stretch}.toolbar input{min-width:0}.status-chart{grid-template-columns:1fr}.detail-grid{grid-template-columns:1fr}.route-group summary{align-items:flex-start;flex-direction:column}}
</style>
</head>
<body>
<div class="app">
  <aside class="sidebar">
    <div class="brand"><div class="mark">SC</div><div><strong>Site Check Pro</strong><span>${live ? 'Live dashboard' : 'Static report'}</span></div></div>
    <div class="side-card">
      <div class="side-label">Target</div>
      <div class="side-url">${escapeHtml(summary.baseURL)}</div>
    </div>
    <div class="side-meta">
      <span>상태 <b id="reportStatus">${escapeHtml(reportStatus)}</b></span>
      <span>실행 <b>${escapeHtml(runLabel(summary))}</b></span>
      <span>시작 <b>${escapeHtml(formatKst(summary.startedAt))}</b></span>
      <span>Duration <b id="duration">${formatDuration(summary.durationMs)}</b></span>
    </div>
    <nav class="nav" aria-label="Report views">
      <button class="view-button active" data-view="summaryView">요약 분석 <span id="sideFailed">${summary.failedChecks}</span></button>
      <button class="view-button" data-view="detailView">실시간 상세 결과 <span id="detailCount">${failed.length}</span></button>
      <button class="view-button" data-view="finalView">최종 결과 <span>${summary.completedChecks}</span></button>
    </nav>
    <span id="connection" class="connection">${live ? '연결 중' : '체크 완료'}</span>
    <div class="side-foot">QA, 관리자, 개발자가 같은 리포트를 보고 실패 증거와 경로 영향을 함께 추적할 수 있습니다.</div>
  </aside>
  <main class="main">
    <header class="topbar">
      <div><div class="eyebrow">Automated Quality Report</div><h1>${live ? '실시간 점검 대시보드' : '사이트 점검 리포트'}</h1><div class="muted">중복 없는 요약, 실패 집중도, 경로별 최종 결과를 한 화면 흐름으로 정리했습니다.</div></div>
      <div class="top-actions">${stopButtonHtml}<span id="runState" class="run-state ${runStateClass}">${escapeHtml(reportStatus)}</span></div>
    </header>
    <section id="summaryView" class="view active">
      <div id="verdict" class="verdict ${verdictClass}">
        <div id="verdictMark" class="verdict-mark">${summary.failedChecks === 0 ? 'OK' : '!'}</div>
        <div><strong id="verdictTitle">${escapeHtml(verdictText)}</strong><span id="verdictText" class="muted">${summary.affectedRoutes}개 경로에 영향 · 전체 체크 실패율 ${summary.checkFailureRate}%</span></div>
        <div id="verdictScore" class="verdict-score">${Math.max(0, Math.round(100 - summary.checkFailureRate))}</div>
      </div>
      <div class="section-head"><div><h2>실행 요약</h2><p class="muted">경로, 체크 수, 실패율만 남겨 빠르게 상태를 판단합니다.</p></div></div>
      <section class="grid">
        <div class="metric"><button id="showRoutes" class="metric-button" type="button"><span>발견 경로 · 눌러서 보기</span><strong id="discovered">${summary.discoveredRoutes}</strong></button></div>
        <div class="metric"><span>점검 경로 인스턴스</span><strong id="routeInstances">${summary.routeInstances}</strong></div>
        <div class="metric"><span>진행된 체크</span><strong id="completed">${summary.completedChecks}</strong></div>
        <div class="metric success"><span>통과</span><strong id="passed">${summary.passedChecks}</strong></div>
        <div class="metric warning"><span>경고</span><strong id="warning">${summary.warningChecks}</strong></div>
        <div class="metric danger"><button id="showFailed" class="metric-button" type="button"><span>실패 · 상세에서 보기</span><strong id="failed">${summary.failedChecks}</strong></button></div>
        <div class="metric danger"><span>문제 경로</span><strong id="affected">${summary.affectedRoutes}</strong></div>
        <div class="metric danger"><span>체크 실패율</span><strong id="failureRate">${summary.checkFailureRate}%</strong></div>
      </section>
      <section id="routeDiscovery" class="route-discovery" hidden><h3>탐색한 경로</h3><ul id="routeDiscoveryList">${initialRouteUrls.map((route) => `<li>${escapeHtml(route)}</li>`).join('') || '<li class="empty">아직 발견된 경로가 없습니다.</li>'}</ul></section>
      <div class="section-head"><div><h2>품질 분석</h2><p class="muted">상태 분포와 실패 집중 구간을 비교합니다.</p></div></div>
      <section class="analysis-grid">
        <div class="panel"><h3>점검 상태</h3><div class="status-chart"><div id="statusDonut" class="donut" style="background:conic-gradient(#179b68 0 ${passedPercent}%,#c77700 ${passedPercent}% ${passedPercent + warningPercent}%,#d14343 ${passedPercent + warningPercent}% ${passedPercent + warningPercent + failedPercent}%,#dfe5ee 0)"></div><div class="legend"><span><label><i style="background:#179b68"></i>통과</label><b id="legendPassed">${summary.passedChecks}</b></span><span><label><i style="background:#c77700"></i>경고</label><b id="legendWarning">${summary.warningChecks}</b></span><span><label><i style="background:#d14343"></i>실패</label><b id="legendFailed">${summary.failedChecks}</b></span></div></div></div>
        <div class="panel"><h3>문제 유형</h3><div id="categoryBars">${barRows(summary.byCategory)}</div></div>
        <div class="panel"><h3>브라우저별 실패</h3><div id="browserBars">${barRows(summary.byBrowser)}</div></div>
        <div class="panel"><h3>프로필별 실패</h3><div id="profileBars">${barRows(summary.byProfile)}</div></div>
      </section>
    </section>
    <section id="detailView" class="view">
      <div class="section-head"><div><h2>실시간 상세 결과</h2><p class="muted">열 제목으로 정렬하고 실패 증거를 바로 확인합니다.</p></div><div class="toolbar"><input id="search" placeholder="URL, 점검명 또는 오류 메시지 검색"><select id="status"><option value="">all status</option><option value="failed">failed</option><option value="warning">warning</option><option value="passed">passed</option><option value="skipped">skipped</option></select></div></div>
      <div class="table-shell"><table><thead><tr><th class="sortable" data-sort="status">상태</th><th class="sortable" data-sort="browser">브라우저</th><th class="sortable" data-sort="profile">프로필</th><th class="sortable" data-sort="category">분류</th><th class="sortable" data-sort="route">경로</th><th class="sortable" data-sort="check">점검</th><th class="sortable" data-sort="message">진단 내용</th><th class="sortable" data-sort="durationMs" data-type="number">시간</th><th>Evidence</th><th>분석</th></tr></thead><tbody id="results">${resultRows(results)}</tbody></table></div>
    </section>
    <section id="finalView" class="view"><div class="section-head"><div><h2>최종 점검 결과</h2><p class="muted">경로별 통과 항목과 문제 원인을 한눈에 확인합니다.</p></div></div><div id="finalBody"></div></section>
  </main>
</div>
<div id="detailModal" class="modal" role="dialog" aria-modal="true" aria-labelledby="detailTitle"><section class="dialog"><header class="dialog-head"><div><strong id="detailTitle">상세 결과</strong><div id="detailSubtitle" class="muted"></div></div><button id="closeDetail" class="close" aria-label="닫기">x</button></header><div id="detailBody" class="dialog-body"></div></section></div>
<script>
const resultData=${safeJson(results)};
const search=document.querySelector('#search'),status=document.querySelector('#status');
function activateView(viewId){document.querySelectorAll('.view-button').forEach(item=>item.classList.toggle('active',item.dataset.view===viewId));document.querySelectorAll('.view').forEach(view=>view.classList.toggle('active',view.id===viewId));if(viewId==='finalView')renderFinal()}
for(const button of document.querySelectorAll('.view-button'))button.addEventListener('click',()=>activateView(button.dataset.view));
function filter(){for(const row of document.querySelectorAll('#results tr')){const text=row.textContent.toLowerCase();const okText=text.includes(search.value.toLowerCase());const okStatus=!status.value||row.classList.contains(status.value);row.style.display=okText&&okStatus?'':'none'}}search.addEventListener('input',filter);status.addEventListener('change',filter);
document.querySelector('#showFailed').addEventListener('click',()=>{status.value='failed';search.value='';filter();activateView('detailView')});
const routeDiscovery=document.querySelector('#routeDiscovery'),routeDiscoveryList=document.querySelector('#routeDiscoveryList');document.querySelector('#showRoutes').addEventListener('click',()=>{routeDiscovery.hidden=!routeDiscovery.hidden;if(!routeDiscovery.hidden)routeDiscovery.scrollIntoView({behavior:'smooth',block:'nearest'})});
const modal=document.querySelector('#detailModal'),detailBody=document.querySelector('#detailBody'),detailSubtitle=document.querySelector('#detailSubtitle');
function textElement(tag,text,className){const el=document.createElement(tag);if(className)el.className=className;el.textContent=String(text??'');return el}
function formatKstText(value){const date=new Date(value);if(Number.isNaN(date.getTime()))return String(value??'');return new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(date)}
function showDetail(id){const r=resultData.find(item=>item.id===id);if(!r)return;detailSubtitle.textContent=r.status+' · '+r.category+' · '+r.check;detailBody.replaceChildren();const dl=document.createElement('dl');dl.className='detail-grid';for(const [label,value] of [['점검 경로',r.route],['최종 도착 URL',r.finalUrl],['실행 브라우저',r.browser],['사용자 프로필',r.profile],['위험도',r.severity||'-'],['진단 메시지',r.message||'-'],['소요 시간',r.durationMs+'ms'],['시작 시각',formatKstText(r.startedAt)],['종료 시각',formatKstText(r.finishedAt)]]){dl.append(textElement('dt',label),textElement('dd',value))}detailBody.appendChild(dl);if(r.details&&Object.keys(r.details).length){detailBody.append(textElement('h3','기술 진단 정보'));detailBody.append(textElement('pre',JSON.stringify(r.details,null,2),'details-json'))}if(r.artifact){detailBody.append(textElement('h3','실패 증거 자료'));const img=document.createElement('img');img.className='artifact-preview';img.src=r.artifact;img.alt=r.check+' 실패 화면';img.loading='lazy';detailBody.append(img)}modal.classList.add('open');document.body.style.overflow='hidden'}
function closeDetail(){modal.classList.remove('open');document.body.style.overflow=''}
document.addEventListener('click',event=>{const button=event.target.closest?.('.detail-button');if(button)showDetail(button.dataset.resultId)});document.querySelector('#closeDetail').addEventListener('click',closeDetail);modal.addEventListener('click',event=>{if(event.target===modal)closeDetail()});document.addEventListener('keydown',event=>{if(event.key==='Escape')closeDetail()});
let sortKey='',sortDirection=1;
for(const header of document.querySelectorAll('.sortable'))header.addEventListener('click',()=>{const key=header.dataset.sort;sortDirection=sortKey===key?-sortDirection:1;sortKey=key;document.querySelectorAll('.sortable').forEach(item=>item.classList.remove('asc','desc'));header.classList.add(sortDirection===1?'asc':'desc');const body=document.querySelector('#results');const rows=[...body.querySelectorAll('tr')];rows.sort((a,b)=>{const aResult=resultData.find(item=>item.id===a.querySelector('.detail-button')?.dataset.resultId),bResult=resultData.find(item=>item.id===b.querySelector('.detail-button')?.dataset.resultId);const av=aResult?.[key]??'',bv=bResult?.[key]??'';return (typeof av==='number'&&typeof bv==='number'?av-bv:String(av).localeCompare(String(bv),'en',{numeric:true,sensitivity:'base'}))*sortDirection});body.append(...rows)});
const finalBody=document.querySelector('#finalBody');
function routeLabel(route){try{const url=new URL(route);return url.pathname+(url.search||'')}catch{return route}}
function renderFinal(){finalBody.replaceChildren();const metrics=document.createElement('div');metrics.className='final-metrics';const counts={passed:resultData.filter(r=>r.status==='passed').length,warning:resultData.filter(r=>r.status==='warning').length,failed:resultData.filter(r=>r.status==='failed').length};for(const [label,value] of [['Tested checks',resultData.length],['Passed',counts.passed],['Warning',counts.warning],['Failed',counts.failed]]){const box=document.createElement('div');box.append(textElement('span',label,'muted'),textElement('b',value));metrics.appendChild(box)}finalBody.appendChild(metrics);const groups=new Map();for(const r of resultData){const key=r.route||'system';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r)}const list=document.createElement('div');list.className='route-summary';for(const [route,items] of [...groups.entries()].sort((a,b)=>routeLabel(a[0]).localeCompare(routeLabel(b[0])))){const failed=items.filter(r=>r.status==='failed'),warning=items.filter(r=>r.status==='warning'),passed=items.filter(r=>r.status==='passed');const group=document.createElement('details');group.className='route-group';group.open=failed.length>0||warning.length>0;const routeSummary=document.createElement('summary');routeSummary.append(textElement('strong',routeLabel(route)));for(const [statusName,statusItems] of [['failed',failed],['warning',warning],['passed',passed]])if(statusItems.length)routeSummary.append(textElement('span',statusItems.length+' '+statusName,'result-pill '+statusName));group.appendChild(routeSummary);const ul=document.createElement('ul');for(const item of items){const li=document.createElement('li');li.append(textElement('span',item.status.toUpperCase()+' · ','status-badge'));const button=document.createElement('button');button.className='issue-link';button.textContent=item.check+(item.message?' - '+item.message:'');button.addEventListener('click',()=>showDetail(item.id));li.appendChild(button);if(item.artifact)li.append(textElement('span',' · Evidence available','muted'));ul.appendChild(li)}group.appendChild(ul);list.appendChild(group)}finalBody.appendChild(list)}
${live ? `
const source=new EventSource('/events');const connection=document.querySelector('#connection');
const routeUrls=new Set(${safeJson(initialRouteUrls)}),routeInstances=new Set(${safeJson(initialRouteInstances)}),affectedInstances=new Set(${safeJson(initialAffectedInstances)});
let completed=${summary.completedChecks},passed=${summary.passedChecks},failedCount=${summary.failedChecks},warning=${summary.warningChecks};
const categoryCounts=new Map(Object.entries(${safeJson(summary.byCategory)})),browserCounts=new Map(Object.entries(${safeJson(summary.byBrowser)})),profileCounts=new Map(Object.entries(${safeJson(summary.byProfile)}));
function setText(id,value){const node=document.querySelector('#'+id);if(node)node.textContent=String(value)}
function updateStatusChart(){const total=Math.max(1,completed),p=passed/total*100,w=warning/total*100,f=failedCount/total*100;document.querySelector('#statusDonut').style.background='conic-gradient(#179b68 0 '+p+'%,#c77700 '+p+'% '+(p+w)+'%,#d14343 '+(p+w)+'% '+(p+w+f)+'%,#dfe5ee 0)';setText('legendPassed',passed);setText('legendWarning',warning);setText('legendFailed',failedCount)}
function updateRates(){const affectedRate=routeInstances.size?((affectedInstances.size/routeInstances.size)*100).toFixed(2):'0',failureRate=completed?((failedCount/completed)*100).toFixed(2):'0';setText('affected',affectedInstances.size);setText('failureRate',failureRate+'%');setText('detailCount',failedCount);setText('sideFailed',failedCount);setText('verdictTitle',failedCount===0?'릴리스 차단 이슈 없음':Number(failureRate)>=25?'릴리스 전 우선 조치 필요':'확인 후 릴리스 가능');setText('verdictText',affectedInstances.size+'개 경로에 영향 · 전체 체크 실패율 '+failureRate+'%');setText('verdictMark',failedCount===0?'OK':'!');setText('verdictScore',Math.max(0,Math.round(100-Number(failureRate))));const verdict=document.querySelector('#verdict');verdict.classList.toggle('healthy',failedCount===0);verdict.classList.toggle('attention',failedCount>0&&Number(failureRate)<25);verdict.classList.toggle('critical',Number(failureRate)>=25);updateStatusChart()}
function cell(value,className){const td=document.createElement('td');if(className)td.className=className;td.textContent=String(value??'');return td}
function renderBars(id,counts){const container=document.querySelector('#'+id);container.replaceChildren();const entries=[...counts.entries()].sort((a,b)=>Number(b[1])-Number(a[1]));if(!entries.length){container.appendChild(textElement('p','No failures','empty'));return}const max=Math.max(1,...entries.map(([,value])=>Number(value)));for(const [label,value] of entries){const row=document.createElement('div');row.className='bar-row';const name=document.createElement('span');name.textContent=label;name.title=label;const bar=document.createElement('div');bar.className='bar-track';const fill=document.createElement('i');fill.style.width=(Number(value)/max*100)+'%';bar.appendChild(fill);const count=document.createElement('b');count.textContent=String(value);row.append(name,bar,count);container.appendChild(row)}}
function increment(counts,key){counts.set(key,Number(counts.get(key)||0)+1)}
function setRunState(text,state){setText('reportStatus',text);const node=document.querySelector('#runState');if(!node)return;node.textContent=text;node.classList.toggle('running',state==='running');node.classList.toggle('done',state==='done');node.classList.toggle('cancelled',state==='cancelled')}
connection.textContent='live';source.onopen=()=>connection.textContent='실시간 연결됨';source.onerror=()=>connection.textContent='연결 재시도 중';
const stopRunButton=document.querySelector('#stopRun');if(stopRunButton)stopRunButton.addEventListener('click',async()=>{stopRunButton.disabled=true;setRunState('중지 요청됨','running');try{const response=await fetch('/stop',{method:'POST'});const data=await response.json();if(!response.ok)throw new Error(data.message||'점검 중지 실패')}catch(error){setRunState(error instanceof Error?error.message:String(error),'running');stopRunButton.disabled=false}});
source.addEventListener('route.discovered',event=>{const e=JSON.parse(event.data),isNew=!routeUrls.has(e.route);routeUrls.add(e.route);routeInstances.add(e.browser+':'+e.profile+':'+e.route);if(isNew){if(routeDiscoveryList.querySelector('.empty'))routeDiscoveryList.replaceChildren();routeDiscoveryList.appendChild(textElement('li',e.route))}setText('discovered',routeUrls.size);setText('routeInstances',routeInstances.size);updateRates()});
source.addEventListener('check.finished',event=>{const e=JSON.parse(event.data),r=e.result;resultData.push(r);completed++;if(r.status==='passed')passed++;if(r.status==='failed'){failedCount++;increment(categoryCounts,r.category);increment(browserCounts,r.browser);increment(profileCounts,r.profile);renderBars('categoryBars',categoryCounts);renderBars('browserBars',browserCounts);renderBars('profileBars',profileCounts);if(r.browser!=='node'&&r.category!=='browser'&&r.category!=='authentication')affectedInstances.add(r.browser+':'+r.profile+':'+r.route)}if(r.status==='warning')warning++;setText('completed',completed);setText('passed',passed);setText('warning',warning);setText('failed',failedCount);updateRates();const tr=document.createElement('tr');tr.className=r.status;const statusCell=document.createElement('td');const badge=document.createElement('span');badge.className='status-badge';badge.textContent=r.status;statusCell.appendChild(badge);tr.append(statusCell,cell(r.browser),cell(r.profile),cell(r.category),cell(r.route,'route'),cell(r.check),cell(r.message||''),cell(r.durationMs+'ms'));const evidenceCell=document.createElement('td');evidenceCell.innerHTML=r.artifact?'<button class="evidence-button detail-button" data-result-id="'+r.id+'"><img src="'+r.artifact+'" alt="실패 화면"><span>Evidence</span></button>':'<span class="no-evidence">-</span>';tr.appendChild(evidenceCell);const detailCell=document.createElement('td'),button=document.createElement('button');button.className='detail-button';button.dataset.resultId=r.id;button.textContent='상세 결과';detailCell.appendChild(button);tr.appendChild(detailCell);document.querySelector('#results').prepend(tr);filter()});
source.addEventListener('run.finished',async event=>{const s=JSON.parse(event.data).summary;completed=s.completedChecks;passed=s.passedChecks;warning=s.warningChecks;failedCount=s.failedChecks;for(const [id,key] of [['discovered','discoveredRoutes'],['routeInstances','routeInstances'],['completed','completedChecks'],['passed','passedChecks'],['warning','warningChecks'],['failed','failedChecks'],['affected','affectedRoutes']])setText(id,s[key]);setText('failureRate',s.checkFailureRate+'%');categoryCounts.clear();for(const [key,value] of Object.entries(s.byCategory))categoryCounts.set(key,value);browserCounts.clear();for(const [key,value] of Object.entries(s.byBrowser))browserCounts.set(key,value);profileCounts.clear();for(const [key,value] of Object.entries(s.byProfile))profileCounts.set(key,value);renderBars('categoryBars',categoryCounts);renderBars('browserBars',browserCounts);renderBars('profileBars',profileCounts);updateRates();setRunState('점검 완료','done');if(stopRunButton)stopRunButton.disabled=true;connection.textContent='체크 완료';source.close();try{const saved=await fetch('/result.json',{cache:'no-store'}).then(response=>response.json());resultData.splice(0,resultData.length,...saved);for(const row of document.querySelectorAll('#results tr')){const id=row.querySelector('.detail-button')?.dataset.resultId,r=resultData.find(item=>item.id===id);if(!r?.artifact)continue;const evidence=row.children[8];evidence.replaceChildren();const button=document.createElement('button');button.className='evidence-button detail-button';button.dataset.resultId=r.id;const img=document.createElement('img');img.src=r.artifact;img.alt='실패 화면';button.append(img,textElement('span','Evidence'));evidence.appendChild(button)}}catch{}renderFinal()});` : ''}
${live ? `source.addEventListener('run.cancelled',event=>{const s=JSON.parse(event.data).summary;completed=s.completedChecks;passed=s.passedChecks;warning=s.warningChecks;failedCount=s.failedChecks;for(const [id,key] of [['discovered','discoveredRoutes'],['routeInstances','routeInstances'],['completed','completedChecks'],['passed','passedChecks'],['warning','warningChecks'],['failed','failedChecks'],['affected','affectedRoutes']])setText(id,s[key]);setText('failureRate',s.checkFailureRate+'%');setRunState('점검 중지됨','cancelled');if(stopRunButton)stopRunButton.disabled=true;connection.textContent='중지됨';source.close();renderFinal()});` : ''}
</script>
</body>
</html>`;
}

export function writeHtmlReport(runDir: string, summary: RunSummary, results: CheckResult[]): void {
  fs.writeFileSync(path.join(runDir, 'index.html'), renderReportHtml(summary, results), 'utf8');
}
