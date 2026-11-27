# 검토 절차와 양식 작성법

## 1. 무엇을 하는가

- 각 사례의 **검토 대상 파일**(`case-info.json`의 `activeFile`)에서 출발하는 정적 관계를 소스만 보고 모두 적는다.
- 관계의 정의는 [RELATION_DEFINITIONS.md](RELATION_DEFINITIONS.md)를 따르고, 판단이 갈리면 [REVIEW_CRITERIA.md](REVIEW_CRITERIA.md)를 본다.
- 관계의 끝점이 다른 파일이나 외부 선언에 있으면, 그 파일을 열어 끝점의 선언 위치를 확인한다.
- 정답의 근거는 **TypeScript 소스의 정적 의미**다. 어떤 도구가 그것을 찾을 수 있을지는 고려하지 않는다. 도구가 찾기 어려워 보여도 관계가 있으면 적고, 찾기 쉬워 보여도 없으면 적지 않는다.

## 2. 작업 순서 (사례마다)

1. `time-log.csv`에 시작 시각을 적는다.
2. 검토 대상 파일을 처음부터 끝까지 읽고, 그 파일이 가져오는 파일과 `shims/`의 선언을 확인한다.
3. 노드(§2)를 정한다: 함수·메서드·클래스·인터페이스·타입·enum, 파일, 외부 선언.
4. **지점 목록**: 검토 대상 파일의 모든 호출식, `new`, JSX 요소를 `sites.csv`에 한 줄씩 적는다.
   - `decision`은 `relation`(관계로 적음), `no-node-target`(대상이 노드가 아님), `excluded`(정의상 관계가 아님) 중 하나다.
   - `relNos`에는 해당 관계 번호를, `reason`에는 `no-node-target`·`excluded`의 이유를 적는다.
5. 지점에서 생기는 관계와 지점 밖의 관계(참조·갱신·dataflow·framework owner)를 `relations.csv`에 적는다.
6. 있을 법하지만 없는 관계(예: 이름이 같지만 다른 선언, 읽기만 하는 상태)를 `negatives.csv`에 적는다. 억지로 만들지 않는다.
7. 판단이 갈린 지점은 `ambiguities.csv`에, 정의에 맞지 않는 연결은 `outside-definitions.csv`에 적는다.
8. 종료 시각을 적는다. 다음 사례로 넘어간다.

권장 순서: `A` 사례를 먼저, `B` 사례를 나중에 한다. 한 번에 2시간 이상 연속하지 않는다.

## 3. `relations.csv` 열

| 열 | 값 |
|---|---|
| `reviewer` | 선언서의 검토자 표기 |
| `blindId` | 사례 ID(예: `A07`) |
| `relNo` | 사례 안 일련번호(1, 2, …) |
| `kind` | `calls`, `constructs`, `references`, `updates`, `dataflow`, `owner` 중 하나 |
| `sourceFile`, `sourceLine`, `sourceName` | 관계를 가진 쪽(owner, §3). 파일이 owner면 `sourceLine`을 비우고 `sourceName`에 `<file>`을 적는다 |
| `targetFile`, `targetLine`, `targetName` | 대상 노드의 **선언** 위치와 이름 |
| | - 외부 패키지 선언(`shims/`)이면 그 파일과 줄 |
| | - TypeScript 기본 라이브러리면 `targetFile`에 `lib`, `targetName`에 `인터페이스.멤버` 또는 전역 이름 |
| | - `owner`는 대상이 없으므로 비운다 |
| `argIndex`, `paramName` | `dataflow`만: 0부터 센 인자 위치와 받는 파라미터 이름 |
| `determinacy` | `determinate` 또는 `indeterminate` |
| `candidates` | `indeterminate`만: 후보 대상들을 `;`로 구분하거나, 열거할 수 없으면 `unbounded` |
| `evidence` | 판단 근거 줄. `파일:줄`을 `;`로 구분 |
| `confidence` | `high`, `medium`, `low` |
| `note` | 판단 이유. `medium`·`low`면 반드시 적는다 |

- framework가 만드는 노드(정의 §2·§5의 콜백 owner, 상태 source, route owner)가 끝점이면 이름 칸에 `<callback-owner>`, `<state-source>`, `<route-owner>` 중 하나를 적고, 줄은 그 노드의 기준 줄(정의 §5)을 적는다. `owner` 관계는 이 노드의 존재를 뜻하며 `source` 칸에만 적는다.
- dynamic `import()`의 대상 모듈(정의 §2의 `module`)이 대상이면 `targetName`에 `<module>`, `targetFile`에 그 파일을 적고 `targetLine`은 비운다.
- 줄 번호는 1부터 센다. 여러 줄에 걸친 선언은 선언이 시작하는 줄(데코레이터가 있으면 첫 데코레이터 줄)이다.
- `negatives.csv`의 열은 `relations.csv`와 같은 표기를 쓴다(`dataflow`면 `argIndex` 포함). `rationale`에 왜 없는지 적는다.
- 같은 owner·대상·종류의 관계는 호출 지점이 여럿이어도 **한 줄**로 적고, 지점을 모두 `evidence`에 넣는다. `dataflow`는 인자 위치마다 한 줄이다.

## 4. 제출과 고정

- 모든 사례가 끝나면 `forms/` 폴더 전체를 연구자에게 보낸다. 제출 후 연구자는 파일의 SHA-256을 기록하고 그 시점을 **고정**한다.
- 고정 후에는 양식을 고치지 않는다. 이후의 불일치 해결 과정에서 의견이 바뀌면 그 기록은 별도 양식(대조표)에 남고, 제출본은 그대로 보존된다.
- 연구자에게 한 질문과 답변은 `questions.csv`에 남는다. 연구자의 답변은 정의 문서의 조항만 인용하며, 특정 사례의 정답이나 도구 결과를 알려 주지 않는다. 같은 답변은 모든 검토자에게 공유된다.
