# Corpus B 독립 검토자 지침

이 문서는 Corpus B Ground Truth를 독립적으로 검토할 사람을 위한 지침이다. 검토자는 블라인드 패킷만 받는다.

## 1. 검토자 조건과 독립성

- 검토자는 사람이다. 생성형 AI나 도구의 출력은 검토 결과가 될 수 없다.
- 검토를 시작하기 전에 `independence-declaration` 항목(§7)에 서명한다. 다음을 **보지 않았고 보지 않을 것**을 확인하는 서명이다.
  - Corpus B의 기존 정답: 저장소의 `expected.json`, `corpus-b/review/*.mjs`, `REVIEW.md`, `ANNOTATION_ADDENDUM.md` 원본, `environment-audit/gt-impact-report.md`, `decision.md`
  - Cogic analyzer의 Corpus B 출력(아직 만들어지지 않았다)
  - EXP-01·Corpus B의 정확도 수치
- Cogic 구현을 읽은 적이 있으면 그 사실을 적는다. 검토자 자격을 잃는 것은 아니지만, 결과 해석에 함께 보고한다.
- 검토 중 궁금한 점은 연구자에게 묻는다. 연구자는 지침·코드에 관한 질문에만 답하고, 기존 정답은 알려 주지 않는다. 질문과 답은 `questions-log.csv`에 남긴다.

## 2. 받는 자료 (블라인드 패킷)

| 경로 | 내용 |
|---|---|
| `common/ANNOTATION_GUIDE.md` | 주석 지침 v1(EXP-01, 변경 없음) |
| `common/blind-addendum.md` | Corpus B 보충 규칙 A1–A10(사례 예시 삭제판) |
| `common/catalog.blind.csv` | 패턴 목록: ID, 종류, 극성, 지원 분류, 설명 |
| `common/reviewer-instructions.md` | 이 문서 |
| `common/blind-review-guide.md` | 검토 절차 |
| `common/review-checklist.csv` | 검토 단계(BLIND) 체크 항목 |
| `cases/<framework>/<caseId>/source/` | 사례 workspace: active file, 로컬 import closure, untyped shim, tsconfig |
| `cases/.../case-info.json` | upstream 저장소·commit·라이선스·파일별 SHA-256 |
| `cases/.../LICENSE.upstream` | upstream 라이선스 원문 |
| `cases/.../worksheet.md` | 줄 번호가 붙은 active file, import 해석표, 선언 목록, 호출 지점 목록 |
| `cases/.../sites-form.csv` | 호출 지점 처분 양식(지점 목록이 미리 채워져 있다) |
| `cases/.../relations-form.csv` | 관계 판정 양식(비어 있다) |
| `cases/.../negatives-form.csv` | 부정 사례 양식(비어 있다) |
| `PACKET_MANIFEST.json` | 패킷 파일 SHA-256. 받은 패킷이 배포본과 같은지 확인한다 |

- worksheet의 목록은 TypeScript parser로 만든 **구문 정보**다. 어떤 선언이 §2 노드인지, 어떤 지점이 무엇을 호출하는지는 적혀 있지 않다. 그 판정이 검토 내용이다.
- 코드를 TypeScript로 열어 보고 싶으면 `source/`에서 TypeScript 5.9.3로 연다(`tsconfig.json` 포함). 외부 패키지는 설치하지 않는다(A1).

## 3. 할 일

사례 20개 각각에 대해 다음을 한다.

1. active file 전체를 읽고, 지침 §4의 관계 6종을 모두 찾아 `relations-form.csv`에 적는다.
   - 관계 6종: calls, constructs, references, dataflow, owner, updates
   - 기존 정답과 맞는지 묻는 양식이 아니다. 처음부터 판정한다.
2. `sites-form.csv`의 모든 지점에 처분을 적는다. 관계를 적었으면 그 relations-form 항목 ID를 적는다.
3. 지침 §7의 부정 사례가 있으면 `negatives-form.csv`에 적는다.
4. `review-checklist.csv`에서 그 사례에 해당하는 BLIND 항목에 판정과 근거를 적는다.
5. 판정마다 **원본 코드 위치(파일:줄)와 지침 조항(§ 번호, 보충 규칙 A 번호)**을 적는다. 근거가 없는 판정은 reconciliation에서 OPEN으로 남는다.

