# 정적 관계 독립 검토 — 파일럿 (`B` 사례 4개)

이 패킷은 TypeScript/JavaScript 소스 4개 사례(`cases/` 아래)에서 함수·클래스 등 사이의 정적 관계를 **처음부터 직접** 적는 검토 파일럿이다. 전체 검토(64개 사례)의 범위와 인원을 정하기 위해, 이 4개 사례에서 걸리는 시간과 어려운 점을 먼저 확인한다.

- 사례 ID는 중립 ID다. 원래 이름·분류·설명은 의도적으로 뺐다.
- 이 패킷에는 정답(기존 Ground Truth), 분석 도구의 출력, 점수, AI 검토 결과가 **없다**. 검토 중에 그런 자료를 찾아보거나 받지 않는다.
- AI 검토 결과는 제출이 고정된 **뒤에도** 연구자의 조정 단계 전까지 보여 주지 않는다.

## 읽는 순서

1. [DECLARATION.md](DECLARATION.md): 검토 전에 작성해 제출한다.
2. [REVIEWER_GUIDE.md](REVIEWER_GUIDE.md): 작업 절차, 양식 작성법, 금지 사항.
3. [SEMANTIC_CONTRACT_C1.md](SEMANTIC_CONTRACT_C1.md): 의미 계약. 다른 정의 문서와 어긋나 보이면 이것이 우선한다.
4. [RELATION_DEFINITIONS.md](RELATION_DEFINITIONS.md): 관계와 노드의 정의(원 지침 발췌).
5. [REVIEW_CRITERIA.md](REVIEW_CRITERIA.md): 관계 종류별 판정 기준.
6. [CORPUS_B_ENVIRONMENT.md](CORPUS_B_ENVIRONMENT.md): 이 사례들(실제 오픈소스 코드)의 환경 규칙.

## 양식 (`forms/`)

기존 양식에 파일럿 기록 양식 하나를 더했다.

| 양식 | 내용 |
|---|---|
| `relations.csv`, `negatives.csv`, `sites.csv`, `ambiguities.csv`, `outside-definitions.csv` | 검토 결과(REVIEWER_GUIDE §3) |
| `time-log.csv` | 사례별 시작·종료 시각과 소요 시간(분). 중단했으면 `interrupted`에 표시 |
| `questions.csv` | 연구자에게 한 질문과 답변 |
| `pilot-feedback.csv` | 파일럿 기록. 아래 `category` 값 중 하나를 고르고, 해당하면 관계 종류와 난이도(1 쉬움 – 5 매우 어려움)를 적는다 |

`pilot-feedback.csv`의 `category`:

| 값 | 적는 것 |
|---|---|
| `difficulty` | 사례를 마친 뒤 관계 종류(`kind`)별 난이도. 관계 종류마다 한 줄 |
| `undecidable` | 정의로 판단할 수 없었던 관계(파일·줄, 이유) |
| `guide-ambiguity` | 지침·계약에서 모호하거나 서로 어긋난 부분(문서와 절) |
| `submission-error` | 양식 작성 중 발견한 오류나 형식 문제(스스로 고친 것 포함) |
| `needs-explanation` | 추가 설명이 필요했던 항목 |

## 사례 폴더

| 파일 | 내용 |
|---|---|
| `case-info.json` | 중립 ID, 검토 대상 파일(`activeFile`), 포함 파일 목록 |
| `source/` | 소스, `tsconfig.json`, 외부 패키지 선언(`shims/`) |
| `provenance.json`, `LICENSE.upstream` | 원 저장소, 고정 commit, 라이선스, 파일 SHA-256 |
