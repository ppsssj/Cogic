# EXP-02 결과: SourceFile 캐시 성능 재측정

- 측정일: 2026-10-30
- 판정: **`EXP02_MEASUREMENT_COMPLETE`**(Group A 54/54, Group B 54/54, P-robust 27개 조건 × 3블록)
- 계획: [experiments/exp-02-cache-performance.md](experiments/exp-02-cache-performance.md)
- 도구: `exp02-cache-benchmark/1.2`(commit `5855704`). 원본과의 차이는 [tools/exp02-diff-from-original.md](tools/exp02-diff-from-original.md)에 있다.
- 공개 데이터: [data/exp-02/](data/exp-02/)
  - run 3개: `samples.csv`, `summary.csv`, `comparison-to-hist.csv`, `correctness.csv`, `integrity.json`, `run.json`, `env.json`, `workloads.json`, `summary.md`
  - 통합 분석: `exp02-report.json`
- 측정 대상: **analyzer 실행 시간**(+harness 결과 캐시 오버헤드)이다. UI 응답 시간이 아니다.

## 1. 실험군

| 실험군 | analyzer | 목적 | 측정 |
|---|---|---|---|
| **Group A — HISTORICAL_REPRODUCTION**(주) | `43ace0fdfdf442d7871c3ef4a92d73b28f1b5e77`. `src`는 과거 측정 commit `d9faa02`와 같다(Git으로 재확인). 빌드 해시 `958dbf67…6270` | 2026-08-29 결과(66.4%)가 같은 방법으로 다시 관찰되는가 | P-orig 54개 조건(`expA-orig-node22-20261030`), P-robust 27개 조건 × 3블록(`expA-robust-node22-20261030`) |
| **Group B — CURRENT_ANALYZER_EVALUATION** | `bbe4cbf5b1f784d9223ca3d46d96058617687b12`(P1-J1–J3 개선 후 main). 빌드 해시 `2423b0d4…ac36` | 현재 코드에서도 캐시가 분석 시간을 줄이는가 | P-orig 54개 조건(`expB-orig-node22-20261030`) |

- 두 실험군의 공통 조건
  - workload: Cogic `d9faa02` clean worktree(`npm ci`), Zod `e6b6ab3`, 같은 규칙의 합성 workspace
  - Node 22.16.0, TypeScript 5.9.3, 측정 방법, 통계 규칙
- Group B는 현재 코드의 성능 평가다. 2026-08-29 결과를 재현한 실험이 아니다.

## 2. 주 결과

### 표 5-6 — Group A 캐시 성능 (Cogic active-edit, P-orig, Node 22.16.0)

| 캐시 조건 | Median | p95 | 감소율 | 95% CI |
|---|---:|---:|---:|---|
| OFF | 795.75 ms | 910.92 ms | — | — |
| SourceFile Only | 221.37 ms | 233.95 ms | **72.2%** | 71.2% – 74.2% |
| Full Result | 218.75 ms | 240.25 ms | 72.5% | 71.5% – 74.5% |

- 기준 정의
  - Median: type-7 보간 중앙값
  - p95: nearest-rank
  - 감소율: r = 1 − Median(Cache)/Median(OFF)
  - 95% CI: OFF와 Cache 표본을 따로 재표본한 bootstrap(10,000회, seed 20261102)
- 과거와 같은 nearest-rank p50으로 계산한 값
  - OFF 794.26 ms, SourceFile Only 221.14 ms, r = 72.2%
  - 시간 차이 Δ = 574.38 ms(95% CI 550.63–634.31)
- P-robust(조건마다 새 프로세스, 무작위 순서, 3블록 합산)
  - SourceFile Only r = **70.3%**(95% CI 69.6%–70.8%)
  - 블록별 r: 70.5%, 70.5%, 69.9%

### 표 5-7 — Group B 캐시 성능 (Cogic active-edit, P-orig, Node 22.16.0)

