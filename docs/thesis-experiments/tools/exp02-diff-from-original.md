# EXP-02 측정 도구와 원본 벤치마크 스크립트의 차이

- 원본: `scripts/benchmark-analysis-cache.mjs`
  - 저장소 내용 기준 `fed34a0`, LF 정규화 SHA-256 `4495a5964ef8a824d72b07c9095ba0a4aadb1228f1ca050a925286475ab87c5e`
  - 원본은 수정하지 않고 실행하지도 않는다. 실행하면 `docs/benchmarks/analysis-cache/`를 다시 쓰기 때문이다.
- 신규: `docs/thesis-experiments/tools/exp02-cache-benchmark.mjs`(`exp02-cache-benchmark/1`)
- 검증
  - `tools/test/exp02-cache-benchmark.test.mjs`가 원본 파일에서 함수 소스를 추출해 실행한다.
  - 같은 입력에서 신규 도구의 복사본과 결과가 같은지 비교한다(§3).

## 1. 바꾸지 않은 것 (Section A, 원본 복사)

| 항목 | 원본 | 신규 | 확인 |
|---|---|---|---|
| 시간 구간 | `performance.now()`로 `analyzePanelEquivalent(...)` 호출 하나를 감싼다(결과 캐시 키 계산, clone, analyzer 실행 포함) | 같다 | 코드 대조 |
| 반복 | 조건마다 warm-up 5, 측정 30 | 같다(기본값). 파일럿만 줄인다 | — |
| 모드 순서 | OFF → SourceFile only → Full result | 같다 | 원본 `runScenario`와 집계 비교 |
| 캐시 초기화 | 모드 시작 때 `clearAnalyzerCaches()` 한 번, 모드마다 새 result cache. cold는 반복마다 둘 다 비운다 | 같다 | 원본 `runScenario`와 집계 비교 |
| 대상·시나리오 순서 | target → scenario → mode. target마다 정합성 분석을 먼저 한다 | 같다(P-orig) | 코드 대조 |
| `analyzePanelEquivalent`, `getAnalysisCacheKey`, `PanelEquivalentResultCache`(LRU 40, clone) | — | 복사 | 반환값·이벤트·hit 비교 |
| `getScenarioCode`(`__cogicBenchmarkVariant${i}`) | — | 복사 | 출력 비교 |
| `generateSyntheticWorkspace`, `listWorkspaceFiles`(무시 폴더, 확장자, 4,000개 상한) | — | 복사 | N = 2, 13, 100, 523에서 파일 목록과 내용 비교 |
| `makeRepositoryTarget`(probe 분석 1회 포함), `selectCogicActiveFile`, `pickExternalActiveFile` | — | 복사. 루트 경로를 인자로 받는다 | — |
| `normalizeAnalysisResult`, `stats`(모집단 SD), `percentile`(nearest-rank) | — | 복사 | 해시와 통계값 비교 |
| analyzer 옵션 | `graphDepth 1`, `traceMode false`, `traceScope single-file`, `cacheEnabled` = 모드 | 같다 | — |

## 2. 다른 것