## 4. 표기 규칙

### 4.1 endpoint (source, target)

| 표기 | 뜻 | 예 |
|---|---|---|
| `file` | active file 노드(모듈 최상위) | `file` |
| `<경로>:<줄>` | §2 노드 선언. 경로는 사례 `source/` 기준, 줄은 지침 §2의 시작 줄(데코레이터·수식어 포함, 주석 제외) | `src/api/user/userController.ts:6` |
| `lib:<이름>` | TS lib 선언(A3 이름 규칙) | `lib:Promise.then` |
| `fw:<줄>` | active file의 framework synthetic 노드(callback owner, state source, route owner). 줄은 지침 §5의 앵커 줄 | `fw:33` |
| `module:<경로>` | `import("./m")`의 module 노드 | `module:src/m.ts` |

### 4.2 relations-form.csv 열

| 열 | 값 |
|---|---|
| `caseId` | 사례 ID |
| `reviewerItemId` | 사례 안에서 고유한 ID(예: `H01`) |
| `kind` | calls / constructs / references / dataflow / owner / updates |
| `source` | §4.1 표기. owner 관계면 framework 노드(`fw:<줄>`) |
| `target` | §4.1 표기. owner면 비운다 |
| `argIndex` | dataflow만. 받는 파라미터 위치(0부터) |
| `gtStatus` | determinate / indeterminate |
| `candidates` | indeterminate만. `unbounded`, 또는 `;`로 구분한 target 목록(dataflow는 `target#argIndex`) |
| `pattern` | catalog.blind.csv의 patternId 하나 |
| `anchor` | owner만. 노드 줄에 실제로 있는 앵커 문자열 |
| `evidenceLines` | active file 줄 번호(공백 구분) |
| `siteIds` | 관련 sites-form 지점 ID(공백 구분, 없으면 비움) |
| `guideClauses` | 근거 조항. 예: `§4.1; A4` |
| `confidence` | high / medium / low |
| `note` | 판단이 어려웠던 이유, 다른 해석 |

### 4.3 sites-form.csv 처분(`disposition`)

| 값 | 뜻 |
|---|---|
| `RELATION` | 이 지점에서 관계가 하나 이상 생긴다. `relationItemIds`에 ID를 적는다 |
| `NO_NODE_TARGET` | 대상 §2 노드가 없다(A2). `reason`에 사유를 적는다 |
| `JSX_INTRINSIC` | intrinsic JSX(지침 §4.1) |
| `INDETERMINATE` | 대상이 정해지지 않는다. relations-form의 indeterminate 항목 ID를 적는다 |
| `OTHER` | 위에 해당하지 않는다. `reason` 필수 |

### 4.4 negatives-form.csv 열

`caseId, reviewerItemId, kind, source, target, pattern, anchor, evidenceLines, rationale, guideClauses`

## 5. 하지 않을 일

- 기존 정답을 찾아보거나, 다른 사람의 검토 결과를 보지 않는다.
- Cogic 등 분석 도구의 그래프 출력을 근거로 쓰지 않는다. TypeScript 컴파일러로 선언을 확인하는 것은 허용한다.
- 지원 분류(supported 등)를 결과에 유리하게 고르지 않는다. 지원 분류는 패턴으로 정해진다.

## 6. 제출

- 제출물
  - 사례별 `relations-form.csv`, `sites-form.csv`, `negatives-form.csv`
  - 작성한 `review-checklist.csv`
  - `questions-log.csv`
  - 독립성 선언(§7)
- 제출하면 상태가 `REVIEW_SUBMITTED`가 된다. 제출 후에는 양식을 고치지 않는다. 고칠 일이 생기면 reconciliation 단계에서 기록한다.

## 7. 독립성 선언 (제출물에 포함)

```
reviewer: <이름>
role: human reviewer
date: <YYYY-MM-DD>
packet: <PACKET_MANIFEST.json의 packetSha256>
target commit: <PACKET_MANIFEST.json의 sourceCommit>
I did not view the existing Corpus B GT, the reconciliation packet, analyzer outputs, or accuracy results before submitting.
I have / have not read the Cogic analyzer source code: <...>
scope reviewed: <사례 목록 또는 ALL>
```
