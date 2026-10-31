# EXP-03 측정 프로토콜 기록 (측정 전 고정)

- 이 문서는 실제 측정 전에 커밋한다. 측정 run의 `phase.json`은 이 커밋을 `toolCommit`으로 기록한다.
- 측정 후 이 문서를 바꾸면 §9에 변경 이력과 사유를 남긴다.
- 계획서: [../experiments/exp-03-scalability.md](../experiments/exp-03-scalability.md)

| 항목 | 값 |
|---|---|
| 측정 도구 | [`exp03-cache-scalability.mjs`](exp03-cache-scalability.mjs)(`exp03-cache-scalability/1`) |
| 보고 도구 | [`exp03-report.mjs`](exp03-report.mjs)(`exp03-report/1`) |
| 재사용 | [`exp02-cache-benchmark.mjs`](exp02-cache-benchmark.mjs) 1.2. **수정하지 않았다**(EXP-02 테스트 11/11 통과) |
| Analyzer | `bbe4cbf5b1f784d9223ca3d46d96058617687b12`(EXP-02 Group B와 같다) |
| Node | 22.16.0(EXP-02와 같은 바이너리). TypeScript 5.9.3 |

## 1. 실제 구현 확인 (`src/analyzer/analyze.ts`, bbe4cbf)

계획서 §0의 서술을 코드와 대조했다. 차이는 없다. 세부 동작은 아래와 같다.

| 항목 | 실제 구현 |
|---|---|
| 용량 | 37행 `const MAX_DISK_SOURCE_FILE_CACHE_ENTRIES = 800;`. 빌드 `out/analyzer/analyze.js` 12행에 같은 선언이 1개 있다. 식별자는 3회 나온다(선언 1, 사용 2) |
| 키 | `normalizeCachePath`: `path.resolve(fileName)`. win32에서는 소문자로 바꾼다 |
| 유효성 | `mtimeMs`, `size`, `scriptKind`, `languageVersionKey`가 모두 같으면 hit. 다르면 `stale` 이벤트 뒤 다시 파싱해 같은 키에 덮어쓴다. 이때 Map 위치는 유지된다 |
| 접근 시각 | hit와 저장 때 `lastAccessedAt = Date.now()`(ms 해상도) |
| 축출 | 저장할 때마다 `pruneDiskSourceFileCache()`를 부른다. 크기가 C를 넘으면 전체 항목을 `lastAccessedAt` 오름차순으로 정렬해 초과분을 지운다 |
| 동률 처리 | 정렬이 안정적이므로 Map 삽입 순서를 따른다. hit는 시각만 갱신하고 Map 위치는 바꾸지 않는다. 그래서 근사 LRU다 |
| `store` 이벤트 | prune **뒤**에 내보낸다. `entries`는 축출 후 크기(≤ C)다 |
| `statSync` | 캐시 경로에서는 요청마다 한 번(hit·miss·stale) 부른다. 실패하거나 파일이 아니면 이벤트 없이 기본 호스트로 넘긴다. `shouldCreateNewSourceFile`이면 `bypass` 이벤트를 내보낸다 |
| OFF 경로 | `defaultHost.getSourceFile`(`ts.createCompilerHost(options, true)`). 캐시 경로와 같이 `setParentNodes = true`로 파싱한다 |

## 2. 용량 주입 (B안)

1. `prepare`가 analyzer 작업 트리의 `out/analyzer` 전체를 저장소 밖 `<run-root>/builds/c{400,800,1600}/out/analyzer`로 복사한다.
2. `analyze.js`에서 `^const MAX_DISK_SOURCE_FILE_CACHE_ENTRIES = (\d+);$` 형태의 선언과 `const|let|var MAX_DISK_SOURCE_FILE_CACHE_ENTRIES` 선언을 센다.
   - 각각 정확히 1개이고 값이 800일 때만 그 숫자 리터럴을 바꾼다.
   - 아니면 **BLOCKED**로 기록하고 중단한다.
3. 치환 뒤 다음을 검증한다.
   - 줄 수가 같다
   - 바뀐 줄 수: C ≠ 800이면 1, C = 800이면 0
   - 식별자 출현 수가 같다
   - 되돌리면 원본과 같다
   - 바이트 길이 차이가 예상과 같다
   - 다른 파일 SHA-256이 원본과 같다