| 캐시 조건 | Median | p95 | 감소율 | 95% CI |
|---|---:|---:|---:|---|
| OFF | 772.11 ms | 869.76 ms | — | — |
| SourceFile Only | 223.02 ms | 243.46 ms | **71.1%** | 69.6% – 72.2% |
| Full Result | 218.14 ms | 239.72 ms | 71.7% | 70.5% – 72.6% |

- 같은 기준이다. nearest-rank p50: OFF 771.23 ms, SourceFile Only 222.45 ms
- 시간 차이 Δ = 549.09 ms(95% CI 517.27–572.80)

### 표 5-8 — 환경 및 재현 판정

| 항목 | 과거(HIST-0829) | 신규(2026-10-30) |
|---|---|---|
| OS | Windows 10(10.0.19045) | Windows 11 Pro(10.0.26100) |
| CPU | Intel i5-4690 @ 3.50 GHz, 논리 4개 | Intel i5-9400F @ 2.90 GHz, 논리 6개 |
| RAM | 15.9 GB | 7.95 GB(측정 시작 시 가용 1.9–2.3 GB) |
| Node.js / V8 | v22.16.0 / 기록 없음 | v22.16.0(공식 배포 zip, SHASUMS256 검증) / 12.4.254.21-node.26, npm 10.9.2 |
| TypeScript | 기록 없음(lockfile ^5.9.3) | 5.9.3 |
| 전원 구성 | 기록 없음 | 균형 조정(GUID `381b4222…`) |
| analyzer | `d9faa02` 작업 트리(dirty 미기록) | A `43ace0f`(`src` = `d9faa02`), B `bbe4cbf` |
| Cogic workload 파일 / 분석 1회 SourceFile 요청 | 84 / 172 | 60 / 173 |
| Zod 요청 | 534 | 532 |
| 합성 요청(N + 159) | 259 / 659 / 1159 / 2159 | 같다 |
| **METHOD_REPRODUCED** | — | **NOT_MET**. (b) Cogic 파일 목록 84 → 60. (d) 결정적 count가 다르다: Cogic 173 vs 172, Zod 532 vs 534. 나머지는 충족: 측정 로직 복사, 54개 조건, warm-up 5·측정 30, Full repeated 전부 result hit, active-edit result hit 0 |
| **EFFECT_DIRECTION_REPRODUCED** | — | **YES**(P-orig), **YES**(P-robust) |
| **MAGNITUDE_COMPATIBLE** | r = 66.4% | **NOT_COMPATIBLE**(P-orig 72.2%, CI 71.2–74.2%, 반폭 1.5%p; P-robust 70.3%, CI 69.6–70.8%, 반폭 0.6%p). 해석 한계는 §5 |
| 정합성 | 비교 1회(miss 경로) | Phase D 18/18 × 3 run. 반복별 결과 해시 OFF와 4,410건 비교, 불일치 0. 요청 수 불변식 위반 0. active-edit 변형 반영 확인 |

## 3. 시나리오별 결과 (Group A P-orig / P-robust, Group B P-orig)

| 대상·시나리오 | 모드 | A P-orig r | A P-robust r | B P-orig r | 과거 r |
|---|---|---:|---:|---:|---:|
| Cogic active-edit | SourceFile | 72.2% | 70.3% | 71.1% | 66.4% |
| Cogic active-edit | Full | 72.5% | 68.8% | 71.7% | 65.2% |
| Cogic repeated | SourceFile | 72.6% | 70.5% | 72.0% | 67.6% |
| Cogic repeated | Full | 99.5% | 99.5% | 99.5% | 99.5% |
| Cogic cold | SourceFile | 20.3% | −2.5% | −0.6% | −2.3% |
| Cogic cold | Full | 19.4% | −3.5% | −3.1% | −6.3% |
| Synthetic-100 active-edit | SourceFile | 85.4% | 84.9% | 84.9% | 표 참조 |
| Synthetic-500 active-edit | SourceFile | 82.2% | 81.3% | 82.1% | 표 참조 |
| Synthetic-1000 active-edit | SourceFile | −10.0% | −12.7% | −10.6% | 표 참조 |
| Synthetic-2000 active-edit | SourceFile | −12.9% | −16.3% | −14.2% | 표 참조 |
| Zod active-edit | SourceFile | 87.5% | 86.9% | 86.7% | 표 참조 |

