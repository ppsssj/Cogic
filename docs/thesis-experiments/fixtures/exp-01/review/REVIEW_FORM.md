# EXP-01 Ground Truth 독립 검토 양식

- 상태: **검토 전** (2026-10-26 기준, 검토자 미지정)
- 표본: `review-sheet.csv` 146개 항목. 전체 GT 항목 708개의 20.6%이며, 범주마다 20% 이상을 seed `20261026`으로 층화 무작위 추출했다(`sample.json`).
- 이 폴더의 검토 결과 칸은 비어 있다. 검토가 끝나기 전에는 "검토 완료"로 기록하지 않는다.

## 1. 검토자에게

이 검토는 생성형 AI(Claude Code)가 작성한 Ground Truth를 사람이 독립적으로 확인하는 절차다. 검토 결과로 주석자 간 일치도(Cohen's κ)를 계산하고, 불일치 항목은 GT 정정(v2) 여부를 판단하는 데 쓴다.

1. **`review-key.csv`는 열지 않는다.** 정답이 들어 있다. 검토가 끝난 뒤 일치도 계산에만 쓴다.
2. [ANNOTATION_GUIDE.md](../ANNOTATION_GUIDE.md)를 먼저 읽는다. 관계와 owner의 정의는 이 지침이 기준이다.
3. 각 행의 `caseId` 폴더에서 소스를 열고 `sites` 위치를 확인한다. `siteText`는 편의를 위한 해당 줄 사본이다.
4. Cogic을 실행하거나 Cogic 출력을 보지 않는다.

## 2. 행 읽는 법

| 열 | 의미 |
|---|---|
| `kind` | `calls`, `constructs`, `references`, `dataflow`, `updates`, `owner`(framework 노드 존재) |
| `source` | 관계의 출발 노드. `파일:줄 종류 이름`, 또는 `[framework 역할: 앵커]` |
| `target` | 관계의 도착 노드. `owner`는 대상이 없다. 후보가 여러 개면 `\|`로 구분한다 |
| `argIndex` | dataflow에서 값을 받는 파라미터 위치(0부터, 지침 §4.5) |

## 3. 판정 값 (`reviewerLabel`)

| 값 | 뜻 |
|---|---|
| `exists` | 지침의 정의상 이 관계가 존재한다. owner면 그 framework 노드가 존재한다 |
| `not-exists` | 이 관계는 존재하지 않는다 |
| `undeterminable` | 소스만으로 존재 여부나 대상을 하나로 정할 수 없다(지침 §6.2) |

나머지 열:

- `reviewerConfidence`: `high`, `medium`, `low` 중 하나
- `reviewerComment`: 근거나 지침의 모호한 점. 지침 자체가 잘못됐다고 보면 여기에 적는다
- `reviewerId`: 검토자 식별자(이니셜 가능)
- `reviewedAt`: 날짜(YYYY-MM-DD)

## 4. 제출과 집계

1. 채운 시트를 `review/filled/<reviewerId>-review-sheet.csv`로 저장한다. 원본 `review-sheet.csv`는 수정하지 않는다.
2. 일치도를 계산한다.

   ```powershell
   node docs/thesis-experiments/tools/exp01/review-agreement.mjs --sheet docs/thesis-experiments/fixtures/exp-01/review/filled/<reviewerId>-review-sheet.csv --key docs/thesis-experiments/fixtures/exp-01/review/review-key.csv --json docs/thesis-experiments/fixtures/exp-01/review/filled/<reviewerId>-agreement.json
   ```

3. 불일치 항목은 작성자와 검토자가 논의한다. GT를 고치기로 하면 [ANNOTATION_GUIDE.md §10](../ANNOTATION_GUIDE.md#10-수정과-버전-관리)에 따라 `expected.v2.json`과 `GT_CHANGELOG.md`로 기록한다. v1은 고치지 않는다.
4. 빈 칸으로 남은 행은 "미검토"로 집계되며 일치로 계산하지 않는다.

## 5. 2인 검토가 불가능한 경우

P0 계획([exp-01-accuracy.md §7](../../../experiments/exp-01-accuracy.md#7-execution-procedure) 4번)에 따라 다음을 논문에 명시한다.

- 작성 후 48시간 이상 지나 작성자가 다시 검토했다는 점
- GT가 **single-annotator**라는 점

P1-A GT는 생성형 AI가 작성했으므로, 사람의 검토 없이 "독립 검증된 GT"라고 쓰지 않는다.
