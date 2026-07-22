# Site Check Pro

Playwright 기반 웹서비스 점검 도구입니다. 패키지를 설치한 뒤 `npx site-check-pro run`으로 Storybook처럼 로컬 콘솔을 띄우고, 콘솔에서 비로그인/로그인 프로필을 선택해 사이트를 점검합니다.

개발자는 설정 파일로 점검 범위를 관리하고, QA팀이나 일반 관리자는 브라우저 화면에서 로그인 정보를 저장하고 결과를 확인할 수 있습니다.

<p>
  <img src="https://github.com/yoo94/site-check-pro/blob/main/public/1.png" alt="Site Check Pro 점검 콘솔" width="760">
</p>

## 주요 기능

- `guest`, `member` 같은 프로필을 체크박스로 선택해 비로그인/로그인 상태를 함께 점검
- 로그인 정보 저장 화면 제공. QA팀이나 관리자가 직접 로그인한 뒤 저장 가능
- 경로 탐색, 렌더링, 콘솔 오류, 네트워크 실패, 새로고침, 뒤로가기 점검
- 실시간 점검 대시보드와 최종 HTML 리포트 생성
- 실패 항목의 Evidence 캡처와 상세 진단 정보 제공
- 이전 점검 결과 목록, 요약, 상세 결과 확인
- React, Vue, Next.js 등 프레임워크와 무관하게 사용 가능

## 설치

Node.js 20 이상이 필요합니다.

```bash
npm install --save-dev site-check-pro
```

또는:

```bash
yarn add -D site-check-pro
pnpm add -D site-check-pro
```

## 빠른 시작

처음에는 `init`으로 설정 파일을 만들고 브라우저를 설치합니다.

```bash
npx site-check-pro init
```

`init`을 실행하면 `site-check-pro.config.ts`가 생성됩니다. 대화형 터미널에서는 Chromium, Firefox, WebKit 중 사용할 브라우저를 선택하고 바로 설치할 수 있습니다.

브라우저 설치를 건너뛴 경우에는 나중에 따로 설치하세요.

```bash
npx site-check-pro install-browsers chromium
npx site-check-pro install-browsers chromium firefox webkit
npx site-check-pro install-browsers --all
```

## 실행 콘솔

```bash
npx site-check-pro run
```

`run`을 실행하면 로컬 콘솔이 열립니다. 콘솔에서 점검할 프로필을 체크하고 `점검 시작`을 누르면 바로 실시간 대시보드로 이동합니다.

- `guest`만 선택: 로그인 없이 점검
- `guest`와 `member` 선택: 비로그인 점검 후 로그인 상태까지 점검
- `member`를 선택했는데 로그인 정보가 없으면 저장 안내 표시
- `현재 점검 확인`: 진행 중이거나 완료된 현재 리포트로 이동
- `점검 중지`: 진행 중인 점검을 멈추고 현재까지의 결과를 저장
- `이전 점검 결과 보기`: 저장된 점검 결과 목록과 상세 확인

<p>
  <img src="https://github.com/yoo94/site-check-pro/blob/main/public/3.png" alt="실시간 점검 대시보드 요약 화면" width="900">
</p>

실시간 대시보드는 점검 중/완료/중지 상태를 표시하고, 진행된 체크 수와 실패율을 즉시 업데이트합니다. 실행 시간은 한국시간 기준으로 표시됩니다. 점검 중에는 상단의 `점검 중지` 버튼으로 현재 실행을 멈출 수 있습니다.

## 설정 파일

`site-check-pro.config.ts`는 점검 대상과 탐색 범위를 관리합니다.