4. 변형 빌드마다 diff 파일을 만든다. 원본·변형 파일별 SHA-256은 `capacity-injection.json`에 기록한다.
5. 변형 빌드의 `node_modules`는 analyzer 작업 트리 `node_modules`를 가리키는 junction이다. 별도 프로세스에서 로딩해 다음을 확인한다.
   - `typescript`의 실제 경로가 원본과 같다
   - `analyze.js`가 변형 디렉터리에서 로딩된다
6. 측정 child는 시작할 때 로딩할 빌드의 파일 해시를 `capacity-injection.json`과 대조한다. phase 시작·종료 때도 analyzer 동일성(HEAD·빌드 해시)과 모든 빌드 해시를 확인한다.
7. 적용 검증은 occupancy로 한다(correctness phase).
   - W > C이면 최대 점유량과 `clearAnalyzerCaches` 이벤트로 직접 읽은 점유량이 정확히 C여야 한다.
   - W ≤ C이면 축출 0, 점유량 W여야 한다.
8. **OFF 기준선은 원본 빌드**(analyzer 작업 트리 `out/`)를 쓴다. C = 800 변형은 원본과 바이트가 같은 복사본이다. 두 빌드의 정합성 결과가 같은지 비교한다.
9. 캐시 로직과 TypeScript 소스는 바꾸지 않는다.

## 3. 측정 전 발견: L은 프로세스 cwd에 따라 달라진다 (MEASURED, 파일럿)

- analyzer는 `ts.parseJsonConfigFileContent(cfg, ts.sys, configDir)`에 `configFileName`을 넘기지 않는다(`analyze.ts:444`).
- 같은 합성 workspace(N = 100)의 W는 측정 프로세스의 cwd에 따라 달랐다.

| 측정 프로세스 cwd | W | 비-workspace 요청 |
|---|---:|---|
| analyzer 작업 트리(`node_modules` 있음) | 259 | `@types` 72, `undici-types` 37, `typescript/lib` 51 |
| EXP-02 도구 작업 트리(`node_modules` 있음) | 259 | 같다 |
| `node_modules`가 없는 디렉터리 | 150 | `typescript/lib` 51 |

- 따라서 자동 포함되는 `@types`는 tsconfig 위치가 아니라 **cwd의 `node_modules/@types`** 를 따른다. 코드 경로 해석(INFERRED): `configFilePath`가 없어 기본 type root가 host의 현재 디렉터리에서 정해진다.
- EXP-02 Group B의 synthetic W(259/659/1159/2159)와 같은 L을 얻기 위해 **모든 측정 프로세스의 cwd를 analyzer 작업 트리로 고정**한다.
  - 도구가 cwd를 검사한다.
  - `workloads.json`에 cwd `@types` 목록과 버전을 기록한다.
- 계획서 §4는 합성 workspace를 `<repo>/.benchmark-workspaces/`에 만들라고 했다. 하지만 L을 정하는 것은 생성 위치가 아니라 cwd다. EXP-02와 같이 저장소 밖 `--work-dir`에 만든다.
- 합성 생성 규칙은 EXP-02(원본 `generateSyntheticWorkspace`)와 같다.

## 4. Workload와 phase

**Workload.** `workloads` 명령이 측정 전에 모두 생성하고 고정한다.

1. N = 100 probe로 L = W − N을 잰다. `"types": []` 변형 probe로 L′을 잰다.
2. 경계 N = C − L − 1, C − L, C − L + 1을 계산한다. 파일럿에서는 L = 159, L′ = 50이었다.
3. 모든 workload의 W를 직접 잰다. 요청 순서 SHA-256, 요청 구성, 내용 해시(tsconfig 포함)를 기록한다.
4. child는 시작할 때 내용 해시를 다시 대조한다.

| 집합 | workload |
|---|---|
| 주 격자 | N = 100, 500, 1000, 2000 |
| 경계 | C = 400: N = 240, 241, 242 · C = 800: 640, 641, 642 · C = 1600: 1440, 1441, 1442 (L = 159일 때) |
| H3-4 | `"types": []`(생성기 출력에서 tsconfig의 `compilerOptions.types`만 추가)<br>- C = 800 경계 N = 749, 750, 751<br>- 같은 N 반사실 N = 641, 642(기본 L에서 W = 800/801) |

**Phase.** 조건마다 새 Node 프로세스를 쓴다. 블록마다 seed `20261103 + offset + block`으로 순서를 섞는다.

