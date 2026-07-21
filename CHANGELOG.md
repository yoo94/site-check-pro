# Changelog

## 0.1.7

- npm 패키지와 CLI 이름을 `site-check-pro`로 변경
- 기본 설정 파일을 `site-check-pro.config.ts`로 변경
- 결과 및 인증 폴더를 `.site-check-pro`로 변경
- 대시보드와 리포트 표시명을 `Site Check Pro`로 통일
- Windows 호환 테스트 명령 `node --test` 적용

## 0.1.5

- 완료 상태 문구를 `체크 완료`로 통일하고 완료 후 재연결 표시 방지
- `상세 결과` 탭을 `실시간 상세 결과`로 변경
- 최종 결과 다이얼로그를 독립된 `최종 결과` 탭으로 전환
- 요약 분석의 발견 경로 카드에서 탐색 경로 목록 제공
- 실패 카드를 누르면 `failed` 필터가 적용된 실시간 상세 결과로 이동

## 0.1.4

- 상세 결과 전체 필드 오름차순·내림차순 정렬 추가
- 상태 필터를 `failed`, `warning`, `passed`, `skipped` 영문 코드로 표기
- 중복 `results.json` 제거 및 `result.json` 단일화
- 실행 완료 시 경로별 최종 요약 다이얼로그 자동 표시
- 상세 테이블에서 Evidence 스크린샷 썸네일과 확대 보기 제공

## 0.1.3

- 원본 JSON 바로가기를 제거하고 `요약 분석`, `상세 결과` 화면 전환으로 변경
- 종합 품질 판정, 핵심 지표 카드, 실패 분포 차트를 갖춘 분석형 리포트로 개편
- 상세 결과 검색·상태 필터와 실패별 기술 진단·증거 이미지 조회 흐름 개선
- 실시간 실행 중 종합 판정과 상세 실패 건수도 함께 갱신

## 0.1.2

- 전체 실패 데이터와 artifact 미리보기를 제공하는 상세 결과 창 추가
- 상태, 분류, 브라우저, 프로필별 대시보드 차트 추가
- `summary.json`, `result.json` 바로가기 추가
- 기존 `results.json`과 호환되는 `result.json` 결과 파일 추가

## 0.1.1

- `playwright`를 런타임 dependency로 포함해 별도 패키지 설치가 필요 없도록 변경
- 기본 브라우저를 Chromium으로 변경
- 초기화 명령에 Chromium/전체/직접 선택/나중에 설치 대화형 메뉴 추가
- 실행 및 인증 명령에서 누락 브라우저 설치 안내 및 확인 추가
- `install-browsers`에 브라우저 인자, `--all`, `--with-deps` 옵션 추가
- Playwright CLI를 패키지 내부 경로로 직접 실행하도록 변경

## 0.1.0

- Initial MVP
- Chromium, Firefox, and WebKit execution
- Framework-agnostic link crawling
- Guest and authenticated profiles
- Reload and browser-history checks
- Console, network, render, navigation, and API checks
- Continue-on-error execution
- SSE live dashboard
- HTML, JSON, and JSONL reports
- Local development server lifecycle support
