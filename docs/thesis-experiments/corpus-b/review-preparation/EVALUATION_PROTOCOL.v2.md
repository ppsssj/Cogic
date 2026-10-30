# Corpus B 평가 프로토콜 v2 — 채점 범위 민감도 분석 (초안)

- 상태: **DRAFT — 연구자 승인 대기.** 확정 프로토콜이 아니다. 승인 전에는 P1-L에 적용하지 않는다.
- 작성일: 2026-10-30(P1-K4). **Corpus B에 Cogic을 실행하지 않은 상태에서** 썼다.
- 관계
  - v1(`corpus-b/EVALUATION_PROTOCOL.md`)을 바꾸지 않는다.
  - 이 문서는 v1에 **보조 민감도 분석 하나를 미리 추가**한다.
  - v1 지표는 그대로 주 지표다.
- 바꾸지 않는 것: GT v1, Corpus B `MANIFEST.json`(601개), scorer `exp01-scorer/1.2`, runner 1.2
- 근거: [scoring-scope-audit.md](scoring-scope-audit.md)(P1-K3)

## 1. 연구 질문

| 번호 | 질문 | 지표 |
|---|---|---|
| RQ-B1(주) | 독립 실제 코드(Corpus B)에서 Cogic이 GT 정의 범위의 관계를 얼마나 정확히 추출하는가 | v1 Precision, In-scope Recall, In-scope F1(v1 §3) |
| RQ-B2(주) | IMPROVED(`bbe4cbf`)가 ORIGINAL(`43ace0f`)보다 나은가, 또는 회귀가 없는가 | v1 paired ΔF1, 전이 표(v1 §3) |
| RQ-B3(보조) | 위 결론이 "GT가 정의하지 않은 외부 패키지 대상 예측"의 처리 방식에 따라 달라지는가 | v2 지표와 v1과의 차이(이 문서) |

- RQ-B3은 민감도 분석이다.
  - v2 결과만으로 RQ-B1·RQ-B2에 답하지 않는다.
  - v1과 v2가 다른 결론을 가리키면 그 사실 자체를 보고한다.

## 2. v1 주 지표 (scorer 1.2, 변경 없음)

| 기호 | 정의 |
|---|---|
| TP | GT determinate 관계와 일대일로 매칭된 예측 수(strict 키). 예측 하나는 GT 하나와만 매칭된다 |
| FP | 매칭되지 않고, indeterminate 항목에도 맞지 않는 예측 수. 이미 다른 예측이 가져간 GT에 맞는 예측(`EXTRA-*`)도 FP |
| EXCL | indeterminate 항목(unbounded 또는 후보)과 맞는 예측 수. Precision 분모에서 뺀다 |
| GT_in | supported 패턴의 GT determinate 수(Corpus B: 78) |
| GT_all | GT determinate 전체(196) |
| TP_in, TP_all | GT_in, GT_all 중 TP인 수 |
| **P₁** | TP / (TP + FP) |
| **R_in** | TP_in / GT_in |
| **R_all** | TP_all / GT_all |
| **F1_in,₁** | 2·P₁·R_in / (P₁ + R_in) |
| **F1_all,₁** | 2·P₁·R_all / (P₁ + R_all) |

- 집계 단위: 20개 사례 micro, strict가 주이고 lenient는 보조다.
- `SCORING_BLOCKED` 사례는 집계에서 뺀다(v1 §3).
- 주의(P1-K3): P₁의 분모에는 GT 정의 범위 밖 예측도 들어간다. 그래서 F1_in,₁은 범위 밖 예측의 영향을 받는다.

## 3. v2 보조 지표

v2는 **같은 scorer 1.2를, 예측의 부분집합 U에 대해 다시 실행한 결과**다. scorer 코드와 GT는 그대로다.

| 기호 | 정의 |
|---|---|
| 𝒫 | 사례의 정규화된 예측 관계 집합(scorer `loadPrediction`/`normalizeCogicGraph` 결과, 같은 키는 이미 하나로 합쳐짐) |
| E | 𝒫 중 대상 키가 OUT 클래스(§4)인 관계. **v2에서 채점 전에 따로 둔다** |
| U | 𝒫 − E |
| TP₂, FP₂, EXCL₂ | scorer 1.2를 U에 대해 실행한 TP, FP, EXCL |
| **P₂** (Scope-restricted Precision) | TP₂ / (TP₂ + FP₂) |
| **R_in,₂**, **R_all,₂** | TP₂_in / GT_in, TP₂_all / GT_all |
| **F1_in,₂** (Scope-restricted In-scope F1) | 2·P₂·R_in,₂ / (P₂ + R_in,₂) |
| **F1_all,₂** | 2·P₂·R_all,₂ / (P₂ + R_all,₂) |
| **Δ** | v2 − v1(P, R_in, R_all, F1_in, F1_all 각각) |

