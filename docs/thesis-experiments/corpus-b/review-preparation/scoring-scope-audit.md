# Corpus B 평가 범위·FP 정책 감사 (P1-K3)

- 결론: **`SCORING_SCOPE_DECISION_REQUIRED`**
- 대상: `exp01-scorer/1.2`(수정 없음), Corpus B GT v1, `corpus-b/EVALUATION_PROTOCOL.md`(수정 없음)
- 방법
  - scorer 코드를 읽었다.
  - scorer 함수를 그대로 import해 **합성 예측**으로 시나리오 11개를 채점했다(정정 P1-K4: 처음에 "12개"로 잘못 적었다)([scoring-scope-probe.mjs](../../tools/corpus-b-review/scoring-scope-probe.mjs)).
  - Cogic 예측은 쓰지 않았다. 합성 예측은 GT와 `excludedSites`로만 만들었다.
- 이 문서의 수치는 도구 검증용 가상 상황이다. Cogic 정확도가 아니다.

## 1. scorer 1.2의 규칙 (코드 근거)

| 규칙 | 코드 |
|---|---|
| 예측 하나는 GT determinate 하나와만 매칭된다. 매칭되면 TP, 아니면 FP | `lib.mjs` `scoreCase`: 최대 매칭 후 `verdict = "FP"` 기본값 |
| FP 중 indeterminate 항목과 맞는 것만 `EXCLUDED`로 바꾼다 | `scoreCase`의 `matchesIndeterminate` |
| `excludedSites`는 채점에 쓰이지 않는다. GT 구조 검사에만 쓰인다 | `excludedSites`는 `validateGtStructure`(lib.mjs 475행)와 validator에서만 읽힌다 |
| Precision = TP / (TP + FP). 분모에 모든 예측이 들어간다. 관계 종류·지원 분류·대상 위치로 거르지 않는다 | `countsFrom`, `metricsFromCounts` |
| In-scope Recall = supported GT 중 TP 비율 | `countsFrom`의 `inScope` |
| **In-scope F1 = F1(전체 Precision, In-scope Recall)** | `metricsFromCounts`: `f1InScope: f1(precision, recallInScope)` |
| 부정 사례: 예측 키가 부정 키와 같으면 위반. 그 예측은 FP이기도 하다 | `negativeRows`, `predRows` |
| 외부 노드 키: `X|<선언 파일>|<줄>`. 같은 키의 예측은 하나로 합쳐진다(`occurrences`) | `cogicNodeKey`, `loadPrediction` |

## 2. 합성 예측 시나리오 (20개 사례 전체)

| 시나리오 | 예측 | TP | FP | EXCL | P | R_in | R_all | F1_in |
|---|---|---|---|---|---|---|---|---|
| S0 GT 전체를 예측 | 196 | 196 | 0 | 0 | 1.000 | 1.000 | 1.000 | 1.000 |
| S1 S0에서 lib 대상 52개 제외 | 144 | 144 | 0 | 0 | 1.000 | 1.000 | 0.735 | 1.000 |
| S2 supported 78개만 | 78 | 78 | 0 | 0 | 1.000 | 1.000 | 0.398 | 1.000 |
| S3a S2 + excluded site마다 외부 API 예측 1개(서로 다른 대상) | 151 | 78 | 73 | 0 | 0.517 | 1.000 | 0.398 | 0.681 |
| S3b S3a와 같되 외부 대상을 "틀리게" | 151 | 78 | 73 | 0 | 0.517 | 1.000 | 0.398 | 0.681 |
| S3c S2 + 외부 API 예측을 모듈 단위 키 하나로 | 95 | 78 | 17 | 0 | 0.821 | 1.000 | 0.398 | 0.902 |
| S4 supported + unsupported-by-design(정답) | 194 | 194 | 0 | 0 | 1.000 | 1.000 | 0.990 | 1.000 |
| S5 S3a + unsupported-by-design(정답) | 267 | 194 | 73 | 0 | 0.727 | 1.000 | 0.990 | 0.842 |
| S6 S2 + indeterminate 후보 예측 | 96 | 78 | 0 | 18 | 1.000 | 1.000 | 0.398 | 1.000 |
| S7 S0 + 부정 사례 2개를 위반 | 198 | 196 | 2 | 0 | 0.990 | 1.000 | 1.000 | 0.995 |
| S8 S3a에서 shim 대상 예측을 따로 뺀 경우(제안 지표의 모의) | 78 | 78 | 0 | 0 | 1.000 | 1.000 | 0.398 | 1.000 |

