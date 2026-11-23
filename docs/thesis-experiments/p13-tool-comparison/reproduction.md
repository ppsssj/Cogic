# 재현과 보존 자료

자리표시자: `<HARNESS_WORKDIR>`(UI 하네스 작업 폴더, 이 저장소 밖), `<P13>`(P13 실험 폴더), `<WORK>`(P11 작업 복사본 폴더), `<COGIC_REPO>`(이 저장소).

## 재현 가능 수준

| 수준 | 상태 | 확인 범위와 한계 |
|---|---|---|
| 기존 데이터 및 판정 검증 | **가능** | 아래 오프라인 검증기로 실행 수, 종료 상태, 원본 판정, C1–C3의 실패 단계·로그 및 대표 판정과 조작 수를 대조한다. 기록된 UI 관찰의 진실성까지 독립적으로 증명하는 것은 아니다. |
| 저장된 데이터로 집계 재생성 | **부분 가능** | 검증기는 원본 기록에서 판정 정정을 계산하고 기존 요약의 분류·조작 수·중앙값을 대조한다. 기존 CSV 전체 열을 새 파일로 재생성하지는 않는다. 원본 `aggregate-p13.cjs`는 원래 디렉터리 구조와 전체 `run.log`가 필요해 새 체크아웃에서 그대로 실행할 수 없다. |
| 다른 PC에서 실제 VS Code UI 실험 재실행 | **부분 가능** | P1/P2/P13 스펙, 공통 라이브러리, 설정과 잠금 파일을 보존했고 테스트 목록 로딩을 확인했다. Stage A 예제는 비공개 저장소에 있고 공개 라이선스를 확인하지 못해 포함하지 않았다. 동일 예제를 적법하게 확보해야 하며, 당시 하네스의 측정 시점 해시가 없어 현 사본이 당시 버전과 동일했는지 증명할 수 없다. 전체 실험은 재실행하지 않았다. |

## 1. 네트워크 없는 검증

Node.js에서 P13 디렉터리를 현재 디렉터리로 하여 실행한다. 추가 패키지, VS Code, 네트워크는 필요하지 않으며 데이터를 수정하거나 파일을 쓰지 않는다.

```powershell
node tools/analysis/verify-archived-results.cjs
```

새 로컬 Git 체크아웃에서도 이 명령이 통과했다. 요약 CSV의 판정을 임시 복사본에서 변조했을 때는 불일치를 보고하고 실패했다.

12개 Stage A 실행과 48개 Stage B 실행의 조합·종료 상태, 원본 과제 판정과 실패 단계, C1 6건·C2 3건·C3 3건, 64개 요약 행의 대표 판정과 조작 수를 검사한다. 불일치 시 오류를 표시하고 종료 코드 1을 반환한다. 나머지 UI 세부 관찰, 모든 요약 열과 화면 내용의 진위는 자동 검증 대상이 아니다. 정정에 사용된 로그는 `data/correction-logs/`의 경로 치환 사본이며 12개 원본을 같은 치환 규칙으로 복사한 결과와 대조했다. 실패 단계는 `steps.csv`에도 보존되어 있다.

## 2. 복구 자료와 출처

[data/source-inventory.csv](data/source-inventory.csv)는 60개 실행에 대한 원래 환경 파일, 결과, 로그, 411개 단계 스크린샷과 선택한 하네스·예제 파일의 존재 여부, 바이트 수, SHA256 및 공개 여부를 기록한다. `<HARNESS>`, `<FIXTURE>`, `<P13>`은 연구실 PC의 경로 별칭이며 해시는 **로컬 원본 바이트**의 값이다. 공개 사본은 경로 치환으로 해시가 다를 수 있다. 조사 당시 스크린샷은 존재했지만 전체 이미지의 개인정보와 재배포 권리를 확인하지 못해 포함하지 않았다. 선별된 대표 그림은 기존 `figures/`에 있다.

하네스는 Git 이력이 없는 연구실 작업 폴더에서 복사했다. P13 스펙과 설정은 이전 PR 사본과 바이트가 같았다. 예제 4개 소스, `package.json`, `tsconfig.json`, 디버그 설정 2개는 측정 전 SHA256 기록과 현재 로컬 파일이 일치한다. 예제의 출처인 `ppsssj/cogic_example`은 조사 시 비공개이며 공개 라이선스가 확인되지 않아 예제와 디버그 설정은 배포하지 않는다. 나머지 정정 외 로그도 개인정보 검토 및 필요 범위를 고려해 포함하지 않았다.

## 3. UI 재실행 준비 (추가 자료 필요)

다음은 실험 재실행의 개요이며 원본 기록 검증에 필요하지 않다. 깨끗한 별도 작업 디렉터리를 사용한다. 운영체제, VS Code와 확장 버전 및 VSIX SHA256은 [tools-and-versions.md](tools-and-versions.md)를 따른다. 외부 VSIX, VS Code와 의존성은 배포하지 않는다.