- Corpus B GT v1에서 성립하는 성질(테스트로 고정)
  - GT의 어느 대상(determinate, indeterminate 후보, 부정)도 OUT 클래스가 아니다. 따라서 E의 예측은 어떤 GT와도 매칭될 수 없다.
  - 결과 1: TP₂ = TP, R_in,₂ = R_in, R_all,₂ = R_all. v2는 Precision만 바꾼다.
  - 결과 2: FP₂ = FP − |E ∩ FP|
  - 결과 3: E의 예측이 unbounded indeterminate와 맞으면 v1에서는 EXCL이었다. v2에서는 E로 빠지므로 EXCL₂ = EXCL − |E ∩ EXCL|이다.
- 부정 사례 위반은 v1·v2 모두 보고한다. E 안의 예측은 부정 키와 같을 수 없다(부정 대상도 OUT이 아니다).

## 4. 평가 범위 포함·제외 규칙 (예측 분류)

- 분류는 **예측 대상 키와 사례 workspace의 파일 목록만** 쓴다(`tools/corpus-b-scoring/scope-v2.mjs` `classifyTarget`).
  - GT·다른 예측·analyzer 버전을 보지 않는다.
  - workspace 파일 목록은 Corpus B MANIFEST로 고정되어 있다.
- 키 형식은 scorer 1.2의 노드 키다(`cogicNodeKey`, `nodeKey`). 경로는 사례 폴더 기준이다.

| 클래스 | 조건 | v2 |
|---|---|---|
| IN_NO_TARGET | owner 관계(대상 없음) | 포함 |
| IN_FILE | `F|…` | 포함 |
| IN_LIB | `L|…`(TS lib 노드) | 포함 |
| IN_SYNTHETIC | `S|…`(framework synthetic 노드) | 포함 |
| IN_LOCAL_DECLARATION | `D|<경로>|…` 또는 `X|<경로>|<줄>`이고, 경로가 workspace의 파일이며 `shims/`가 아니다 | 포함 |
| IN_LOCAL_MODULE | `M|<경로>`이고, 경로가 workspace 파일이다(코퍼스 모듈의 dynamic import) | **포함**(원칙 5) |
| IN_TSLIB_EXTERNAL | `X|<tslib>/…` | 포함. GT는 lib 대상을 `L|`로 적으므로 이런 키는 FP로 남는다. 범위가 아니라 키 형식의 문제다 |
| IN_UNCLASSIFIED | 위·아래 어디에도 맞지 않는 키(workspace 밖 경로가 아닌 미지 형식, `?|…` 등) | 포함(보수적: FP를 지우지 않는다) |
| **OUT_SHIM_DECLARATION** | `X|shims/…` 또는 `M|shims/…`: 대상이 생성된 untyped 외부 모듈 선언이다 | **제외** |
| **OUT_OUTSIDE_WORKSPACE** | `X|<outside>/…` 또는 `M|<outside>/…`: 대상이 사례 workspace 밖이다 | **제외** |
| **OUT_UNRESOLVED_MODULE** | `M|<경로>`인데 경로가 workspace 파일이 아니다. 예: `./App.vue` | **제외** |

- source 쪽 키로는 거르지 않는다.
- 제외 조건 3개는 모두 "GT 정의 범위(ANNOTATION_ADDENDUM A1·A2: 코퍼스 안 선언)에 대상이 있을 수 없음"을 키 구조만으로 판정한다.
- 제외 조건은 실행 전에 이 표로 고정한다. 결과를 본 뒤 클래스를 추가하거나 옮기지 않는다.

## 5. 예측 키 중복 처리

1. scorer 1.2의 `loadPrediction`이 먼저 같은 relation 키를 하나로 합치고 `occurrences`를 센다.
2. v2 분할은 그 뒤 **고유 키 단위**로 한다. 같은 키는 항상 같은 클래스다.
3. E의 보고에는 고유 키 수와 `occurrences` 합계를 함께 적는다.
4. 키 충돌·malformed 등 차단 사유는 분할 전 예측에서 그대로 넘어간다. 그래서 v1에서 `SCORING_BLOCKED`인 사례는 v2에서도 차단된다. v2가 차단을 풀지 않는다.

