# Existing Benchmark Audit (Task B)

대상: `docs/benchmarks/analysis-cache/` (커밋 `fed34a0`), 생성 스크립트 `scripts/benchmark-analysis-cache.mjs`

이 문서는 기존 결과를 **수정하지 않고** 검토한다. 기존 파일의 무결성 해시는 [reproducibility.md](reproducibility.md#3-과거-산출물-무결성)에 기록했다.

- 기존 실행 식별자: **HIST-0829** (2026-08-29T12:24:56Z – 13:10:02Z, 약 45분)
- 검증 도구: [`tools/audit-existing-benchmark.mjs`](tools/audit-existing-benchmark.mjs) (읽기 전용), 출력 [`data/p0/existing-benchmark-audit-output-20261026.txt`](data/p0/existing-benchmark-audit-output-20261026.txt)

---

## 1. 과거 벤치마크 실행 방식 (코드 기준)

### 1.1 실행 흐름

`main()` (`benchmark-analysis-cache.mjs:72`):

1. `out/analyzer`(컴파일 산출물)의 `analyzeWorkspaceActive`, `clearAnalyzerCaches`를 `require`한다 (`:11-14`). **production analyzer 함수를 직접 호출한다.**
2. 대상 6개를 만든다: Cogic 저장소, 합성 100/500/1000/2000, Zod(`git clone --depth 1`).
3. 대상별로 correctness 비교 후 `cold → repeated → active-edit` 순서로 실행하고, 시나리오마다 `OFF → SourceFile only → Full result` 순서로 실행한다 (`:112-140`, `:511`).
4. 결과를 `docs/benchmarks/analysis-cache/` 아래 7개 파일에 **덮어쓴다** (`writeBenchmarkArtifacts`, `:210-240`).

### 1.2 실제 측정 구간

`runScenario` (`:509-572`): `performance.now()`로 `analyzePanelEquivalent()` 호출 1회를 감싼다 (`:528-536`).

측정 구간에 **포함**되는 것:

- (Full 모드) result cache 키 계산(SHA-256 2회 + `JSON.stringify`), 조회, hit 시 JSON clone 반환
- `analyzeWorkspaceActive` 전체: tsconfig 파싱, `ts.createProgram`, TypeChecker, 그래프·calls·diagnostics 생성
- (Full 모드, miss) 결과 JSON clone 저장, LRU prune

측정 구간에서 **제외**되는 것:

- VS Code `findFiles` 파일 탐색 (파일 목록을 사전에 고정)
- 350 ms debounce
- webview 메시지 직렬화, React 렌더링
- `debug` 콜백 비용은 포함된다. 모든 모드에서 배열 push 1회 수준이다.

결론: 측정값은 **analyzer 실행 시간(+harness result cache 오버헤드)** 이며, UI 응답시간이 아니다.

### 1.3 반복·Warm-up

- 조건(target × scenario × mode)마다 warm-up 5회 + 측정 30회 (`DEFAULT_WARMUP`, `DEFAULT_RUNS`, `:19-20`)
- 모드 시작 시 `clearAnalyzerCaches()`를 호출하고 `PanelEquivalentResultCache`를 새로 만든다 (`:512-517`). cold 시나리오는 매 반복마다 둘 다 비운다 (`:519-522`).
- 모든 조건이 **하나의 Node 프로세스**에서 연속 실행된다. 조건 사이에 프로세스 격리나 GC 강제가 없다.

### 1.4 Cache 모드 정의

| 모드 | `cacheEnabled` (SourceFile) | Result cache | 코드 |
|---|---|---|---|
| OFF | false | 사용 안 함 | `:41` |
| SourceFile only | true | 사용 안 함 | `:42-47` |
| Full result | true | `PanelEquivalentResultCache` | `:48` |

주의: production에는 "SourceFile only" 모드가 없다. 사용자 설정 하나가 두 캐시를 함께 켠다 (`CodeGraphPanel.ts:1394-1429`). SourceFile only는 **분석용 분리 조건**이다.

### 1.5 시나리오

- cold: 매 반복 캐시를 비운다. 캐시 생성 오버헤드를 측정한다.
- repeated: 동일 코드·설정을 반복한다. Full 모드는 warm-up에서 저장한 결과를 측정 30회 모두에서 hit한다 (CSV `resultCacheHits=30`).
- active-edit: 반복마다 활성 파일 끝에 `__cogicBenchmarkVariant${iteration}` 함수를 붙인다 (`getScenarioCode`, `:670-675`). 코드 해시가 매번 달라 result cache는 **설계상 hit할 수 없다**. CSV에서도 모든 active-edit/Full 행이 `resultCacheHits=0`, `resultCacheMisses=30`이다.

### 1.6 Full Result Cache의 실제 적중 여부

| 시나리오 | Result hits / 30 | 해석 |
|---|---:|---|
| cold | 0 | 매 반복 clear |
| repeated | 30 (전 대상) | 측정 30회 모두 hit. analyzer 미호출로 SourceFile 이벤트 0 |
| active-edit | 0 (전 대상) | 키가 매번 다름 |

따라서 보고된 "Full result active-edit p50 378.67 ms"는 result cache 효과가 아니다. **SourceFile cache 효과 + result cache 키 계산·저장 오버헤드**다.

### 1.7 통계값 계산 방식 (`stats`, `percentile`, `:764-789`)

- percentile: **nearest-rank** 방식, `index = ceil(n·p) − 1`. n=30에서 p50은 정렬 후 15번째 값이다(보간·중앙 두 값 평균 없음). p95는 29번째 값이다.
- 표준편차: **모집단 표준편차**(분모 n), 표본 표준편차(n−1)가 아니다.
- 개선율: `(OFF p50 − mode p50) / OFF p50`. 독립 표본 두 중앙값의 차이이며 신뢰구간과 유의성 검정은 없다.
- 반복별 원시 측정값은 저장하지 않는다. JSON/CSV에는 **집계값만** 있다.

### 1.8 결과 정합성(correctness) 비교 방식 (`:677-737`)

- 대상마다 OFF, SourceFile only, Full result를 각각 **`clearAnalyzerCaches()` 직후 1회** 실행한다. `resultCache`는 새 인스턴스다.
- 따라서 SourceFile only 비교는 **캐시가 빈 상태(전부 miss)** 에서, Full 비교는 **result cache miss** 상태에서 이루어진다.
- **결론: 기존 correctness 검증은 캐시 hit 경로를 한 번도 거치지 않는다.** "cache ON/OFF 결과 동일"은 *캐시 활성 상태의 cold 경로*가 OFF와 같다는 의미에 그친다. 재사용된 `SourceFile` 객체나 clone된 결과의 동일성은 검증되지 않았다.
- 정규화 대상: `graph.nodes`, `graph.edges`, `imports`, `exports`, `calls`, `diagnostics`. `trace`, `meta`는 제외된다. `calls`는 상위 60개로 잘린 목록이다(baseline-audit K1).

### 1.9 환경과 Git SHA

- `getGitSha()`는 `git rev-parse HEAD`만 기록한다 (`:263-273`). **working tree dirty 여부와 스크립트 해시는 기록하지 않는다.**
- 기록된 Cogic SHA는 `d9faa02`다. 그런데 스크립트·`package.json` 변경(`benchmark:cache`)·결과 문서는 이후 커밋 `fed34a0`에서 처음 추가되었다. 즉 **커밋되지 않은 스크립트로 실행되었다.**
- 보완 사실: `git diff d9faa02 HEAD -- src`는 비어 있다(0줄). 측정된 **analyzer 소스는 현재 HEAD와 동일**하다.

---

## 2. Harness vs Production 등가성

| 항목 | Production (`CodeGraphPanel`) | Harness | 등가성 |
|---|---|---|---|
| Analyzer 호출 | `analyzeWorkspaceActive` | 동일 함수 직접 호출 | **동일** |
| SourceFile cache | 모듈 전역, 설정으로 on/off | 동일 모듈, `cacheEnabled` 인자 | **동일** |
| Result cache 구현 | `analysisResultCache` (private, `:1274-1353`) | `PanelEquivalentResultCache` (`:631-668`) 재구현 | **재구현(등가 harness)**. 키 필드·JSON clone·LRU(40)은 같다. 경로 정규화가 다르다: prod는 `\\→/` + 소문자, harness는 `path.resolve` + Windows에서만 소문자 |
| 파일 목록 | `findFiles(glob, "**/{node_modules,dist,build,out,.next}/**", 4000)`, 10 s 캐시 | 자체 디렉터리 순회. `.git`, `.vscode-test`, `coverage`, `.turbo`, `.cache`, `.benchmark-*` 등 추가 제외, 이름순 정렬 | **다름**. tsconfig가 있으면 Program root에는 영향 없음(K9). 키 해시와 tsconfig 없는 workspace에는 영향 |
| Graph depth | 기본 0, depth별 분기 (`:1438-1508`) | 1 고정, 분기 없음 | depth 1에서 analyzer 결과 = production 결과. depth 0/≥2는 측정되지 않음 |
| 무효화 | 문서 변경마다 result cache 전체 clear (K6) | 없음 | **다름**. 실제 편집에서는 result cache가 매번 비어 있다. harness의 repeated hit는 실제 편집 흐름에서는 일어나지 않는다 |
| Debounce / UI | 350 ms, postMessage, 렌더링 | 제외 | 측정 범위 밖 |

판정: **SourceFile cache 측정은 production 함수를 직접 측정한 것**이다. **Full result 측정은 production 메서드가 아니라 등가 harness를 측정한 것**이다. 기존 limitations.md도 이 점을 밝히고 있다.

---

## 3. 데이터 정합성 검증 결과 (P0에서 실행)

| 검사 | 결과 |
|---|---|
| CSV 54행 vs JSON `rows` 54개, 14개 필드 문자열 일치 | **일치** (불일치 0) |
| `results.md` 시나리오 표 54행: p50/p95/mean/min/max/stddev/개선율/hits 서식 문자열 | **54/54 일치** |
| 개선량·개선율 재계산 (`OFF p50 − p50`) | 전 행 일치 (오차 < 1e-9) |
| 순서 불변식 `min ≤ p50 ≤ p95 ≤ max`, `min ≤ mean ≤ max`, `median = p50`, `runs = 30` | 전 행 만족 |
| 누락 조건 | 없음 (6 대상 × 3 시나리오 × 3 모드 = 54) |
| `notes` (외부 저장소 실패 등) | 빈 배열 |
| correctness 12건 | 전부 `same=true`, 해시 일치 |

결론: **기존 문서의 표 수치는 원시 데이터와 정확히 일치한다.** 문서 작성 과정의 전사 오류는 없다.

발견된 서술상 불일치:

1. README "1.09 s to 0.38 s"(분석 캐시 문서 README와 루트 README): SourceFile-only p50은 0.366 s다. 0.38 s는 Full result(0.379 s)에 해당한다. 서술 문장은 스크립트에 **하드코딩**되어 있다 (`:870`).
2. 해석 문장 하드코딩: `results.md`의 "1088.25 ms to 366.03 ms" (`:985`), "All comparisons in this run matched" (`:1034`), README의 합성 100/500/1000/2000 해석 (`:866`)은 데이터에서 계산되지 않는다. **스크립트를 재실행해 수치가 달라져도 문장은 그대로 남아 표와 모순될 수 있다.**

---

## 4. 이상치·변동성

반복별 표본이 없어 개별 이상치는 식별할 수 없다. 집계값으로 변동이 큰 조건만 표시한다(CV = SD/mean > 10% 또는 max/p50 > 1.4).

| 조건 | p50 | max | CV | 비고 |
|---|---:|---:|---:|---|
| synthetic-100 / repeated / OFF | 1178.34 ms | 2239.76 ms | 19.8% | max가 p50의 1.9배. 같은 대상 cold/active-edit OFF(CV 3–4%)보다 크게 불안정하다 |
| cogic / repeated / OFF·SF·Full | 1189 / 385 / 6.07 ms | 1701 / 556 / 8.06 ms | 12% 내외 | 같은 대상 active-edit보다 변동이 크다 |
| synthetic-1000 / cold / Full | 2122.54 ms | 3262.14 ms | 12.1% | p95 2687 ms |
| synthetic-2000 / repeated / Full | 11.74 ms | 41.93 ms | 45.9% | ms 단위 hit 경로. GC/타이머 잡음 |
| synthetic-100 / repeated / Full | 0.50 ms | 4.08 ms | 97.6% | 동일 |

해석(INFERRED): 단일 프로세스 연속 실행에서 GC, 백그라운드 부하, JIT 상태 변화의 영향으로 보인다. 표본이 없어 검증할 수 없다. 신규 실험은 반복별 표본을 반드시 저장해야 한다.

---

## 5. 실험 순서에 의한 편향

- 순서가 **완전 고정**되어 있다: 대상 → (correctness) → cold → repeated → active-edit, 각 시나리오 안에서 OFF → SF → Full.
- OFF는 항상 각 시나리오의 첫 조건이다. 앞선 조건의 힙 상태, JIT 최적화, OS 파일 캐시가 뒤 조건에 유리하게 작용할 수 있다(방향 불명, INFERRED).
- OS 파일 시스템 캐시는 초기화되지 않는다. OFF도 디스크 대신 OS 페이지 캐시에서 읽을 가능성이 높아 OFF 비용을 과소 측정할 수 있다.
- 평가: 효과 크기가 큰 조건(66–83% 감소)은 순서 편향만으로 설명되기 어렵다. 반면 cold의 2–12% 차이와 1000/2000의 ON 지연(7–14%)은 **순서·환경 잡음과 같은 크기 수준**이라 순서를 통제해야 판단할 수 있다.

---

## 6. 재현 가능성 평가

| 요소 | 재현 가능성 | 근거 |
|---|---|---|
| Analyzer 코드 | **가능** | `src` 동일(d9faa02 = HEAD) |
| 합성 workspace | **가능** | 결정적 생성기 (`generateSyntheticWorkspace`, `:367-451`) |
| Zod | **가능** | 기록된 SHA `e6b6ab347675cd2bd54b1bdbed16f98c59be82a9`로 checkout 가능. 단 스크립트는 `--depth 1` 최신 HEAD를 받으므로 SHA 고정 로직을 추가해야 한다 |
| Cogic 대상 파일 목록 | **불완전** | 과거 84개, 현재 61개(같은 순회 규칙). untracked 빌드 산출물(`media/webview` 등)이 목록에 포함된다. Program root는 tsconfig 기준 18개라 분석 비용 영향은 작을 것으로 추정(INFERRED) |
| 스크립트 | **부분** | 실행 당시 스크립트는 커밋되지 않았다. 현재 커밋본과 같은지 증명할 수 없다(dirty 미기록) |
| 하드웨어·OS·Node | **불가(현 장비)** | i5-4690/16 GB/Win10/Node 22.16.0 → i5-9400F/8 GB/Win11/Node 24.12.0 |
| 원시 표본 | **불가** | 집계값만 존재. 과거 분포와 통계적 비교(CI, 검정)는 불가능하다 |

판정: **방법(method) 재현은 가능하다. 같은 환경(same-environment) 재현은 원래 장비가 없으면 불가능하다.** 신규 실험은 절대 ms가 아니라 **방향성·상대 효과 크기**를 과거 결과와 비교해야 한다. 판정은 방법 재현, 효과 방향 재현, 크기 호환성(제한적)의 세 차원으로 나눈다([EXP-02 §9](experiments/exp-02-cache-performance.md#9-statistical-analysis)).

---

## 7. 기존 주장의 적용 범위 검토

| 주장 (기존 문서) | 판정 | 근거·조건 |
|---|---|---|
| Cogic active-edit에서 SF cache로 p50 1088.25 → 366.03 ms (66.4%) | **원시 데이터로 뒷받침됨, 단일 실행·단일 환경** | MEASURED[HIST-0829]. 재현 전에는 "과거 1회 측정"으로만 인용해야 한다 |
| Full result active-edit 65.2% | **수치는 맞지만 result cache 효과가 아님** | hit 0. SF 효과 + 오버헤드 |
| Repeated Full 99.5% | **best-case 상한** | 문서 스스로 경고. 실제 편집 흐름에서는 문서 변경 시 전체 clear(K6) 때문에 일어나지 않는다 |
| "Correctness: all cache ON/OFF matched" | **범위 축소 필요** | hit 경로 미검증(§1.8) |
| 100/500에서 이득, 1000/2000에서 hit 0 + 느려짐 | **원시 데이터와 일치** | SF 요청 수 = N + 159, 1000 → 1159, 2000 → 2159 > 800 |
| 1000/2000 원인은 용량 초과로 인한 LRU 비효율 "가능성" | **가설로 적절**, 인과 미입증 | 문서 스스로 "not proven"이라 밝힘. P0 probe에서 요청 순서가 분석 간 동일함을 확인했다 → 순환 접근 + LRU에서 hit 0은 이론적으로 예측된다(INFERRED). EXP-03에서 검증 |
| Zod 83% 감소 | **적용 범위 좁음** | 활성 파일이 re-export index이고 그래프가 nodes 2, edges 0이다. 이득의 대부분이 lib/의존 `.d.ts` 재파싱 회피에서 온다는 해석은 INFERRED다(파일 단위 시간 미측정, 아래 추가 관찰 참조) |
| (암묵) 사용자 체감 성능 향상 | **주장 불가** | UI·debounce·탐색 제외. 측정 범위 밖 |

추가 관찰(MEASURED[P0-PROBE], 요청 count만 기록하고 시간은 재지 않음): Cogic 대상 분석 1회의 SourceFile 요청 172건은 workspace 17, TypeScript lib 46, `@types/*` 72, `undici-types` 37로 구성된다. **요청 건수의 90.1%(155건)가 사용자 코드가 아닌 선언 파일이다.**

이 값은 **요청 비중**이지 **성능 개선 기여도**가 아니다. 둘을 구분해야 하는 이유는 다음과 같다.

- 파일별 파싱 비용은 크기와 구문 구조에 따라 크게 다르다. 예를 들어 `lib.dom.d.ts` 한 개와 작은 `@types` 파일 한 개의 비용은 같지 않다. 건수 비중을 시간 비중으로 옮길 수 없다.
- probe는 요청별 파싱 시간을 기록하지 않았다. HIST-0829 데이터에도 파일 단위 시간이 없다.
- 시간 단축(1088.25 → 366.03 ms, MEASURED[HIST-0829])에는 SourceFile 파싱 회피 외에 stat 검증, Program 구성, 바인딩·타입 검사, 그래프 생성 비용의 변화도 섞여 있다. 캐시가 줄이는 것은 이 중 파싱 단계뿐이다.

따라서 "SF cache 이득은 주로 변경되지 않은 라이브러리 선언 파일의 재파싱 회피에서 온다"는 해석은 **INFERRED**다. 논문에는 다음 두 문장을 분리해서 쓴다.

1. MEASURED[P0-PROBE]: "Cogic 대상 분석 1회의 SourceFile 요청 중 90.1%(건수)가 선언 파일이다."
2. INFERRED: "따라서 캐시 이득의 상당 부분이 선언 파일 재파싱 회피에서 올 가능성이 있다. 시간 기여도는 측정하지 않았다."

기여도를 확정하려면 §8의 8번 항목처럼 요청별 파싱 시간이나 파일 범주별 캐시 조건을 측정해야 한다.

---

## 8. 추가 측정이 필요한 항목

1. 반복별 원시 표본(iteration, 시각, 모드, hit/miss 수) → CI·검정·이상치 분석
2. hit 경로 결과 동일성(SF hit, Full hit clone)
3. 실행 순서 무작위화·프로세스 격리 조건
4. dirty 여부, 스크립트 SHA-256, Node·TS 버전, 전원 구성, 가용 메모리 기록
5. 대상별 SourceFile 요청 구성(workspace vs lib) 기록
6. 용량별 hit/miss/eviction/occupancy, 재사용 거리(reuse distance), 메모리 → EXP-03
7. (선택) 두 번째 Zod 활성 파일처럼 그래프가 의미 있는 크기인 실제 파일
8. (선택, 미배정) 요청 범주별 시간 기여도: 요청별 `createSourceFile` 시간을 측정 구간 밖에서 기록하거나, 선언 파일만 캐시하는 진단 조건을 둔다. 현재 EXP-02/03 확증 범위에는 들어 있지 않다. 수행 전까지 선언 파일 기여도 주장은 INFERRED로 유지한다