- P = Precision, R_in = In-scope Recall, R_all = Overall Recall, F1_in = In-scope F1, EXCL = indeterminate로 제외된 예측
- 외부 API 예측의 모의 키: `X|shims/third-party.d.ts|<줄>`. owner는 `F|<active file>`로 두었다.
- 테스트: `tools/corpus-b-review/test/review.test.mjs`가 위 관계(S3a=S3b, S5 > S3a 등)를 확인한다.

## 3. 질문에 대한 답

**Q1. `excludedSites`에 있는 외부 API 예측이 실제로 FP가 되는가?**

- 그렇다. scorer는 `excludedSites`를 읽지 않는다. GT에 대응 관계가 없는 예측은 indeterminate와 맞지 않는 한 FP다.
- S3a: excluded site 73개마다 예측 하나 → FP 73. Precision 1.000 → 0.517, In-scope F1 1.000 → 0.681. In-scope Recall은 1.000 그대로다.
- 이 결과는 P1-K1 ANNOTATION_ADDENDUM A2의 사전 규칙("Cogic이 이런 지점에 external 노드를 만들면 FP가 된다")과 같다. 규칙이 코드에 그대로 구현되어 있다.

**Q2. 외부 API를 정확하게 추출한 예측과 잘못 추출한 예측을 구분할 수 있는가?**

- 현재 지표로는 구분할 수 없다. S3a(맞는 외부 대상)와 S3b(틀린 외부 대상)의 모든 지표가 같다. GT에 외부 API 관계가 없기 때문이다.
- 사후에 할 수 있는 것: FP를 대상 키로 나누는 것. 예: 대상이 `X|shims/…`인 FP와 그 밖의 FP
  - 이렇게 나눠도 "외부 API를 가리킨다"는 사실만 알 수 있다. 맞는 API인지는 알 수 없다.
  - 맞는 API인지 판정하려면 외부 API 관계의 정답이 필요하다. 그것은 P1-K2 Option C 수준의 GT 확장이다.
- FP 수 자체도 analyzer가 외부 노드를 어떤 키로 만드는지에 달려 있다.
  - shim은 모듈마다 한 줄이다.
  - 같은 모듈의 서로 다른 API가 같은 키로 합쳐지면 FP가 줄어든다(S3c: 73 → 17).
  - 그래서 외부 API FP 수는 추출 품질이 아니라 키 구성을 반영할 수 있다.
  - Cogic이 실제로 어떤 키를 만드는지는 실행하지 않아 확인하지 않았다.

**Q3. 현재 Precision은 어떤 예측 모집단의 Precision인가?**

- 분모는 **analyzer가 낸 모든 관계 예측**이다. indeterminate와 맞는 예측만 빠진다. 다음 예측이 모두 들어간다.
  - 로컬·lib 대상
  - framework owner
  - 외부 패키지 대상
  - 지원 범위 밖 관계
- 분자는 Corpus B GT의 determinate 관계와 맞는 예측이다. GT 정의 범위는 로컬 §2 노드, TS lib, framework 구문 의미다.
- 따라서 Precision은 "GT가 정의한 범위 기준으로, analyzer 출력 전체 중 맞는 비율"이다.
  - GT가 정의하지 않은 범위(외부 패키지)의 예측은 맞든 틀리든 오답으로 센다.
  - EXP-01은 framework를 typed shim으로 두고 framework API 관계를 GT에 넣었다. 그래서 같은 이름의 Precision이라도 두 코퍼스 사이에 비교할 수 없다.

**Q4. 지원 범위 밖 관계가 In-scope F1에 영향을 주는가?**

- 그렇다. 두 방향 모두 영향을 준다.
  - 지원 범위 밖 관계를 맞히면 In-scope F1이 오른다. S3a → S5: TP가 늘어 Precision이 오르고, In-scope Recall은 그대로인데 In-scope F1이 0.681 → 0.842로 오른다.
  - 범위 밖 예측이 틀리면 In-scope F1이 내려간다(S3a).
- 이유: In-scope F1은 In-scope Recall과 **전체** Precision을 결합한다. 그래서 "in-scope"라는 이름과 달리 범위 밖 예측의 영향을 받는다.
- P1-L 프로토콜은 In-scope F1을 주 지표로 정했다. 해석할 때 이 점을 명시해야 한다.

**Q5. scorer 1.2의 채점 정책이 Annotation Guide와 모순되는가?**

- 직접 모순은 없다.
  - 지침은 §2 노드 사이의 관계만 정답으로 정한다.
  - Corpus B 보충 규칙 A2는 외부 API 지점의 예측이 FP가 된다고 실행 전에 정했다.
  - scorer는 그대로 동작한다.