```ts
import { defineConfig } from 'site-check-pro';

export default defineConfig({
  baseURL: 'https://example.com',
  browsers: ['chromium'],
  profiles: {
    guest: {
      seeds: ['/'],
      exclude: ['/mypage/**'],
    },
    member: {
      storageState: '.site-check-pro/auth/member.json',
      seeds: ['/'],
      exclude: ['/login', '/signup'],
    },
  },

  // 로컬 개발 서버를 함께 띄워야 하는 경우 사용합니다.
  // webServer: {
  //   command: 'npm run dev',
  //   url: 'http://localhost:3000',
  //   reuseExisting: true,
  // },

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

`baseURL`, `crawl.exclude`, `profiles.*.exclude`, `checks` 같은 값은 코드에 하드코딩하지 않고 설정 파일에서 관리하는 방식이 기본입니다.
`crawl.exclude`는 모든 프로필에 공통으로 적용되고, `profiles.guest.exclude`처럼 프로필 안에 둔 exclude는 해당 프로필 탐색에만 적용됩니다.

## 로그인 정보 저장

로그인 상태 점검이 필요하면 콘솔에서 `로그인 정보 저장`을 누르세요. 저장 페이지가 먼저 열리고, 그 안에서 로그인 페이지를 열어 실제 서비스에 로그인한 뒤 다시 저장 페이지로 돌아와 저장합니다.

CLI로 저장 페이지만 직접 열 수도 있습니다.

```bash
npx site-check-pro auth
```

기본 프로필은 `member`이며 저장 위치는 다음과 같습니다.

```text
.site-check-pro/auth/member.json
.site-check-pro/auth/member.profile.json
```

다른 프로필 이름이나 로그인 URL을 지정할 수도 있습니다.

```bash
npx site-check-pro auth admin --url https://example.com/login
```

저장된 인증 파일은 쿠키와 토큰을 포함할 수 있습니다. `.site-check-pro/`는 Git에 커밋하지 마세요. `init`은 `.gitignore`에 이 경로를 자동으로 추가합니다.

## 상세 결과와 Evidence

실시간 상세 결과에서는 각 체크의 상태, 브라우저, 프로필, 경로, 점검명, 진단 메시지, 소요 시간을 볼 수 있습니다. 실패 항목에는 가능한 경우 Evidence 캡처가 붙습니다.

<p>
  <img src="https://github.com/yoo94/site-check-pro/blob/main/public/4.png" alt="실시간 상세 결과 테이블" width="900">
</p>

`상세 결과`를 누르면 실패 원인과 기술 진단 정보를 다이얼로그에서 확인할 수 있습니다.

<p>
  <img src="https://github.com/yoo94/site-check-pro/blob/main/public/5.png" alt="실패 상세 결과와 Evidence 다이얼로그" width="760">
</p>

## 이전 점검 결과

점검 결과는 실행마다 `.site-check-pro/runs/<run-id>` 아래에 저장됩니다.

- `summary.json`: 점검 요약과 통계
- `result.json`: 전체 체크 상세 결과
- `index.html`: 독립 실행형 HTML 리포트
- `artifacts/`: 실패 캡처 등 증거 파일

콘솔의 `이전 점검 결과 보기`를 누르면 저장된 결과 목록이 열리고, 선택한 실행의 요약과 상세를 확인할 수 있습니다.

<p>
  <img src="https://github.com/yoo94/site-check-pro/blob/main/public/2.png" alt="이전 점검 결과 목록" width="760">
</p>

최근 결과를 파일로 다시 열려면:

```bash
npx site-check-pro report open
```

특정 실행 폴더를 열려면:

```bash
npx site-check-pro report open ".site-check-pro/runs/<run-id>"
```

## 실행 옵션

대상 URL을 임시로 바꿔 실행:

```bash
npx site-check-pro run https://staging.example.com
```

브라우저 창을 보면서 실행:

```bash
npx site-check-pro run --headed
```

여러 브라우저로 실행:

```bash
npx site-check-pro run --browser chromium,firefox,webkit
```

브라우저가 없으면 자동 설치:

```bash
npx site-check-pro run -y
```

## React, Vue, Next.js에서 사용

Site Check Pro는 앱 코드 안에 컴포넌트를 넣는 방식이 아니라, 실행 중인 웹서비스를 외부에서 점검하는 방식입니다. 그래서 React, Vue, Next.js 모두 같은 흐름으로 사용합니다.

React/Vue/Vite 프로젝트:

```ts
import { defineConfig } from 'site-check-pro';

export default defineConfig({
  baseURL: 'http://localhost:5173',
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExisting: true,
  },
  browsers: ['chromium'],
  crawl: {
    maxPages: 50,
    maxDepth: 3,
    exclude: ['/logout', '/payment/**'],
  },
});
```

Next.js 프로젝트:

```ts
import { defineConfig } from 'site-check-pro';

export default defineConfig({
  baseURL: 'http://localhost:3000',
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExisting: true,
  },
  browsers: ['chromium'],
  crawl: {
    maxPages: 80,
    maxDepth: 4,
    exclude: ['/api/**', '/logout', '/payment/**'],
  },
});
```

실행은 동일합니다.

```bash
npx site-check-pro run
```

## 로컬 tgz로 테스트

npm 배포 전에 현재 패키지를 압축해서 다른 프로젝트에서 설치해볼 수 있습니다.

```bash
npm pack
```

생성된 파일을 테스트 프로젝트에서 설치합니다.

```bash
npm install /path/to/site-check-pro-0.1.8.tgz
npx site-check-pro init https://example.com
npx site-check-pro run
```

또는 이 프로젝트에서 압축 파일 내용만 미리 확인합니다.

```bash
npm pack --dry-run
```

## 배포 전 확인

```bash
npm run check
npm pack --dry-run
npm publish
```

## Git에 올리지 말아야 할 파일

```gitignore
.site-check-pro/
```

`.site-check-pro/auth`에는 인증 정보가 들어갈 수 있고, `.site-check-pro/runs`에는 실행 결과와 Evidence가 쌓입니다.

## 라이선스

MIT License
