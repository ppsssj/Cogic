# P14-C — 현재 분석기 정확도 평가 프로토콜(초안)과 독립 GT 검토 준비

- 기준: `main` `6ee778418e189d02ba11089de7550231c75292ac`, 브랜치 `research/p14c-accuracy-protocol`
- **판정: BLOCKED.** 공식 정확도 결과는 독립 사람 검토(게이트 4)가 끝나기 전까지 산출·보고하지 않는다.
- 이 단계에서 바꾸지 않은 것: 제품 코드, GT v1, scorer 1.2(`tools/exp01/lib.mjs`), runner 1.2, 과거 run·raw data.
- 미완성(사용 한도로 중단): 프로토콜 상세 문서의 분리 작성, 게이트 JSON, 연구자용 adjudication 양식 템플릿. 아래 §3–§6의 내용이 현재의 초안이다.

## 1. 버전과 무결성 (VERIFIED)

| 대상 | 값 |
|---|---|
| 평가 대상 analyzer | `6ee7784`. `src/analyzer` tree `175409d`, `src/shared` `5698ec4`, 빌드 해시 `697dcdd3…0cefc4`, TypeScript 5.9.3, Node 24.12.0 |
| P14-B(`cdc3196`) 이후 analyzer 변경 | #31 Program 재사용, #32 계측, #33 Depth 요청 수명주기(`analyze.ts`, `depth.ts`, `index.ts`, +518줄). 출력 동일성은 검증되지 않았다 |
| 과거 기준 | ORIGINAL `43ace0f`(tree `33f97d7`), IMPROVED `bbe4cbf`(`a2202f4`), P14-A `fdaecd4`(`5e89665`) |
| Corpus A | fixtures tree `08f74c5`(P1-A-R1 이후 변경 없음). runner preflight의 GT manifest·평가 manifest r2 검사 통과 |
| Corpus B | main에 없다. PR #15(`b4a5ff5`)와 #19(`4c5a3e2`)에만 있으며 두 커밋의 fixtures tree `1a76222`, MANIFEST blob `4a3fcfb`가 같다. #16–#18은 #15 브랜치로 병합되었다 |

**진단 smoke run**(`exp01-run.mjs --bootstrap 0`, 결과는 저장소 밖 보관): 44/44 실행, 결정성·OFF/ON 일치, warm hit 경로 VERIFIED, scorer `COMPLETE`. 기술 게이트는 `ANALYZER_NOT_IDENTICAL_TO_BASELINE`과 `BOOTSTRAP_NOT_PREREGISTERED`로 불합격이다(예상대로). **정확도 수치는 보고하지 않는다.**

runner의 `analyzerIdentity.note`는 고정 문구("Same analyzer implementation as the baseline")로, 실제 `identical: false`와 모순된다. P14-A의 지적과 같다.

## 2. 기존 평가의 문제점

1. 두 GT 모두 생성형 AI가 작성했고, 작성자가 analyzer 구현을 읽었다. 사람 검토는 0건이다(Corpus A 44/44 `not-reviewed`, Corpus B 20/20 `REVIEW_PENDING`).
2. scorer 1.2와 runner 1.2는 출력을 본 뒤 개정되었다(`POST_HOC_AMENDED`). 원래 사전 등록 결과가 아니다.
3. 현재 analyzer는 runner의 baseline 동일성 게이트를 통과할 수 없다. 새 analyzer를 위한 프로토콜이 필요하다.
4. Lenient 채점에 정의 문제가 있다(§4).
5. 기존 검토 자료가 analyzer 범위를 노출한다.
   - Corpus A의 146행 표본은 GT 항목을 제시하는 판정형이다(정박 효과).
   - Corpus A 사례 폴더 이름과 설명이 범주를 드러낸다(예: `-negatives`, `-unsupported`).
   - Corpus B의 P1-K3 패킷에는 지원 분류 열(`catalog.blind.csv`)과 패턴 선택 규칙이 들어 있다.
6. Corpus B 결과(P1-L)는 과거 두 analyzer의 결과이며 main에 병합되지 않았다.

## 3. 평가 프로토콜 초안 (DRAFT, 미고정)