| phase | 조건 | warm-up / 측정 / 블록 | 비고 |
|---|---|---|---|
| correctness | 빌드 4개(원본, c400, c800, c1600) × 전체 workload. 빌드마다 프로세스 1개 | OFF 3회 + SF 3회(active-edit 변형 0–2) | 측정 아님 |
| time | N 4 × {OFF(원본), SF@400, 800, 1600} × active-edit = 16 | 5 / 30 / 3 | 주 실험 |
| repeated | 같은 16조건 × repeated | 5 / 30 / 1 | 보조(계획서: k = 1) |
| boundary | 경계 9 + H3-4 5 = 14, SF@해당 C(H3-4는 C = 800) × active-edit | 3 / 15 / 3 | OFF 없음(hit율이 주 지표) |
| trace | SF 주 격자 12 + 경계·H3-4 14 = 26 | 2 / 3 / 1 | 요청 순서 전체를 저장(gzip) |
| memory | 16조건(OFF 포함) × active-edit, `node --expose-gc` | 3 / 10 / 1 | 시간 run과 분리 |
| microbench | 정렬(C별 1,000회 × 5), `statSync`·키 계산(N별 W개 파일 × 20패스) | — | harness 재구현이다. analyzer 내부 실행 비용이 아니다 |

**측정 루프.** EXP-02 `runScenarioSamples`의 한 mode 루프와 같다.

- mode 시작 때 `clearAnalyzerCaches`를 한 번 부르고, result cache를 새로 만든다.
- 시간 구간은 `performance.now()`로 `analyzePanelEquivalent` 하나를 감싼다.
- 다음 작업은 모두 시간 구간 밖이다: 이벤트 집계, 결과 해시(`canonicalHash`), `memoryUsage`, `os.freemem`, trace 저장.

**memory phase.** 분석마다 다음을 한다.

1. 분석은 원시값만 반환하는 helper 안에서 실행한다.
2. 그 뒤 50 ms timer를 기다린다.
3. `global.gc()`를 2회 부르고 `memoryUsage()`를 읽는다.
4. 분석 중의 자연 GC는 `PerformanceObserver('gc')`로 모아, 시간 창 안에서 시작한 항목만 그 분석에 넣는다.
5. 끝에서 다음 두 값을 잰다.
   - 캐시를 유지한 채 GC한 뒤의 `heapUsed`
   - `clearAnalyzerCaches` 뒤 GC한 뒤의 `heapUsed`

   두 값의 차이를 캐시 보유량 추정치로 쓴다.

- 파일럿 2(exploratory)에서 같은 동기 frame에서 `gc()`를 부르거나 `setImmediate`만 기다리면, OFF(캐시 없음)인데도 일부 반복에서 heap이 약 95–105 MB 높았다. 이는 그 분석의 SourceFile 집합 크기에 해당한다.
- 50 ms timer 뒤에는 사라졌다. **원인은 확인하지 않았다.** 그래서 이 대기를 측정 절차로 고정했다.

**메모리 보호.**

- parent는 조건을 시작하기 전에 가용 메모리가 400 MB 미만이면 phase를 `ABORTED`로 끝낸다. 파일은 보존한다.
- 측정하는 동안 별도 프로세스가 `Win32_PerfFormattedData_PerfOS_Memory`(가용 MB, Pages/sec)를 5초마다 기록한다(run root `paging.csv`).

## 5. 지표와 판정 규칙 (사전 고정)

### 지표

