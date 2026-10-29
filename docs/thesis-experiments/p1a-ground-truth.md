# P1-A: Ground Truth Corpus & Scoring Infrastructure

- 상태: Ground Truth v1과 채점 규칙을 사전 등록했다(커밋 `41bbe19`). **측정은 하지 않았다.**
- 기준: `origin/main` = `6ebd265b204900bb24b467cdc54e133e713214c2` (P0 PR #1 병합 커밋), 2026-10-26 fetch 후 확인
- 작업 브랜치: `research/thesis-p1a-ground-truth`
- 실험 기준 문서: [experiments/exp-01-accuracy.md](experiments/exp-01-accuracy.md)(P0-R1 포함), [experimental-design.md](experimental-design.md)

이 단계의 성공 기준은 정확도 수치가 아니다. **예측 결과를 보기 전에 정답 데이터와 채점 규칙을 고정하는 것**이다. 이번 단계에서 하지 않은 일은 다음과 같다.
- 신규 코퍼스에 Cogic analyzer를 실행하지 않았다.
- 예측 JSON과 정확도 수치를 만들지 않았다.

---

## 1. 산출물

| 경로 | 내용 |
|---|---|
| [fixtures/exp-01/ANNOTATION_GUIDE.md](fixtures/exp-01/ANNOTATION_GUIDE.md) | 정답 정의: 노드, owner, 관계 6종, framework 의미, 지원 분류, 결정성, 버전 관리 |
| [fixtures/exp-01/catalog.csv](fixtures/exp-01/catalog.csv) | 패턴 143개(positive 112, negative 30, excluded 1). 범주, 지원 분류, 코드 근거, P0 대응 행. GT에 쓰인 것은 140개다. `CALL-FIELD-INIT`와 `CONS-IN-ANON-CALLBACK`은 정의만 있고 사례가 없으며, `VUE-SFC`는 제외 형식이다 |
| `fixtures/exp-01/<category>/<case-id>/` | fixture 44개: 소스, `tsconfig.json`, shim, `case.json`, `expected.json` |
| [fixtures/exp-01/COVERAGE.md](fixtures/exp-01/COVERAGE.md) | GT 커버리지 보고서(도구 생성) |
| `fixtures/exp-01/validation-report.json` | GT 검증 결과(도구 생성) |
| `fixtures/exp-01/gt-manifest.json` | 사전 등록 시점 파일 해시(고정, 다시 쓰지 않음) |
| `fixtures/exp-01/eval-manifest.r1.json` | P1-A-R1 채점 도구 수정 후 평가 도구 기준 해시(§12) |
| [fixtures/exp-01/review/](fixtures/exp-01/review/REVIEW_FORM.md) | 독립 검토 표본(146/708)과 양식. 결과 칸은 비어 있다 |
| [fixtures/exp-01/GT_CHANGELOG.md](fixtures/exp-01/GT_CHANGELOG.md) | 사전 등록 이후 GT 변경 기록 |
| `tools/exp01/lib.mjs` | 정규화, 매칭, 채점, 지표, 통계, CSV, GT 구조 검증(순수 함수) |
| `tools/exp01/validate-gt.mjs` | GT 검증기(TypeScript 컴파일러로 fixture를 파싱·타입 검사) |
| `tools/exp01/score.mjs` | 채점 CLI |
| `tools/exp01/coverage.mjs` | 커버리지 보고서 생성 |
| `tools/exp01/review-sample.mjs`, `review-agreement.mjs` | 검토 표본 추출, 검토 후 Cohen's κ 계산 |
| `tools/exp01/manifest.mjs` | manifest 생성·대조(`--scope gt`로 GT 데이터만 대조 가능) |
| `tools/exp01/test/score.test.mjs` | 단위 테스트 30개(합성 예측 데이터만 사용) |

## 2. 코퍼스 요약

자세한 표는 [COVERAGE.md](fixtures/exp-01/COVERAGE.md)에 있다.

| 범주 | supported (in-scope) | unsupported-by-design | ambiguous·determinate | determinate 합계 | indeterminate | negative |
|---|---:|---:|---:|---:|---:|---:|
| calls | 126 | 15 | 2 | 143 | 6 | 7 |
| constructs | 33 | 5 | 1 | 39 | 0 | 5 |
| references | 137 | 19 | 0 | 156 | 0 | 5 |
| dataflow | 149 | 17 | 15 | 181 | 2 | 5 |
| updates | 35 | 1 | 0 | 36 | 0 | 7 |
| react-hook-owner | 22 | 0 | 0 | 22 | 0 | 5 |
| vue-hook-owner | 25 | 3 | 0 | 28 | 0 | 5 |
| express-route-owner | 18 | 8 | 0 | 26 | 0 | 5 |
| nest-route-owner | 20 | 0 | 0 | 20 | 0 | 5 |
| **합계** | **565** | **68** | **18** | **651** | **8** | **49** |

- **P0 최소 표본 기준(§5.1)을 모두 충족한다.**
  - 핵심 범주 in-scope ≥ 30
  - framework 범주 ≥ 15
  - 범주별 부정 사례 ≥ 5
  - 전체 ≥ 250
- **여유가 작은 곳**:
  - constructs in-scope는 33개이고, 그중 20개가 명시적 생성자 패턴이다(§8 D3).
  - constructs, references, dataflow와 framework 4범주의 부정 사례는 기준선과 같은 5개다.
- **패턴 집중**: 개수가 많은 패턴은 다음과 같다.
  - `DF-EXTERNAL` 71
  - `CALL-FW-API` 47
  - `DF-POSITIONAL` 41
  - `REF-SHORTHAND-PROPERTY` 39(references in-scope의 28%)
  - `DF-CONSTRUCTOR` 33

  한 패턴의 체계적 실패가 범주 Recall을 크게 움직일 수 있으므로, 결과는 반드시 패턴별 표(`metrics-by-pattern.csv`)와 함께 보고한다. 관계는 실제 소스의 관계이고 반복 생성하지 않았지만, framework API 호출(`useState`, `ref`, `app.get`)과 그 인자 dataflow가 많은 것은 framework fixture 구성의 결과다.
- **`.vue` SFC**: 정량 평가에서 제외했다. 카탈로그 `VUE-SFC` 행에 파일 형식 지원 범위의 한계로만 기록했다.

## 3. Ground Truth 작성 방법

### 3.1 절차

1. **지침과 카탈로그 작성**: 관계 정의는 [ANNOTATION_GUIDE.md](fixtures/exp-01/ANNOTATION_GUIDE.md)에, 패턴과 지원 분류는 `catalog.csv`에 둔다.
   - 지원 분류는 패턴 단위로, Cogic 구현 코드를 읽어 정했다(P0 §3 규칙).
   - P0 카탈로그에 있는 패턴은 P0 분류를 그대로 썼다.
2. **fixture 작성**: P0 §5.1 카탈로그 행을 바탕으로 소스를 먼저 썼다. 외부 패키지는 최소 선언 shim으로 대체했다.
3. **타입 검사**: 모든 fixture가 자신의 `tsconfig.json`으로 진단 0건이 되도록 했다(TypeScript 5.9.3).
4. **GT 작성**: 소스를 줄 번호와 함께 읽고 지침의 정의만으로 `expected.json`을 작성했다. 결정성(`gtStatus`)도 이때 부여했다.
5. **기계 검증**: `validate-gt.mjs`로 다음을 확인했다.
   - 스키마
   - 노드가 실제 선언·앵커를 가리키는지
   - 근거 줄이 존재하는지
   - 활성 파일의 모든 호출 지점이 GT 항목에 인용되었는지
   - 키 충돌이 없는지

   검증에서 나온 오류는 소스를 다시 읽어 고쳤다(§3.3).
6. **사전 등록**: GT, 지침, 카탈로그, 채점 도구, 테스트, manifest를 한 커밋으로 고정했다(§9).

### 3.2 Cogic 예측 출력을 쓰지 않았다

- 신규 fixture에 Cogic analyzer(`analyzeWorkspaceActive` 등)를 실행하지 않았다. P1-A 도구 어디에서도 analyzer를 import하지 않는다.
- 기존 Cogic 테스트 snapshot, 그래프 JSON, debug 출력을 정답 작성에 쓰지 않았다.
- 채점 도구 테스트의 예측 데이터는 모두 테스트 코드에서 손으로 만든 합성 데이터다. 코퍼스 왕복 테스트(round-trip)는 GT를 Cogic 출력 형식으로 바꾼 합성 그래프를 쓴다. 이것은 키 정규화가 실제 코퍼스에서 동작하는지 확인하는 도구 자체 점검이며 정확도 측정이 아니다.
- 기존 `npm test`(25개)는 저장소의 기존 테스트 입력에 analyzer를 실행한다. 신규 코퍼스는 대상이 아니다.

### 3.3 사전 등록 전 수정 내역

모두 Cogic 출력과 무관하게, 타입 검사기와 GT validator의 결과 또는 지침 일관성 검토로 찾은 것이다.

| 대상 | 수정 | 발견 경위 |
|---|---|---|
| `calls/c10-negatives/main.ts` | `const text: string = "target()"`로 타입 명시 | TS2367 진단 |
| `dataflow/d01-parameter-binding/main.ts` | 배열 spread를 일반 파라미터에 넘기는 함수(타입 오류)를 `spreadRest`, `choose`로 교체 | TS2556 진단 |
| `references/r01-type-references/main.ts` | `roleOf` 반환 타입을 `string`으로 변경. 반환 타입 참조와 enum 멤버 참조가 한 관계로 합쳐져 `REF-ENUM-MEMBER` 패턴을 따로 셀 수 없었기 때문 | GT 작성 중 |
| Express 3개 사례 `expected.json` | shim 노드 줄 번호 18건을 1씩 정정 | validator(노드-선언 불일치) |
| Nest 4개 사례 `expected.json` | 어떤 관계에도 쓰이지 않는 노드 12개 제거 | validator 경고 |
| `constructs/k03-factories/expected.json` | `I01` 후보를 열거형에서 `"unbounded"`로 변경. `totalArea`가 export되어 fixture 밖 코드가 구조적 타입 인자를 넘길 수 있다(지침 §6.2). 쓰이지 않게 된 노드 3개 제거 | 결정성 규칙 일관성 검토 |
| `catalog.csv` | 패턴 7개 추가(alias/namespace import, 이름 있는 handler 호출, 비지원 owner 관계). 쓰이지 않는 `NEG-SETTER-DATAFLOW` 삭제 | GT 작성 중 |

## 4. 생성형 AI 활용 범위

- fixture 소스, shim, `expected.json`, `case.json`, 지침, 카탈로그, 모든 도구와 테스트, 이 문서는 **Claude Code(생성형 AI, 모델 claude-opus-5-5)가 작성했다.**
- 사람이 작성하거나 검토한 GT 항목은 **없다**(2026-10-26 기준).
- 따라서 P1-A GT는 "단일 주석자(single-annotator), 생성형 AI 작성"이다. 독립적인 사람이 검증한 GT라고 주장하지 않는다.

## 5. 독립성과 검토 상태

| 항목 | 상태 |
|---|---|
| Cogic 출력 미사용 | 지켰다(§3.2) |
| 작성자의 구현 지식 | **있다.** 작성자는 Cogic analyzer·adapter 소스를 읽었다(지원 분류 목적). 정답 정의가 구현 동작에 끌려갈 위험이 있다. 위험을 줄이려고 지침에서 관계를 구현과 무관한 의미로 정의했고, 구현이 다르게 동작할 것으로 보이는 곳도 의미대로 정답을 적었다(§8 D1–D4) |
| 사람의 독립 검토 | **수행되지 않았다.** 검토자가 아직 정해지지 않았다 |
| 검토 준비 | `review/review-sheet.csv`: 146개(전체 708의 20.6%, 범주마다 20% 이상, seed 20261026). blind 시트와 정답 키를 분리했다. 판정 값은 `exists`/`not-exists`/`undeterminable`의 3종이다. 일치도는 `review-agreement.mjs`로 계산한다 |
| 검토 결과 | 없음. 결과 칸은 비어 있고, 임의로 채우지 않았다 |

P0 §7은 "GT 검토 → 사전 등록 커밋" 순서다. P1-A에서는 검토자가 없어 **검토 전에 사전 등록했다.** 이후 검토에서 정정이 필요하면 v1을 고치지 않고 v2로 기록한다. 이 순서 차이는 논문 방법 절에 명시한다.

## 6. 채점 도구

| 요구 기능 | 구현 위치 | 정의 |
|---|---|---|
| 1. 노드 정규화 | `lib.mjs` `nodeKey`, `cogicNodeKey`, `relativeFixturePath` | 키는 지침 §2를 따른다. Cogic 노드 매핑은 다음과 같다. `/#\d+$/` 이름의 function은 synthetic이다. `:-1` id의 external은 module이다. function/method는 callable, class는 class, interface는 typeLike다. 경로는 fixture 루트 기준 POSIX 상대경로이고 드라이브 문자는 소문자로 바꾼다. fixture 밖 파일은 `<outside>`/`<tslib>` |
| 2. 관계 유형별 매칭 | `relationKey` | `kind\|src\|tgt`. dataflow는 `\|argIndex`를 더한다(Cogic `arg#i`에서 추출). owner는 `owner\|src` |
| 3. TP/FP/FN | `scoreCase`, `maximumMatching` | 예측과 GT는 strict·lenient 모두 **최대 1:1**로 짝짓는다(최대 이분 매칭, P1-A-R1). 동점은 같은 kind·주 대상 > 같은 kind·`targetAlternatives` > 다른 구조 kind > GT id 순으로 정하고, 예측은 키 순서로 처리한다. 따라서 결과가 입력 순서와 무관하다. 후보 GT가 있었지만 다른 예측이 이미 가져간 예측은 FP다(strict `EXTRA-ALTERNATIVE`, lenient `EXTRA-LENIENT`) |
| 4. P/R/F1 | `computeMetrics`, `metricsFromCounts` | `P = TP/(TP+FP)`. `R_in = TP_supported/GT_supported`. `R_overall = TP/GT_determinate`. F1은 P와 각 R로 계산 |
| 5. strict/lenient | `lenientKey` | lenient는 calls, constructs, references, updates의 kind를 무시하고 끝점만 비교한다. 매칭은 strict와 같이 1:1이다. 같은 끝점에 GT가 2개(예: calls와 references)이고 예측이 1개면 TP는 1개다. dataflow(argIndex)와 owner는 strict와 같다 |
| 6. in-scope/overall | `countsFrom` | 패턴의 `support`로 나눈다 |
| 7. indeterminate 분리 | `matchesIndeterminate` | P0-R1 §6.5.2 그대로다. 결정 가능한 GT와 먼저 맞추고, 남은 예측이 후보와 맞으면 `EXCLUDED`가 된다. 후보 밖이면 FP다. `unbounded`면 같은 source·kind의 남은 예측을 모두 제외한다. 제외 수는 `indeterminate.csv`, 전부 FP로 본 민감도 P는 `precisionSensitivity` |
| 8. 중복 제거 | `normalizeCogicGraph` | 같은 키 예측은 1개로 합치고 `occurrences`와 `diagnostics.json`의 `duplicates`에 기록한다 |
| 9. 키 충돌 탐지 | `normalizeCogicGraph` | 서로 다른 Cogic id가 같은 키가 되면 `collisions`에 기록하고 그 사례를 `SCORING_BLOCKED`로 둔다(9a). GT 쪽 충돌은 validator가 오류로 막는다 |
| 9a. fail-closed 진단 | `scoringBlockers`, `isConfirmatory`, `score.mjs` | P1-A-R1. 정규화 중 다음이 하나라도 나오면 사례 상태가 `SCORING_BLOCKED`다: 노드 키 충돌(`node-key-collision`), 잘못된 edge endpoint(`invalid-endpoint`), 파싱할 수 없는 dataflow 인덱스(`unparsable-dataflow-index`), 알 수 없는 edge kind(`unknown-edge-kind`), 알 수 없는 노드 kind(`unknown-node-kind`). `exp01-pred/1` 입력에도 같은 검사를 한다. 막힌 사례의 행 단위 판정은 `matches.csv`에 남긴다(`caseStatus`). 그러나 `computeMetrics`·`metricsByPattern`·bootstrap 집계에서는 뺀다. 원본 진단은 원래 edge·노드 객체(`raw`)와 함께 `diagnostics.json`에 저장한다. 막힌 사례가 있으면 `summary.json`의 `scoringStatus`가 `BLOCKED`이고 CLI 종료 코드는 2다. 이 상태의 수치는 확증 결과로 보고하지 않는다. 수동 검토와 원인 규명 전에 Cogic 원출력이나 GT를 고치지 않는다 |
| 10. CSV/JSON 출력 | `score.mjs` | `matches.csv`(행 단위 판정, `caseStatus`, 원인 코드 칸 비움), `metrics-by-category.csv`, `metrics-by-pattern.csv`, `indeterminate.csv`, `negatives.csv`, `diagnostics.json`, `summary.json`(`scorerVersion`, `scoringStatus`, `blockedCases`, micro, macro, cluster bootstrap 95% CI) |

**0으로 나누는 경우와 빈 범주의 정의**(사전 고정):

| 상황 | 정의 |
|---|---|
| 예측 0개(`TP+FP = 0`) | Precision = 정의되지 않음(`null`) |
| GT 0개(분모 0) | 해당 Recall = `null` |
| P 또는 R이 `null` | F1 = `null` |
| P = R = 0 | F1 = 0 |
| GT는 없고 예측만 있는 범주 | Recall = `null`, Precision = 0(전부 FP), F1 = `null` |
| macro 평균 | F1이 `null`이 아닌 범주만 평균하고, 포함된 범주 목록을 함께 출력한다 |
| Wilson CI | n = 0이면 `null` |
| bootstrap | 재표본에서 F1이 `null`이면 그 표본을 제외하고 제외 수(`undefinedDraws`)를 보고한다 |

- 통계: 범주별 P·R에 Wilson 95% CI를 붙이고, micro F1에는 사례 단위 cluster bootstrap(기본 10,000회, seed 20261026)을 쓴다. 둘 다 P0 §9 규칙이다.
- 부정 사례: 예측되면 일반 FP이고, `negatives.csv`의 `violated`에 표시한다. 별도 지표로 합산하지 않는다.

## 7. 검증 결과

| 항목 | 결과 |
|---|---|
| fixture 문법·타입 구성(44개 tsconfig, TS 5.9.3) | PASS: 진단 0건 |
| GT JSON 스키마·구조(`validateGtStructure`) | PASS: 오류 0건 |
| 노드 참조 무결성(선언·앵커 위치 대조) | PASS |
| 근거 줄 존재 | PASS |
| 호출 지점 커버리지(활성 파일의 call/new/JSX 줄) | PASS: 누락 0건 |
| 정규화 키 충돌(GT) | PASS: 0건 |
| 휴리스틱 경고 | 5건. 근거 줄에 대상 이름이 없는 동적 접근·alias 사례(`c08 I01`, `k04 R04`, `k08 N04`, `d01 I01`, `h03 R16`). 의도된 결과다 |
| 범주별 표본 수·부정 사례 | PASS: P0 기준 전부 충족(§2) |
| 채점 도구 단위 테스트 | PASS: 30/30(사전 등록 시점). P1-A-R1 후 44/44(§12) |
| 기존 compile / lint / lint:webview / `npm test` | PASS: `npm test` 25 passing(기존 테스트 입력만 사용). production 코드는 바꾸지 않았다 |
| 문서 링크 | PR 본문에 기록 |
| fixture의 예상 Cogic 출력과 실제 출력 비교 | NOT_RUN(이번 단계 범위 밖) |

## 8. P0 문서와의 차이와 의문점

P0 문서는 고치지 않았다. 아래 항목은 P1-B 측정과 해석 때 확인할 사항이다. D1–D4는 코드 읽기에 근거한 추정이며, analyzer를 실행해 확인한 사실이 아니다.

| ID | 내용 | P1-A 처리 | 영향 |
|---|---|---|---|
| D1 | P0 §5.1은 express `app.get("/p", handler)`를 supported로 분류했다. 그러나 hook·route 콜백 탐지는 `visitDecls`가 `parentId`가 있을 때만 수행한다(`analyze.ts:1389`). **모듈 최상위 route 등록**에는 처리 경로가 없어 보인다 | 최상위 등록을 새 패턴 `FW-EXPRESS-TOPLEVEL`(unsupported-by-design)로 분리했다. 함수 안 등록은 P0대로 supported로 두었다 | 실무 Express 코드는 최상위 등록이 흔하므로, 함수 안 등록만으로 측정한 express 결과를 일반화하면 안 된다 |
| D2 | P0는 overload 호출을 "supported 추정"으로 분류했다. 같은 파일 overload는 `getResolvedSignature().getDeclaration()`이 본문 없는 시그니처를 반환하고, 노드 맵(`idByDeclPos`)에는 구현만 있다(`analyze.ts:2036-2082`). edge가 만들어지지 않을 수 있다 | P0 분류(supported)를 유지했다. 정답 대상은 구현 노드다 | 1개 관계(`CALL-OVERLOAD-LOCAL`) |
| D3 | `new C()`의 대상을 construct signature의 선언으로 찾는다(`analyze.ts:2099-2104`). 명시적 생성자가 있으면 그 선언이 생성자일 수 있다. 같은 파일에서는 노드 맵에 없어 edge가 빠질 수 있다. 다른 파일에서는 external 노드가 생성자 줄을 가리켜 GT(클래스 줄)와 키가 어긋날 수 있다 | P0 분류(supported)와 의미 기준 정답(대상 = 클래스)을 유지했다 | constructs in-scope 33개 중 20개(`CONS-*-EXPLICIT-CTOR`). 생성자 인자 dataflow(`DF-CONSTRUCTOR` 33개)도 같은 영향을 받을 수 있다 |
| D4 | 객체 리터럴 shorthand `{ a }`의 식별자는 TypeChecker가 속성 심볼로 해석할 수 있다. 참조 수집이 변수 선언으로 이어지지 않을 수 있다 | "supported 추정 → 검증 대상"으로 두었다 | `REF-SHORTHAND-PROPERTY` 39개(references in-scope의 28%) |
| D5 | P0 §5.1은 React custom hook, `useRef`, `useContext`를 unsupported-by-design으로 분류했다. 그러나 framework 의미(지침 §5.1)로 보면 이들은 React가 실행하는 콜백 owner나 렌더 상태 source를 **만들지 않는다**. 놓친 정답이 없다 | 이들을 positive 비지원 패턴이 아니라 **부정 사례**(`NEG-CUSTOM-HOOK`, `NEG-USEREF`, `NEG-USECONTEXT`)로 다뤘다. 이들의 호출 자체는 일반 calls로 정답에 넣었다 | P0의 "비지원" 표현과 다르다. PR #2 검토에서 부정 사례로 유지하기로 했다. 부정 사례 위반은 owner 관계 FP로만 집계된다 |
| D5a | (P1-A-R1 명확화) D5 부정 사례의 범위 | 세 부정 사례는 모두 `kind: "owner"`다. 뜻은 그 호출 줄에 React synthetic 노드(콜백 owner·상태 source)가 **생기면 안 된다**는 것이다. 같은 호출의 일반 관계는 부정하지 않는다. `h03`에서 `Widget → useContext/useRef/useToggle`의 `calls`(R10, R12, R14)와 `dataflow`(R11, R13, R15)는 정답이다. 사용자 hook 본문 안의 `useState`도 그대로 상태 source다(R03). 지침 §5.1, §7에 같은 문장을 추가했다 | GT 데이터는 바꾸지 않았다(`GT_CHANGELOG.md`). 지금의 GT가 이 해석과 이미 맞으므로 fixture나 관계를 바꿀 필요가 없다 |
| D6 | P0 §6.3은 `argIndex`를 Cogic edge id의 `arg#i`에서 추출한다고만 했다 | GT의 `argIndex`를 **값을 받는 파라미터 위치**로 정의했다(지침 §4.5). Cogic은 i번 인자와 i번 파라미터를 짝지으므로 `arg#i`가 곧 파라미터 위치다. rest 파라미터로 모이는 인자는 한 관계가 된다 | 정의의 구체화다. 모순은 아니다 |
| D7 | P0 §6.3의 lenient는 "kind 무시, 끝점만 비교"다 | dataflow(argIndex)와 owner는 lenient에서도 strict와 같게 두었다. 구조 관계의 매칭은 1:1이다. 사전 등록 시점(41bbe19)의 "다대다 매칭"은 채점 결함이었고 P1-A-R1에서 고쳤다(§12) | 구체화 |
| D8 | P0 §6.3의 "framework owner에서 나가는 관계는 별도 범주" | 범주 규칙: owner 관계와 synthetic 노드에서 나가는 관계는 framework 범주, `updates`는 항상 updates 범주(`lib.mjs` `categoryFor`) | 구체화 |
| D9 | P0 §7은 GT 검토를 사전 등록 전에 하도록 했다 | 검토자가 없어 검토 전에 사전 등록했다(§5) | 절차 순서 차이. 논문에 명시 |
| D11 | (P1-A-R1 검토 중 발견) GT의 TS lib 대상 노드는 `L\|<symbol>` 키다. 그러나 정규화기는 Cogic 노드로 `L\|` 키를 만들지 않는다. TS lib 파일의 노드는 `X\|<tslib>/<파일>\|<줄>`이 된다 | 고치지 않았다. lib 대상 GT 17개(`CALL-LIB`, `DF-LIB`, `REF-LIB`, `CONS-LIB`, 모두 unsupported-by-design, 5개 사례)는 항상 FN이 된다. Cogic이 lib 선언으로 edge를 만들면 그 예측은 FP가 된다. 코드상 Cogic은 lib 파일 대상을 제외하므로(`analyze.ts:1955`, `:2060`, `:2110`) 후자는 예상되지 않는다 | overall Recall에만 영향이 있고 in-scope 지표에는 없다. lib 노드 매핑 규칙(예: 심볼 이름 대조)을 추가할지는 측정 전에 결정해야 한다. **결정(2026-10-28): `D11_KEEP_PRE_REGISTERED_SCORING`.** 분류·정규화·GT를 그대로 두고, 실제 출력에 TS lib 대상 관계가 있으면 runner가 별도 진단으로 기록해 확증 결과의 타당성을 재검토한다([p1b-runner.md §6](p1b-runner.md#6-d11-결정)) |
| D10 | Owner 규칙. 생성자 본문과 인스턴스 필드 초기화식의 owner는 class, 데코레이터 식의 owner는 file이다(지침 §3.2, §3.4). P0에는 이 경우의 규칙이 없다. 코드상 class owner 전환 경로가 없다(`analyze.ts:2187-2225`). 메서드 데코레이터는 순회하지 않는다(`:2197-2207`) | 새 패턴 `CALL/CONS/DF-CTOR-BODY`, `*-FIELD-INIT`, `*-DECORATOR-METHOD`(unsupported-by-design)로 분리했다 | overall에만 영향 |

## 9. 사전 등록과 GT 버전 관리

- **사전 등록 커밋**: 이 브랜치에서 GT, 지침, 카탈로그, 채점 도구, 테스트, `gt-manifest.json`을 처음 커밋한 것이다. SHA는 아래 표에 후속 커밋으로 기록한다. 같은 커밋에 사전 등록 SHA를 쓸 수는 없다.

  | 항목 | 값 |
  |---|---|
  | 사전 등록 커밋(preregistrationCommit) | `41bbe19434b4d284c6368b5fb5158cf1a5dbdf1e` (2026-10-26) |
  | manifest | `fixtures/exp-01/gt-manifest.json`(LF 정규화 SHA-256, fixture·도구 파일 전체) |

- **고정 확인**:
  - GT 데이터: `node docs/thesis-experiments/tools/exp01/manifest.mjs --check --scope gt`. 사전 등록 manifest와 비교한다(*.md를 뺀 fixture 전체).
  - 평가 도구: `node docs/thesis-experiments/tools/exp01/manifest.mjs --check --manifest docs/thesis-experiments/fixtures/exp-01/eval-manifest.r1.json`. P1-A-R1 이후의 기준이다(§12).
  - P1-B 실행 도구는 측정 전에 두 검사가 모두 통과해야 시작하도록 만든다. 사전 등록 manifest 전체 대조(`--check`)는 R1 이후 의도된 차이 7개 파일을 보고한다(§12).
- **정정 절차**:
  - v1(`expected.json`)은 고치지 않는다. 정정은 `expected.v2.json` 새 파일과 `GT_CHANGELOG.md` 기록으로 별도 커밋한다(지침 §10).
  - 측정 후 오류 분석에서 발견한 정정은 "측정 후"로 표시한다.
  - 채점은 `--gt-version`으로 버전을 고르며, v1과 v2 결과를 모두 보고한다.
- **문서 갱신**: 사전 등록 이후 이 문서(`p1a-ground-truth.md`)와 상위 README의 서술을 고쳐도 manifest 대상이 아니므로 GT 고정에는 영향이 없다.
- **manifest 정책**: `gt-manifest.json`은 사전 등록 기록이므로 다시 쓰지 않는다. 도구나 지침이 바뀌면 새 manifest 파일을 만든다(`--write`는 기존 파일을 덮어쓰지 않는다).

## 10. 재현 절차

```powershell
git checkout <평가 도구 기준 커밋(§12)>
npm ci                                                        # TypeScript 5.9.3 (fixture 타입 검사용)
node docs/thesis-experiments/tools/exp01/manifest.mjs --check --scope gt   # 기대: manifest OK (214 files)
node docs/thesis-experiments/tools/exp01/manifest.mjs --check --manifest docs/thesis-experiments/fixtures/exp-01/eval-manifest.r1.json   # 기대: manifest OK
node docs/thesis-experiments/tools/exp01/validate-gt.mjs       # 기대: cases 44, errors 0, warnings 5
node docs/thesis-experiments/tools/exp01/coverage.mjs          # 기대: determinate 651, indeterminate 8, negatives 49
node docs/thesis-experiments/tools/exp01/review-sample.mjs     # 기대: population 708, sampled 146
node --test docs/thesis-experiments/tools/exp01/test/score.test.mjs   # 기대: 44 pass (사전 등록 커밋에서는 30)
```

`coverage.mjs`와 `review-sample.mjs`는 생성 파일을 덮어쓴다. 같은 입력과 seed면 같은 내용이 나오므로, 실행 후 `git diff --exit-code docs/thesis-experiments/fixtures/exp-01`로 재현을 확인할 수 있다.

P1-B 측정 명령은 실행 도구가 생기면 [exp-01-accuracy.md §13](experiments/exp-01-accuracy.md#13-reproduction-procedure) 형식으로 정한다.

```powershell
node docs/thesis-experiments/tools/exp01/score.mjs --predictions docs/thesis-experiments/data/exp-01/<run-id>/predictions --out docs/thesis-experiments/data/exp-01/<run-id>
```

## 11. P1-B 착수 준비 상태

**PARTIALLY_READY**

| 항목 | 상태 |
|---|---|
| GT·지침·카탈로그·채점 규칙 고정 | READY(사전 등록 커밋) |
| 채점 도구 | READY(`exp01-scorer/1.1`, 합성 데이터 테스트 44/44, §12). 실제 analyzer 출력 형식 대응은 P1-B 첫 실행에서 확인해야 한다. 특히 경로 표기, synthetic 노드 이름 규칙(`#n`), `arg#i` |
| 실행 도구(`exp01-run.mjs`) | **P1-B에서 구현했다([p1b-runner.md](p1b-runner.md)).** 아래는 P1-A 시점의 기록이다. 작성할 일: `analyzeWorkspaceActive({ workspaceRoot: <case dir>, filePaths, cacheEnabled: false })`를 부르고 `exp01-raw/1` 형식(`fixtureRoot` 포함)으로 저장한다. 2회 실행 해시 비교(결정성)와 캐시 OFF/ON 비교(P0 §8, §10)도 넣는다. 시작 전에 §9의 두 manifest 검사를 통과하게 한다. 결과의 `scoringStatus`가 `COMPLETE`가 아니면 확증 결과로 쓰지 않는다 |
| 사람의 독립 검토 | **미수행.** 측정 전에 검토를 마치는 것을 권장한다. 그래야 정정이 모두 "측정 전"이 된다. 불가능하면 single-annotator를 명시하고 진행한다 |
| D1–D5 해석 | 측정을 막지는 않는다. 결과 해석과 원인 코드 부여 때 사용한다 |
| D11(lib 노드 매핑) | 결정됨: `D11_KEEP_PRE_REGISTERED_SCORING`(2026-10-28). overall Recall에 고정 FN 17개가 포함되며, 이 점을 결과와 함께 보고한다 |
| 코퍼스 B(실제 오픈소스) | 미착수(P0 §5.2, 별도 단계) |

## 12. P1-A-R1: 채점 도구 수정

신규 측정 전, PR #2 코드 리뷰에서 찾은 **평가 도구 결함**을 고쳤다. GT 데이터(`expected.json`, `case.json`, fixture 소스, `catalog.csv`)는 바꾸지 않았다. 사전 등록 커밋(`41bbe19`)은 GT의 사전 등록 기준으로 그대로 유지한다. 이 수정 시점까지 신규 코퍼스에 Cogic analyzer를 실행한 적이 없고, 정확도 수치도 만든 적이 없다. 따라서 결과를 보고 규칙을 바꾼 경우에 해당하지 않는다.

| 결함 | 사전 등록 시점 동작(`exp01-scorer/1.0`) | 수정(`exp01-scorer/1.1`) | 회귀 테스트 |
|---|---|---|---|
| lenient 다중 TP | lenient에서 예측 1개가 같은 lenient 키의 GT를 모두 TP로 만들었다. 같은 끝점에 calls GT와 references GT가 있고 예측이 1개면 GT 쪽 TP가 2개였다. 예측 쪽 TP(1)와 GT 쪽 TP(2)가 달라 Recall이 부풀었다 | strict·lenient 모두 최대 이분 매칭으로 1:1만 허용한다(§6 3번, 5번) | `R1 lenient: …` 4개 |
| `targetAlternatives` 순서 의존 | strict에서도 예측 입력 순서대로 첫 빈 GT를 골랐다. 대상 후보가 겹치면 매칭 수가 최대가 아닐 수 있었고, 입력 순서에 따라 결과가 달라질 수 있었다 | 최대 매칭과 결정적 동점 규칙을 쓴다. 예측은 키 순서로 처리한다 | `R1 targetAlternatives: …` 2개, 입력 순서 무관 1개, `maximumMatching` 1개, 양쪽 TP 일치 1개 |
| 진단 오류 fail-open | 키 충돌, 잘못된 endpoint, `arg#i` 없는 dataflow, 알 수 없는 kind를 `diagnostics.json`에 적기만 했다. 그 사례는 정상 사례로 집계했다 | 해당 사례를 `SCORING_BLOCKED`로 두고 확증 집계에서 뺀다(§6 9a). 원본 진단은 `raw`와 함께 보존한다. `exp01-pred/1` 입력도 같은 검사를 받는다 | `R2 …` 5개 |
| D5 문서 | 부정 사례가 일반 관계까지 부정하는 것으로 읽힐 수 있었다 | 지침 §5.1, §7과 §8 D5a에 부정 범위를 명시했다(의미 변경 없음) | — |

strict 모드의 기존 동작은 유지된다. 사전 등록 시점의 테스트 30개는 수정 없이 모두 통과한다. 대상 후보가 겹치지 않으면 이전 greedy 매칭과 결과가 같다. 다만 사전 등록 시점의 lenient 정의(D7의 "다대다")가 바뀌었으므로, 논문에는 채점 도구 버전 `exp01-scorer/1.1`을 썼다고 명시한다.

수정 전 동작은 같은 합성 입력으로 확인했다. lenient에서 GT 2개(calls·references, 같은 끝점)와 예측 1개를 넣으면, 수정 전 도구는 GT TP 2, 예측 TP 1을 냈다. 수정 후 도구는 1과 1을 낸다.

검토 중에 D11(lib 노드 매핑)도 발견했다. 매핑 규칙을 새로 만드는 것은 채점 규칙 변경이다. 그래서 이번에는 고치지 않고 §8에 보고했다.

**평가 도구 기준 고정**:

| 항목 | 값 |
|---|---|
| GT 사전 등록 커밋 | `41bbe19434b4d284c6368b5fb5158cf1a5dbdf1e`(변경 없음) |
| 채점 도구 버전 | `exp01-scorer/1.1`(`lib.mjs` `SCORER_VERSION`, `summary.json`의 `scorerVersion`) |
| 평가 도구 기준 커밋(evaluationToolCommit) | `ae82bfbf0e26b7cba67e40af2b1f0a1fe89b81ca` (2026-10-27). 이 SHA는 후속 커밋으로 기록했다(같은 커밋에 자기 SHA를 쓸 수 없다) |
| 평가 도구 manifest | `fixtures/exp-01/eval-manifest.r1.json` |
| GT 데이터 무결성 | `manifest.mjs --check --scope gt`: 사전 등록 manifest와 214개 파일 일치 |
| 사전 등록 manifest와 다른 파일 | `tools/exp01/lib.mjs`, `score.mjs`, `manifest.mjs`, `test/score.test.mjs`, `fixtures/exp-01/ANNOTATION_GUIDE.md`, `GT_CHANGELOG.md`, `README.md`(7개, 모두 의도된 변경). GT 데이터 파일은 없다 |
