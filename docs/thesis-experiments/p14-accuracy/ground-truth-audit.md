# GT 독립성과 판정 방법

## PROVISIONAL: GT의 독립성

Corpus A GT v1은 Claude Code가 작성했다. 기록상 이 fixture에서 Cogic을 실행하기 전에 고정했으나 작성자는 분석기 구현과 지원 범위를 알고 있었다. 사람이 독립 검토하지 않았으며, 146/708개의 검토 표본과 답안 분리 양식이 준비돼 있다. GPT-6 교차 검토는 사람 검토가 아니고 기존 구조를 일부 알고 있었으며 선행 고정 시점도 독립 확인할 수 없다. 사람이 채택하지 않은 사후 판정은 GT v1을 대체하지 않는다. 기존 [P1-D 기록](../p1d-ai-cross-review.md)을 참고한다.

Corpus B는 소스 선정·GT 작성·manifest 고정 후 그 코퍼스에 처음 Cogic을 실행했다고 기록한다. TypeScript 기반 초안과 AI 작성 검토 결정으로 생성됐고 작성자는 Cogic 구현을 알고 있었다. 20/20 `humanReviewed: false`, `REVIEW_PENDING`이다. P1-K의 blind 패킷은 원본 소스와 지침은 포함하고 GT·예측·점수를 분리한다. 사람 검토는 시작되지 않았다. 결과를 본 Hono H2는 새 검증 표본이 아니다.

검토자는 독립성·기존 결과 열람 여부를 선언하고 blind 패킷의 관계·부정 사례·결정성을 먼저 제출한다. 제출을 고정한 뒤 기존 GT와 대조하여 불일치를 판정한다. Corpus A의 146행은 기존 표본 도구와 agreement 도구를 이용해 관계 존재 및 결정성을 구분하여 일치도(해당 시 Cohen's κ)를 계산한다. 사람이 없으면 계산하지 않는다. Corpus B는 기존 블라인드/대조 패킷과 reconciliation 절차를 사용한다. 결과를 본 후 정정이 필요하면 GT v1을 보존하고 `expected.v2.json` 및 변경 이유·발견 시점·검토자를 별도로 기록하고 v1/v2를 모두 재채점한다. 사후 정정은 사전 등록 GT로 표현하지 않는다.

## VERIFIED: 지표와 한계

- 관계는 호출 지점이 아닌 중복 제거된 관계 집합이며, 각 예측과 GT는 최대 한 번 매칭한다. strict는 kind와 끝점(및 dataflow 인자 인덱스)을 비교하고 lenient는 kind를 완화한다.
- Precision = TP/(TP+FP). 예측의 TP에는 모든 determinate 지원 분류가 들어간다. in-scope Recall은 supported determinate GT 중 TP/전체, overall Recall은 supported·unsupported-by-design·determinate ambiguous 전체 중 TP/전체다. 따라서 in-scope F1의 Precision 분자는 supported GT만으로 한정되지 않는다.
- indeterminate 후보와 일치한 예측은 TP·FP에서 제외한다(후보 밖은 FP, unbounded는 별도 집계). 부정 사례는 positive recall 분모가 아니다. TS lib GT 대상은 사전 등록 D11 매핑을 유지하여 overall에서 누락으로 남을 수 있다.
- Corpus B 주 분석 v1은 GT에 없는 외부 shim 대상 예측도 FP로 센다. 사전에 고정된 보조 v2는 대상이 범위 밖인 예측을 별도로 제외해 precision 민감도를 계산한다. scorer 1.1→1.2의 **충돌 해결 개정**과 Corpus B **범위 프로토콜 v1→v2**는 서로 다른 변경이다.
- Wilson 95% 구간은 관계별 이항 근사이며 관계 독립성을 보장하지 않는다. 사례 단위 bootstrap은 사례 상관을 고려하지만 소수 사례와 편중 표본의 대표성을 보장하지 않는다. macro는 정의되지 않은 범주를 제외하므로 포함 범주를 함께 봐야 한다.

## DIAGNOSTIC: 완화 채점의 겹침

Corpus A `d01-parameter-binding`에서 확정 `references`와 같은 끝점의 불확정 `calls` 예측이 겹친다. strict에서는 참조가 TP이고 호출이 제외되지만, lenient에서는 호출이 TP를 차지하고 참조가 `EXTRA-LENIENT` FP가 된다. 따라서 실제 run에서 lenient precision이 strict보다 낮아진다. [최소 특성화 테스트](tools/scorer-overlap.test.mjs)는 현재 동작을 고정해 재현할 뿐 원하는 정책을 선언하지 않는다. 과제별 관계 의미와 제외 우선순위를 검토하고 수정 전후·v1/v2 결과를 분리해야 한다. 제품 analyzer의 결함과 별개의 **평가 도구 쟁점**이다.