- **대상:** 평가 시점에 고정한 analyzer SHA와 빌드 해시 한 개. 과거 baseline과의 동일성이 아니라 이 고정값과의 동일성을 게이트로 쓴다(새 runner 설정 또는 runner 1.3이 필요하며, 승인 대상이다).
- **Corpus·GT:** Corpus A tree `08f74c5`와 GT v1, Corpus B tree `1a76222`와 GT v1. 사람 검토 후 정정이 필요하면 `expected.v2.json`을 따로 만들고 v1은 보존한다. v1과 v2를 모두 채점해 함께 보고한다.
- **매칭:**
  - Strict: kind와 끝점이 같아야 한다(`dataflow`는 인자 위치까지). 각 예측과 GT는 최대 한 번 매칭한다.
  - Lenient: 보조 지표다. §4의 결정 전까지 결과를 strict와 나란히 비교하지 않는다.
- **TP·FP·FN:** TP는 매칭된 예측, FP는 매칭되지 않고 indeterminate 후보에도 해당하지 않는 예측, FN은 매칭되지 않은 determinate GT다. indeterminate와 매칭된 예측은 `EXCLUDED`로 별도 집계한다.
- **Recall:** in-scope(supported determinate)와 overall(모든 determinate)을 구분한다. Precision의 분자에는 모든 TP가 들어간다는 점을 명시한다.
- **집계:** micro(관계 합산)와 macro(정의된 범주 평균, 포함 범주 명시). 관계 단위 Wilson 구간과 사례 단위 bootstrap 10,000회(seed 사전 고정)를 쓴다.
- **부정 사례:** recall 분모가 아니다. 위반 수를 별도 보고한다.
- **제외 기준:** 사전에 고정한 실행 실패, 키 충돌(`SCORING_BLOCKED`) 사례만 제외하고 목록을 공개한다. 결과를 본 뒤 사례를 빼지 않는다.
- **탐색적 vs 확증적:**
  - 이 프로토콜과 사람 검토가 **결과를 보기 전에** 고정되면, 그 뒤 실행은 "프로토콜 고정 후 평가"로 보고한다.
  - 과거 실험과 이번 smoke run은 탐색적이다.
  - 과거 결과를 사후에 사전 등록 평가로 표현하지 않는다.

## 4. Lenient scorer 감사 (VERIFIED, `tools/lenient-audit.mjs`, 테스트 8개)

- 감사 도구의 기본 변형은 lib.mjs `scoreCase`와 88개 case·mode 전부에서 행 단위로 같다. 감사 결과가 원래 scorer를 정확히 재현한다는 뜻이다.

| 원인 | 내용 | 후보 | 이번 smoke 예측에서의 영향 | Strict 영향 |
|---|---|---|---|---|
| L1 | 매칭되는 예측이 kind가 아니라 키 순서로 정해진다 | 최소 비용 최대 매칭(같은 kind 우선) | d01 1건, 행 3개(개수 변화 없음) | 없음 |
| L2 | GT를 놓친 예측(`EXTRA`)은 indeterminate와 비교되지 않는다 | indeterminate를 먼저 확인 | d01: FP 1 → EXCLUDED 1 | 없음 |
| L3 | lenient 부정 사례가 다른 kind의 **올바른** 예측에 위반된다 | 같은 kind만 위반 | 7개 사례, 위반 12건 감소 | 없음 |
| L4 | "끝점만 비교"를 예측 쪽만 접으면 TP가 사라진다 | GT도 함께 접어야 함(분모 정의 변경) | 19개 사례, TP 33 감소(단측 적용 시) | 없음 |

- **GT 쪽 사실:** 같은 끝점에 kind가 둘인 GT 관계쌍이 41개 있다(constructs+references 19, references+updates 21, calls+references 1). 다른 kind의 정답과 끝점이 겹치는 부정 사례는 12개다.
- 사전 등록 문서 §6.3은 lenient를 "kind 무시, 끝점만 비교"라 정의한다. 그러나 구현은 구조 kind만 접고 `dataflow`와 `owner`는 엄격하게 유지하며, 중복 끝점 처리 규칙도 없다.
- **승인 필요(채택하지 않음):** L1·L2는 사전 등록 §6.5.2("determinate와 맞으면 TP")와 strict의 판정에 맞추는 수정으로 보인다. L3·L4는 lenient 의미 자체를 바꾼다. 어느 것을 채택하든 scorer 1.3으로 버전을 올리고, 1.2와 1.3 결과를 함께 보고해야 한다.