## 6. TP/FP/FN 분모 규칙 요약

| 지표 | 분자 | 분모 | E의 처리 |
|---|---|---|---|
| P₁ | TP | TP + FP | FP에 들어간다 |
| P₂ | TP₂(= TP) | TP₂ + FP₂ | 분모에서 빠진다 |
| R_in(1·2 같음) | TP_in | GT_in = 78 | 영향 없음 |
| R_all(1·2 같음) | TP_all | GT_all = 196 | 영향 없음 |
| FN | GT − TP | — | 영향 없음 |
| EXCL | indeterminate 매칭 | Precision 분모에서 제외 | E는 EXCL₂에서도 빠진다 |

## 7. 제거한 예측의 보존과 위험

- 보존
  - E의 모든 예측을 `scope-comparison.json` `removed`에 남긴다: 사례, relation 키, 종류, 클래스, occurrences
  - 클래스별·종류별 수도 남긴다.
  - 원시 예측은 v1 규칙대로 저장소 밖에 보존한다.
- **위험 1 — 잘못된 로컬 연결의 은폐(원칙 4)**
  - 상황: analyzer가 로컬 선언을 불러야 할 지점을 shim 선언으로 잘못 연결하면, 그 예측은 OUT_SHIM_DECLARATION이 되어 v2에서 사라진다.
  - 결과: v2 Precision은 이 오류를 반영하지 않는다. 대응하는 GT 관계는 v1·v2 모두 FN으로 남는다(Recall에는 반영된다).
  - 대응: **위험 지표**를 보고한다.
    - 정의: E 중 OUT_SHIM_DECLARATION인 예측의 (종류, source)가 v1에서 FN인 GT 관계의 (종류, source)와 같은 경우의 수와 목록
    - 이 지표는 분할이 끝난 뒤 보고에만 GT를 쓴다. 분할에는 영향을 주지 않는다.
    - 선별 지표이므로 거짓 경보가 있다. 같은 owner의 다른 관계가 FN이기만 해도 걸린다. 합성 시나리오 S3a에서 2건, S3c에서 1건이 걸렸지만 둘 다 실제 오연결이 아니었다.
    - 목록은 사람이 원문과 대조해 판정하고, 판정 결과를 함께 보고한다.
- **위험 2 — 키 형식에 따른 E 크기**
  - E의 크기는 analyzer가 외부 노드를 어떤 키로 만드는지에 따라 달라진다(합성 S3a 73 대 S3c 17).
  - 그래서 Δ의 크기를 외부 API 추출 품질로 해석하지 않는다.
- **위험 3 — 범위 정의 자체:** v2는 "GT가 정의한 범위"를 기준으로 한다. 외부 API 관계가 맞는지는 v1·v2 어느 쪽으로도 평가하지 않는다(P1-K3 Q2).

## 8. ORIGINAL/IMPROVED paired comparison

- 두 analyzer에 다음이 모두 같다(테스트로 확인).
  - 같은 분류 함수, 같은 workspace 파일 목록, 같은 scorer, 같은 GT
  - 분류는 키의 함수이므로 같은 키는 두 버전에서 같은 클래스다.
- 보고
  - 버전별 v1·v2 지표
  - ΔF1_in(IMPROVED − ORIGINAL)을 v1과 v2 각각에 대해
  - 차이의 차이: (ΔF1_in,₂ − ΔF1_in,₁)
- 불확실성
  - v1 §3의 paired cluster bootstrap(10,000회, seed `20261101`)을 v1과 v2에 **같은 재표본(사례 인덱스)**으로 적용한다.
  - 사례 단위 bootstrap(seed `20261026`)도 v1·v2에 같은 재표본으로 적용한다.
- 해석 규칙(실행 전 고정)
  - v1과 v2의 ΔF1 부호가 같으면, 결론은 외부 대상 처리에 강건하다고 적는다.
  - 부호가 다르거나 한쪽 CI만 0을 포함하면, 버전 차이가 외부 대상 예측 변화에 좌우된다고 적는다. 이 경우 RQ-B2의 결론을 내리지 않는다.
  - 버전별 E 크기와 클래스 구성을 나란히 보고한다.

## 9. 데이터 누수와 선택 편향

