# Cogic Thesis Experiments — P0: Baseline Audit & Experimental Design

예상 논문 제목: **정적 분석 기반 코드 구조 시각화 도구 Cogic의 설계 및 성능 최적화**

이 폴더는 졸업논문 실험의 준비 단계(P0) 산출물이다. P0의 목적은 새 기능 개발이 아니라 **현재 구현과 기존 실험 결과를 검증하고, 재현 가능한 후속 실험 계획을 세우는 것**이다. P0에서는 성능 벤치마크를 실행하지 않았고, production 코드도 변경하지 않았다.

## 기준 정보

| 항목 | 값 |
|---|---|
| Repository | https://github.com/ppsssj/Cogic |
| Base commit | `fed34a0950f1dc7b4b9e922a8c0b3b331c8aaa19` (= `origin/main`, 2026-10-26 fetch 후 확인) |
| 감사 일자 | 2026-10-26 |
| 감사 환경 | Windows 11 Pro 10.0.26100, i5-9400F 6C, 8 GB, Node v24.12.0, TypeScript 5.9.3 |
| Baseline 검증 | compile PASS, lint PASS(extension·webview), webview 타입검사 PASS, `npm test` **25 passing / 0 failing** (VS Code 1.143.1) |

## 증거 라벨 (Evidence Labels)

논문에 쓰는 모든 자료에 다음 라벨 중 하나를 붙인다.

| 라벨 | 의미 | 이 폴더에서의 예 |
|---|---|---|
| **IMPLEMENTED** | 소스코드로 확인된 구현 | `analyze.ts:37` SourceFile cache 800 |
| **TESTED** | 실제 테스트 실행으로 검증된 결과 | `TESTED[P0-1026]`: 2026-10-26 `npm test` 25 passing |
| **MEASURED** | 원시 데이터가 있는 측정 결과. 실행 ID를 붙인다 | `MEASURED[HIST-0829]`: 2026-08-29 기존 벤치마크(집계값만, 미재현). `MEASURED[P0-PROBE]`: 2026-10-26 계측 probe(count만, 타이밍 없음) |
| **HISTORICAL** | 과거 기록으로만 확인되고 원시 데이터나 현재 코드로 재확인되지 않은 결과 | 2026-04 중간보고서 서술 |
| **INFERRED** | 현재 자료에 근거한 해석·가설 | 대규모 hit 0의 원인 = LRU 순환 접근 스래싱 |
| **PLANNED** | 아직 수행하지 않은 실험·개선 | EXP-01/02/03 전체 |

원칙: `MEASURED[HIST-…]`는 **재현된 결과가 아니다.** 과거 실험과 신규 실험은 실행 ID, 날짜, 커밋, 환경으로 항상 구분한다.

## 문서 구성