| 지표 | 정의 |
|---|---|
| hit율 h | 측정 반복의 Σhit / Σ(hit + miss + stale). 결정적 count이므로 CI를 두지 않는다(계획서 §6) |
| 분류 | Hit: h ≥ 99%. Miss: h < 1%. 그 사이: Partial |
| eviction(유도) | `store`마다 (직전 점유량 + [miss면 1]) − `entries`. 음수이거나 앞선 miss·stale이 없으면 anomaly |
| occupancy | 반복 끝 점유량(유도). 프로세스 끝에 `clearAnalyzerCaches` 이벤트의 `sourceFiles`로 직접 읽는다 |
| 재사용 거리 | 요청마다 직전 같은 파일 요청 이후의 서로 다른 파일 수(Fenwick tree). 순수 LRU(용량 C)는 거리 < C인 요청만 hit한다. 관측 hit와 LRU 예측 hit의 차이를 근사 LRU 오차로 보고한다 |
| 시간 | 조건별 type-7 median, p95, IQR, 평균, 표본 SD. 블록별 median을 함께 보고한다 |
| r | 1 − median(ON)/median(OFF). pooled 표본 기준이고, 블록별 r도 보고한다 |
| r·Δ의 95% CI | **2단계(cluster) bootstrap**(10,000회, seed 20261103)<br>1. 블록을 복원 추출한다. OFF와 ON에 같은 블록 번호를 쓴다(같은 블록에서 측정했기 때문).<br>2. 뽑은 블록 안에서 반복을 복원 추출한다.<br>k = 1(repeated)이면 프로세스 내 bootstrap이 된다 |
| 보조 검정 | Mann–Whitney U, Cliff's δ, Hodges–Lehmann, Holm 보정(주 격자 12 비교)<br>- pooled 반복 표본에 적용한다. 같은 프로세스 안의 반복은 독립이 아니라서 **가정을 위반한다**.<br>- 그래서 판정에는 쓰지 않고 참고로만 보고한다.<br>- 블록 수가 3이라 블록 단위 검정은 하지 않는다 |
| N–시간 기울기 | 빌드별 블록 median과 N의 OLS. 점 bootstrap CI |
| H3-6 | 메모리 조건별 (직접 occupancy, 캐시 보유량 추정)의 OLS 기울기(byte/entry), bootstrap CI, R² |

### 가설 판정

| 가설 | 판정 규칙 |
|---|---|
| H3-1 | 주 격자 24셀(active-edit 12 + repeated 12)에서 관측 분류가 측정 W 기준 예측(W ≤ C → Hit, W > C → Miss)과 모두 같으면 SUPPORTED, 아니면 NOT_SUPPORTED(불일치 셀 보고) |
| H3-2 | (a) 계획서 예측표(L = 159) 12셀이 모두 일치<br>(b) 회복 2건 모두: N = 500의 C 400 → 800, N = 1000의 C 800 → 1600에서 h < 1% → ≥ 99%이고, 큰 C의 r 95% CI 하한 > 0<br>둘 다 성립하면 SUPPORTED. 회복이 일부만 성립하면 PARTIALLY_SUPPORTED |
| H3-3 | 각 C에서 W = C − 1, C → Hit이고 W = C + 1 → Miss이면 그 C는 통과. 3개 C 모두 통과하면 SUPPORTED, 일부면 PARTIALLY_SUPPORTED |
| H3-4 | L′ < L이고 H3-4 5셀이 측정 W 기준 예측과 모두 같으면 SUPPORTED. 5셀은 C = 800 경계 3점과, 같은 N 641·642에서 기본 L이면 W = 800·801이지만 L′이면 Hit인 2점이다 |
| H3-5 | 다음 셋이 모두 성립하면 SUPPORTED. 둘째 조건(속도 저하)이 일부라도 있으면 PARTIALLY_SUPPORTED<br>- zero-hit 주 격자 조건 모두에서 ON − OFF의 95% CI가 0보다 크다<br>- 정렬 microbench 비용이 C에 따라 단조 증가한다<br>- 분해 합(stat + 키 + 정렬 + GC 차이)이 관측 차이의 CI 안에 든다<br>분해는 근사다. microbench는 analyzer 밖에서 쟀고, GC 차이는 강제 GC를 하는 별도 run에서 얻었다. 잔차를 그대로 보고한다 |
| H3-6 | 기울기 CI 하한 > 0이고 R² ≥ 0.9이면 SUPPORTED. 기울기만 양수면 PARTIALLY_SUPPORTED |

### 스래싱 판정 (계획서 §6의 다섯 기준)

대상은 W > C인 조건이다: 주 격자 6개, 경계 C + 1 3개, H3-4 C + 1 1개.

| 기준 | 조작적 정의 |
|---|---|
| 1 | h < 1% |
| 2 | 분석당 eviction median / miss median이 1 ± 1% |
| 3 | 모든 측정 반복의 끝 점유량이 정확히 C |
| 4 | trace phase 측정 반복의 최소 재사용 거리 ≥ C |
| 5 | 반사실. 다음 중 하나가 성립하면 충족이다<br>- 같은 workload에서 C′ ≥ W인 빌드의 correctness 2·3회차 hit율 ≥ 99%<br>- (기본 L workload의 경우) 같은 N의 `"types": []` 변형이 Hit<br>C′ ≥ W인 측정 용량도 H3-4 변형도 없으면 NOT_TESTABLE |

