# P1-C: EXP-01 Ground Truth 검토 준비

- 작성일: 2026-10-29
- 기준: `main` `f09758e66b300f853d725d40f85cabce2bb745bc` (PR #4 병합 커밋)
- 상태: **검토 자료 준비 완료, 검토 미수행.** 사람의 검토 결과, 일치도, 정확도 수치는 이 문서에 없다.

이 문서는 EXP-01 정확도 측정 전에 GT(Ground Truth)를 사람이 검토하는 절차를 정리한다. 이미 있는 검토 자료(`fixtures/exp-01/review/`)를 그대로 쓴다. 새 표본을 뽑거나 기존 표본, GT, 지침, 도구를 바꾸지 않았다. 검토 결과 칸도 채우지 않았다.

검토자가 읽는 양식은 기존 [REVIEW_FORM.md](fixtures/exp-01/review/REVIEW_FORM.md)다. 이 문서는 양식에 없는 보충 설명, 연구자용 절차, 남은 결정을 담는다. `REVIEW_FORM.md`는 manifest 대상 파일이라 고치지 않았다.

---

## 1. 연구 기준과 고정 커밋

| 항목 | 값 |
|---|---|
| Repository | `ppsssj/Cogic` |
| 기준 브랜치 | `main` = `f09758e66b300f853d725d40f85cabce2bb745bc` (2026-10-29 fetch 후 확인) |
| GT 사전 등록 커밋 | `41bbe19434b4d284c6368b5fb5158cf1a5dbdf1e` (2026-10-26) |
| 평가 도구 기준 커밋 | `ae82bfbf0e26b7cba67e40af2b1f0a1fe89b81ca` (P1-A-R1) |
| 채점 도구 | `exp01-scorer/1.1` |
| 실행 도구 | `exp01-runner/1.1` |
| GT 버전 | v1 (`expected.json`). v2는 없다 |
| GT manifest | `fixtures/exp-01/gt-manifest.json` (사전 등록 기록, 다시 쓰지 않음) |
| 평가 도구 manifest | `fixtures/exp-01/eval-manifest.r1.json` |
| 검토 표본 seed | `20261026` |

## 2. 현재 fixture·GT 상태

| 항목 | 값 | 확인 방법 |
|---|---|---|
| fixture | 44개(모든 폴더 이름 = `case.json`의 `caseId`) | §8 감사 |
| determinate 관계 | 651개 | `coverage.mjs`, [p1a-ground-truth.md §2](p1a-ground-truth.md#2-코퍼스-요약) |
| indeterminate 관계 | 8개 | 같음 |
| 부정 사례(negatives) | 49개 | 같음 |
| 검토 모집단 | 708개 = 651 + 8 + 49 | `sample.json`의 `population` |
| 사람 검토 기록 | 없음. 44개 `case.json` 모두 `humanReviewed: false`, `reviewStatus: "not-reviewed"`, `reviewNotes: []` | §8 감사 |
| GT 작성자 | Claude Code(생성형 AI, 모델 claude-opus-5-5). 사람이 작성하거나 검토한 항목은 없다 | [p1a-ground-truth.md §4](p1a-ground-truth.md#4-생성형-ai-활용-범위) |
| 작성자의 구현 지식 | 있다. 작성자는 Cogic 구현 소스를 읽었다(지원 분류 목적) | [ANNOTATION_GUIDE.md §1](fixtures/exp-01/ANNOTATION_GUIDE.md#1-기본-원칙) 6번 |
| `GT_CHANGELOG.md` | v1 최초 작성, v1 지침 명확화(P1-A-R1, GT 데이터 변경 없음) 2건 | [GT_CHANGELOG.md](fixtures/exp-01/GT_CHANGELOG.md) |

## 3. Blind 검토 표본 구성

### 3.1 추출 방식

- 도구: `tools/exp01/review-sample.mjs` (사전 등록 커밋에 포함)
- 모집단: GT v1의 관계와 부정 사례 전체 708개. 하나의 항목이 한 행이다.
  - determinate 관계 → 정답 키 `exists`
  - indeterminate 관계 → 정답 키 `undeterminable`
  - 부정 사례 → 정답 키 `not-exists`
- 층화: 범주(관계 종류, framework owner는 framework별)마다 `ceil(모집단 × 0.2)`개를 seed `20261026 + 범주 순서`로 무작위 추출했다.
- 섞기: 추출한 146개를 seed `20261026 + 1000`으로 다시 섞어 `S001`–`S146`을 붙였다. 행 순서로 범주나 정답을 추측할 수 없게 하기 위해서다.
- 분리: 검토자용 `review-sheet.csv`에는 정답 열이 없다. 정답은 `review-key.csv`에만 있다.

### 3.2 범주별 분포

| 범주 | 모집단 | 표본 | 비율 |
|---|---:|---:|---:|
| calls | 156 | 32 | 20.5% |
| constructs | 44 | 9 | 20.5% |
| dataflow | 188 | 38 | 20.2% |
| express-route-owner | 31 | 7 | 22.6% |
| nest-route-owner | 25 | 5 | 20.0% |
| react-hook-owner | 27 | 6 | 22.2% |
| references | 161 | 33 | 20.5% |
| updates | 43 | 9 | 20.9% |
| vue-hook-owner | 33 | 7 | 21.2% |
| **합계** | **708** | **146** | **20.6%** |

- 표본은 44개 fixture 중 40개에서 나왔다. 나머지 4개는 표본에 항목이 없다.
- 행의 `kind` 분포: calls 36, references 36, dataflow 41, constructs 9, updates 9, owner 15. framework 범주의 행은 `calls`·`references` 같은 관계이거나 `owner`(노드 존재)다.
- 15개 행은 근거 위치(`sites`)가 두 곳 이상이다.
- 표본 안의 정답 분포(`exists`/`not-exists`/`undeterminable` 개수)는 이 문서에 적지 않았다. `review-key.csv`를 열어야 알 수 있고, 검토 전에 알려지면 blind가 깨진다.

### 3.3 알려진 blind 한계

- 2개 행은 `target`이 `(후보를 열거할 수 없는 호출 대상)`으로 표시된다. 이 표기는 GT가 그 항목을 indeterminate로 본다는 것을 사실상 드러낸다. 표본과 시트는 사전 등록 대상이라 바꾸지 않는다. 이 2개 행은 결과 보고 때 따로 표시한다(§6.3).
- `owner` 행 15개는 `target`이 `(노드 존재 여부)`다. 관계 종류만 알려 줄 뿐 정답은 드러내지 않는다.
- 저장소 전체(git 이력 포함)에는 정답이 들어 있다. 검토자에게는 저장소가 아니라 §4.1의 검토 묶음만 준다.

## 4. 검토자용 실행 절차

검토자에게 줄 문서는 [REVIEW_FORM.md](fixtures/exp-01/review/REVIEW_FORM.md)와 [ANNOTATION_GUIDE.md](fixtures/exp-01/ANNOTATION_GUIDE.md)다. 아래는 연구자가 검토를 준비하고 진행하는 절차와, 양식에 없는 보충 안내다. 보충 안내는 지침의 정의를 바꾸지 않는다.

### 4.1 검토 묶음 만들기(연구자)

검토자에게 저장소를 주지 않고, 정답이 없는 파일만 저장소 밖 폴더에 복사해서 준다.

```powershell
# 저장소 루트에서 실행. 대상 폴더는 저장소 밖이어야 한다.
$dst = "$env:USERPROFILE\exp01-review-bundle"
robocopy docs\thesis-experiments\fixtures\exp-01 $dst /E `
  /XF expected*.json review-key.csv case.json catalog.csv coverage.json COVERAGE.md validation-report.json gt-manifest.json eval-manifest.r1.json GT_CHANGELOG.md README.md `
  /XD filled
# robocopy는 복사 성공 시 종료 코드 1을 돌려준다.
```

이 명령을 2026-10-29에 임시 폴더로 시험했다. 결과는 125개 파일이었다.

- 포함: fixture 소스(`.ts` 75개, `.tsx` 2개), `tsconfig.json` 44개, `ANNOTATION_GUIDE.md`, `review/REVIEW_FORM.md`, `review/review-sheet.csv`, `review/sample.json`
- 제외 확인: `expected*.json`, `review-key.csv`, `case.json`, `catalog.csv`, 커버리지, manifest 파일은 0개

`case.json`은 정답은 아니지만 사례 설명(`description`)에 관계 종류에 대한 힌트가 있어 뺐다. 묶음에 대한 검토 지시는 다음과 같다.

- 묶음 밖의 저장소 파일, `p1a-ground-truth.md`, 채점 도구 테스트, Cogic 실행 결과를 보지 않는다.
- 묶음 안의 지침 링크 중 묶음 밖을 가리키는 것(예: `p1a-ground-truth.md`)은 열지 않는다.

### 4.2 검토 순서(검토자)

1. **지침 읽기**: `ANNOTATION_GUIDE.md` §1–§7을 먼저 읽는다. 관계와 owner의 정의는 이 지침이 기준이다. 특히 다음 절을 본다.
   - §2: 무엇이 노드인가
   - §3: owner 결정, 이름 없는 콜백은 투명하다
   - §6.2: 결정성
   - §7: 부정 사례
2. **행 하나씩 판정**: `review-sheet.csv`의 각 행에서 다음을 확인한다.
   1. `caseId` 폴더를 연다. 폴더는 범주 폴더 아래에 있다. 예: `calls/c01-local-direct/`.
   2. `sites`의 `파일:줄`을 연다. 여러 곳이면 ` ; `로 구분되어 있다. `siteText`는 그 줄의 사본일 뿐이므로 반드시 원본 파일의 앞뒤 문맥을 본다.
   3. `source`와 `target`이 가리키는 선언을 찾는다. 형식은 `파일:줄 종류 이름`이다. `shims/*.d.ts`, `lib/*.ts` 같은 다른 파일이나 `TS lib: <기호>`일 수 있다.
   4. 지침의 정의만으로 판정한다. 판단 근거는 `reviewerComment`에 적는다.
3. **판정 값 기록**: §4.3을 따른다.
4. **제출**: §4.6을 따른다.

다른 검토자와 상의하지 않는다. 같은 fixture의 다른 행을 함께 보는 것은 괜찮다.

### 4.3 판정 값 정의

| 값 | 정의 | 고르는 경우 |
|---|---|---|
| `exists` | 지침의 정의상 이 행의 관계 `(kind, source, target[, argIndex])`가 존재한다. `owner` 행이면 그 framework 노드가 존재한다 | 출발 노드, 도착 노드, 관계 종류, `argIndex`가 모두 지침과 맞을 때 |
| `not-exists` | 이 관계는 존재하지 않는다 | 관계 자체가 없거나, 관계는 있지만 `source`(owner)·`target`·`argIndex` 중 하나가 지침과 다를 때 |
| `undeterminable` | 소스만으로 관계의 존재 여부나 도착 대상을 하나로 정할 수 없다(지침 §6.2) | 대상이 런타임 값·동적 디스패치·fixture 밖에서 공급되는 값에 따라 달라질 때 |

행별 보충 규칙(지침 정의를 그대로 적용한 것이다):

- **owner가 다르면 `not-exists`**: 예를 들어 지침 §3에 따르면 콜백 안의 호출은 감싸는 함수가 owner인데, 행의 `source`가 다른 노드라면 `not-exists`다. `reviewerComment`에 맞다고 보는 owner를 적는다.
- **줄 번호만 다르면**: 같은 선언을 가리키지만 줄 번호가 지침 §2의 줄 규칙과 다르면, 판정은 `exists`/`not-exists` 중 지침대로 고르고 그 차이를 코멘트에 적는다. 사후 논의에서 GT 오류인지 판단한다.
- **`target`이 `(후보를 열거할 수 없는 호출 대상)`이거나 후보가 `|`로 여러 개인 행**: "소스만 보고 도착 대상을 하나로 정할 수 있는가"를 판정한다. 정할 수 없으면 `undeterminable`이다. 하나로 정할 수 있다고 보면 `exists`로 표시하고 그 대상을 코멘트에 적는다.
- **`owner` 행**: 지침 §5의 조건(해당 framework 모듈에서 가져온 것인지 등)에 맞는 framework 노드가 그 위치에 있어야 하는지를 판정한다. 같은 위치의 `calls`·`references`는 따로 판정하지 않는다(지침 §7).
- **부정 사례인지 추측하지 않는다**: 시트에는 정답 방향이 없다. 모든 행을 같은 기준으로 판정한다.

### 4.4 `reviewerConfidence` 기록

| 값 | 기준 |
|---|---|
| `high` | 지침의 해당 조항이 분명하고, 소스를 확인한 결과 다른 해석의 여지가 없다 |
| `medium` | 판정은 내렸지만 지침 조항 해석이나 TypeScript 의미에 약간의 불확실성이 있다 |
| `low` | 지침이 이 경우를 직접 다루지 않거나, 둘 이상의 판정이 그럴듯하다 |

`low`이면 `reviewerComment`에 어느 조항이 모호한지와, 다른 후보 판정을 함께 적는다.

### 4.5 판단하기 어려운 사례

1. **빈칸으로 두지 않는다.** 빈칸은 "미검토"로 집계되어 κ 계산에서 빠진다. 가장 그럴듯한 값을 고르고 `reviewerConfidence: low`와 코멘트를 남긴다.
2. **지침 자체가 틀렸다고 보면** 지침대로 판정하고, 코멘트 앞에 `[GUIDE]`를 붙여 이유를 적는다. 지침을 바꾸는 판단은 검토자가 하지 않는다.
3. **표본 행이 이해되지 않으면**(노드 설명이 소스와 맞지 않는 등) `not-exists` 또는 `undeterminable` 중 지침에 가까운 값을 고르고, 코멘트 앞에 `[ROW]`를 붙인다.
4. **TypeScript 의미가 확실하지 않으면** 검토자가 직접 `tsc`나 편집기로 타입을 확인해도 된다. Cogic은 실행하지 않는다.
5. **판정을 바꿨다면** 마지막 판정만 남긴다. 바꾼 이유는 코멘트에 적어도 된다.

### 4.6 제출

1. 원본 `review-sheet.csv`는 고치지 않는다. 복사본에 `reviewerLabel`, `reviewerConfidence`, `reviewerComment`, `reviewerId`, `reviewedAt`(YYYY-MM-DD)을 채운다. 다른 열은 바꾸지 않는다.
2. 파일 이름은 `<reviewerId>-review-sheet.csv`로 한다. UTF-8로 저장한다. Excel에서 저장하면 인코딩과 따옴표가 바뀔 수 있으므로 저장 후 첫 줄 열 이름이 그대로인지 확인한다.
3. 연구자에게 전달한다. 연구자는 이 파일을 `docs/thesis-experiments/fixtures/exp-01/review/filled/`에 둔다.
   - 이 폴더는 manifest 검사 대상에서 빠진다(`manifest.mjs`의 `walk`가 `review/filled`를 건너뜀). 두 manifest 검사는 그대로 통과한다.
   - 다만 커밋하지 않은 채로 두면 실행 도구의 dirty 검사가 측정을 막는다. 측정 전에 별도 커밋으로 넣는다.
4. 검토자가 정답 키를 본 적이 있으면 그 사실을 함께 알린다. 그 검토 결과는 blind 검토로 보고하지 않는다.

## 5. 검토 방식과 연구 윤리

두 방식 중 무엇을 최종 채택할지는 사용자(연구자)가 정한다. 이 문서는 두 방식을 모두 준비해 둔다.

### 5.1 방식 A: 독립적인 사람 검토자를 확보한 경우

1. 검토자를 정하고, 검토자가 GT 작성(생성형 AI)과 이 저장소 작업에 관여하지 않았는지 기록한다. 예: 지도교수, 동료.
2. 검토자는 Cogic analyzer 출력과 GT 정답(`expected.json`, `review-key.csv`)을 보지 않는다. §4.1의 묶음만 쓴다.
3. 고정된 146개 표본 전체를 검토한다. 표본을 추가하거나 빼지 않는다.
4. 소스코드와 사전 작성된 `ANNOTATION_GUIDE.md`만으로 판정한다.
5. 모든 행에 `reviewerId`와 `reviewedAt`을 남긴다.
6. 검토 후 연구자가 `review-agreement.mjs`로 일치도를 계산한다(§6).
7. 불일치를 정답 오류, 지침 모호성, 판단 차이로 분류한다(§6.4).
8. 실제로 검토가 끝나기 전에는 어느 문서에도 "검토 완료"나 일치도 값을 쓰지 않는다.

보고할 때 주의할 점:

- 이 κ는 **"생성형 AI가 작성한 GT"와 "사람 검토자 1명"의 일치도**다. 사람 두 명 사이의 주석자 간 일치도가 아니다. 논문에는 이 구성을 그대로 쓴다.
- 검토 시점을 기록한다. GT 사전 등록(2026-10-26) 뒤, 그리고 첫 측정 전인지 후인지를 적는다.

### 5.2 방식 B: 독립 검토자를 확보하지 못한 경우

1. GT가 생성형 AI(Claude Code)에 의해 작성되었다고 명시한다.
2. 독립적인 사람 검토가 없었다고 명시한다. 이 사실은 이후 단계에서도 바꾸지 않는다.
3. 연구자가 직접 다시 확인했다면 수행 날짜, 범위(146개 표본 전체, 일부, 또는 다른 범위), 방법을 사실대로 기록한다.
   - 연구자는 GT 작성자가 아니다. 따라서 이것을 "작성자의 자기 재검토"라고 부르지 않는다. "연구자 사후 검토"처럼 원 작성자와 구분되는 이름을 쓴다.
   - 연구자는 Cogic 개발자이고 실행 도구 작업을 보았으므로 독립 검토자가 아니다. 이 점도 함께 적는다.
   - 연구자 검토도 `review-sheet.csv` 형식으로 기록할 수는 있다. 그래도 그 결과를 "독립 검토"나 "주석자 간 일치도"로 보고하지 않는다.
4. 사람 검토 결과가 없으면 Cohen's κ를 계산하거나 추정하지 않는다. "κ 해당 없음"으로 쓴다.
5. single-annotator GT와 독립 검증 부재를 논문의 타당성 위협으로 명시한다. 관련 위험은 [risks-and-limitations.md](risks-and-limitations.md) R-21이다.

P0 계획([exp-01-accuracy.md §7](experiments/exp-01-accuracy.md#7-execution-procedure) 4번)과 `REVIEW_FORM.md` §5는 2인 검토가 불가능할 때 "작성 후 48시간 뒤 자기 재검토"를 제안한다. 이 문장은 사람이 GT를 작성한다고 가정했다. P1-A GT는 생성형 AI가 작성했으므로 그대로 적용할 수 없다. 방식 B에서는 위 3번 규칙을 따른다. 두 문서는 manifest 대상이므로 고치지 않고, 이 차이를 여기와 논문 방법 절에 적는다.

### 5.3 두 방식 공통

- AI가 만든 판정을 사람의 검토 결과로 기록하지 않는다. 이 문서 작성(Claude Code)도 검토 결과를 만들지 않았다.
- `reviewerLabel`, `reviewerId`, `reviewedAt`은 실제로 판정한 사람만 채운다.
- 검토 방식, 검토자 수, 검토 시점, 측정 전/후 여부를 결과와 함께 보고한다([exp-01-accuracy.md §14](experiments/exp-01-accuracy.md#14-acceptance-criteria) "GT 검토 방식이 명시되었다").

## 6. 일치도 계산과 불일치 처리

### 6.1 계산 명령

```powershell
node docs/thesis-experiments/tools/exp01/review-agreement.mjs `
  --sheet docs/thesis-experiments/fixtures/exp-01/review/filled/<reviewerId>-review-sheet.csv `
  --key docs/thesis-experiments/fixtures/exp-01/review/review-key.csv `
  --json docs/thesis-experiments/fixtures/exp-01/review/filled/<reviewerId>-agreement.json
```

도구(`review-agreement.mjs`, 사전 등록 커밋에 포함)는 다음 일을 한다.

- 시트와 키를 `sampleId`로 맞춘다.
- `reviewerLabel`이 빈 행은 `unreviewed`로 세고 일치 계산에서 뺀다.
- 허용 값(`exists`/`not-exists`/`undeterminable`) 밖의 값과 키에 없는 `sampleId`는 `invalid`로 센다.
- 검토된 행의 GT 라벨과 검토자 라벨로 Cohen's κ를 계산한다. 전체와 범주별 값을 낸다. 결과에는 `observed`(관찰 일치율), `expected`(우연 일치율), `kappa`, `disagreements` 목록이 있다.
- 기대 일치율이 1이면(예: 범주 안 라벨이 모두 같음) `kappa`는 `null`이다.

### 6.2 계산 전 확인

1. `unreviewed`와 `invalid`가 모두 0인지 본다. 0이 아니면 검토자에게 다시 확인한 뒤 계산한다. 그래도 남으면 그 수를 보고한다.
2. 키 파일이 사전 등록본인지 확인한다. `manifest.mjs --check --scope gt`가 `manifest OK (214 files …)`이어야 한다.

### 6.3 보고 방법(권장, 결과를 보기 전에 확정할 것)

- 전체 κ와 함께 관찰 일치율, 3×3 혼동 행렬(GT 라벨 × 검토자 라벨)을 보고한다.
  - 모집단의 92%(651/708)가 `exists`라 라벨 분포가 한쪽으로 치우친다. 이런 경우 관찰 일치율이 높아도 κ는 낮게 나올 수 있다.
  - 혼동 행렬은 `agreement.json`의 `reviewed` 수와 `disagreements`로 만들 수 있다. 도구는 바꾸지 않는다.
- 범주별 κ는 표본이 5–38개라 불안정하다. 기술 통계로만 쓰고 확증 판정에 쓰지 않는다. `null`은 "계산 불가"로 적는다.
- §3.3의 2개 행(대상 표기로 정답 방향이 드러난 행)은 포함한 값과 제외한 값을 모두 적는다.
- κ 해석 기준(예: Landis–Koch 구간)과 "GT 품질 충분" 판단 기준을 쓸지는 검토 결과를 보기 전에 정한다(§9).

### 6.4 불일치 처리

모든 불일치(`disagreements`)에 다음 원인 중 하나를 붙인다. 판단은 GT 작성 측(연구자)과 검토자가 함께 하고, 둘 다 기록한다.

| 원인 코드 | 의미 | 후속 조치 |
|---|---|---|
| `GT-ERROR` | 지침대로라면 GT가 틀렸다 | v2 정정 후보(§7) |
| `GUIDE-AMBIGUOUS` | 지침이 이 경우를 분명히 정하지 않아 둘 다 가능하다 | 지침 개정 후보. v1 결과는 그대로 두고 한계로 보고 |
| `REVIEWER-DIFF` | 지침은 분명하지만 검토자가 다르게 판정했다 | GT 유지. 사유 기록 |

- 원인 분류는 Cogic 출력을 보지 않고 한다. 측정 후에 분류하면 그렇다고 표시한다.
- 불일치 목록, 원인 코드, 결정 내용은 `review/filled/<reviewerId>-disagreements.md`(manifest 비대상) 같은 별도 기록으로 남긴다. 파일 이름은 실제 검토 때 정한다.
- κ는 원래 판정으로 계산한 값만 보고한다. 논의 뒤에 검토자 판정을 고쳐 κ를 다시 계산하지 않는다.

## 7. GT v1 보존과 v2 정정 절차

### 7.1 이번 단계에서 바꾸지 않은 것

`expected.json`, `case.json`, `catalog.csv`, `ANNOTATION_GUIDE.md`, `REVIEW_FORM.md`, `review-sheet.csv`, `review-key.csv`, `sample.json`, `gt-manifest.json`, `eval-manifest.r1.json`, `tools/exp01/` 전체, `tools/exp01-run.mjs`, production 코드(`src/`)는 그대로다. 이 PR의 변경은 이 문서와 README 색인뿐이다.

### 7.2 정정 절차(향후)

[ANNOTATION_GUIDE.md §10](fixtures/exp-01/ANNOTATION_GUIDE.md#10-수정과-버전-관리)을 따른다.

1. v1(`expected.json`)은 고치지 않는다.
2. 정정이 필요한 사례에 `expected.v2.json`(`gtVersion: 2`)을 만든다.
3. `GT_CHANGELOG.md`에 다음을 기록한다.
   - 사례
   - 항목
   - 변경 전·후
   - 사유(§6.4 원인 코드 포함)
   - 발견 경위(예: "P1-C 사람 검토, 검토자 <id>")
   - 측정 전/후
4. 별도 커밋으로 넣는다.
5. 결과는 v1(사전 등록 기준)과 v2(사후 정정)를 둘 다 보고한다. 확증 결과는 v1 기준이며, v2는 "사후 정정 결과"로 표시한다.

### 7.3 v2 도입 전에 확인된 도구 제약

기존 도구 코드를 읽어 확인한 사항이다. 도구는 바꾸지 않았다.

| 제약 | 근거 | 영향 |
|---|---|---|
| `score.mjs --gt-version 2`는 모든 사례에서 `expected.v2.json`을 읽는다 | `score.mjs`의 `scoreCorpus`가 사례마다 `gtFileName(gtVersion)` 파일을 읽고, 파일이 없으면 예외가 난다 | 정정이 일부 사례뿐이어도 44개 사례 모두에 v2 파일이 필요하다. 정정 없는 사례는 v1 내용을 `gtVersion: 2`로 옮긴다. 다른 방법은 도구 개정이다 |
| v2 파일을 넣으면 `--scope gt` 검사가 `added …/expected.v2.json`을 보고한다 | `manifest.mjs`는 기록에 없는 파일을 `added`로 셈 | 실행 도구 preflight가 실패한다(`exp01-run.mjs`는 `gt-manifest.json`과 `eval-manifest.r1.json`을 고정으로 검사) |
| `GT_CHANGELOG.md` 수정은 `eval-manifest.r1.json` 검사(`scope all`)에서 `changed`가 된다 | `*.md`는 `scope gt`에서만 빠짐 | 위와 같다 |
| 실행 도구는 채점 시 GT 버전을 넘기지 않는다 | `exp01-run.mjs`에 `--gt-version` 인자가 없음 | 실행 도구는 v1으로만 채점한다. v2 채점은 저장된 `predictions/`에 `score.mjs --gt-version 2`를 따로 실행한다 |

따라서 v2를 만들려면 다음이 별도 PR로 필요하다.

- 새 manifest(예: `gt-manifest.v2.json`). 기존 manifest는 다시 쓰지 않는다.
- 실행 도구 manifest 경로 개정(`exp01-runner/1.2` 등)

이 개정은 측정 전에 하는 것이 좋다(§9).

## 8. 검증 결과

모두 2026-10-29, `main` `f09758e`에서 새로 만든 브랜치 `research/thesis-p1c-review-readiness`(작업 트리 깨끗함)에서 실행했다.

### 8.1 무결성과 테스트

| 명령 | 기대 | 결과 |
|---|---|---|
| `node docs/thesis-experiments/tools/exp01/manifest.mjs --check --scope gt` | 214개 일치 | `manifest OK (214 files; …gt-manifest.json, scope gt)` |
| `node docs/thesis-experiments/tools/exp01/manifest.mjs --check --manifest docs/thesis-experiments/fixtures/exp-01/eval-manifest.r1.json` | 227개 일치 | `manifest OK (227 files; …eval-manifest.r1.json, scope all)` |
| `node --test docs/thesis-experiments/tools/exp01/test/score.test.mjs` | 44 pass | 44 pass / 0 fail |
| `node --test docs/thesis-experiments/tools/test/exp01-run.test.mjs` | 30 pass | 30 pass / 0 fail (mock analyzer, 합성 입력) |
| `npm run compile` | 성공 | 종료 코드 0 |
| `npm run lint` | 성공 | 종료 코드 0 |
| `node docs/thesis-experiments/tools/exp01/validate-gt.mjs` | cases 44, errors 0, warnings 5 | `cases 44, errors 0, warnings 5` |
| `docs/thesis-experiments/data/` | `p0`만 존재 | `p0`만 존재(`exp-01` 없음) |

### 8.2 검토 표본 감사(읽기 전용)

임시 폴더의 감사 스크립트로 확인했다. `review-key.csv`는 `sampleId` 열 집합 비교와 파일 해시 비교에만 썼다. 정답 열은 읽거나 출력하지 않았다.

| 항목 | 결과 |
|---|---|
| 1. 표본 수 | 146행 = `sample.json`의 `sampled` 146, 모집단 708 |
| 2. `sampleId` 중복 | 없음(고유 146개, `S001`–`S146`) |
| 3. `caseId` 일치 | 146행 모두 실제 fixture 폴더(44개 중 40개)와 일치. 폴더 이름과 `case.json`의 `caseId`도 44개 모두 일치 |
| 4. 범주별 층화 | 시트의 범주별 개수 = `sample.json` = `ceil(모집단 × 0.2)`, 9개 범주 모두(§3.2) |
| 5. 검토 결과 칸 | 146행 × 5열(`reviewerLabel`, `reviewerConfidence`, `reviewerComment`, `reviewerId`, `reviewedAt`) 모두 비어 있음. `review/filled/` 폴더 없음 |
| 6. 양식 일치 | 시트 열 14개가 `REVIEW_FORM.md` §2–§3의 설명과 일치. 판정 값 3종이 `REVIEW_FORM.md`, `sample.json`의 `labels`, `review-agreement.mjs`의 `LABELS`에서 같음. 시트에 정답 성격의 열(`gtLabel`, `gtStatus`, `gtPattern`, `itemId`, `itemType`) 없음 |
| 7. 검토 완료 주장 | 없음. `REVIEW_FORM.md`는 "검토 전", `p1a-ground-truth.md` §5·§11과 `p1b-runner.md` §9는 "미수행", 44개 `case.json`은 `humanReviewed: false`·`not-reviewed` |
| 근거 위치 | 모든 `sites`가 실제 파일과 줄을 가리키고, `siteText`가 그 줄과 일치 |
| 키 대응 | `review-key.csv` 146행, `sampleId` 집합이 시트와 같음 |
| 재현성 | `review-sample.mjs --out <임시 폴더>`로 다시 만든 `review-sheet.csv`, `review-key.csv`, `sample.json`이 저장소 파일과 같음(LF 정규화 SHA-256). 임시 폴더는 확인 후 지움 |

### 8.3 기존 문서 일관성

| 문서 | 확인 결과 |
|---|---|
| `experimental-design.md` | 있음. 검토 절차와 어긋나는 서술 없음 |
| `experiments/exp-01-accuracy.md` | 있음. §7 4번이 "GT 검토 → 사전 등록" 순서와 "자기 재검토"를 가정한다. 실제로는 검토 전에 사전 등록했고(`p1a-ground-truth.md` §5에 기록됨), 작성자는 생성형 AI다(§5.2) |
| `fixtures/exp-01/ANNOTATION_GUIDE.md` | 있음. §10 정정 규칙이 이 문서 §7과 같음 |
| `fixtures/exp-01/review/REVIEW_FORM.md` | 있음. 표본 수, seed, 판정 값, 제출 경로가 실제 파일과 일치. §5의 "자기 재검토"는 위와 같은 차이가 있음 |
| `review-sheet.csv`, `sample.json` | 있음. §8.2 |
| `tools/exp01/review-agreement.mjs` | 있음. 단위 테스트(`agreement counts empty reviewer labels as unreviewed…`)가 `score.test.mjs`에 포함되어 통과 |
| `p1a-ground-truth.md`, `p1b-runner.md` | 있음. 검토 상태를 "미수행"으로 기록 |

## 9. 실제 실험 착수 전에 남은 결정

| # | 결정 | 선택지 | 권장 |
|---|---|---|---|
| R1 | 검토 방식 | 방식 A(독립 사람 검토) / 방식 B(검토자 없음, single-annotator 명시) | A. 검토자를 확보할 수 있다면 측정 전에 수행 |
| R2 | 검토 시점 | 측정 전 / 측정 후 | 측정 전. 그래야 모든 정정이 "측정 전"이 되고 출력에 영향을 받지 않는다 |
| R3 | 검토자 | 이름·소속·GT 작업과의 독립성 | 지도교수 또는 이 저장소 작업에 관여하지 않은 동료 |
| R4 | 일치도 해석·보고 기준 | κ 해석 구간, 관찰 일치율·혼동 행렬 병기, §3.3 2개 행 처리 | 검토 결과를 보기 전에 §6.3대로 확정 |
| R5 | v2 정정 시 도구 개정 | 정정 없는 사례도 v2 파일 생성 / 채점 도구가 v1로 대체하도록 개정. 새 GT manifest와 실행 도구 manifest 경로 개정(§7.3) | 정정이 생기면 측정 전에 별도 PR로 개정하고, 기존 manifest는 보존 |
| R6 | 방식 B의 연구자 사후 검토 | 수행 여부, 범위, 기록 형식 | 수행한다면 날짜·범위를 기록하고 "독립 검토"로 부르지 않음 |
| R7 | 검토 결과 커밋 | `review/filled/` 커밋 시점 | 측정 전에 별도 커밋(dirty 검사 때문) |

검토 외의 착수 조건은 [p1b-runner.md §9](p1b-runner.md#9-p1-b-실제-측정-착수-조건)를 따른다. 깨끗한 작업 트리, `npm run compile`, `confirmatory.eligible: true`가 그 조건이다.

## 10. 논문 제5장 방법론 설명 초안

아래 초안에는 측정값이나 검토 결과가 없다. `[ ]` 안은 실제 수행 후 채우거나 고를 부분이다. 실제 수행 전에는 채우지 않는다.

> **5.x 정답 집합(Ground Truth)의 구성과 검증**
>
> 관계 분석 정확도 평가는 마이크로 fixture 44개로 이루어진 코퍼스 A를 사용했다. 각 fixture에 대해 정답 관계 집합을 사전에 작성했다. 정답은 TypeScript 소스의 정적 의미와 사전 작성한 주석 지침서(Annotation Guide v1)의 정의로만 정했다. 정답 작성자는 해당 fixture에 Cogic을 실행하거나 그 출력을 보지 않았다.
>
> 정답 집합은 생성형 AI(Claude Code)가 작성했다. 작성자는 지원 범위 분류를 위해 Cogic 구현 소스를 읽었으므로, 정답 정의가 구현 동작에 끌려갈 위험이 있다. 이 위험을 줄이기 위해 관계를 구현과 무관한 의미로 정의했고, 정답 집합·지침·채점 규칙을 첫 측정 전에 한 커밋(`41bbe19`)으로 사전 등록했다.
>
> 정답 집합 v1은 결정 가능한 관계 651개, 결정 불가능한(indeterminate) 관계 8개, 부정 사례 49개로 구성된다. 결정 불가능한 관계는 확증 지표에서 제외하고 별도로 보고했다.
>
> 정답 검증을 위해 전체 708개 항목에서 관계 범주별로 20% 이상(합계 146개, 20.6%)을 고정 seed(`20261026`)로 층화 무작위 추출했다. 검토 시트에는 정답을 넣지 않았고, 정답 키는 별도 파일로 분리했다. 표본 추출 도구와 표본은 사전 등록 커밋에 포함되었다. 원래 계획은 검토 후 사전 등록이었으나, 검토자가 정해지지 않아 사전 등록을 먼저 했다. 검토에서 발견된 정정은 v1을 고치지 않고 별도 버전(v2)으로 기록했다.
>
> **[방식 A를 채택한 경우]** 정답 작성에 관여하지 않은 검토자 [ ]명([역할])이 [날짜]에 표본 146개를 소스코드와 주석 지침만으로 판정했다(`exists`/`not-exists`/`undeterminable`). 검토자는 Cogic 출력과 정답 키를 보지 않았다. 검토는 첫 측정 [전/후]에 이루어졌다. 정답 키와 검토자 판정 사이의 일치도를 Cohen's κ로 계산했다. 이 값은 생성형 AI가 작성한 정답과 사람 검토자 사이의 일치도이며, 사람 주석자 두 명 사이의 일치도가 아니다. 라벨 분포가 한쪽으로 치우쳐 있어 관찰 일치율과 혼동 행렬을 함께 보고했다. 불일치 항목은 정답 오류, 지침 모호성, 판단 차이로 분류했다. 정답 오류로 판정된 항목은 v2로 정정했고, 결과는 v1(사전 등록 기준)과 v2(사후 정정)를 모두 제시했다.
>
> **[방식 B를 채택한 경우]** 독립적인 사람 검토자를 확보하지 못해 정답 집합은 단일 주석자(single-annotator) 정답으로 남았다. 정답은 생성형 AI가 작성했고, 독립적인 사람 검토는 이루어지지 않았으므로 주석자 간 일치도는 보고하지 않는다. [연구자가 [날짜]에 [범위]를 사후 확인했다. 연구자는 정답 작성자가 아니며, Cogic 개발자이므로 독립 검토자로 보지 않는다.] 이 점은 6장 타당성 위협에서 다룬다.

타당성 위협 절(제6장 등)에 넣을 항목:

- 정답 작성자가 생성형 AI이며 구현 소스를 읽었다(구성 타당성).
- 방식 B라면 독립 검증이 없다. 방식 A라도 검토자가 1명이고, 검토 표본은 전체의 20.6%다.
- 검토 시트의 2개 행은 대상 표기로 정답 방향이 드러난다(§3.3).
- 사전 등록이 검토보다 먼저 이루어졌다.