| 문서 | 내용 |
|---|---|
| [baseline-audit.md](baseline-audit.md) | Task A·D: 기능별 구현 위치, 노드/관계 종류, adapter 범위, 캐시 정책, 테스트 현황, README 불일치, 왜곡 요인, 실행 환경, 검증 명령 결과 |
| [existing-benchmark-audit.md](existing-benchmark-audit.md) | Task B: 기존 벤치마크의 측정 구간·통계 방식·harness 등가성·데이터 정합성·순서 편향·재현 가능성·주장 범위 |
| [experimental-design.md](experimental-design.md) | 공통 프로토콜: 사전 등록, 데이터 분리, run 기록, 통계 규약, production 변경 정책, 환경 체크리스트 |
| [experiments/exp-01-accuracy.md](experiments/exp-01-accuracy.md) | EXP-01 관계 분석 정확도 계획(14개 항목) |
| [experiments/exp-02-cache-performance.md](experiments/exp-02-cache-performance.md) | EXP-02 캐시 성능 재현 계획(14개 항목) |
| [experiments/exp-03-scalability.md](experiments/exp-03-scalability.md) | EXP-03 캐시 용량·확장성 계획(14개 항목) |
| [evidence-matrix.md](evidence-matrix.md) | 논문 주장 → 소스코드 → 테스트/실험 → 상태 → 추가 작업 |
| [reproducibility.md](reproducibility.md) | 환경 비교, 버전, 재현 명령, 과거 산출물 무결성 해시 |
| [risks-and-limitations.md](risks-and-limitations.md) | 위험 목록(심각도·대응), P0 자체의 한계 |
| [p1a-ground-truth.md](p1a-ground-truth.md) | P1-A: EXP-01 Ground Truth 작성 방법, 독립성·검토 상태, 채점 규칙, 사전 등록, P0와의 차이 |
| [p1b-runner.md](p1b-runner.md) | P1-B: EXP-01 실행 도구 사용법, 사전 확인, 결과 폴더, 반복 비교 규칙, D11 결정 |
| [p1c-review-readiness.md](p1c-review-readiness.md) | P1-C: EXP-01 GT 사람 검토 준비(표본 감사, 검토자 절차, 검토 방식 A/B, 일치도·불일치 처리, v2 정정 절차, 남은 결정, 제5장 초안). 검토는 미수행 |
| [p1d-ai-cross-review.md](p1d-ai-cross-review.md) | P1-D: GPT-6 AI 교차 검토(146개) 보존, GT v1과의 일치도 재계산, 불일치 S037·S107 사후 판정 초안, v2 도입 조건. 사람 검토 아님 |
| [evidence/exp-01-ai-cross-review/](evidence/exp-01-ai-cross-review/README.md) | P1-D: AI 교차 검토 원본(사용자 제공, 바이트 보존)과 재계산 결과 |
| [p1f-scoring-blocker-audit.md](p1f-scoring-blocker-audit.md) | P1-F: EXP-01 첫 실측의 React 5개 사례 `SCORING_BLOCKED` 원인 감사(analyzer의 타입 있는 setter·dispatch 처리 + scorer external 키), 수정안 비교, 후속 PR 계획. 첫 run은 진단 전용 |
| [evidence/exp-01-p1f-scoring-blocker/](evidence/exp-01-p1f-scoring-blocker/README.md) | P1-F: 충돌 재현·진단 채점 스크립트와 출력, React setter 합성 입력 시험 |
| [p1g-scorer-amendment.md](p1g-scorer-amendment.md) | P1-G: EXP-01 run 보존(0651 baseline, 0636 replication)과 scorer 1.2 사후 개정(같은 줄 external 선언 구분), 39개 사례 불변성, fail-closed 유지, runner 1.2로 넘길 작업 |
| [evidence/exp-01-p1g-scorer-1.2/](evidence/exp-01-p1g-scorer-1.2/README.md) | P1-G: 공개용 run 보존 기록(상대 경로·해시), scorer 1.1/1.2 비교 스크립트와 결과, 진단 재채점 요약 |
| [p1h-runner-amendment.md](p1h-runner-amendment.md) | P1-H: runner 1.2(r2 manifest, scorer 1.2 고정, 사후 개정 프로토콜 기록, 기준 analyzer 동일성 확인, npm 기록). 기술 게이트와 사전 등록 확증의 구분 |
| [fixtures/exp-01/](fixtures/exp-01/README.md) | P1-A: EXP-01 코퍼스 A(fixture 44개, GT v1), 주석 지침, 패턴 카탈로그, 커버리지, 검토 표본 |
| `tools/exp01/` | P1-A: GT 검증, 채점, 커버리지, 검토 표본, manifest 도구와 단위 테스트 |
| `tools/exp01-run.mjs`, `tools/test/` | P1-B: EXP-01 실행 도구와 합성 입력 단위 테스트 |
| `tools/` | P0 읽기 전용 감사 도구 2개 |
| `data/p0/` | P0 도구 출력(감사 결과, SourceFile 요청 probe) |

## 핵심 결론