| 위험 | 통제 |
|---|---|
| GT 정답 여부로 예측을 고른다(원칙 6) | 분류 함수에 GT가 입력되지 않는다. 빈 GT로 바꿔도 결과가 같다(테스트) |
| 결과를 보고 제외 규칙을 바꾼다 | §4 표와 도구 해시를 실행 전에 고정한다(§10). 바꾸면 v3로 따로 만들고 v2 결과도 보고한다 |
| 유리한 지표만 보고한다 | v1·v2 전 지표와 Δ를 항상 나란히 보고한다(§11) |
| 잘못된 로컬 연결 은폐 | 위험 지표와 사람 판정(§7) |
| 버전별로 다른 규칙 | 같은 함수·같은 입력(§8) |
| GT 사람 검토 전 결과 | GT 상태(`REVIEW_PENDING` 등)를 결과와 함께 적는다. 검토로 GT가 바뀌면 v1 프로토콜 §4의 v2 GT 절차를 따른다 |

## 10. 실행 전 해시 고정 절차

연구자가 이 초안을 승인한 뒤, P1-L 실행 전에 한다.

1. 상태 표시를 `DRAFT`에서 `APPROVED`로 바꾸고, 승인자·날짜·승인 commit을 적는다.
2. `node docs/thesis-experiments/tools/corpus-b-scoring/protocol-freeze.mjs --write <파일>`로 다음 파일의 SHA-256(LF 정규화)을 기록한다. 기존 파일은 덮어쓰지 않는다.
   - `EVALUATION_PROTOCOL.v2.md`, `corpus-b/EVALUATION_PROTOCOL.md`
   - `tools/corpus-b-scoring/*.mjs`와 테스트
   - `tools/exp01/score.mjs`·`lib.mjs`, Corpus B `MANIFEST.json`
3. P1-L 실행 도구는 시작할 때 이 고정 파일을 검사한다. 하나라도 다르면 실행하지 않는다.
4. 고정 후에 바꾸면 새 버전(v3) 문서와 새 고정 파일을 만든다. v2 결과도 함께 보고한다.

- 이번 PR에서는 1–2를 하지 않았다(승인 전). `protocol-freeze.mjs --print`로 현재 초안의 해시를 볼 수 있다.

## 11. 논문 보고 방식

- 본문 주 결과: v1 지표(RQ-B1·RQ-B2)
- 같은 표에 v2와 Δ를 둔다.
  - 형식: P, R_in, R_all, F1_in, F1_all × {v1, v2, Δ} × {ORIGINAL, IMPROVED}
  - 함께 둘 것: E 크기(고유 키·occurrences), 클래스별 수, 위험 지표와 사람 판정 결과
- 문장 규칙
  - v2를 "정확도"라고 부르지 않는다. "외부 패키지 대상 예측을 제외한 Precision(민감도 분석)"으로 쓴다.
  - In-scope F1(v1)은 "전체 예측의 Precision과 지원 범위 Recall의 조화평균"이라고 정의를 함께 쓴다.
  - Corpus B 결과를 EXP-01 사전 등록 확증 결과로 쓰지 않는다. holdout 사전 고정 평가로 쓴다.

## 12. v1 결과와의 관계

- v1 지표는 v1 프로토콜 그대로 계산한다. v2 도구의 v1 출력은 `score.mjs` 단독 실행 출력과 **바이트 단위로 같다**(테스트).
- v2는 v1을 대체하지 않는다. v1과 v2가 다르면 v1이 사전 고정 주 결과다.

## 13. 합성 시나리오 회귀 결과 (도구 검증용, Cogic 결과 아님)

P1-K3 `scoring-scope-audit.md`의 시나리오를 그대로 썼다.

- 정정: 그 문서는 시나리오 수를 "12개"라고 적었지만, 표와 도구의 시나리오는 **11개**다(S0, S1, S2, S3a, S3b, S3c, S4, S5, S6, S7, S8).
- 기호: P = Precision, F1_in = In-scope F1, F1_all = Overall F1

