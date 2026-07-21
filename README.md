# Site Check Pro

Playwright 기반으로 웹사이트의 경로를 탐색하고 페이지·API·새로고침·뒤로가기를 점검하며, 실시간 대시보드와 최종 리포트를 만드는 프레임워크 독립형 도구입니다.

## 이름과 기본 경로

- npm 패키지: `site-check-pro`
- CLI 명령: `site-check-pro`
- 설정 파일: `site-check-pro.config.ts`
- 결과 폴더: `.site-check-pro/runs`
- 로그인 상태: `.site-check-pro/auth`

## 요구 사항

- Node.js 20 이상
- 점검할 웹사이트 또는 로컬 개발 서버

## 설치 및 시작

```bash
npm install --save-dev site-check-pro
npx site-check-pro init
npx site-check-pro run --ui
npx site-check-pro auth member --url [로그인url] 
```

```bash
yarn add  site-check-pro
yarn site-check-pro init  
yarn site-check-pro run --ui
yarn site-check-pro auth member --url [로그인url]
```

로그인할 경로들어가서 로그인 후 터미널에서 엔터치면 토큰 등을 저장하여 사용됩니다.
토큰은 oauth등의 시간별로 재발급 받으시는게 좋습니다.


초기화할 때 사용할 브라우저를 선택할 수 있습니다. 나중에 별도로 설치하려면:

```bash
npx site-check-pro install-browsers chromium
npx site-check-pro install-browsers chromium firefox webkit
npx site-check-pro install-browsers --all
```

## 설정 예시

`site-check-pro.config.ts`:

```ts
import { defineConfig } from 'site-check-pro';

export default defineConfig({
  baseURL: 'https://example.com',
  browsers: ['chromium'],
  profiles: {
    guest: { seeds: ['/'] },
    member: {
      storageState: '.site-check-pro/auth/member.json',
      seeds: ['/mypage'],
    },
  },
  crawl: {
    maxPages: 100,
    maxDepth: 5,
    exclude: ['/logout', '/delete/**', '/payment/**'],
    linkAttributes: ['href', 'data-href', 'data-route', 'data-url'],
  },
  checks: {
    reload: true,
    history: true,
  },
  dashboard: {
    enabled: false,
    port: 4177,
    open: true,
  },
});
```

## 로그인 상태 저장

```bash
npx site-check-pro auth member --url https://example.com/login
```

열린 브라우저에서 로그인한 뒤 안내에 따라 저장하면 `.site-check-pro/auth/member.json`이 생성됩니다. 이 폴더는 인증 정보를 포함할 수 있으므로 Git에 커밋하지 마세요.

## 실행

```bash
npx site-check-pro run
npx site-check-pro run --ui
npx site-check-pro run --headed
npx site-check-pro run --browser chromium,firefox,webkit
```

`--ui`를 사용하면 요약 분석, 실시간 상세 결과, 최종 결과 탭을 제공하는 대시보드가 열립니다. 실패 항목에는 가능한 경우 Evidence 캡처가 연결됩니다.

## 결과 확인

각 실행 결과는 `.site-check-pro/runs/<run-id>`에 저장됩니다.

- `summary.json`: 합계와 경로 통계
- `result.json`: 전체 상세 결과
- `index.html`: 독립 실행형 HTML 리포트
- `artifacts/`: 실패 캡처 등 증거 파일

최근 결과를 다시 열려면:

```bash
npx site-check-pro report open
npx site-check-pro report open ".site-check-pro/runs/<run-id>"
```

## npm 배포 전 확인

```bash
npm install --include=dev
npm run check
npm pack --dry-run
npm publish
```

MIT License
