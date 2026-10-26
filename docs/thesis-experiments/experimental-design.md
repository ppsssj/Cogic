# Experimental Design — 공통 프로토콜

이 문서는 EXP-01/02/03에 공통으로 적용하는 규칙을 정의한다. 실험별 세부 계획(14개 항목)은 아래 문서에 있다.

- [experiments/exp-01-accuracy.md](experiments/exp-01-accuracy.md) — 코드 관계 분석 정확도
- [experiments/exp-02-cache-performance.md](experiments/exp-02-cache-performance.md) — 캐시 성능 재현
- [experiments/exp-03-scalability.md](experiments/exp-03-scalability.md) — 캐시 용량·확장성

모든 실험은 PLANNED 상태다. P0에서는 실행하지 않았다.

---

## 1. 연구 질문 구조

| 논문 장(예정) | 실험 | 상위 질문 |
|---|---|---|
| 분석 정확도 평가 | EXP-01 | Cogic이 추출한 관계는 실제 코드의 관계와 얼마나 일치하는가? 어떤 패턴에서 실패하는가? |
| 성능 최적화 평가 | EXP-02 | 기존에 보고된 캐시 효과가 같은 방법으로 다시 관찰되는가? 캐시는 결과를 바꾸지 않는가? |
| 확장성 평가 | EXP-03 | 규모와 캐시 용량이 hit율·시간·메모리에 어떤 영향을 주는가? 대규모에서 이득이 사라지는 원인은 무엇인가? |

권장 수행 순서: **P1 = EXP-01 → P2 = EXP-02 → P3 = EXP-03**.

- EXP-01은 성능 실험 장치와 독립적이고 production 코드 변경이 필요 없다.
- EXP-02는 EXP-03의 측정 harness(표본 저장, 환경 기록)를 먼저 만든다.
- EXP-03은 용량 주입이 필요해 마지막에 둔다. 코드 변경 여부를 결정해야 한다(§5).

---

## 2. 사전 등록 원칙 (Pre-registration)