| 구분 | 원본 | 신규 | 측정값 영향 |
|---|---|---|---|
| analyzer 로딩 | 저장소 자신의 `../out/analyzer`를 import 시점에 로딩 | `--analyzer-root`의 `out/analyzer`를 동일성 확인 후 로딩. 같은 함수를 같은 방식으로 호출한다 | 없음 |
| Cogic workload | 스크립트가 있는 저장소 자체(당시 `d9faa02` 작업 트리) | 별도 clean worktree(`d9faa02`, `npm ci`). analyzer 저장소와 분리했다. 과거와 같은 파일 목록을 쓰기 위해서다 | 과거와 같은 commit. 경로만 다르다 |
| 합성 workspace 위치 | 저장소 안 `.benchmark-workspaces/` | 저장소 밖 `--work-dir/synthetic/`. 생성 규칙은 같다 | 경로만 다르다 |
| Zod | `git clone --depth 1`(당시 최신) | `e6b6ab347675cd2bd54b1bdbed16f98c59be82a9`에 고정(과거 기록 SHA). 의존성은 설치하지 않는다(원본과 같다) | 과거와 같은 commit |
| 반복별 기록 | 집계만 남긴다 | 반복마다 한 행(`samples.csv`). 시간이 멈춘 **뒤에** 기록한다: SF hit·miss·stale·bypass·disabled 이벤트 수, result hit·miss, `heapUsed`, `rss`, 결과 해시, active-edit 변형 함수 반영 여부, 시각 | 구간 밖 작업. 단 반복마다 결과 해시를 계산하므로 할당이 늘어 다음 반복의 GC 시점이 달라질 수 있다(§4) |
| 결과 해시 | 정합성 분석에서만 `normalizeAnalysisResult` | 반복마다 `fastNormalizedHash`. 원본 정규화와 **같은 해시**를 항목마다 한 번만 직렬화해 계산한다(테스트로 같음 확인) | 위와 같음 |
| 정합성 분석(Phase D) | target마다 OFF·SF·Full 각 1회(캐시를 비운 뒤), 해시 비교 | target마다 다음을 한 뒤 시나리오를 측정한다. ① OFF 1회(기준 해시, 요청 수 W) ② SF 2회(2회차 hit 경로) ③ Full 2회(2회차 result hit) ④ 변형 반영 확인 1회 ⑤ workload 기록용 OFF 1회 | 측정 구간 밖. 원본보다 분석이 4회 더 많아 JIT warm 상태가 약간 다를 수 있다. 측정은 모드마다 캐시를 비우고 warm-up 5회 뒤에 시작한다 |
| 통계 | nearest-rank p50·p95, mean, 모집단 SD | 원본 값을 함께 계산한다. 추가: type-7 median·p95, IQR, 표본 SD, bootstrap 95% CI(Δ, r), Hodges–Lehmann, Mann–Whitney U, Cliff's δ, Holm 보정. 집계는 실행 후 `samples.csv`에서 다시 계산한다 | 없음(사후 계산) |
| 출력 | `docs/benchmarks/analysis-cache/`를 다시 쓴다 | `--out-root/<run-id>/`(저장소 밖). `docs/benchmarks` 아래는 거부하고, 기존 폴더는 덮어쓰지 않는다. 공개용은 `publish`로 경로 없이 복사한다 | 없음 |
| 무결성 | 없음 | 실행 전후 과거 산출물 8개의 LF 정규화 SHA-256을 `reproducibility.md §3` 값과 대조한다. 실행 전 불일치면 시작하지 않는다 | 없음 |
| 동일성 | commit만 기록 | analyzer HEAD·`src/analyzer` tree·빌드 해시·TypeScript 5.9.3·clean worktree를 검사한다. Group A는 `d9faa02`와 `src` diff 0도 검사한다. 도구 저장소가 dirty면 거부한다 | 없음 |
| P-robust | 없음 | 조건마다 새 Node 프로세스(`child` 명령). 블록마다 seed로 조건 순서를 섞는다. 블록별 CSV를 따로 보존한다 | 새 프로토콜(원본과 비교하지 않는 견고성 측정) |
| 환경 기록 | Node, OS, CPU, 메모리 총량 | 추가: OS 버전, V8, npm, execArgv, NODE_OPTIONS, 전원 구성, 시작·종료 가용 메모리 | 없음 |

## 3. 복사 충실도 테스트 (`tools/test/exp02-cache-benchmark.test.mjs`)