- 전체 54개 조건의 과거 대비 판정은 `data/exp-02/expA-orig-node22-20261030/comparison-to-hist.csv`에 있다.
  - Group A P-orig: 방향 YES 30개(그중 크기 COMPATIBLE 9개, NOT_COMPATIBLE 21개), NO 3개, REVERSED 3개
- **Cold 초기화 비용**
  - P-robust와 Group B에서 cold의 캐시 조건은 OFF보다 빠르지 않다(−0.6% ~ −3.5%). 과거와 방향이 같다.
  - Group A P-orig의 cold +20%는 OFF 측정 중간(반복 20–31)에 1,000–1,560 ms로 느려진 구간 때문이다.
    - 앞부분이 아니라 중간이므로 JIT warm-up이 아니다. 일시적 시스템 간섭으로 보이며 원인은 확인하지 못했다.
    - 표본은 제외하지 않았다. 이 조건의 판정(REVERSED)은 P-robust로 뒤집힌다(같은 방향 −2.5%).
- **Repeated Full Result:** 측정 30회 모두 result hit이고 99.5% 감소한다(3.8 ms). 같은 입력을 반복하는 극단적 최적 조건이다.
- **Active-edit SourceFile 캐시:** Full Result의 result hit는 0이다. 그래서 Full Result는 SourceFile Only와 같은 수준이다(키 계산·clone 오버헤드 포함).
- **Synthetic-1000/2000**
  - 분석 1회 요청(1,159·2,159)이 SourceFile 캐시 용량 800을 넘어 hit가 0이다.
  - 캐시 조건이 OFF보다 10–17% 느리다(stat·저장·LRU 정리 비용). 과거 관찰(hit 0, 지연)과 같은 방향이다.
- **요청 수와 용량:** 요청 수 W ≤ 800인 대상(Cogic 173, Synthetic-100 259, Synthetic-500 659, Zod 532)은 반복 hit가 W와 같다. W > 800인 대상은 hit가 0이다.

## 4. Group A와 B

| Cogic active-edit | A Median | B Median | B/A |
|---|---:|---:|---:|
| OFF | 795.75 ms | 772.11 ms | 0.970 |
| SourceFile Only | 221.37 ms | 223.02 ms | 1.007 |
| Full Result | 218.75 ms | 218.14 ms | 0.997 |

- B의 감소율(71.1%)은 A(72.2%)와 비슷하다. 두 CI는 71.2–72.2% 구간에서 겹친다.
- 개선된 analyzer(P1-J1–J3)에서도 SourceFile 캐시 효과의 방향과 크기가 유지된다.
- B의 OFF가 3% 빠르다. 하지만 같은 장비의 연속 run이고 run 사이 변동을 따로 측정하지 않았다. 그래서 analyzer 변경 때문이라고 말할 수 없다.
- B는 Cogic 결과의 엣지가 576 → 584로 늘었다(개선 내용). 실행 비용 차이는 측정 오차 범위 안이다.

## 5. 해석과 한계

- **크기 비교의 한계:** 과거 결과는 반복별 표본이 없는 점추정 하나다.
  - 그래서 NOT_COMPATIBLE은 "현재 측정의 CI가 과거 점추정 66.4%를 포함하지 않는다"는 뜻일 뿐이다. 과거 결과가 틀렸다는 뜻이 아니다.
  - 하드웨어(CPU 세대·코어 수), OS, 메모리, workload 파일 목록이 모두 다르다. 이 차이만으로 상대 효과 크기가 달라질 수 있다.
  - 두 효과 크기가 같은지 다른지는 검정할 수 없다.
