# EXP-03: Cache Capacity & Scalability

- 상태: **PLANNED** (P3 대상)
- 준비도: **PARTIALLY_READY**
  - 지금 가능: 파일 수 변화에 따른 시간·hit/miss·occupancy·접근 순서 측정. 기존 `debug` 이벤트만으로 가능하다(`analyze.ts:647-690`).
  - **차단**: SourceFile cache 용량 변경. `MAX_DISK_SOURCE_FILE_CACHE_ENTRIES = 800`이 상수다(`analyze.ts:37`). 주입 방식 결정이 필요하다([../experimental-design.md §5](../experimental-design.md#5-production-코드-변경-정책) A안/B안).
  - harness 추가 필요: 메모리, GC 시간, eviction 유도, 재사용 거리 계산.
- 선행: EXP-02 도구(표본 저장·환경 기록·무결성 검증)를 재사용한다.

---

## 0. 확인된 구현 사실 (설계 전제)

| 정책 | 실제 구현 | 위치 |
|---|---|---|
| SourceFile cache 용량 | 800 entries, 근사 LRU(`Date.now()` ms, 동률은 삽입 순서), 초과 시 저장마다 전체 정렬 후 초과분 제거 | `analyze.ts:37`, `:646`, `:710-722` |
| Result cache 용량 | 40 entries, 근사 LRU, JSON clone | `CodeGraphPanel.ts:35`, `:1341` |
| 파일 목록 cache | 10 s TTL | `CodeGraphPanel.ts:1023` |
| Discovery 상한 | `findFiles(..., 4000)` | `CodeGraphPanel.ts:1027-1031` |

용어:

- `N` = 합성 workspace 파일 수(과거 실험의 "files")
- `W` = 분석 1회당 disk SourceFile 요청 수(작업 집합). 과거 원시 데이터: `W = N + 159` (synthetic), cogic 172, zod 534
- `L = W − N` = workspace 밖 선언 파일 수(TS lib, 상위 디렉터리 `node_modules/@types` 자동 포함분). P0 probe 기준 cogic의 비-workspace 요청은 155건이다
- `C` = SourceFile cache 용량

과거 관찰(MEASURED[HIST-0829]): `C = 800`일 때 W = 259, 659 → hit, W = 1159, 2159 → **hit 0**, ON이 OFF보다 7–14% 느림.

---

## 1. Research Question

- **RQ3-1**: `C = 800`에서 `N`이 커질 때 분석 시간과 SF hit율은 어떻게 변하는가?
- **RQ3-2**: hit율 붕괴는 `W > C`일 때 일어나는가(용량 기인 LRU 스래싱)? `C`를 키우면 hit가 회복되는가?
- **RQ3-3**: 용량 증가의 시간 이득과 메모리 비용(trade-off)은 어떤가?
- **RQ3-4**: hit가 0일 때 캐시 ON이 OFF보다 느린 이유는 무엇인가(`statSync`, 저장마다 전체 정렬, 유지된 AST로 인한 GC 증가)?

## 2. Hypothesis

근거: 분석 간 요청 순서가 동일하다(MEASURED[P0-PROBE], cogic 172건 순서 일치). 동일 순서 순환 접근에서 LRU는 `W ≤ C`이면 첫 분석 이후 전부 hit, `W > C`이면 hit 0이 된다(고전적 LRU 순환 패턴, INFERRED).

- **H3-1 (절벽 가설)**: active-edit/repeated의 측정 반복에서 분석 1회당 SF hit 수는 `W ≤ C`이면 `W`(hit율 ≈ 100%), `W > C`이면 0이다.
- **H3-2 (용량 회복)**: 아래 예측표가 성립한다(L = 159 가정. 실제 L은 실행 환경에서 측정해 다시 계산한다).

| N | W(예상) | C=400 | C=800 | C=1600 |
|---:|---:|---|---|---|
| 100 | 259 | hit | hit | hit |
| 500 | 659 | **0** | hit | hit |
| 1000 | 1159 | 0 | **0** (과거 관찰) | **hit** |
| 2000 | 2159 | 0 | **0** (과거 관찰) | **0** |

- **H3-3 (경계 날카로움)**: 각 `C`에서 `W = C`인 N은 hit, `W = C + 1`인 N은 hit 0이다.
- **H3-4 (작업 집합 조작)**: `N`을 바꾸지 않고 `L`만 줄이면(합성 tsconfig에 `"types": []`), 절벽 위치가 `N` 기준으로 그만큼 이동한다. 절벽이 `N`이 아니라 `W`를 따른다는 증거다.
- **H3-5 (zero-hit 오버헤드)**: hit 0 조건에서 ON − OFF 시간 차이는 miss 수 × (stat + 저장 + 정렬 O(C log C))와 GC 증가로 설명된다. 정렬 비용은 C에 따라 증가한다.
- **H3-6 (메모리)**: GC 후 `heapUsed`는 occupancy에 비례해 증가한다.

결과가 예측과 다르면(예: W > C에서 부분 hit) 그대로 보고하고 원인(근사 LRU 동률, 순서 변화)을 분석한다.

## 3. Experimental Variables

| 구분 | 변수 | 수준 | 근거 |
|---|---|---|---|
| 독립 | N | 100, 500, 1000, 2000 | 과거와 동일. W가 400/800/1600 경계를 각각 가른다 |
| 독립 | N(경계) | 각 C에 대해 `N = C − L − 1, C − L, C − L + 1` (L 실측 후 결정. L=159면 C=800 → 640, 641, 642) | H3-3 |
| 독립 | C | 400, 800(기본), 1600 | 400은 N 100/500, 800은 500/1000, 1600은 1000/2000 사이에 경계를 둔다 |
| 독립(선택) | C = 4000 | 모든 W보다 큼 | "용량 무제한" 기준선. 메모리 상한 추정 |
| 독립 | Mode | OFF, SourceFile only | result cache는 active-edit에서 hit하지 않으므로 제외(EXP-02에서 다룸) |
| 독립 | Scenario | active-edit(주), repeated(보조) | |
| 독립 | L 조작 | 기본 tsconfig(과거 동일), `"types": []` | H3-4 |
| 종속 | 반복별 분석 시간 | ms | |
| 종속 | SF hit / miss / stale / store 수, 분석 후 occupancy | debug 이벤트 | |
| 종속 | eviction 수 | `store` 이벤트의 `entries` 시퀀스로 유도(§6) | |
| 종속 | 재사용 거리(LRU stack distance) 분포 | 접근 순서에서 오프라인 계산 | |
| 종속 | `heapUsed`, `rss` (GC 후), GC 누적 시간 | `--expose-gc`, `PerformanceObserver('gc')` | |

후보값 검토: 400/800/1600 × 100/500/1000/2000은 각 용량 경계 양쪽에 최소 1개 규모가 오도록 배치되어 있어 H3-2 검증에 충분하다. 규모를 늘리기보다 **경계 점을 추가**하는 편이 비용 대비 증거력이 높다. N = 4000(production discovery 상한)은 모든 C에서 hit 0이 예측되어 정보가 적고, 8 GB 장비에서 메모리 위험이 있어 선택 항목으로 둔다.

## 4. Controlled Variables

- EXP-02 §4와 같음(커밋, TS, Node, graphDepth 1, 변형 코드 규칙, 환경 체크리스트)
- 합성 생성기: 과거 `generateSyntheticWorkspace`와 동일(결정적). 생성 위치도 과거와 같은 `<repo>/.benchmark-workspaces/` → 상위 `node_modules/@types` 구성이 L을 정한다. **`node_modules/@types` 목록과 버전을 기록한다**
- 용량 주입 시 다른 동작(키, 검증 조건, 정렬 방식)은 바꾸지 않는다
- 메모리 측정 run과 시간 측정 run을 분리한다(`global.gc()` 강제는 시간 측정을 왜곡하므로)

## 5. Dataset / Workload

- 합성 workspace: N ∈ {100, 500, 1000, 2000} + 경계 N 9개 + (H3-4) L 조작 변형
- 실제 대상(보조): cogic(W=172), zod(W=534) — 모든 C에서 W < C라 hit 예측. C=400에서 zod는 W > C → **hit 0 예측**(실제 저장소에서의 절벽 확인용 exploratory)

## 6. Measurement Metrics

- hit율 `h = hits / (hits + misses + stale)` (측정 반복 기준, Wilson CI는 불필요: 결정적 count)
- occupancy: 분석 종료 시 마지막 `store` 이벤트의 `entries`
- eviction(유도): 분석 내에서 `store` 이벤트의 `entries`가 이전과 같고 그 값이 C이면 eviction 1건. 시작 시 `clear` 이벤트로 초기화. B안을 택하면 동일하게 계산하고, A안에서 `evict` 이벤트를 추가하면 교차 검증한다
- 재사용 거리: 각 요청에 대해 직전 같은 파일 요청 이후 서로 다른 파일 수. **모든 재사용 거리 ≥ C이면 LRU hit 0이 수학적으로 보장된다**
- 시간: median(type 7), p95, IQR, `Δ_ON−OFF`와 bootstrap 95% CI. N에 대한 기울기(선형 회귀, CI)
- zero-hit 오버헤드 분해: (a) `statSync` 횟수 × 측정한 평균 stat 비용, (b) prune 정렬 microbenchmark(같은 크기 Map, 같은 비교 함수, harness 내 재구현으로 명시), (c) GC 누적 시간 차이
- 메모리: GC 후 `heapUsed` 중앙값, 캐시 보유분 추정 `heapUsed(full) − heapUsed(after clearAnalyzerCaches + gc)`

### 스래싱 입증 기준 (사전 고정)

다음 다섯 가지를 모두 만족하면 해당 workload에서 "**용량 기인 LRU 스래싱이 관찰됨**"으로 판정한다. 일부만 만족하면 만족한 항목만 보고한다.

1. 측정 반복의 SF hit율 = 0 (또는 < 1%)
2. 분석당 eviction 수 ≈ miss 수(저장할 때마다 축출)
3. occupancy가 C로 포화
4. 모든 요청의 재사용 거리 ≥ C
5. 반사실 조건: 같은 workload에서 C > W로 바꾸면 hit율 ≈ 100% (또는 H3-4의 W 감소로 회복)

1–4는 C=800의 기존 1000/2000 조건에서 production 무변경으로 측정할 수 있다. 5는 용량 주입(A/B안)이나 H3-4 조작이 필요하다. **H3-4는 production 변경 없이 반사실 증거를 제공한다.**

## 7. Execution Procedure

1. **L 실측**: 각 환경에서 N=100 workload로 probe 1회 실행 → `L = W − N` 기록, 경계 N 계산 후 `workloads.json`에 고정
2. **용량 주입 결정·구현**(A안 PR 또는 B안 도구). 검증: C=400 조건에서 occupancy 최댓값이 정확히 400인지 확인
3. **시간 측정 run** (`--expose-gc` 없이):
   - 주 격자: 4 N × {OFF, SF@400, SF@800, SF@1600} × active-edit = 16 조건, warm-up 5 + 측정 30
   - 경계: 9 workload × SF@해당 C × active-edit, warm-up 3 + 측정 15
   - 조건마다 새 프로세스, 블록 무작위화, k = 3 블록
   - 보조: repeated 시나리오는 주 격자에 대해 k = 1
4. **계측 run**: 접근 순서 전체(파일 경로, 이벤트 종류, entries)를 조건마다 측정 반복 3회분 저장 → 재사용 거리·eviction 계산
5. **메모리 run** (`node --expose-gc`): 주 격자 SF 조건에서 분석마다 측정 구간 밖에서 `global.gc()` 후 `process.memoryUsage()`. `PerformanceObserver`로 GC 시간 수집. 측정 10회
6. **오버헤드 분해**: prune 정렬 microbenchmark(C ∈ {400, 800, 1600}, 1,000회), stat 비용 microbenchmark(대상 파일 집합)
7. **H3-4**: `"types": []` 변형으로 L을 줄이고 N 경계 주변 3점 × C=800 × SF 측정
8. 분석·보고(가설별 사전 규칙 적용)

예상 소요(과거 i5-4690 시간 기준 추정, 파일럿으로 갱신): 주 격자 약 20분/블록 × 3, 경계 약 5분/블록 × 3, 계측·메모리 약 30분, H3-4 약 10분. 합계 약 2–3시간.

## 8. Repetition Strategy

- 조건 내 반복: 주 격자 30, 경계 15
- 프로세스 블록: k = 3(무작위 순서)
- count 지표는 결정적이므로 블록 간 동일해야 한다. 다르면 비결정성으로 보고한다

## 9. Statistical Analysis

- H3-1/H3-2/H3-3: 결정적 count로 예측표와 셀 단위 일치 여부를 판정한다(일치 셀 수 / 전체)
- 시간: 조건별 median과 bootstrap CI. `C`별 N–시간 곡선. `W/C` 비율을 x축으로 한 hit율·시간 그래프
- H3-5: 관측된 `Δ_ON−OFF`(zero-hit 조건)와 분해 추정치 합의 비교(비율, CI)
- H3-6: occupancy 대비 heapUsed 선형 회귀(기울기 = entry당 바이트, CI)
- 다중 비교: Holm 보정

## 10. Correctness Validation

- 모든 C와 OFF에서 같은 변형 코드의 정규화 결과 해시가 같아야 한다(용량은 결과를 바꾸면 안 됨)
- 불변식: 분석당 `hit + miss + stale = W`, `occupancy ≤ C`
- 용량 주입 적용 확인: occupancy 최댓값 = C(W > C인 경우)
- 기본값 회귀: 주입 경로를 쓰지 않으면 C = 800이고 기존 `npm test` 25개가 통과해야 한다(A안)
- 과거 산출물 해시 불변

## 11. Threats to Validity

| 유형 | 위협 | 완화 |
|---|---|---|
| 내적 | 용량 주입이 다른 동작을 바꿀 위험 | 최소 diff, 기본값 불변 테스트, B안이면 치환 검증 |
| 내적 | ms 해상도 동률 → 근사 LRU가 순수 LRU와 다르게 동작 | 재사용 거리와 실제 hit를 대조. 불일치는 보고 |
| 내적 | GC 비결정성, 8 GB 메모리 압박 | 시간 run과 메모리 run 분리, 가용 메모리 기록, rss 모니터링 |
| 구성 | 합성 workspace의 W에 상위 `@types`가 섞임(L 혼입) | L 실측·기록, H3-4로 분리 |
| 구성 | "스래싱" 용어의 조작적 정의 | §6 다섯 기준 사전 고정 |
| 외적 | 합성 파일은 작고 균일. 실제 프로젝트의 파일 크기·의존 분포와 다름 | 실제 대상(cogic, zod) 보조 측정. 일반화 제한 |
| 외적 | 실제 편집은 다중 파일 변경·무효화로 접근 패턴이 순환이 아닐 수 있음 | 범위 밖으로 명시(future work) |
| 외적 | production은 depth ≥2에서 분석당 Program 여러 개를 만든다 → 실제 W가 더 큼 | 범위 밖으로 명시. 해석 시 언급 |

## 12. Expected Output Files

```text
docs/thesis-experiments/data/exp-03/<run-id>/
├── run.json, env.json
├── workloads.json            # N, L, W, 경계 N 계산 근거, @types 목록
├── capacity-injection.json   # A/B안, 적용 검증 결과
├── samples.csv               # target,N,W,C,mode,scenario,block,iteration,elapsedMs,hit,miss,stale,store,evictDerived,occupancyEnd,resultHash
├── access-sequences/<cond>.csv.gz   # 요청 순서 (계측 run)
├── reuse-distance.csv        # 조건별 분포 요약
├── memory.csv                # heapUsed, rss, gcMs (메모리 run)
├── overhead-microbench.csv
├── prediction-check.csv      # H3-1~H3-3 셀별 예측 vs 관측
├── thrashing-criteria.csv    # 기준 1–5 충족 여부
└── summary.md                # 도구 생성
```

## 13. Reproduction Procedure

```powershell
git worktree add ..\cogic-exp03 <run 커밋>
cd ..\cogic-exp03
npm ci; npm run compile
node docs/thesis-experiments/tools/exp03-probe-L.mjs
node docs/thesis-experiments/tools/exp03-capacity.mjs --phase time --blocks 3 --seed <seed>
node docs/thesis-experiments/tools/exp03-capacity.mjs --phase trace
node --expose-gc docs/thesis-experiments/tools/exp03-capacity.mjs --phase memory
```

도구 이름은 P3에서 확정한다.

## 14. Acceptance Criteria

- [ ] L 실측값과 경계 N이 측정 전에 `workloads.json`에 고정되었다
- [ ] 용량 주입 적용이 occupancy로 검증되었다(또는 차단 사유 기록)
- [ ] 주 격자 16 조건 × k=3 블록, 경계 9 조건 완료
- [ ] 예측표(H3-2) 셀별 판정과 스래싱 기준 1–5 표 생성
- [ ] 메모리·GC 데이터와 오버헤드 분해 결과 생성
- [ ] 모든 조건에서 결과 해시가 OFF와 같다(다르면 결과로 보고)
- [ ] 과거 산출물 해시 불변