다섯 기준이 모두 충족되면 THRASHING_OBSERVED, 아니면 PARTIAL_EVIDENCE다.

### 정합성

정합성 오류가 있는 조건은 정상 성능 결과로 보고하지 않는다.

- correctness phase 모든 행이 통과해야 한다: 해시가 OFF와 같다, 변형이 반영됐다, 요청 수가 W와 같다, 불변식이 성립한다, occupancy ≤ C, 용량 적용이 확인된다.
- c800 결과가 원본과 같아야 한다(count·점유·해시).
- 측정 phase 반복별로 다음을 확인한다.
  - SF 조건: hit + miss + stale + bypass = W, `maxEntries` ≤ C, 유도 anomaly 0
  - OFF 조건: disabled = W
  - active-edit: 변형이 반영됐다
- 같은 반복 번호에서 SF 해시가 OFF 해시와 같아야 한다(time·repeated). boundary는 블록 간 해시가 같아야 하고, 반복 0–2는 correctness OFF 해시와도 같아야 한다.
- count가 블록 간 결정적이어야 한다.

## 6. 계획서와 다른 점 (측정 전 기록)

| 항목 | 계획서 | 이번 실행 | 이유 |
|---|---|---|---|
| 합성 workspace 위치 | `<repo>/.benchmark-workspaces/` | 저장소 밖 work-dir. cwd 고정 | §3. L을 정하는 것은 cwd다 |
| L 조작 | `"types": []` | 같다. 같은 N 반사실 2점 추가 | H3-4 반사실을 직접 보이기 위해 |
| C = 4000 | 선택 항목 | 하지 않음 | P3 지시서가 400/800/1600을 지정했다 |
| 실제 대상 cogic·zod | 보조(exploratory) | 하지 않음 | P3 지시서 §6이 합성 workspace만 지정했다 |
| 메모리 조건 | SF 주 격자 | OFF 포함 16조건 | 기준선(캐시 없음) |
| trace 반복 | 측정 3회 | warm-up 2 + 측정 3 | 첫 분석(채우기)과 두 번째 분석을 분리하기 위해 |
| memory GC | 분석마다 `global.gc()` | 50 ms 대기 + `gc()` 2회 | §4 파일럿 관찰 |
| 기본값 회귀(`npm test` 25개) | A안 조건 | 해당 없음(B안) | production 무변경 |
| 측정 환경 | 가용 메모리 ≥ 3 GB, 고성능 전원 | 측정 시작 시 가용 메모리를 기록한다(파일럿 때 1.3–1.9 GB). 전원은 균형 조정(EXP-02와 같다) | 8 GB 장비이고 상주 앱이 있다. 파일럿에서 child RSS ≤ 약 750 MB, 가용 메모리 512 MB 미만인 반복 0을 확인했다 |

## 7. 파일럿 (최종 통계에서 제외)

**pilot1**

- prepare·workloads 동작 확인: L = 159, L′ = 50. 18개 workload 모두 W = 예측 W였다.
- correctness 4 workload: 48/48 통과.
  - C = 400에서 W = 401이면 hit 0이다.
  - 점유량은 정확히 400이다.
  - 2·3회차 eviction은 1159(= miss)다.
- N = 2000 time·trace·memory: 실행 가능. child RSS는 약 730 MB였다.

**pilot2**

- 축소 end-to-end 실행: 7개 phase 모두 COMPLETE, report 생성 확인.
- 이 과정에서 memory GC 측정 문제(§4)를 발견했다. `heapUsed` 측정만 고쳤고, 시간 측정 로직은 바꾸지 않았다.

## 8. 재현

```powershell
cd <analyzer worktree @ bbe4cbf>          # cwd 고정 (§3)
$T = "<repo>\docs\thesis-experiments\tools\exp03-cache-scalability.mjs"
node $T prepare   --analyzer-root . --run-root <run-root>
node $T workloads --analyzer-root . --run-root <run-root> --work-dir <work-dir>
foreach ($p in "correctness","time","repeated","boundary","trace","memory","microbench") {
  node $T phase --name $p --analyzer-root . --run-root <run-root> --work-dir <work-dir> --exp02-zip <exp02 zip>
}
node <repo>\docs\thesis-experiments\tools\exp03-report.mjs --run-root <run-root>
```

## 9. 변경 이력

| 버전 | 내용 |
|---|---|
| 1 | 최초(측정 전) |