- **METHOD_REPRODUCED NOT_MET의 원인**
  - 같은 commit(`d9faa02`)의 clean tree인데도 Cogic 파일 수가 84에서 60으로 다르다. 과거 실행에는 untracked 파일이 있었을 가능성이 있지만 확인할 수 없다(과거 파일 목록이 기록되지 않았다).
  - SourceFile 요청 차이(Cogic +1, Zod −2)의 원인도 확인하지 못했다.
  - 측정값을 과거 count에 맞추지 않았다.
- **메모리**
  - 측정 시작 시 가용 메모리는 1.9–2.3 GB로, 계획서 기준(≥ 3 GB)에 못 미쳤다. 연구자가 사용자 앱을 정리한 뒤 진행을 결정했다.
  - 반복별 기록상 가용 메모리 512 MB 미만인 반복은 다음과 같다.
    - P-orig 두 run: 0건
    - P-robust: 25건(Synthetic-500 repeated OFF, 주 조건 아님)
  - Node RSS는 최대 1.0–1.4 GB였다.
- **계획서와의 차이**
  - P-robust 주 조건은 계획서가 "30"이라고 적었지만 나열된 집합은 27개다(도구 문서 §5).
  - 블록 사이 30초 휴지를 두지 않았다.
  - Node 24.12.0 보조 P-orig run(계획서 Phase C 보조)은 하지 않았다.
  - 반복마다 결과 해시를 계산했다(구간 밖, 도구 문서 §4).
- **측정 범위:** analyzer 실행 시간만 측정했다. UI·debounce·파일 탐색은 포함하지 않는다. Full Result는 production 메서드가 아닌 등가 harness다.

## 6. 논문용 서술 (제5장 5.3 초안)

> 기존 벤치마크(2026-08-29)의 측정 로직을 그대로 복사한 별도 측정 도구로 SourceFile 캐시의 성능을 다시 측정하였다. 과거 측정과 같은 analyzer 소스(`43ace0f`, `d9faa02`와 `src` 동일)와 같은 Node.js 22.16.0을 사용하였으나, 하드웨어와 운영체제, 메모리 용량은 과거와 다르다. Cogic 저장소에서 활성 파일을 매번 수정하는 시나리오의 분석 시간 중앙값은 캐시를 끈 경우 795.75 ms, SourceFile 캐시만 켠 경우 221.37 ms였으며, 시간 감소율은 72.2%(95% CI 71.2–74.2%)였다. 조건마다 프로세스를 분리하고 실행 순서를 무작위화한 견고성 측정에서도 감소율은 70.3%(95% CI 69.6–70.8%)로, 효과의 방향이 유지되었다. 두 측정의 신뢰구간은 과거 점추정 66.4%를 포함하지 않았다. 그러나 과거 결과는 반복별 표본이 없는 단일 점추정이고 실행 환경과 작업 대상의 파일 목록(84개 대 60개)이 다르므로, 이 차이를 성능 차이로 해석하지 않는다. 결정적 요청 수(Cogic 173건 대 172건, Zod 532건 대 534건)도 과거와 정확히 일치하지 않아, 측정 절차의 동일성은 부분적으로만 재현되었다(METHOD_REPRODUCED: NOT_MET). 따라서 본 결과는 "같은 방법으로 측정했을 때 SourceFile 캐시의 시간 감소 효과가 다시 관찰되었다"는 방향의 재현으로 한정하여 보고한다.
>
> 캐시의 효과는 작업 대상의 크기에 따라 달랐다. 분석 1회의 SourceFile 요청 수가 캐시 용량(800개) 이하인 대상에서는 반복 분석 시 모든 요청이 캐시에서 재사용되었고 시간이 70–88% 줄었다. 반면 요청 수가 용량을 넘는 1,000개·2,000개 파일 합성 workspace에서는 캐시 적중이 0이었고, 캐시 관리 비용 때문에 분석 시간이 오히려 10–17% 늘었다. 캐시를 매번 비우는 cold 시나리오에서는 캐시가 시간을 줄이지 못했다(견고성 측정 −2.5%). 동일 입력을 반복하는 경우 Full Result 캐시는 분석 시간을 99.5% 줄였으나, 이는 결과를 그대로 재사용하는 극단적인 최적 조건이며 활성 파일이 바뀌는 편집 시나리오에서는 결과 캐시 적중이 발생하지 않았다.
>
> P1-J1–J3 개선을 반영한 현재 analyzer(`bbe4cbf`)에서도 같은 시나리오의 감소율은 71.1%(95% CI 69.6–72.2%)로, 캐시 효과가 유지되었다. 모든 측정에서 캐시 적중 경로의 분석 결과는 캐시를 끈 결과와 정규화 해시가 같았다(반복별 4,410건 비교, 불일치 0). 결과 캐시의 복사본은 JSON 직렬화로 값이 정의되지 않은 속성이 제거되므로, 비교는 두 결과를 같은 JSON 정규형으로 변환한 뒤 수행하였다.

