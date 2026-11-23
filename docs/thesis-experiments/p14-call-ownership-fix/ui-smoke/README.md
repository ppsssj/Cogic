# VS Code UI smoke와 역사적 테스트 정책

## UI 결과

VS Code 1.147.0, Playwright 1.65.1에서 P14-B 확장을 `--extensionDevelopmentPath`로 로드하고 새 user-data·확장 폴더와 [작은 fixture](fixture/src/main.ts)를 사용했다. Marketplace 패키지를 설치하거나 P13을 재실행하지 않았다.

첫 실행에서는 `request`, typed `fetch`, `#dispatch` 멤버 행이 렌더링됐지만 클래스 내부 calls 엣지가 표시되지 않았다. Webview가 멤버들을 같은 부모 노드로 매핑한 뒤 source와 target이 같다는 이유로 엣지를 제거한 것이 원인이었다. 수정 후에는 서로 다른 자식 핸들을 가진 엣지만 유지하고 실제 자기호출과 접힌 그룹 내 관계는 기존처럼 숨긴다.

실제 Webview DOM 및 화면 좌표에서 `request → fetch`, `fetch → #dispatch`, `#dispatch → finish` calls와 앞 두 dataflow가 크기를 갖고 렌더링됨을 확인했다. 자기호출은 숨겨졌고 파일 그룹을 접고 다시 펼칠 수 있었다. `finish`를 더블클릭해 `target.ts`로 이동한 뒤 그래프의 `request`를 더블클릭해 `main.ts`로 복귀했다. 한 가지 작은 fixture의 smoke 결과이며 모든 그래프에서 선의 가독성을 보장하지는 않는다. 스크린샷은 격리 프로필에만 저장하고 공개하지 않았다.

## 재현

1. 저장소 루트에서 `npm run build:all`을 실행한다. VS Code 1.147.0 archive와 Node를 별도로 준비한다.
2. P13의 `tools/harness/`를 **새 임시 폴더**로 복사하고 그 폴더에서 `npm ci --ignore-scripts`를 실행한다. 이 폴더 안 `e2e/p14b-ui.spec.ts`로 [spec](p14b-ui.spec.ts)을 복사하고, `playwright.p14b.config.ts`를 하네스 루트에 복사한다. [fixture](fixture/)도 하네스 밖의 별도 새 폴더에 복사한다. 원래 하네스·연구 데이터는 사용자가 수정하지 않는다.
3. 하네스 루트에서 아래 네 환경 변수를 설정한다. `<새-프로필>`은 존재하지 않는 경로여야 하며, 테스트는 기존 디렉터리 사용을 거부한다.

```powershell
$env:STUDY_WORKSPACE = '<fixture-복사본>'
$env:VSCODE_EXE = '<VS-Code-1.147.0-Code.exe>'
$env:P14_EXTENSION_ROOT = '<Cogic-저장소>'
$env:P14_UI_PROFILE = '<새-프로필>'
npx playwright test -c playwright.p14b.config.ts e2e/p14b-ui.spec.ts
```

## P14-A 역사적 결함 테스트

수정 전 버전에서만 통과하는 [원본 테스트 사본](evidence/hono-h2-minimal.original.txt)은 Git 기준 바이트 SHA256 `270d1b091623a3cc4134ffb89d6e19a1c6d7a8409482eb10c043595d5d1b1fcd`으로 보존한다. `48e7058`의 별도 checkout에서 원본이 통과함을 확인했다. 현재 테스트 파일은 기본적으로 skip하여 현재 제품 테스트와 섞이지 않는다. 과거 analyzer를 컴파일한 별도 checkout에서만 opt-in한다.

```powershell
$env:COGIC_P14A_HISTORICAL = '1'
node --test docs/thesis-experiments/p14-accuracy/tools/hono-h2-minimal.test.cjs
Remove-Item Env:COGIC_P14A_HISTORICAL
```

현재 제품의 기대 동작은 `npm test`의 `P14 call ownership` 테스트와 위 UI smoke로 확인한다. 과거 테스트를 현재 analyzer에서 강제로 실행하면 결함이 수정됐으므로 실패하는 것이 정상이다.
