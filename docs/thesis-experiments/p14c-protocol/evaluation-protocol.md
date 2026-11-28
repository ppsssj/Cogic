# P14-C 정확도 평가 프로토콜 (DRAFT-1, 미고정)

- 상태: **초안(DRAFT-1, P14-E 보완).** 승인 D-1–D-5와 Semantic Contract C1을 반영했다. 검토자 확보와 GT 검토가 끝나지 않았으므로 프로토콜 전체는 고정되지 않았다.
  - 이 문서는 아직 고정되지 않았다.
  - 고정은 별도 커밋으로 하고, 그 커밋 SHA를 `execution-gates.json`의 `protocolFreezeCommit`에 적는다.
  - 고정 전에 현재 analyzer로 실행한 모든 결과는 **탐색적**이다.
- 과거 실험(EXP-01 v1.1/1.2, P1-L, P14-A)은 이 프로토콜로 다시 분류하지 않는다. 그 기록과 raw data는 그대로 둔다.

## 1. 평가 대상

| 항목 | 고정할 값 | 현재 후보 |
|---|---|---|
| Analyzer | 커밋 SHA, `src/analyzer`·`src/shared` tree, 컴파일 산출물 해시 | `6ee7784`, `175409d`, `5698ec4`, `697dcdd3…0cefc4` |
| 환경 | Node, TypeScript, OS | Node 24.12.0, TypeScript 5.9.3, Windows 11 |
| 실행 조건 | 캐시 OFF 2회 + ON cold/warm, 결정성·OFF/ON 일치 필수 | runner 1.2와 같음 |

runner 1.2의 동일성 게이트는 과거 baseline `43ace0f`와 비교한다. 이 프로토콜은 **고정된 평가 대상과의 동일성**을 게이트로 쓴다. 이를 위해 runner 1.3이 필요하며, runner 1.3은 1.2와 별도 버전으로 기록한다. **D-3 승인(P14-E): runner 1.3 도입을 승인했다. 아직 구현하지 않았다.**

## 2. Corpus와 GT

| Corpus | 고정 | GT |
|---|---|---|
| A (44 합성 사례) | fixtures tree `08f74c5`, GT manifest, 평가 manifest r2 | v1. 사람 검토 후 필요하면 v2 |
| B (20 실제 사례) | `4c5a3e2`의 fixtures tree `1a76222`, MANIFEST blob `4a3fcfb` | v1. 사람 검토 후 필요하면 v2 |

- **D-2 결정(P14-E):** Corpus B는 main으로 가져오지 않고 고정 커밋 `4c5a3e2` 참조를 유지한다.

**무결성 검사**는 매 실행 전에 한다. Corpus A는 manifest 검사, Corpus B는 MANIFEST 검사와 upstream 해시 대조다. 실패하면 analyzer를 실행하지 않는다.

**GT의 지위**는 다음과 같이 표기한다.

| 상태 | 표기 |
|---|---|
| 사람 검토 완료 전 | `AI-authored GT v1 (not human-validated)` |
| 검토와 조정을 마친 뒤 | `GT v1 + independent review (agreement 보고)` |
| 정정했으면 | `GT v2` |

### 2.1 GT 버전과 계약 버전 (P14-E, 승인 A-2)

- **두 축을 분리한다.**
  - **GT 버전**(v1, v2 …): 계약을 그대로 두고 정답 항목을 정정한 것이다. 사유는 `GT_CHANGELOG.md`에 남긴다.
  - **Semantic Contract 버전**(C1, C2 …): 관계의 의미(표현 정책)를 바꾼 것이다.
- **현재 계약은 C1이다.**
  - 문서: [p14e-pilot/contract/SEMANTIC_CONTRACT_C1.md](../p14e-pilot/contract/SEMANTIC_CONTRACT_C1.md)
  - 출처와 정합성: [c1-provenance.md](../p14e-pilot/c1-provenance.md)
  - C1은 지침 v1, Corpus B 보충 규칙, 카탈로그 owner 설명, D10을 모은 것이다. 기존 GT v1의 의미를 바꾸지 않는다. 데코레이터 항목 전수 확인 결과 GT v1은 C1과 일치한다.
- **보고 표기:** 모든 결과는 `(GT 버전, 계약 버전, scorer 버전)`을 함께 적는다. 예: `GT v1 / C1 / scorer 1.2 strict`.
- **계약을 바꾸면:**
  - C2를 만들고 C1과 C2로 모두 채점해 보고한다.
  - 계약 변경 후보(CC-1–CC-4)는 C1에 넣지 않았다.
