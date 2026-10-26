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
| `tools/` | P0 읽기 전용 감사 도구 2개 |
| `data/p0/` | P0 도구 출력(감사 결과, SourceFile 요청 probe) |

## 핵심 결론

1. **기존 벤치마크 수치는 원시 데이터와 정확히 일치한다** (CSV = JSON, results.md 54/54행). 다만 원시 데이터에 반복별 표본이 없고, 과거 1회·단일 환경 측정이다.
2. **측정된 analyzer 코드는 현재 HEAD와 같다** (`git diff d9faa02 HEAD -- src` = 0줄). 하드웨어·OS·Node는 모두 달라 same-environment 재현은 현재 장비로 불가능하다.
3. **기존 correctness 검증은 캐시 hit 경로를 거치지 않았다.** "ON/OFF 결과 동일"은 cold 경로에 한정된 주장이다.
4. **Full result 모드의 active-edit 수치(−65.2%)는 result cache 효과가 아니다** (hit 0). SourceFile cache 효과와 harness 오버헤드다.
5. Cogic 대상 분석 1회의 SourceFile 요청 172건 중 **90.1%가 TS lib/@types 선언 파일**이고, 요청 순서는 분석 간 동일하다(P0 probe). 대규모 hit 0 현상은 순환 접근 LRU의 이론적 예측과 맞는다. 단 아직 INFERRED이며 EXP-03에서 검증한다.
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