| 테스트 | 원본에서 추출한 함수 | 비교 |
|---|---|---|
| 합성 workspace·파일 목록·시나리오 코드 | `generateSyntheticWorkspace`, `listWorkspaceFiles`, `getScenarioCode` | 파일 목록과 내용(N = 2, 13, 100, 523), 변형 코드 |
| 결과 캐시·키·정규화·통계 | `analyzePanelEquivalent`, `getAnalysisCacheKey`, `PanelEquivalentResultCache`, `normalizeAnalysisResult`, `stats`, `percentile` | 반환값, debug 이벤트, 2회차 result hit, 해시, 통계값 |
| 반복별 해시 | `normalizeAnalysisResult` | 무작위 결과 30개에서 `fastNormalizedHash`와 같은 해시 |
| 측정 루프 | `runScenario` | 같은 가짜 analyzer로 원본 루프의 측정 반복 수·SF hit·miss·result hit·miss가 신규 반복별 표본의 합과 같다(3 시나리오 × 3 모드) |

## 4. 측정값에 영향을 줄 수 있는 차이 (보고서에 함께 적는다)

1. **반복마다 하는 계측:** 결과 해시, 이벤트 집계, `memoryUsage()`
   - 모두 시간 구간 밖이지만 힙 할당을 늘린다. 그래서 다음 반복의 GC 시점이 원본과 다를 수 있다.
   - 영향은 원본 표본이 없어 직접 비교할 수 없다. 해시 계산은 `runScenarioSamples`의 `hashIterations` 인자로 끌 수 있다(CLI 옵션은 없다). 이번 run에서는 계획서 §7 Phase D 4를 따라 해시를 켰다.
2. **정합성 분석 횟수:** 측정 전 분석이 원본보다 많다. warm-up 5회가 이를 흡수한다고 가정한다(INFERRED).
3. **workload 경로**
   - 결과 캐시 키와 그래프의 파일 경로가 원본과 다르다. 경로 길이가 키 계산과 clone 비용에 미세하게 영향을 줄 수 있다.
   - 비교 단위는 상대 지표(감소율)다.
4. **환경:** 하드웨어·OS·Node·전원 구성이 과거와 다르다(`reproducibility.md §1`). 절대 ms는 비교하지 않는다.

## 5. 계획서와의 차이

- EXP-02 계획서 §7 Phase E는 P-robust 주 조건을 "6 대상 × active-edit × 3 mode, cogic·synthetic-500 × repeated × 3 mode, cogic × cold × 3 mode = 30 조건"이라고 적었다.
- 그런데 나열된 집합을 세면 18 + 6 + 3 = **27**이다.
- 도구는 나열된 27개를 쓴다. 30이라는 합계는 계획서의 계산 오류로 기록한다.

## 6. 버전 이력

| 버전 | 변경 | 계기 |
|---|---|---|
| 1 (`0e89756`) | 최초 | — |
| 1.1 | ① 모드 간 결과 비교(Phase D, 반복별 해시)를 `canonicalHash`(결과 캐시와 같은 JSON 왕복 뒤 정규화 해시)로 바꿨다. ② 반복마다 OS 가용 메모리(`freeMem`)를 기록한다 | Phase A 파일럿(1.0)에서 Full result 2회차(result hit) 해시가 OFF와 달랐다. 원인: 결과 캐시 clone(`JSON.parse(JSON.stringify())`)이 값이 `undefined`인 속성을 지운다(Cogic 결과의 `graph.edges[].label` 234개, `graph.nodes[].sig`·`signature` 13개와 `trace`의 같은 항목). 원본 `normalizeAnalysisResult`는 이 속성을 `"undefined"`로 직렬화한다. 구조 비교에서는 차이가 0이다. 시간 측정 로직은 바뀌지 않았다. 파일럿은 최종 통계에 넣지 않는다 |
| 1.2 | Phase D "SourceFile 2회차 hit > 0" 조건을 분석 1회 요청 수 W ≤ 800(SourceFile 캐시 용량, 두 analyzer 모두 `MAX_DISK_SOURCE_FILE_CACHE_ENTRIES = 800`)일 때만 적용한다. `hitExpected` 열을 추가했다 | 두 번째 파일럿(1.1)에서 Synthetic-1000·2000(W = 1159·2159)의 2회차 hit가 0이라 실패로 나왔다. 해시 일치·불변식은 성립했고, hit 0은 계획서 H2-4가 예상한 동작이다 |