## 7. 재현

```powershell
git worktree add ..\cogic-analyzer-original 43ace0fdfdf442d7871c3ef4a92d73b28f1b5e77   # Group A (npm ci; npm run compile)
git worktree add ..\cogic-analyzer-improved bbe4cbf5b1f784d9223ca3d46d96058617687b12   # Group B (npm ci; npm run compile)
git worktree add ..\cogic-workload-d9faa02 d9faa0221760f6d1b345ae067a3b37362562e1a0    # Cogic workload (npm ci)
git clone https://github.com/colinhacks/zod.git <work>\zod; git -C <work>\zod checkout e6b6ab347675cd2bd54b1bdbed16f98c59be82a9
$N22 = "<node-v22.16.0-win-x64>\node.exe"   # nodejs.org 공식 zip, SHASUMS256 검증
& $N22 docs/thesis-experiments/tools/exp02-cache-benchmark.mjs run --group A --analyzer-root ..\cogic-analyzer-original --cogic-workload ..\cogic-workload-d9faa02 --work-dir <work> --out-root <out> --run-id <id> --protocol orig --node-label v22.16.0
& $N22 docs/thesis-experiments/tools/exp02-cache-benchmark.mjs run --group B --analyzer-root ..\cogic-analyzer-improved ...   # 같은 인자
& $N22 docs/thesis-experiments/tools/exp02-cache-benchmark.mjs run --group A ... --protocol robust --blocks 3 --seed 20261102
node docs/thesis-experiments/tools/exp02-cache-benchmark.mjs publish --run <out>\<id> --to docs/thesis-experiments/data/exp-02/<id>
node docs/thesis-experiments/tools/exp02-report.mjs --a-orig <A> --b-orig <B> --a-robust <R> --out <file>
```

- 원시 결과는 저장소 밖에 보존했다.
  - 파일: `exp02-runs-20261030.zip`, SHA-256 `fea7da4646e16c9d97aded527c8efa43c2dcaca25df08afd60bdb2d9f46d02dc`
  - 내용: 파일 133개. 본 측정 3개와 파일럿 2개 run의 전체 출력(절대 경로 포함), P-robust 블록별 CSV, 통합 보고, 준비 로그
- 파일럿 2개(`pilot-A-node22`, `pilot2-A-node22-heavy`)는 도구 검증용이다. 최종 통계에 넣지 않았다.
- 과거 산출물 8개 파일의 SHA-256은 모든 run 전후에 `reproducibility.md §3` 값과 같았다(`integrity.json`). `npm run benchmark:cache`는 실행하지 않았다.
