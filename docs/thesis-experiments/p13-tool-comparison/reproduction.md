# 재현

자리표시자: `<HARNESS_WORKDIR>`(UI 하네스 작업 폴더, 이 저장소 밖), `<P13>`(P13 실험 폴더), `<WORK>`(P11 작업 복사본 폴더), `<COGIC_REPO>`(이 저장소).

## 1. 준비
```powershell
# 비교 도구 VSIX (Marketplace vspackage) — SHA256은 tools-and-versions.md와 일치해야 함
#   https://marketplace.visualstudio.com/_apis/public/gallery/publishers/sudopanda/vsextensions/trace-function-flow/1.1.1/vspackage
#   https://marketplace.visualstudio.com/_apis/public/gallery/publishers/context-graph/vsextensions/context-graph/0.10.9/vspackage
# Cogic 테스트 VSIX: 이 저장소 main cef96eb에서
npm ci; npm run build:all; npx @vscode/vsce package -o <P13>\vsix\cogic-main-cef96eb-TEST.vsix
# 세 VSIX를 하나의 확장 폴더에 설치(하네스가 도구별 프로필로 복사해 쓴다)
& "<HARNESS_WORKDIR>\harness\.vscode-test\vscode-win32-x64-archive-1.147.0\bin\code.cmd" --user-data-dir <P13>\install-user-data --extensions-dir <P13>\extensions --install-extension <vsix>
```
- Stage A 예제: P3의 4파일 예제(`src/demo.ts`, `receipt.ts`, `money.ts`, `runner.ts`, `.vscode/launch.json`, `tasks.json`). 원본 저장소 `ppsssj/cogic_example` + 실행용 `runner.ts`.
- Stage B: P11과 같은 고정 커밋(hono `cd50668`, vite `3567471`)의 작업 복사본. 의존성은 lockfile 그대로 `--ignore-scripts`로 설치([../p11-real-world/reproduction.md](../p11-real-world/reproduction.md)).

## 2. 실행
```powershell
# Stage A — P3 스펙(무수정), 3회, 도구 순서 회전
powershell -File tools\runners\run-stage-a.ps1 -Runs 3
# Stage B — e2e/p13-real.spec.ts + playwright.p13.config.ts를 하네스에 두고
powershell -Command "& 'tools\runners\run-stage-b.ps1' -Tasks H1,H2,V1,V2 -Runs 3"   # -File로는 배열 인자가 한 문자열이 됨
# 집계
node tools\analysis\aggregate-p13.cjs <P13>\summary
```

## 3. 파일
| 경로 | 내용 |
|---|---|
| `tools/harness/p13-real.spec.ts`, `playwright.p13.config.ts` | Stage B 스펙과 설정 |
| `tools/runners/run-stage-a.ps1`, `run-stage-b.ps1` | 실행기(메모리 게이트, 재개, 작업 복사본 확인) |
| `tools/analysis/aggregate-p13.cjs`, `sanitize.cjs` | 집계, 공개용 경로 치환 |
| `data/stage-a-*.{csv,json}`, `data/stage-b-*.{csv,json}` | 요약과 실행별 결과 |
| `data/runs/<runId>/` | 실행별 증거(작업 기록 `tasks.csv`/`p13-tasks.json`, `evidence.json`, 실행 로그). 경로는 자리표시자로 바꿈 |
| `figures/` | 대표 스크린샷 |
