# EXP-02: Cache Performance Reproduction

- 상태: **PLANNED** (P2 대상)
- 준비도: **PARTIALLY_READY** — 측정 대상 analyzer 코드는 과거 실행과 동일하다(`git diff d9faa02 HEAD -- src` = 0줄). 기존 harness 로직을 재사용할 수 있다. 다만 기존 스크립트는 과거 산출물을 덮어쓰고 반복별 표본을 남기지 않으므로 **그대로 실행하면 안 된다**. 원래 하드웨어가 없으면 same-environment 재현은 불가능하다.
- 과거 기준 결과: MEASURED[HIST-0829] ([../existing-benchmark-audit.md](../existing-benchmark-audit.md))
- 측정 대상: **analyzer 실행 시간**(+harness result cache 오버헤드). UI 응답시간이 아니다.

---

## 1. Research Question

- **RQ2-1 (주 질문)**: 현재 HEAD에서 Cogic 저장소 active-file edit 시나리오의 SourceFile cache 효과(과거 p50 −66.4%)가 같은 방법으로 다시 관찰되는가?
- **RQ2-2**: 과거에 관찰된 패턴(cold 오버헤드, repeated Full best-case, active-edit의 result hit 0, 합성 1000/2000의 SF hit 0과 지연)이 대상 전체에서 재현되는가?
- **RQ2-3**: 캐시 **hit 경로**(재사용된 `SourceFile`, clone된 result)의 분석 결과가 OFF와 동일한가?
- **RQ2-4 (견고성)**: 실행 순서 무작위화와 프로세스 격리를 적용해도 결론이 유지되는가?

## 2. Hypothesis

- **H2-1**: Cogic active-edit에서 SourceFile only의 p50은 OFF보다 작다. 상대 감소율 `r = 1 − median(SF)/median(OFF)`의 95% CI 하한 > 0.
- **H2-2**: active-edit Full result 모드의 result hit는 0이고, p50은 SourceFile only와 같거나 약간 크다(키 계산·clone 오버헤드).
- **H2-3**: cold 시나리오에서 캐시 활성 조건은 OFF보다 빠르지 않다(캐시 생성 오버헤드).
- **H2-4**: 분석 1회당 SourceFile 요청 수는 과거와 같다: cogic 172, synthetic N+159, zod 534. 합성 1000/2000의 SF hit는 0이다. 결정적 count이므로 정확히 일치해야 한다. 단 `node_modules/@types` 구성이 바뀌면 달라질 수 있으므로 구성도 기록한다. cogic 172는 P0 probe에서 이미 일치를 확인했다(MEASURED[P0-PROBE]).
- **H2-5**: 모든 hit 경로 결과는 OFF와 정규화 해시가 같다.

## 3. Experimental Variables

| 구분 | 변수 | 수준 |
|---|---|---|
| 독립 | Cache mode | OFF, SourceFile only, Full result (과거 정의와 동일) |
| 독립 | Scenario | cold, repeated, active-edit (과거 정의와 동일) |
| 독립 | Workload | cogic, synthetic-100/500/1000/2000, zod (과거와 동일) |
| 독립(프로토콜) | 실행 프로토콜 | P-orig(과거 순서·단일 프로세스), P-robust(무작위 순서·조건별 프로세스 격리) |
| 독립(보조) | Node 버전 | v22.16.0(과거), v24.12.0(현재) |
| 종속 | 반복별 분석 시간(ms) | `performance.now()` 구간은 과거와 동일 |
| 종속 | 반복별 SF hit/miss/stale, result hit/miss | debug 이벤트 수 |
| 종속(보조) | 반복 후 `heapUsed`, `rss` | `process.memoryUsage()` (GC 강제 없음, 기록만) |

## 4. Controlled Variables