1. **기존 벤치마크 수치는 원시 데이터와 정확히 일치한다** (CSV = JSON, results.md 54/54행). 다만 원시 데이터에 반복별 표본이 없고, 과거 1회·단일 환경 측정이다.
2. **측정된 analyzer 코드는 현재 HEAD와 같다** (`git diff d9faa02 HEAD -- src` = 0줄). 하드웨어·OS·Node는 모두 달라 same-environment 재현은 현재 장비로 불가능하다.
3. **기존 correctness 검증은 캐시 hit 경로를 거치지 않았다.** "ON/OFF 결과 동일"은 cold 경로에 한정된 주장이다.
4. **Full result 모드의 active-edit 수치(−65.2%)는 result cache 효과가 아니다** (hit 0). SourceFile cache 효과와 harness 오버헤드다.
5. Cogic 대상 분석 1회의 SourceFile **요청 172건 중 90.1%(건수 기준)가 TS lib/@types 선언 파일**이고, 요청 순서는 분석 간 동일하다(MEASURED[P0-PROBE], count만). 이 비중은 **성능 개선 기여도가 아니다.** 선언 파일 재파싱 회피가 시간 단축의 대부분을 차지한다는 해석은 INFERRED다. 대규모 hit 0 현상은 순환 접근 LRU의 이론적 예측과 맞는다. 이것도 아직 INFERRED이며 EXP-03에서 검증한다.
6. 기존 테스트 25개는 모두 통과하지만, 관계의 **존재만 단언**한다. 정밀도(FP)를 검증한 근거는 없다 → EXP-01 필요.
7. **`npm run benchmark:cache`는 과거 원본을 덮어쓴다.** 신규 실험에서는 사용하면 안 된다.

## 실험 준비 상태

| 실험 | 상태 | 차단 요인 / 해결 작업 |
|---|---|---|
| EXP-01 정확도 | **PARTIALLY_READY** | analyzer를 Node에서 직접 호출할 수 있다. GT 코퍼스, 주석 지침, 매칭·채점 도구는 아직 없다(P1에서 작성) |
| EXP-02 캐시 재현 | **PARTIALLY_READY** | 측정 로직은 재사용할 수 있다. 출력 분리·반복별 표본·dirty 거부를 갖춘 신규 도구가 필요하다. 원래 장비가 없으면 방법 재현만 가능하다 |
| EXP-03 확장성 | **PARTIALLY_READY** | 규모·hit/miss·occupancy는 지금 측정할 수 있다. **용량 변경은 차단 상태**다(상수). A안(기본값 유지 선택 인자) 또는 B안(컴파일 산출물 치환) 결정이 필요하다 |

## 데이터 분리 원칙

- `docs/benchmarks/analysis-cache/` = HIST-0829 원본. 읽기 전용이다.
- 신규 실험 데이터는 `docs/thesis-experiments/data/<exp>/<run-id>/`에만 쓴다.
- 가설과 다른 결과, 실패·중단 run도 삭제하지 않고 status와 함께 보존한다.

## 변경 이력

P1-D까지의 개정은 실험을 실행하기 전에 이루어졌다. 그 시점에는 실험 데이터가 없었다(`data/exp-*` 없음). 따라서 결과를 보고 규칙을 바꾼 경우에 해당하지 않는다. P1-F는 EXP-01 첫 실측(진단 전용) **이후**의 원인 감사다. 이 단계에서 평가 규칙은 바꾸지 않았다. 이후 규칙을 개정하면 사후 개정으로 따로 표시한다.

