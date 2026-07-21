# Site Check Pro verification

배포 전 아래 명령으로 타입 검사, 빌드, 테스트 및 패키지 구성을 확인합니다.

```bash
npm install --include=dev
npm run check
npm pack --dry-run
```

Windows에서도 테스트 파일 검색이 동작하도록 테스트 명령은 `node --test`를 사용합니다.

패키지 설치 검증 예시:

```powershell
npm install -D .\site-check-pro-0.1.7.tgz
npx site-check-pro --help
npx site-check-pro init http://localhost:3000
npx site-check-pro run --ui
```
