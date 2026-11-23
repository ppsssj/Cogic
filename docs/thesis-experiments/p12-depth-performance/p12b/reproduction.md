# P12-B 재현

## 환경 (이번 측정)
- Windows 11, RAM 8 GB(측정 중 가용 약 1.3–2.0 GB), Node v24.12.0, TypeScript 5.9.3
- `node --max-old-space-size=768`: V8 **old space** 상한. V8 전체 힙 한도(`v8.getHeapStatistics().heap_size_limit`)는 young generation 등을 포함해 이보다 크다(이 환경에서 약 960 MiB). 두 값은 각 실행 JSON의 `meta.maxOldSpaceSizeMB`, `meta.v8HeapSizeLimitMB`에 따로 기록했다. 설정 불일치가 아니다.
- 프로젝트: P11 고정 커밋 hono `cd50668335738d170ecd03e783f2f2d5317b95d6` (H1 `src/helper/cookie/index.ts`), vite `3567471998e3da315675086f44368e266c9c0e33` (V1 `packages/vite/src/node/server/index.ts`)
- 실행 cwd: Cogic 저장소 루트(자동 `@types` 해석이 cwd에 의존한다. P12-A 별도 발견)

## 준비
```bash
# P12-B 빌드
git checkout perf/p12b-program-session && npm ci && npm run compile
# 기준 빌드 (P12-A main, 같은 의존성)
git worktree add --detach ../p12b-baseline 7469baf
cmd //c mklink //J "..\p12b-baseline\node_modules" "node_modules"   # Windows. 다른 OS는 npm ci
(cd ../p12b-baseline && node node_modules/typescript/bin/tsc -p ./)
```

## 측정
```bash
bash docs/thesis-experiments/p12-depth-performance/p12b/tools/run-matrix.sh ../p12b-baseline <projects-dir> <graph-dump-dir>
node docs/thesis-experiments/p12-depth-performance/p12b/tools/summarize-p12b.cjs
```
- 모든 실행은 순차로 하며, 한 반복 안에서 조건(base / off / on)을 번갈아 실행한다.
- 실행 전 가용 메모리가 기준(Hono 0.9–1.0 GB, Vite D2 1.3 GB)보다 적으면 실행하지 않고 `*.skipped.json`을 남긴다. 실행 중 400 MB 아래로 내려가면 중단(`aborted`)을 기록한다.
- 단일 실행:
```bash
node --max-old-space-size=768 docs/thesis-experiments/p12-depth-performance/p12b/tools/profile-depth-product.cjs \
  --cogic . --root <vite> --file packages/vite/src/node/server/index.ts --depth 2 --session 1 --out run.json
```

## 조건
| 이름 | `--cogic` | 실행 경로 |
|---|---|---|
| `base` | 기준 워크트리(`7469baf`) | P12-A replica 순회 + 기준 `analyzeWorkspaceActive`(계측 없음) |
| `off` | P12-B 빌드 | 제품 `analyzeWorkspaceDepth`, `programSession: false` |
| `on` | P12-B 빌드 | 제품 `analyzeWorkspaceDepth`, 세션 사용(제품 기본값) |

Program 생성 시간과 구조 재사용 상태는 제품의 `analyzer.program.created` 이벤트에서 가져온다(`off`·`on`만). 기준 빌드에는 이 이벤트가 없어 Program 시간은 비교하지 않는다. P12-A v2 도구의 문자열 치환 계측은 쓰지 않았다.

## 그래프 해시
- `graphHashRaw`: 직렬화한 그래프 JSON의 SHA-256. 체크아웃 경로에 따라 달라진다.
- `graphHashNormalized`: Cogic 체크아웃 루트와 cwd를 `<cogic>`으로, 프로젝트 루트를 `<project>`로 바꾼 뒤의 SHA-256. 기준(별도 워크트리)과 P12-B를 비교할 때는 이 값을 쓴다.

## 검증 명령
```bash
npm run compile && npm run lint && npm test
npx mocha --ui tdd out/test/p12bProgramSession.test.js   # 세션 테스트만 빠르게
```