1. `tools/harness/`를 분석 대상 프로젝트 **밖의** 독립 폴더로 복사하고 그곳에서 `npm ci --ignore-scripts`를 실행한다. `p13-real.spec.ts`를 `e2e/p13-real.spec.ts`로 복사한다. Node.js v24.12.0, Playwright 1.65.1, @vscode/test-electron 3.1.0을 사용했다.
2. Stage A는 권한을 가진 비공개 예제 사본(소스 4개와 `.vscode/launch.json`, `tasks.json`, TypeScript 설정 및 의존성)이 필요하다. Stage B는 [P11 재현 절차](../p11-real-world/reproduction.md)의 고정 커밋 hono `cd50668`, vite `3567471` 작업 복사본이 필요하다.
3. VS Code 1.147.0 archive와 [지정된](tools-and-versions.md) 세 확장을 격리 폴더에 설치하고 `VSCODE_EXE`, `P4_EXTENSIONS_DIR`, `STUDY_WORKSPACE`를 지정한다. Stage B는 `P13_TASK`, `P13_ANSWER_KEY`도 지정한다. 파일 복사 후 `npx playwright test -c playwright.config.ts e2e/p1-cogic.spec.ts e2e/p2-compare.spec.ts --list`, `npx playwright test -c playwright.p13.config.ts e2e/p13-real.spec.ts --list`로 로딩을 점검할 수 있다(후자에는 `P13_TASK`와 `P13_ANSWER_KEY`가 필요). 임시 폴더에서 각각 테스트 4개가 목록화됐다.
4. 원래 실행기 `tools/runners/run-stage-a.ps1`, `run-stage-b.ps1`의 `<HARNESS_WORKDIR>`, `<P13>`, `<WORK>`, `<COGIC_REPO>`를 실제 경로로 바꿔 별도 사본을 사용한다. 이 실행기들은 연구실 경로와 프로세스 이름을 가정하므로 환경에 맞게 검토해야 한다. 기존 출력 디렉터리를 사용하면 exit 0만 건너뛰고 실패한 TFF H2를 재시도할 수 있다.

Stage A 예제는 P3의 4파일 예제(`src/demo.ts`, `receipt.ts`, `money.ts`, `runner.ts`, `.vscode/launch.json`, `tasks.json`)다. 원본 저장소 `ppsssj/cogic_example`에 실행용 `runner.ts`를 추가했다. Stage B 작업 복사본의 의존성은 lockfile 그대로 `--ignore-scripts`로 설치한다.

비교 도구 VSIX는 다음 Marketplace 주소에서 확보하고 SHA256을 확인한다.

- Trace Function Flow 1.1.1: `https://marketplace.visualstudio.com/_apis/public/gallery/publishers/sudopanda/vsextensions/trace-function-flow/1.1.1/vspackage`
- Context Graph 0.10.9: `https://marketplace.visualstudio.com/_apis/public/gallery/publishers/context-graph/vsextensions/context-graph/0.10.9/vspackage`

Cogic 테스트 VSIX는 이 저장소의 main `cef96eb`에서 빌드한다. 세 VSIX는 하네스가 도구별 프로필로 복사할 수 있도록 하나의 격리된 확장 폴더에 설치한다. 아래의 자리표시자는 실제 경로로 바꾼다.

```powershell
npm ci
npm run build:all
npx @vscode/vsce package -o <P13>\vsix\cogic-main-cef96eb-TEST.vsix
& "<HARNESS_WORKDIR>\harness\.vscode-test\vscode-win32-x64-archive-1.147.0\bin\code.cmd" --user-data-dir <P13>\install-user-data --extensions-dir <P13>\extensions --install-extension <vsix>
```

실행기와 원본 집계기는 별도 작업 사본에서 사용한다. 원본 집계기는 `data/stage-a`·`data/stage-b`의 환경 파일과 하네스의 `runs/<runId>/<suite>/` 구조 및 `run.log`를 요구한다. 저장소에는 환경 파일이 `data/runs-env/`에 있고 실행 자료도 `data/runs/<runId>/`로 평탄화되어 있으므로, 자리표시자만 바꿔서는 저장된 자료를 집계할 수 없다.

```powershell
powershell -File tools\runners\run-stage-a.ps1 -Runs 3
powershell -Command "& 'tools\runners\run-stage-b.ps1' -Tasks H1,H2,V1,V2 -Runs 3"
node tools\analysis\aggregate-p13.cjs <P13>\summary
```

기존 결과를 덮어쓰거나 재측정 결과와 혼합하지 않는다. 현재 검증은 실행 기록의 정합성 점검과 테스트 목록 로딩이며 전체 UI 실험의 성공을 보증하지 않는다.

## 4. 파일

| 경로 | 내용 |
|---|---|
| `tools/harness/` | 공통 라이브러리, Stage A·B 스펙, 설정 및 의존성 잠금 파일 |
| `tools/runners/run-stage-a.ps1`, `run-stage-b.ps1` | 실행기(메모리 게이트, 재개, 작업 복사본 확인) |
| `tools/analysis/` | 원본 집계기, 공개용 경로 치환기 및 오프라인 검증기 |
| `data/stage-a-*.{csv,json}`, `data/stage-b-*.{csv,json}` | 요약과 실행별 결과 |
| `data/runs/<runId>/`, `data/runs-env/` | 실행별 기록과 환경 정보. 경로는 자리표시자로 바꿈 |
| `data/correction-logs/` | 판독 정정 C1–C3에 관련된 12개 로그의 공개용 사본 |
| `figures/` | 대표 스크린샷 |