| 개정 | 날짜 | 계기 | 변경 내용 | 영향 문서 |
|---|---|---|---|---|
| P0 | 2026-10-26 | 최초 작성 | Baseline audit, 기존 벤치마크 감사, EXP-01/02/03 계획 | 전체 |
| P0-R1 | 2026-10-26 | PR #1 검토 의견 | ① **선언 파일 비중 해석**: 요청 90.1%(건수, MEASURED[P0-PROBE])와 시간 기여도를 분리했다. "이득의 대부분이 선언 파일 재파싱 회피"는 INFERRED로 재분류하고 evidence C09a를 추가했다. ② **EXP-01 GT 판정**: GT 결정성 축을 추가했다. 정답이 결정 불가능한 사례는 P/R/F1 확증 평가에서 빼고 별도 보고한다. 정답이 명확한 unsupported-by-design 사례는 overall Recall에 포함한다. strict/lenient와 in-scope/overall 구분은 유지했다. ③ **EXP-02 재현 판정**: 단일 3단계 판정을 METHOD_REPRODUCED / EFFECT_DIRECTION_REPRODUCED / MAGNITUDE_COMPATIBLE 세 차원으로 바꾸었다. 과거 점추정 66.4%와 현재 CI만으로 동일 성능 재현을 확정하지 않는다 | README, existing-benchmark-audit, evidence-matrix, risks-and-limitations, reproducibility, experimental-design, exp-01, exp-02 |
| P1-A | 2026-10-26 | EXP-01 준비 | EXP-01 GT v1(44 사례, 확증 651, 정답 불확정 8, 부정 49)과 채점 도구를 사전 등록했다. 측정은 하지 않았다. P0 문서는 고치지 않았다. P0와의 차이·의문점은 [p1a-ground-truth.md §8](p1a-ground-truth.md#8-p0-문서와의-차이와-의문점)에 보고했다 | README(문서 목록), p1a-ground-truth, fixtures/exp-01, tools/exp01 |
| P1-A-R1 | 2026-10-27 | PR #2 코드 리뷰(채점 정확성) | 측정 전에 평가 도구 결함을 고쳤다. ① lenient에서 예측 1개가 GT 여러 개를 TP로 만들던 문제를 고쳤다. strict·lenient 모두 결정적 최대 1:1 매칭을 쓴다(`targetAlternatives` 포함). ② 노드 키 충돌, 잘못된 endpoint, 파싱 불가 dataflow 인덱스, 알 수 없는 kind가 있는 사례는 `SCORING_BLOCKED`로 두고 확증 집계에서 뺀다(fail-closed). ③ D5 부정 사례가 synthetic owner/state-source의 존재만 부정한다는 점을 명시했다. GT 데이터와 사전 등록 커밋(`41bbe19`)은 바꾸지 않았다. 채점 도구 `exp01-scorer/1.1`과 `eval-manifest.r1.json`을 새 평가 도구 기준(`ae82bfb`)으로 고정했다([p1a-ground-truth.md §12](p1a-ground-truth.md#12-p1-a-r1-채점-도구-수정)). Cogic 실행이나 정확도 측정은 하지 않았다 | README, p1a-ground-truth, fixtures/exp-01(지침·변경 기록·README), tools/exp01 |
| P1-B | 2026-10-28 | EXP-01 실행 준비 | 실행 도구 `exp01-run.mjs`(`exp01-runner/1.0`)를 추가했다. 사전 확인(두 manifest 검사, 빌드 신선도, dirty 거부), `exp01-raw/1` 원본 저장, 덮어쓰기 금지, 결정성·캐시 OFF/ON(hit 경로 포함) 비교, GraphPayload 구조 검증, D11 TS lib 진단, `scoringStatus`에 따른 확증 판정을 넣었다. D11은 `D11_KEEP_PRE_REGISTERED_SCORING`으로 결정했다. 합성 입력 테스트만 했다. 실제 코퍼스 실행과 정확도 측정은 하지 않았다(NOT_RUN). GT·평가 도구·manifest는 바꾸지 않았다 | README, p1a-ground-truth(D11 결정 기록), p1b-runner, tools/exp01-run.mjs, tools/test |
| P1-B-R1 | 2026-10-28 | PR #3 검토(실행 도구 신뢰성) | 측정 전에 실행 도구 결함을 고쳤다(`exp01-runner/1.1`). ① 채점 프로세스 종료 코드 0, `summary.json` 존재, `COMPLETE`, `exp01-scorer/1.1`을 모두 만족해야 확증 결과로 인정한다. 채점기 예외도 `run.json`에 기록한다. ② 변형별 결과를 생성 직후 저장해, 뒤 변형이 실패해도 앞 결과가 남는다. 실패 변형·오류·stack을 기록한다. ③ `--bootstrap`은 0 이상의 정수만 받고, 확증 결과는 사전 등록값 10,000에서만 인정한다. ④ 캐시 hit 경로 검증 상태(`cacheHitPath`)를 정확도 확증 판정과 분리하고 해석 규칙을 정했다([p1b-runner.md §10](p1b-runner.md#10-p1-b-r1-실행-도구-신뢰성-수정)). 실제 analyzer 실행과 정확도 측정은 하지 않았다 | README, p1b-runner, tools/exp01-run.mjs, tools/test |
| P1-C | 2026-10-29 | EXP-01 GT 검토 준비 | 기존 검토 표본 146개(seed `20261026`)를 읽기 전용으로 감사했다(중복·caseId·층화·빈 결과 칸·재현성). 검토자용 보충 안내, 검토 방식 A(독립 사람 검토)/B(single-annotator 명시), 일치도 보고·불일치 분류, v2 도입 시 도구 제약을 정리했다([p1c-review-readiness.md](p1c-review-readiness.md)). 사람 검토, analyzer 실행, 정확도 측정은 하지 않았다. GT·표본·지침·도구·manifest는 바꾸지 않았다 | README, p1c-review-readiness |
| P1-D | 2026-10-29 | GPT-6 AI 교차 검토 결과 수령 | 사용자가 제공한 GPT-6 판정 146개와 기록을 `evidence/exp-01-ai-cross-review/`에 바이트 그대로 보존했다. 기존 `review-agreement.mjs`로 일치도를 다시 계산했다(144/146, κ 0.940, S014·S104 제외 시 κ 0.933). 이 값은 AI 간 일치도이며 사람 검토가 아니다. 불일치 2건을 판정했다: S037은 `GUIDE-AMBIGUOUS`(사전 등록 카탈로그와 컴파일 결과상 GT 유지), S107은 `REVIEWER-DIFF`(GT 유지). 연구자 채택 전 초안이다([p1d-ai-cross-review.md](p1d-ai-cross-review.md)). GT·지침·표본·도구·manifest는 바꾸지 않았다. analyzer 실행과 정확도 측정은 하지 않았다 | README, p1d-ai-cross-review, evidence/exp-01-ai-cross-review |
| P1-F | 2026-10-29 | EXP-01 첫 실측 채점 차단 | run `exp01-20261029-0651-43ace0f-50587`(analyzer 44/44 OK, scorer `BLOCKED`, 진단 전용)의 React 5개 사례 `node-key-collision` 6건을 원시 예측으로 추적했다. 원인은 둘이다. ① analyzer가 타입이 있는 React setter·dispatch 호출을 `updates` 대신 반환 tuple 안 함수 타입을 가리키는 external `calls`·`dataflow`로 출력한다. ② scorer 1.1의 external 키 `X\|file\|line`이 같은 줄의 두 선언을 구별하지 못한다. 충돌이 행 단위 수치를 왜곡하지는 않았다. scorer 1.2 사후 개정을 먼저 하고 analyzer 개선은 따로 하도록 제안했다([p1f-scoring-blocker-audit.md](p1f-scoring-blocker-audit.md)). GT·지침·scorer·runner·analyzer·manifest·run 결과는 바꾸지 않았다 | README, p1f-scoring-blocker-audit, evidence/exp-01-p1f-scoring-blocker |
| P1-G | 2026-10-29 | P1-F 권장안 A | **사후 개정**: scorer `exp01-scorer/1.2`. 같은 키를 가진 external 노드 묶음에서 다른 노드를 모두 감싸는 선언 하나만 기본 키를 유지하고, 나머지는 열 번호 키로 구별한다. 정해지지 않으면 계속 차단한다. 새 `eval-manifest.r2.json`(227개)을 만들었다. `eval-manifest.r1.json`·`gt-manifest.json`·GT·지침·runner·analyzer는 바꾸지 않았다. baseline 원시 예측에서 차단되지 않은 39개 사례의 행이 모두 같고, 차단 5개 사례는 채점된다(가짜 TP 0). 두 run의 원시 결과는 저장소 밖에 보존하고 해시만 공개했다. runner 1.1은 r1을 고정 검사하므로 runner 1.2가 필요하다([p1g-scorer-amendment.md](p1g-scorer-amendment.md)) | README, p1g-scorer-amendment, tools/exp01(lib·score·manifest·test), fixtures/exp-01/eval-manifest.r2.json, evidence/exp-01-p1g-scorer-1.2 |
| P1-H | 2026-10-29 | scorer 1.2 통합 | runner `exp01-runner/1.2`로 바꿨다. GT manifest와 `eval-manifest.r2.json`을 검사하고, r2 내용을 해시로 고정했다. scorer 버전은 `exp01-scorer/1.2`로 runner 안에 고정했다(이전에는 `lib.mjs` 상수를 따랐다). 모든 run에 `POST_HOC_AMENDED`, `researchStatus: POST_HOC_AMENDED_EVALUATION`, `preregisteredConfirmatory: false`를 기록한다. 기준 analyzer `43ace0f`와 소스 tree·빌드 산출물·TypeScript·package 파일이 같지 않으면 기술 게이트를 통과하지 못한다. `env.json`에 npm을 기록한다. 실제 실행은 하지 않았다([p1h-runner-amendment.md](p1h-runner-amendment.md)) | README, p1h-runner-amendment, tools/exp01-run.mjs, tools/test |
