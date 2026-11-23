# 재현

## 환경
| 항목 | 값 |
|---|---|
| 하드웨어 | Intel Core i5-9400F(6C/6T), RAM 8 GB(7.9 GB 인식), NVIDIA GeForce GT 710 |
| OS | Windows 11 Pro 10.0.26100 |
| 런타임 | Node.js v24.12.0, git 2.52, pnpm 12.21(typeorm은 저장소 지정 pnpm 10.34.9), yarn 1.22.22(excalidraw) |
| TypeScript | 5.9.3 (Cogic v0.0.6 의존성, 분석기 변형 빌드와 측정에 동일하게 사용) |
| VS Code | 1.147.0 win32-x64 archive(격리 user-data / extensions) |
| 자동화 | Playwright 1.65.1(Electron) — UI 하네스는 이 저장소에 없음(P4–P10과 같은 별도 작업 폴더) |

## 경로 자리표시자
`tools/`의 스크립트는 로컬 경로를 다음 자리표시자로 바꿔 두었다: `<P11>`(실험 폴더: `projects/`, `work/`, `variants/`, `targets/`, `data/`), `<COGIC_REPO>`(Cogic 저장소), `<HARNESS_WORKDIR>`(UI 하네스 작업 폴더), `<RESULTS>`(P4–P10 결과 폴더).

## 1. 대상 준비
```bash
mkdir -p <P11>/projects && cd <P11>/projects
git clone --depth 1 https://github.com/honojs/hono.git   && git -C hono checkout cd50668335738d170ecd03e783f2f2d5317b95d6
# 나머지도 project-selection.md의 고정 SHA로 (shallow clone이 해당 SHA를 포함하지 않으면 git fetch --depth 1 origin <sha>)
pnpm --dir hono install --frozen-lockfile --ignore-scripts
pnpm --dir vite install --frozen-lockfile --ignore-scripts
pnpm --dir query install --frozen-lockfile --ignore-scripts
npx --yes pnpm@10.34.9 --dir typeorm install --frozen-lockfile --ignore-scripts   # 프로젝트 폴더 밖에서 실행
(cd excalidraw && npx --yes yarn@1.22.22 install --frozen-lockfile --ignore-scripts)
# 작업 복사본: git worktree add --detach <P11>/work/<p> HEAD, 각 node_modules 폴더를 같은 상대 경로에 junction으로 연결
node tools/analyzer/make-target.cjs hono       <P11>/work/hono       src                   <P11>/targets/hono.json
node tools/analyzer/make-target.cjs excalidraw <P11>/work/excalidraw packages/excalidraw   <P11>/targets/excalidraw.json
node tools/analyzer/make-target.cjs vite       <P11>/work/vite       packages/vite/src     <P11>/targets/vite.json
node tools/analyzer/make-target.cjs typeorm    <P11>/work/typeorm    packages/typeorm/src  <P11>/targets/typeorm.json
node tools/analyzer/make-target.cjs query      <P11>/work/query      packages/query-core/src <P11>/targets/query.json
```

## 2. 분석기 변형 빌드
```bash
# adaptive = v0.0.6 그대로; fixed800 = v0.0.6 + 396923c의 src/analyzer/{analyze,index}.ts + tools/variants/fixed800-instrumentation.diff
for v in adaptive fixed800; do mkdir -p <P11>/variants/$v; git -C <COGIC_REPO> archive v0.0.6 src tsconfig.json package.json | tar -x -C <P11>/variants/$v; done
git -C <COGIC_REPO> show 396923c:src/analyzer/analyze.ts > <P11>/variants/fixed800/src/analyzer/analyze.ts
git -C <COGIC_REPO> show 396923c:src/analyzer/index.ts  > <P11>/variants/fixed800/src/analyzer/index.ts
# instrumentation diff 적용 후, 각 변형에 node_modules junction(<COGIC_REPO>/node_modules)을 만들고
node node_modules/typescript/bin/tsc -p .      # 각 변형 폴더에서
# (진단) adaptive-sk = v0.0.6 + tools/variants/adaptive-sk-diagnostic.diff
```

## 3. 분석기 벤치마크와 검증
```bash
node tools/analyzer/run-p11.cjs p11-hono hono          # 프로젝트마다 하나씩 (중단되면 같은 명령으로 재개)
node tools/analyzer/run-p11.cjs p11-excalidraw excalidraw
node tools/analyzer/run-p11.cjs p11-vite vite
node tools/analyzer/run-p11.cjs p11-typeorm typeorm
node tools/analyzer/run-p11.cjs p11-query query
node tools/analyzer/check-project.cjs <P11>/data/p11-hono hono    # 45블록 완전성
node tools/analyzer/run-corr.cjs p11-corr                         # JSON 의미론 해시 + .json 스크립트 종류 진단
node tools/analyzer/summarize-p11.cjs <P11>/summary-all <P11>/data/p11-{hono,excalidraw,vite,typeorm,query}
node tools/analyzer/analyze-corr.cjs <P11>/data/p11-corr <P11>/summary-all
node tools/analyzer/figures-p11.cjs <P11>/summary-all <P11>/figures
```
메모리 게이트는 `P11_GATE_MB`(현재 기본 1,000 MB; 이 데이터의 분석기 블록은 1,500 MB에서 측정)로 바꿀 수 있다.

## 4. UI
```powershell
# 하네스 e2e/에 tools/ui/p11-real.spec.ts, 하네스 루트에 tools/ui/playwright.p11.config.ts를 두고
# 조건별 격리 확장 폴더에 VSIX 설치: v0.0.6(bdd0cab6…) / P4(2748b83d…)
powershell -File tools/ui/run-p11-ui.ps1 -Projects hono -Runs 3    # 프로젝트마다 따로 호출(-File에서는 배열 인자가 한 문자열이 됨)
powershell -File tools/ui/run-p11-ui.ps1 -Projects vite -Runs 3
node tools/ui/summarize-ui.cjs <P11>/summary-ui p11ui
node tools/ui/export-ui-runs.cjs <P11>/summary-ui/p11-ui-per-sample.csv
```

## 데이터 파일
| 파일 | 내용 |
|---|---|
| `data/raw/p11-<project>.blocks.jsonl.gz` | 블록별 원시 표본(시간, 캐시 이벤트, 메모리, 해시, 그래프 크기). 경로는 프로젝트 상대 |
| `data/raw/p11-corr.blocks.jsonl.gz` | 검증 실행 원시 표본 |
| `data/raw/check-*.json` | 프로젝트별 45블록 완전성 점검 |
| `data/raw/p11-main-LOST-reference.run.log` | 원시 데이터를 잃은 첫 실행의 로그(참고용, 통계 제외) |
| `data/summary/*.csv` | 조건 요약, 비교(bootstrap), 일관성, 프로젝트 표 |
| `data/ui/*.csv` | UI 표본·조건 요약·그래프 해시·소스 이동·메모리 감시·민감도 |
| `data/run-policy-changes.md` | 실행 정책 변경 이력 |
