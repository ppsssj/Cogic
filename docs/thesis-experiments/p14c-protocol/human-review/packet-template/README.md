# 정적 관계 독립 검토 패킷

이 패킷은 TypeScript/JavaScript 소스 64개 사례(`cases/A01`–`A44`, `B01`–`B20`)에서 함수·클래스 등 사이의 정적 관계를 **처음부터 직접** 적는 검토 자료다.

- 사례 ID는 무작위 순서의 중립 ID다. 원래 이름·분류·설명은 의도적으로 뺐다.
- 이 패킷에는 정답(기존 Ground Truth), 분석 도구의 출력, 점수가 **없다**. 검토 중에 그런 자료를 찾아보거나 받지 않는다.

## 읽는 순서

1. [DECLARATION.md](DECLARATION.md): 검토 전에 작성해 제출한다.
2. [REVIEWER_GUIDE.md](REVIEWER_GUIDE.md): 작업 절차, 양식 작성법, 금지 사항.
3. [RELATION_DEFINITIONS.md](RELATION_DEFINITIONS.md): 관계와 노드의 정의(원 지침 발췌).
4. [REVIEW_CRITERIA.md](REVIEW_CRITERIA.md): 관계 종류별 판정 기준과 판단이 갈리는 경우의 처리.
5. [CORPUS_B_ENVIRONMENT.md](CORPUS_B_ENVIRONMENT.md): `B` 사례(실제 오픈소스 코드)에만 적용되는 환경 규칙.

## 사례 폴더

| 파일 | 내용 |
|---|---|
| `case-info.json` | 중립 ID, 검토 대상 파일(`activeFile`), 포함 파일 목록 |
| `source/` | 소스, `tsconfig.json`, 외부 패키지 선언(`shims/`) |
| `provenance.json`, `LICENSE.upstream` | `B` 사례만: 원 저장소, 고정 commit, 라이선스, 파일 SHA-256 |

## 양식 (`forms/`)

| 양식 | 내용 |
|---|---|
| `relations.csv` | 존재한다고 판단한 관계 |
| `negatives.csv` | 있을 법하지만 존재하지 않는다고 판단한 관계 |
| `sites.csv` | 검토 대상 파일의 모든 호출·`new`·JSX 지점의 처리 |
| `ambiguities.csv` | 판단이 갈린 지점과 선택한 해석 |
| `outside-definitions.csv` | 코드에 의미 있는 연결이 있지만 정의된 관계 종류에 맞지 않는 것 |
| `questions.csv` | 연구자에게 한 질문과 답변 |
| `time-log.csv` | 사례별 작업 시간 |