- 다만 **해석상의 불일치**가 두 가지 있다.
  1. EXP-01 계획(`experiments/exp-01-accuracy.md` §6.4)은 in-scope/overall 구분을 **재현율에만** 정의한다(supported GT만 분모). Precision에는 범위 구분이 없다. 그런데 In-scope F1은 이 Precision과 결합된다. 그래서 In-scope F1을 "지원 범위 안의 성능"으로 읽으면 잘못 해석된다(Q4).
  2. Corpus B에서는 GT에 없는 외부 패키지 범위가 크다. P1-K2 기준으로 active file 식별자 198개가 외부 패키지로 해석된다. 그래서 Precision이 analyzer의 정확도가 아니라 "외부 노드를 얼마나 만드는가"를 반영할 수 있다.
- 기존 테스트 주석: `tools/exp01/test/score.test.mjs` §18 주석은 "Cogic은 TS lib 대상을 내지 않는다(TS-lib targets, which Cogic never emits)"고 적고 있다.
  - 이 주석이 맞다면 Corpus B의 lib 대상 determinate 52개(모두 unsupported-by-design)는 항상 FN이다. Overall Recall 상한은 0.735다(S1).
  - 이 동작은 실행해서 확인하지 않았다. 출처는 테스트 주석뿐이다.

**Q6. 별도 민감도 분석이 필요한가?**

- 필요하다.
  - 현재 주 지표만으로는 P1-L 결과가 "로컬 관계 추출 정확도"인지 "외부 노드 생성 경향"인지 구분할 수 없다(Q2–Q4).
  - ORIGINAL과 IMPROVED가 외부 노드를 다르게 만든다면, ΔF1이 개선 대상 관계(6개 안팎)보다 외부 FP 변화에 좌우될 수 있다.
- 민감도 분석은 **P1-L 실행 전에** 별도 버전 프로토콜로 고정해야 한다. 결과를 본 뒤 정하면 사후 선택이 된다.

## 4. 제안: 평가 프로토콜 v2 초안 (채택 전)

`EVALUATION_PROTOCOL.md`(v1)는 바꾸지 않는다. 연구자가 채택하면 `EVALUATION_PROTOCOL.v2.md`로 새로 만들고, P1-L 실행 전에 해시를 고정한다.

| 항목 | 제안 |
|---|---|
| v1 지표 | 그대로 계산·보고한다(사전 고정 결과) |
| 예측 분할(사전 정의) | 채점 전에 예측을 대상 키로 나눈다. **U(universe 안)**: 대상이 사례의 로컬 §2 노드(`D|`, 코퍼스 파일 `X|`), TS lib(`L|`), active file의 synthetic(`S|`), owner. **E(universe 밖)**: 대상이 shim 선언(`X|shims/…`), 해석 불가 module(`M|`) 등 GT 정의 범위 밖 |
| 추가 지표 1 | **Scope-restricted Precision** = TP / (TP + FP_U). E의 예측은 분모에서 뺀다 |
| 추가 지표 2 | **Scope-restricted In-scope F1** = F1(Scope-restricted Precision, In-scope Recall) |
| 추가 지표 3 | **Supported-target Precision**: 예측 중 GT supported 관계와 같은 (kind, source, target) 모양인 것만 분모로. 모양 정의는 실행 전에 고정 |
| E 보고 | E 예측 수(사례별·관계 종류별), excluded site와 겹치는 수, 키 중복으로 합쳐진 수. **E는 정답 여부를 판정하지 않는다** |
| 위험 통제 | E로 분류된 예측 중에는 로컬 대상을 shim으로 잘못 해석한 오류도 있을 수 있다. 이것이 빠지지 않도록 E 목록을 공개하고, 위 지표를 v1 지표와 나란히 보고한다. E 비율이 크면 그 자체를 결과로 보고한다 |
| paired 비교 | ΔF1(v1)과 ΔF1(scope-restricted)을 함께 보고한다. 개선 대상 패턴의 전이 표는 v1 그대로 쓴다 |
| scorer | scorer 1.2는 바꾸지 않는다. 분할은 scorer 입력 전에 하는 별도 도구(`exp01-scorer/1.2`에 예측 부분집합을 넣는 방식)로 구현하고 합성 입력으로 먼저 시험한다 |

- 결정 필요: 위 제안을 채택할지, 다른 정의를 쓸지, v1만 보고할지. 연구자가 정한다([open-decisions.md](open-decisions.md) D-1).