- Analyzer 소스: `src` 동일(HEAD). 사전 등록 커밋에서 `npm run compile` 후 `out/analyzer/*.js` SHA-256 기록
- TypeScript 5.9.3. graphDepth 1, traceMode false, traceScope `single-file`, warm-up 5, 측정 30(P-orig)
- 활성 파일: cogic `src/panel/CodeGraphPanel.ts`, synthetic `entry.ts`, zod `packages/zod/src/index.ts`
- 변형 코드: `getScenarioCode` 동일(`__cogicBenchmarkVariant${iteration}` 추가)
- Result cache: `PanelEquivalentResultCache`와 동일 로직(키·clone·LRU 40)
- 파일 목록: 과거와 같은 순회 규칙. 단 cogic 대상은 **깨끗한 `git worktree`**(untracked 산출물 없음)에서 만들고 목록 SHA-256을 기록한다. 과거 84개와 달라지는 점은 기록한다
- Zod: SHA `e6b6ab347675cd2bd54b1bdbed16f98c59be82a9`로 checkout(과거 스크립트는 `--depth 1` 최신이었음)
- 환경 통제: [../experimental-design.md §6](../experimental-design.md#6-측정-환경-통제-체크리스트-exp-0203)

## 5. Dataset / Workload

과거와 동일한 6개 대상이다(재현 목적상 추가·변경하지 않음).

보조 workload(exploratory, 재현 판정에서 제외): zod `packages/zod/src/v4/classic/schemas.ts`. 과거 zod 활성 파일은 그래프가 nodes 2, edges 0이라 의미 있는 크기의 실제 파일 데이터가 하나 필요하다. 이 경로는 과거 스크립트의 후보 목록(`pickExternalActiveFile`)에도 있다.

## 6. Measurement Metrics

- 조건별: median(type 7과 과거 nearest-rank 둘 다), p95, mean, 표본 SD(n−1), 모집단 SD(과거 비교용), IQR, min, max
- 조건 간: `Δ = median(OFF) − median(mode)`, `r = Δ / median(OFF)`, bootstrap 95% CI(Δ, r), Hodges–Lehmann, Mann–Whitney U, Cliff's δ
- count: 반복별 SF hit/miss/stale/bypass, result hit/miss. 반복마다 `hit + miss + stale = W`(분석 1회당 요청 수) 불변식 확인
- 정합성: 반복별 정규화 결과 해시(OFF 기준 해시와 비교)

## 7. Execution Procedure

### Phase A — 도구 준비 (production 무변경)

1. `docs/thesis-experiments/tools/exp02-cache-benchmark.mjs`를 작성한다. 기존 스크립트의 측정 로직(`analyzePanelEquivalent`, `PanelEquivalentResultCache`, `getScenarioCode`, `generateSyntheticWorkspace`, `listWorkspaceFiles`)을 **그대로 복사**하고 출처와 원본 SHA-256(`4495a596…`)을 주석에 남긴다. 측정 로직은 수정하지 않으며, 다음 기능만 추가한다.
   - 출력 경로 강제: `docs/thesis-experiments/data/exp-02/<run-id>/`. `docs/benchmarks/` 아래 쓰기 시도 시 즉시 실패
   - 반복별 표본 CSV, run/env/workloads JSON
   - dirty tree 거부, 과거 산출물 해시 사전·사후 검증
   - `--protocol orig|robust`, `--node-label`, `--seed`, `--targets`, `--scenarios`
   - hit 경로 정합성 검사(Phase D)
2. 기존 스크립트와의 diff를 `tools/exp02-diff-from-original.md`로 남긴다(측정 로직 무변경을 리뷰어가 확인할 수 있도록).
3. 통계 함수 단위 테스트(알려진 입력의 median/percentile/bootstrap 재현성).

### Phase B — 파일럿 (확증 분석에서 제외)

- cogic, synthetic-100 active-edit, 3 mode, 10회 → 분산 추정, 소요 시간 측정, 도구 동작 확인
- 산출: P-robust 반복 수 결정. 목표는 주 지표 `r`의 95% CI 반폭 ≤ 5%p

### Phase C — P-orig 방법 재현 (확증)

- 과거와 같은 순서, 단일 프로세스, warm-up 5, 측정 30, 54개 조건 전부
- Node v22.16.0으로 1회(주), v24.12.0으로 1회(보조)
- 예상 소요: 과거 약 45분/회(i5-4690 기준). 현재 장비 기준은 파일럿으로 추정한다

### Phase D — Hit 경로 정합성 (확증)

대상마다:

1. OFF로 변형 코드 v0을 분석해 기준 해시 `H0`을 얻는다.
2. SourceFile only로 v0을 2회 분석한다. 2회차는 hit 경로이며 hit 수 > 0을 확인하고 해시 = `H0`인지 본다.
3. Full result로 v0을 2회 분석한다. 2회차는 result hit(clone 반환)이며 해시 = `H0`인지 본다.
4. Phase C·E의 모든 측정 반복에서도 결과 해시를 계산해, 같은 변형 코드의 OFF 해시와 비교한다(측정 구간 밖에서 계산).

### Phase E — P-robust 견고성 (확증: RQ2-4)

- 주 조건 집합: 6 대상 × active-edit × 3 mode, cogic·synthetic-500 × repeated × 3 mode, cogic × cold × 3 mode = 30 조건
- 조건마다 **새 Node 프로세스**(warm-up 5 + 측정 30)를 실행한다. 조건 순서는 seed 기반 무작위(블록 무작위화: 반복 블록마다 30 조건을 섞음)
- 블록 반복 k: 파일럿으로 정하며 최소 3, 목표 5
- 블록 사이 30초 휴지, 시작·종료 시 가용 메모리 기록

## 8. Repetition Strategy

- 조건 내: warm-up 5, 측정 30(과거와 동일)
- 프로세스 간: P-robust에서 k ≥ 3 블록(독립 프로세스)
- 실행 회차: P-orig를 Node 버전별 1회. 시간이 허락하면 다른 날 1회 더(일 간 변동)

## 9. Statistical Analysis

- **주 지표**: Cogic active-edit `r_SF = 1 − median(SF)/median(OFF)`
- **재현 판정 규칙(사전 고정)**. 과거 원시 표본이 없으므로 과거 점추정 `r_hist = 0.664`를 기준으로 쓴다.
  - **REPRODUCED**: 신규 `r_SF`의 95% CI가 0.664를 포함하고 하한 > 0
  - **DIRECTION_ONLY**: 하한 > 0이지만 CI가 0.664를 포함하지 않음(효과 방향은 같고 크기가 다름)
  - **NOT_REPRODUCED**: CI가 0을 포함하거나 음수
  - 환경이 다르므로 DIRECTION_ONLY도 그 자체로 해석 가능한 결과다. 절대 ms 일치는 판정에 사용하지 않는다
- 보조 지표는 같은 규칙을 각 조건의 과거 점추정에 적용한다(표로 보고)
- count 지표(H2-4)는 정확 일치 여부로 판정한다
- P-robust는 블록별 중앙값의 분포와 블록 간 변동(블록 중앙값의 범위·CV)을 보고하고, P-orig와 결론(판정 범주)이 같은지 비교한다
- 다중 비교: 보조 조건의 Mann–Whitney p값에 Holm 보정

## 10. Correctness Validation

- Phase D 전부 통과(H2-5). 실패하면 실패 자체가 주요 결과이며, 해당 모드의 성능 수치는 "정합성 미보장"으로 표시한다
- 반복별 불변식 `hit + miss + stale = W`
- Full repeated에서 측정 30회 모두 result hit, active-edit에서 0인지 확인
- 실행 전후 과거 산출물 8개 파일 SHA-256 불변
- `out/analyzer` 해시가 사전 등록 시점과 같은지 확인

## 11. Threats to Validity

| 유형 | 위협 | 영향·완화 |
|---|---|---|
| 내적 | 하드웨어·OS·Node가 과거와 다름 | same-environment 재현 불가. 상대 지표로 판정하고 Node 22 조건을 추가한다. 원래 장비를 쓸 수 있으면 추가 실행 |
| 내적 | 실행 순서·JIT·힙 상태 | P-robust(무작위·격리)로 통제 |
| 내적 | OS 파일 캐시 미초기화 | 통제 불가. 모든 조건이 같은 조건(warm FS)임을 명시한다 |
| 내적 | 메모리 8 GB, 가용 메모리 부족 시 페이징 | 시작 시 가용 ≥ 3 GB, 반복별 rss 기록. 페이징 의심 구간은 표시 |
| 내적 | 백신 실시간 검사·백그라운드 작업 | 기록만 가능. 이상치는 표본에서 식별 |
| 구성 | 측정값은 analyzer 실행 시간이지 UX 지연이 아님 | 논문에서 명시. UI·debounce·`findFiles` 제외 |
| 구성 | Full result는 production 메서드가 아닌 등가 harness | 명시. production은 문서 변경마다 result cache 전체를 clear한다(baseline K6) |
| 구성 | SourceFile only는 production에 없는 분리 조건 | 분석용 조건임을 명시 |
| 구성 | SF 이득의 90%가 lib 선언 재파싱 회피(cogic) | 해석에 반영. 대상별 요청 구성을 표로 제시 |
| 외적 | 대상 6개, 실제 저장소는 cogic·zod 2개 | 일반화 제한. 보조 workload는 exploratory |
| 결론 | 과거 표본 부재로 분포 비교 불가 | 점추정 기준 판정 규칙 사용, 한계 명시 |

## 12. Expected Output Files

```text
docs/thesis-experiments/data/exp-02/<run-id>/
├── run.json                 # protocol, seed, node-label, 사전 등록 커밋, 도구 SHA-256
├── env.json
├── workloads.json           # 대상별 SHA, 파일 목록 해시, Program root 수, SF 요청 구성
├── samples.csv              # target,scenario,mode,process,block,iteration,isWarmup,elapsedMs,sfHit,sfMiss,sfStale,resultHit,resultMiss,heapUsed,rss,resultHash,timestamp
├── correctness.csv          # Phase D 결과
├── summary.csv              # 조건별 통계 (type7 & nearest-rank)
├── comparison-to-hist.csv   # 조건별 과거 점추정, 신규 CI, 판정
├── integrity.json           # 과거 산출물 해시 사전·사후
└── summary.md               # 도구 생성
docs/thesis-experiments/tools/exp02-cache-benchmark.mjs
docs/thesis-experiments/tools/exp02-diff-from-original.md
```

## 13. Reproduction Procedure

```powershell
git worktree add ..\cogic-exp02 <run 커밋>     # 깨끗한 작업 트리
cd ..\cogic-exp02
npm ci; npm run compile
powercfg /setactive SCHEME_MIN                   # 고성능 (측정 후 SCHEME_BALANCED로 원복)
node docs/thesis-experiments/tools/exp02-cache-benchmark.mjs --protocol orig --node-label v22.16.0
node docs/thesis-experiments/tools/exp02-cache-benchmark.mjs --protocol robust --blocks 5 --seed <seed>
```

외부 저장소(zod)는 기록된 SHA로 checkout된다(네트워크 필요). 재현자는 `samples.csv`로 `summary.csv`를 다시 계산해 일치하는지 확인한다.

## 14. Acceptance Criteria

- [ ] P-orig 54개 조건 전부 반복별 표본 포함으로 측정(누락 조건은 사유 기록)
- [ ] Phase D hit 경로 정합성 결과 기록(통과/실패 무관하게 보고)
- [ ] `env.json`·`workloads.json` 필수 필드 완비
- [ ] 과거 산출물 해시 불변(`integrity.json` PASS)
- [ ] 주 지표 판정(REPRODUCED/DIRECTION_ONLY/NOT_REPRODUCED)과 보조 지표 표 생성
- [ ] P-robust k ≥ 3 블록 완료 및 P-orig와 결론 비교
- [ ] 측정 범위(analyzer 실행 시간)와 비측정 범위(UI)가 보고서에 명시됨