1. **계획 고정**: 각 실험은 실행 전에 이 계획 문서, 가설, 판정 규칙, (EXP-01) Ground Truth를 커밋한다. 첫 측정 run은 그 커밋 SHA를 `preregistrationCommit`으로 기록한다.
2. **판정 규칙 사전 정의**: 가설 채택/기각, 재현 판정(METHOD_REPRODUCED / EFFECT_DIRECTION_REPRODUCED / MAGNITUDE_COMPATIBLE의 세 차원, [EXP-02 §9](experiments/exp-02-cache-performance.md#9-statistical-analysis))은 실험별 문서에 정의한 규칙만 사용한다. 결과를 보고 규칙을 바꾸면 변경 이력과 사유를 남기고 두 결과를 모두 보고한다.
3. **결과 보존**: 가설과 다른 결과, 실패한 run, 중단된 run도 삭제하지 않는다. 각 run 폴더에 `status: completed | aborted | invalid`와 사유를 기록한다.
4. **사후 탐색 구분**: 계획에 없던 분석은 "exploratory"로 표시해 확증(confirmatory) 결과와 구분한다.
5. **성능 개선 금지**: 실험 기간 동안 측정 결과를 좋게 만드는 production 최적화를 하지 않는다. 최적화를 하려면 별도 실험으로 분리하고, 최적화 전 결과를 먼저 고정한다.

---

## 3. 데이터 분리와 디렉터리 규칙

```text
docs/benchmarks/analysis-cache/        # HIST-0829 원본. 읽기 전용. 절대 수정/덮어쓰기 금지
docs/thesis-experiments/
├── data/
│   ├── p0/                             # P0 probe·audit 출력
│   ├── exp-01/<run-id>/
│   ├── exp-02/<run-id>/
│   └── exp-03/<run-id>/
├── fixtures/exp-01/                    # (P1) 정확도 실험 fixture와 Ground Truth
└── tools/                              # 실험 도구 (docs/** 는 VSIX 패키지에서 제외됨)
```

- **run-id 형식**: `<exp>-<YYYYMMDD>-<HHmm>-<shortsha>[-dirty]` (예: `exp02-20261102-1430-fed34a0`)
- **dirty 정책**: 측정 run은 `git status --porcelain`이 비어 있지 않으면 실행을 거부한다. 강제 실행하면 run-id에 `-dirty`를 붙이고 `git diff` 출력을 저장한다. 결과는 확증 분석에서 제외한다.
- **기존 스크립트 사용 금지**: `npm run benchmark:cache`와 `scripts/benchmark-analysis-cache.mjs`는 `docs/benchmarks/analysis-cache/`를 덮어쓴다. 신규 실험은 출력 경로를 강제하는 별도 도구(`docs/thesis-experiments/tools/`)를 사용한다. 실행 전후로 과거 산출물의 SHA-256을 대조한다([reproducibility.md](reproducibility.md#3-과거-산출물-무결성)).
- **대용량 데이터**: 합성 workspace와 외부 clone은 저장소에 넣지 않는다(기존 `.gitignore` 유지). 대신 생성 파라미터·SHA·파일 목록 해시를 기록한다.

### 3.1 각 run 폴더의 필수 파일

| 파일 | 내용 |
|---|---|
| `run.json` | run-id, 실험 ID, 시작·종료 시각(UTC), `preregistrationCommit`, `headCommit`, `dirty`, 도구 파일 SHA-256, CLI 인자, status |
| `env.json` | OS 이름·빌드, CPU 모델·코어·논리 코어, 총/가용 메모리(시작·종료), 전원 구성, Node·npm·TypeScript 버전, `process.versions.v8`, 실행 플래그(`--expose-gc` 등) |
| `workloads.json` | 대상별 경로(상대), 커밋 SHA, 파일 목록 SHA-256, 파일 수, Program root 수, `usedTsconfig`, 분석 1회당 SourceFile 요청 수와 구성 |
| `samples.csv` | 반복별 원시 측정(성능 실험) 또는 예측 관계 목록(EXP-01) |
| `summary.csv` / `summary.md` | 사전 정의 통계. `summary.md`는 `samples.csv`에서 **생성**되며 손으로 쓴 해석 문장을 포함하지 않는다 |
| `notes.md` | 사람이 쓴 관찰·이상 사항. 증거 라벨 표기 |

---

## 4. 통계 규약

| 대상 | 방법 |
|---|---|
| 중심 경향 | 중앙값(median). 보간 방식은 **선형 보간(type 7)** 으로 통일한다. 과거 결과와 비교할 때는 과거 방식(nearest-rank)도 함께 계산한다 |
| 산포 | IQR, 표본 표준편차(n−1), min/max, p95 |
| 두 조건 차이 | 중앙값 차이·비율의 **bootstrap 95% CI** (percentile bootstrap, 10,000 resamples, seed 기록). Hodges–Lehmann 추정량 병기 |
| 유의성 | Mann–Whitney U (양측). 여러 비교 시 Holm 보정. p값보다 효과 크기와 CI를 우선 보고한다 |
| 효과 크기 | Cliff's δ |
| 비율(정밀도·재현율·hit율) | Wilson score 95% CI |
| F1 등 비율의 함수 | 파일 단위 cluster bootstrap 95% CI |
| 프로세스 반복 | 프로세스(run) 단위 중앙값을 다시 요약해 프로세스 간 변동을 보고한다(계층 구조 무시 금지) |

통계 계산은 실험 도구 안에서 순수 JS로 구현하고 단위 테스트로 검증한다. 신규 npm 의존성은 추가하지 않는다. 외부 도구(R, Python)를 쓰면 버전과 스크립트를 run 폴더에 저장한다.

---

## 5. Production 코드 변경 정책

| 필요 | 실험 | 권장 방식 | 상태 |
|---|---|---|---|
| 출력 경로 분리, 반복별 표본, 환경 기록 | EXP-02/03 | **신규 도구 파일만 추가.** production 무변경 | 결정 불필요 |
| hit/miss/occupancy/접근 순서 | EXP-03 | 기존 `debug` 콜백 이벤트 사용 (`analyze.ts:647-690`) | 결정 불필요 |
| eviction 수 | EXP-03 | `store` 이벤트의 `entries` 시퀀스로 유도. 직접 이벤트가 필요하면 아래 B안에 포함 | 결정 불필요 |
| **SourceFile cache 용량 변경** | EXP-03 | **A안**: analyzer에 기본값 800을 유지하는 선택 인자(예: `sourceFileCacheCapacity`)를 추가하는 별도 PR. 기본 동작 불변을 단위 테스트로 증명한다. **B안**: production 무변경, 실험 도구가 `out/analyzer/analyze.js`를 임시 디렉터리에 복사해 상수를 치환하고, 치환 적용 여부를 occupancy 최댓값으로 검증한다 | **사용자 결정 필요** (P3 착수 전) |

권고: 학술적 투명성은 **A안**이 높다(리뷰 가능한 diff와 테스트). production 무변경 원칙을 엄격히 지키려면 B안을 택하되, 치환 대상 문자열과 결과를 run 폴더에 기록한다.

---

## 6. 측정 환경 통제 체크리스트 (EXP-02/03)

실행 전 `env.json`에 기록하고, 불충족 항목은 `notes.md`에 남긴다.

- [ ] 전원 구성: 고성능(측정 후 원복). 현재 기본값은 "균형 조정"
- [ ] 불필요한 애플리케이션 종료. VS Code도 종료(독립 Node 실행)
- [ ] 측정 시작 시 가용 메모리 ≥ 3 GB (8 GB 장비, P0 시점 가용 1.1 GiB)
- [ ] Windows Update·백신 정밀 검사 미실행 확인 (실시간 검사는 통제 불가, 기록만)
- [ ] 동일 Node 바이너리 경로·버전
- [ ] `npm run compile` 직후 `out/` SHA-256 기록
- [ ] 과거 산출물 해시 대조 PASS

---

## 7. 결과 보고 템플릿

각 실험 보고서는 다음 순서를 따른다.

1. 실행 정보(run-id, 커밋, 환경 요약, 사전 등록 커밋)
2. 사전 정의 결과표(도구가 생성)
3. 가설별 판정(사전 규칙 적용)
4. 이상 사항·제외 데이터와 사유
5. 해석(INFERRED 라벨 명시)
6. 타당성 위협 갱신
