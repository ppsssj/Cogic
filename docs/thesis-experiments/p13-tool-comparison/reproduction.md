# 재현

자리표시자: `<HARNESS_WORKDIR>`(UI 하네스 작업 폴더, 이 저장소 밖), `<P13>`(P13 실험 폴더), `<WORK>`(P11 작업 복사본 폴더), `<COGIC_REPO>`(이 저장소).

## 재현 가능 범위와 누락 자료

**이 저장소만으로는 실험 실행이나 원본 집계 스크립트의 재실행을 독립적으로 재현할 수 없다.** P13 스펙은 외부 하네스의 `e2e/lib`와 Playwright 설정·의존성에 의존하고, Stage A에는 외부의 P1/P2 스펙과 예제가 필요하다. 이 하네스의 버전 고정 식별자와 전체 소스는 이 PR에 포함되지 않는다. 원래 실행 환경의 하네스가 있어도 동일 파일인지 독립적으로 확인할 수 없다.

커밋된 `data/runs/`의 `result.json`, `steps.csv`, `evidence.json`, `p13-tasks.json` 및 `data/runs-env/`는 기존 분류와 실패 단계를 점검하는 데 쓸 수 있다. `run.log`는 `*.log` 무시 규칙 때문에 Git에 없고, 단계별 스크린샷도 포함되지 않는다. 문서에 별도로 수록한 대표 `figures/`는 포함된다. 따라서 집계 스크립트가 참조하는 `run.log`와 모든 UI 증거를 새 체크아웃에서 직접 확인할 수는 없다.

아래 명령은 **필요한 외부 하네스를 확보한 경우의 절차 개요**다. 스크립트 안의 `<...>` 경로를 실제 경로로 바꾸고, P13 스펙과 설정을 하네스에 복사해야 한다. 집계기는 `data/stage-a`·`data/stage-b`의 환경 파일과 하네스의 `runs/<runId>/<suite>/` 구조 및 `run.log`를 요구한다. 저장소에는 환경 파일이 `data/runs-env/`에 있고 실행 자료도 `data/runs/<runId>/`로 평탄화되어 있으므로, 자리표시자만 바꿔서는 저장된 자료를 집계할 수 없다. 원자료를 덮어쓰지 않도록 별도 작업 복사본과 출력 폴더를 사용한다.

실행기는 exit 0 기록만 재개 대상으로 건너뛰므로 기존 출력 경로에서 실행하면 실패한 TFF H2 3회를 다시 시도할 수 있다. 이 PR의 결과 검토에는 재실행이 필요하지 않다.

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
| `data/runs/<runId>/` | 실행별 기록(`tasks.csv`/`p13-tasks.json`, `result.json`, `steps.csv`, `evidence.json`). 경로는 자리표시자로 바꿈; 로그와 단계별 스크린샷은 미포함 |
| `figures/` | 대표 스크린샷 |