## 5. 독립 사람 검토 준비

- **패킷 생성:** `tools/build-review-packet.mjs --out <저장소 밖 새 폴더>`
  - 고정 커밋의 git 객체에서 64개 사례(A01–A44, B01–B20, seed 순서의 중립 ID)를 만든다.
  - 넣는 것: 소스, tsconfig, shim, 출처, 라이선스.
  - 뺀 것: GT, `case.json`, catalog(패턴·지원 분류·analyzer 코드 위치), 원래 사례 ID, analyzer 출력, 점수, import-edge 표.
  - 누출 검사 288개 패턴(단어, 원래·축약 사례 ID, GT 항목 ID, 패턴 ID)에서 0건이다. 일부러 심은 누출은 모두 검출한다(테스트). 같은 입력이면 같은 패킷 해시가 나온다.
- **검토자 문서와 양식**(`human-review/packet-template/`):
  - 문서: 선언서, 절차, 관계 정의(원 지침 §2–§5·§6.2 발췌, 범위 문장 제거), 종류별 판정 기준, Corpus B 환경 규칙.
  - 양식: relations, negatives, sites, ambiguities, outside-definitions, questions, time-log.
  - 검토자는 kind, 끝점, 결정성만 쓴다. 패턴과 지원 분류는 연구자가 검토 후 대응시킨다.
- **대조:** `tools/reconcile.mjs`가 고정된 제출본과 GT v1을 사례별로 비교해 대조표를 만든다.
  - 결과 코드: AGREE / KIND_DIFF / ARG_DIFF / DETERMINACY_DIFF / CANDIDATES_DIFF / POLARITY_CONFLICT / GT_ONLY / REVIEWER_ONLY.
  - 위치 기반 positive specific agreement를 함께 계산하고, 조정 결정 열이 있다.
  - GT v1을 그대로 옮긴 "완벽한 검토자"는 64개 사례 전 항목에서 일치한다(테스트).
- **절차:**
  1. 선언서를 받는다.
  2. 검토자가 blind로 작성한다.
  3. 제출본의 SHA-256을 기록하고 고정한다.
  4. 연구자가 대조한다.
  5. 불일치는 두 번째 검토자 또는 조정자가 판정한다. 판정자는 analyzer 예측을 보지 않으며(`predictionsSeenByDecider` 열), 각 결정에 지침 조항을 인용한다.
  6. GT 변경은 `expected.v2.json`과 변경 이력(이유, 발견 시점, 결정자)으로만 한다.
- 검토 결과가 나오기 전까지 "human-validated GT"라는 표현을 쓰지 않는다.

## 6. 실행 게이트

| 게이트 | 상태 |
|---|---|
| 1. Analyzer SHA·빌드 고정 | 후보값 기록(§1). 평가 시점에 고정 필요 |
| 2. Corpus 무결성 | Corpus A 검증. Corpus B는 브랜치 커밋 고정 확인, main 통합은 미결정 |
| 3. Scorer 정책 고정·테스트 | **미결정**(§4 L1–L4 승인 필요) |
| 4. 독립 사람 검토 | **미시작**: 검토자 미확보 |
| 5. 프로토콜 고정 | 초안(§3). 승인·고정 커밋 필요 |
| 6. 결과·raw 보존 | 절차 있음(run을 저장소 밖에 보관하고 해시 기록) |

## 7. 실행한 검사

- `node --test docs/thesis-experiments/p14c-protocol/tools/test/*.test.mjs`: 16/16 통과.
- runner smoke 1회: 위 §1 결과.
- 제품 테스트(`npm test`)는 이번 변경이 문서·연구 도구뿐이어서 다시 돌리지 않았다.