| 시나리오 | v1 TP/FP/EXCL | P₁ | F1_in,₁ | F1_all,₁ | E | v2 TP/FP/EXCL | P₂ | F1_in,₂ | F1_all,₂ | ΔF1_in |
|---|---|---|---|---|---|---|---|---|---|---|
| S0 GT 전체 | 196/0/0 | 1.000 | 1.000 | 1.000 | 0 | 196/0/0 | 1.000 | 1.000 | 1.000 | 0 |
| S1 lib 대상 제외 | 144/0/0 | 1.000 | 1.000 | 0.847 | 0 | 144/0/0 | 1.000 | 1.000 | 0.847 | 0 |
| S2 supported만 | 78/0/0 | 1.000 | 1.000 | 0.569 | 0 | 78/0/0 | 1.000 | 1.000 | 0.569 | 0 |
| S3a + 외부 API(서로 다른 대상) | 78/73/0 | 0.517 | 0.681 | 0.450 | 73 | 78/0/0 | 1.000 | 1.000 | 0.569 | +0.319 |
| S3b + 외부 API(틀린 대상) | 78/73/0 | 0.517 | 0.681 | 0.450 | 73 | 78/0/0 | 1.000 | 1.000 | 0.569 | +0.319 |
| S3c + 외부 API(모듈 키) | 78/17/0 | 0.821 | 0.902 | 0.536 | 17 | 78/0/0 | 1.000 | 1.000 | 0.569 | +0.098 |
| S4 supported + unsupported | 194/0/0 | 1.000 | 1.000 | 0.995 | 0 | 194/0/0 | 1.000 | 1.000 | 0.995 | 0 |
| S5 S3a + unsupported | 194/73/0 | 0.727 | 0.842 | 0.838 | 73 | 194/0/0 | 1.000 | 1.000 | 0.995 | +0.158 |
| S6 + indeterminate 후보 | 78/0/18 | 1.000 | 1.000 | 0.569 | 0 | 78/0/18 | 1.000 | 1.000 | 0.569 | 0 |
| S7 + 부정 위반 2 | 196/2/0 | 0.990 | 0.995 | 0.995 | 0 | 196/2/0 | 0.990 | 0.995 | 0.995 | 0 |
| S8 shim 대상을 손으로 뺀 S3a | 78/0/0 | 1.000 | 1.000 | 0.569 | 0 | 78/0/0 | 1.000 | 1.000 | 0.569 | 0 |

- 모든 시나리오에서 R_in·R_all·TP는 v1과 v2가 같다.
- S8(P1-K3의 수작업 모의)과 S3a의 v2가 같다. 도구가 그 모의를 그대로 재현한다.
- S3a와 S3b는 v2에서도 같다. v2도 외부 API 추출 품질은 구분하지 않는다(위험 3).

## 14. 추가 합성 검사 (P1-K4)

| 검사 | 결과 |
|---|---|
| 외부 API FP | E로 빠지고 P₂가 오른다 |
| 올바른 로컬 예측 | 두 버전 모두 TP |
| 잘못된 로컬 예측(workspace 파일, 틀린 줄) | 두 버전 모두 FP(제외되지 않는다) |
| shim으로 잘못 연결한 로컬 관계 | v1 FP·v2 제외, GT는 양쪽 FN. 위험 지표 1건 |
| dynamic import | workspace 모듈 `M|src/router.ts`는 포함(GT에 없으면 FP). `M|src/pages/Home.vue`(파일 없음), `M|shims/…`, `M|<outside>/…`는 제외 |
| indeterminate | v1과 같다. 단, unbounded indeterminate가 v1에서 흡수하던 shim 대상 예측은 v2에서 E로 빠진다(EXCL 1 → 0) |
| 부정 관계 | v1·v2 위반 수가 같다 |
| 같은 키 중복 | scorer가 먼저 합친다. E는 고유 키 1개, occurrences 3 |
| 두 analyzer | 같은 키는 같은 클래스. 빈 GT workspace에서도 분할 결과가 같다 |
| 차단 사례 | v1 차단이면 v2 차단 |
| CLI | v2 도구의 v1 출력이 `score.mjs` 출력과 파일 단위로 같다 |

## 15. 연구자 결정이 필요한 항목

| ID | 결정 |
|---|---|
| P-1 | 이 초안을 승인할지, 고칠지, v1만 쓸지 |
| P-2 | `IN_TSLIB_EXTERNAL`·`IN_UNCLASSIFIED`를 포함으로 둘지(현재: 보수적으로 포함) |
| P-3 | `OUT_UNRESOLVED_MODULE`을 제외로 둘지. 이 경우 workspace 밖 `.vue` 등을 대상으로 한 dynamic import 예측이 빠진다 |
| P-4 | 위험 지표의 사람 판정을 누가 할지(GT 판정자와 같은 사람인지) |
| P-5 | §8 해석 규칙(부호 불일치 시 RQ-B2 결론 보류)을 채택할지 |
| P-6 | Supported-target Precision(P1-K3 초안의 추가 지표 3)은 넣지 않았다. 예측의 "supported 모양"을 정의하려면 패턴 판정이 필요하다. 그 판정은 GT 없이 예측만으로는 정할 수 없어 원칙 6과 충돌한다. 다시 넣을지 결정이 필요하다 |