- **미결 항목:** C1의 OPEN-1–OPEN-6과 C-OPEN-7·8은 계약이 정하지 않은 항목이다.
  - 검토에서 이 항목에 걸린 관계는 GT 오류가 아니라 계약 미결로 따로 분류한다.

## 3. 관계 매칭

- **단위:** 호출 지점이 아니라 중복을 없앤 관계 집합이다. 키는 `(kind, source, target)`이고, `dataflow`는 인자 위치를 더한다. `owner`는 source만 쓴다.
- **Strict(주 지표):**
  - 키가 같아야 매칭한다. overload 허용 대상(`targetAlternatives`)도 매칭으로 인정한다.
  - 매칭은 최대 이분 매칭이며, 각 예측과 각 GT는 최대 한 번만 매칭된다.
  - 같은 끝점에서 kind가 다르면 예측 kind의 FP와 GT kind의 FN이다.
- **D-1 결정(P14-E): strict가 주 지표로 확정되었다.**
- **Lenient:** 정책을 확정하기 전까지 공식 평가에서 쓰지 않는다. [lenient-scorer-audit](README.md#4-lenient-scorer-감사-verified-toolslenient-auditmjs-테스트-8개)의 L1–L4는 감사 결과로만 보존한다.

## 4. TP, FP, FN, EXCLUDED

| 판정 | 정의 |
|---|---|
| TP | determinate GT와 매칭된 예측 |
| FN | 매칭되지 않은 determinate GT |
| EXCLUDED | determinate GT와 매칭되지 않고, indeterminate 항목의 (source, 후보 대상)과 맞는 예측. `unbounded`면 그 source에서 나온 설명되지 않은 예측 모두. 개수를 별도로 보고한다 |
| FP | 나머지 예측. 후보 밖 대상으로 가는 예측도 FP다 |

## 5. 지표와 범위

- **Precision** = TP / (TP + FP). 분자에는 지원 분류와 무관하게 모든 TP가 들어간다. 민감도 지표로 EXCLUDED를 FP로 본 Precision도 함께 보고한다.
- **Recall** 두 가지:
  - **in-scope:** 분모는 supported determinate GT다.
  - **overall:** 분모는 supported, unsupported-by-design, determinate ambiguous를 모두 포함한다.
  - 지원 분류는 **analyzer의 설계 범위**이지 정답의 성질이 아니다. 따라서 사람 검토가 끝난 뒤 연구자가 패턴에 대응시키고, 그 대응을 고정한다.
  - **D-4 결정(P14-E):** GT의 의미 검토와 지원 분류를 분리한다. 매핑 규칙과 고정 시점은 [c1-provenance.md §5](../p14e-pilot/c1-provenance.md#5-의미-검토와-지원-분류의-분리-승인-d-4)를 따른다.
- **집계:**
  - **micro:** 관계를 모두 합산한다.
  - **macro:** 정의된 범주의 평균이다. 포함한 범주를 함께 표기한다. framework owner는 framework별 범주다.
- **구간:**
  - 관계 단위 Wilson 95% 구간. 관계가 서로 독립이라고 가정한다는 한계를 밝힌다.
  - 사례 단위 bootstrap. 10,000회, seed를 고정 시점에 적는다.
- **부정 사례:** recall의 분모가 아니다. 위반 수와 위반 목록을 따로 보고한다. lenient에서의 위반 정의는 D-1(L3)에 따른다.
- **Corpus:** A와 B를 따로 보고한다. 합산하지 않는다.

## 6. 불확실 관계와 제외 기준

- **indeterminate:** GT 작성 시 blind로 부여한 값을 따른다. 사람 검토에서 결정성이 다르게 판단되면 조정 결정으로 v2에 반영하고, v1과 v2를 모두 채점한다.
- **사례 제외:** 사전에 정한 사유만 인정한다.
  - analyzer 실행 실패
  - 결정성 불일치
  - 키 충돌(`SCORING_BLOCKED`)
  - 무결성 실패

  제외한 사례와 사유를 모두 공개한다. 결과를 본 뒤 사례나 관계를 제외하지 않는다.
- **D11:** TS lib 대상은 사전 등록 D11 매핑을 유지한다. overall FN에 남을 수 있음을 밝힌다.

## 7. 사람 검토와 일치도

- 절차는 [human-review/README](human-review/README.md)를 따른다.
- **보고 항목:** 일치도는 검토자 대 GT v1, 검토자 대 검토자 모두 보고한다.
  - 관계 집합의 positive specific agreement. determinate positive 관계 기준이다.
  - 결정성의 일치(해당 시 Cohen's κ).
  - 불일치 유형별 건수.
- **보고하지 않는 경우:** 검토자가 없으면 일치도를 계산하지 않는다.

### 7.1 검토의 독립성, AI의 역할, 파일럿 (P14-E)

- **사람 검토의 독립성:**
  - 검토자는 AI 응답, Cogic 출력, GT, 점수를 보기 전에 판단하고 제출한다.
  - 제출은 SHA-256으로 고정한다. AI 결과는 고정 뒤 조정 단계에서만 함께 본다.
  - GT·analyzer를 읽은 사람이나 세션의 판정은 독립 검토로 보고하지 않는다.
- **AI 검토는 보조다.**
  - 불일치를 찾아 사람 판정 대상을 고르는 데만 쓴다.
  - 다수결이나 AI 간 일치를 정답으로 채택하지 않는다.
  - 사람 검토를 AI 검토로 대체해 보고하지 않는다.
  - GT·analyzer를 읽은 세션(패킷을 만든 Claude Code 세션 포함)의 검토는 독립 AI 검토로 세지 않는다.
- **파일럿에 따른 범위 확정:**
  1. Corpus B 4개 사례(framework별 1개, 고정 seed 선정)로 AI 3종과 사람 검토를 먼저 한다([p14e-pilot](../p14e-pilot/README.md)).
  2. 파일럿 결과로 전체 검토의 인원과 범위를 정한다(D-5). 결과는 사례당 시간, 판단 불가·모호 항목, 계약 보강 필요 여부다.
  3. 정한 범위는 전체 검토 시작 **전에** 이 문서에 적는다.
- **원본 증거 보존:**
  - AI 응답 원문은 `ai-review.mjs intake`로 바이트 그대로 보존한다(SHA-256, 메타데이터, 덮어쓰기 거부).
  - 사람 제출본은 받은 그대로 SHA-256과 함께 보존한다.
  - 원문은 고치지 않는다. 형식 오류는 보고만 한다.
  - 원문과 blind key는 저장소 밖에 둔다. 저장소에는 해시와 처리 기록만 올린다.

## 8. 탐색적 평가와 확증적 평가

| 구분 | 조건 | 표현 |
|---|---|---|
| 탐색적 | 아래 게이트가 하나라도 열려 있는 상태의 실행. 과거 실험 전부, P14-C smoke | "diagnostic/exploratory". 수치는 공개하지 않거나 그 사실을 함께 적는다 |
| 프로토콜 고정 후 평가 | 게이트 1–6이 모두 닫힌 뒤, 고정 커밋 이후 처음 실행한 결과 | "protocol-fixed evaluation". 사후 사전 등록(preregistered)이라고 부르지 않는다 |

## 9. 재현 절차

1. 고정 커밋을 checkout하고 `npm ci`, `npm run compile`을 실행한다.
2. runner(1.3 승인 후)로 Corpus A를 실행한다. 새 run-id를 쓰고, bootstrap은 10000이다.
3. Corpus B runner를 고정 checkout에서 실행한다.
4. raw run을 ZIP으로 저장소 밖에 보관하고 SHA-256을 기록한다. 절대 경로가 들어 있어 Git에 올리지 않는다.
5. `execution-gates.json`의 게이트 6에 run-id, ZIP 해시, 보관 위치를 적는다.

## 10. 승인 대기 결정

| ID | 결정 |
|---|---|
| D-1 | **승인(P14-E):** strict 주 지표. lenient는 정책 확정 전 공식 평가에 쓰지 않음. L1–L4는 감사 결과로 보존. lenient 정책 자체는 미결 |
| D-2 | **승인:** Corpus B는 고정 커밋 `4c5a3e2` 참조 유지 |
| D-3 | **승인:** runner 1.3 도입. 미구현 |
| D-4 | **승인:** 의미 검토와 지원 분류 분리. 규칙과 고정 시점은 c1-provenance §5 |
| D-5 | **부분 승인:** 독립 검토자 2명 권장. 실제 인원과 범위는 파일럿 결과를 본 뒤 확정(미결) |
