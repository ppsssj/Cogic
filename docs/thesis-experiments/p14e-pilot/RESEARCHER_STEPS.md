# 파일럿 검토 진행 절차 (연구자용)

- 패킷은 저장소 밖에서 만든다. 저장소에는 GT가 있으므로 검토자에게 저장소를 주지 않는다.
- 같은 명령은 같은 바이트를 만든다(결정성 테스트).

```powershell
node docs/thesis-experiments/p14e-pilot/tools/pilot.mjs build --out C:\dev\p13\p14e-data\pilot-v1
```

| 산출물 | 받는 사람 |
|---|---|
| `deliver/p14e-pilot-ai-claude.zip`, `-gpt6.zip`, `-gemini.zip` | 각 AI 세션. 세 파일은 **바이트가 같다**(같은 SHA-256) |
| `deliver/p14e-pilot-human.zip` | 사람 검토자 |
| `deliver/SHA256SUMS.txt`, `build-result.json`, `selection/`, `ai/researcher/`, `human/researcher/` | 연구자만. blind key가 들어 있다 |

## 1. AI 검토 (모델마다, 사례마다)

### 1.1 세션 조건

- 사례마다 **새 대화**를 연다. 한 대화에 한 사례만 다룬다(4 사례 × 3 모델 = 12 대화).
- 다음을 끄거나 쓰지 않는다.
  - 기억(memory)
  - 프로젝트·커스텀 지시
  - 저장소·드라이브 연결
  - 웹 검색
- 이 연구 저장소나 GT를 읽은 대화·프로젝트에서 검토하지 않는다.
  - 이 패킷을 만든 Claude Code 세션은 GT와 analyzer를 읽었다. 그래서 이 세션의 검토는 독립 검토가 아니며, 이 세션은 검토하지 않았다.
- 모델 이름·버전은 **화면에 표시된 그대로** 적는다. 표시가 없으면 `unknown`으로 적는다. 추측하지 않는다.

### 1.2 첫 메시지

1. `p14e-pilot-ai-<model>.zip`을 첨부한다.
2. `AI_REVIEW_PROMPT.md`의 `---` 사이 본문을 그대로 붙인다.
3. 마지막 줄에 `검토할 사례: B02`처럼 사례를 적는다.
   - 사례: `B02`, `B04`, `B06`, `B18`
   - 순서는 모델마다 같게 한다(예: B02 → B04 → B06 → B18).

ZIP을 받지 못하는 인터페이스이면 패킷 폴더의 파일을 직접 첨부한다. 첨부한 파일 목록을 `--settings`에 적는다.

### 1.3 응답 보존

- 응답 전체를 **수정하지 말고** 파일로 저장한다.
  - 복사해 `.md`로 저장하거나, 인터페이스의 내보내기를 쓴다.
  - 답이 여러 메시지로 나뉘었으면 순서대로 한 파일에 이어 붙이고, 그 사실을 `--settings`에 적는다.
- 다시 요청했거나 수정을 요청했으면 그 대화 전체를 원문으로 보존한다. 어떤 답을 채택했는지 `--settings`에 적는다.

```powershell
node docs/thesis-experiments/p14d-semantic-contract/tools/ai-review.mjs intake `
  --evidence C:\dev\p13\p14e-data\ai-evidence --model gpt6 --version "<화면 표시 모델명>" `
  --interface web --date 2026-11-29 --case B02 --file <저장한 응답 파일> `
  --settings "zip 468c016e…(SHA256SUMS 값); new chat; memory off; web off"
```

`--model`은 `claude`, `gpt6`, `gemini` 중 하나로 고정한다. `intake`는 덮어쓰기를 거부하고 원문 SHA-256을 기록한다.

### 1.4 형식 검증과 비교

모든 모델의 4 사례가 보존된 **뒤에** 한다.

```powershell
node docs/thesis-experiments/p14d-semantic-contract/tools/ai-review.mjs extract --evidence C:\dev\p13\p14e-data\ai-evidence --model gpt6 --out C:\dev\p13\p14e-data\forms-gpt6
node docs/thesis-experiments/p14d-semantic-contract/tools/ai-review.mjs compare --a C:\dev\p13\p14e-data\forms-claude --b C:\dev\p13\p14e-data\forms-gpt6 --out C:\dev\p13\p14e-data\cmp-claude-gpt6.csv
```

- 형식이 틀린 응답은 `extract-report.json`의 `unparsed`에 남는다. 원문을 고치지 않는다. 재요청했으면 1.3대로 새 원문으로 보존한다.
- 비교는 세 쌍(claude–gpt6, claude–gemini, gpt6–gemini)이다. 어느 쪽도 정답으로 취급하지 않는다.

## 2. 사람 검토

1. 검토자에게 `p14e-pilot-human.zip`만 준다. AI 응답, 비교 결과, 저장소 링크는 주지 않는다.
2. 검토자는 `DECLARATION.md`를 먼저 제출한다.
3. 검토자는 4 사례를 검토하고 `forms/` 폴더 전체를 보낸다. 시간, 난이도, 판단 불가, 모호한 부분, 제출 오류, 추가 설명 필요 항목은 `time-log.csv`와 `pilot-feedback.csv`에 적는다.
4. 연구자는 받은 즉시 각 파일의 SHA-256을 계산해 `p14c-protocol/human-review/adjudication/submission-log.csv`에 적는다. 그 시점을 **고정**으로 한다.
5. 질문에는 정의 문서 조항만 인용해 답한다. 같은 답을 모든 검토자에게 공유하고 `questions.csv`에 남긴다.
6. AI 결과는 사람 제출이 고정된 뒤 조정 단계에서만 함께 본다.

## 3. 다음 단계에서 할 분석 (응답이 모인 뒤)

- **AI 대 AI, 사람 대 사람:** 관계별 불일치를 뽑는다.
  - `compare`의 A_ONLY·B_ONLY가 누락·추가 관계다.
  - KIND_DIFF, ARG_DIFF, DETERMINACY_DIFF, CANDIDATES_DIFF를 함께 본다.
  - owner만 다른 쌍은 A_ONLY + B_ONLY 쌍으로 나타난다(같은 대상·종류). 이를 owner 불일치로 묶는다.
  - `ambiguities`의 `ruleCited`(OPEN-n, C1 조항)로 계약 해석 불일치를 분류한다.
- **GT v1 대조:** 모든 제출을 고정한 뒤 `p14c-protocol/tools/reconcile.mjs`로 한다.
- **다수결은 정답이 아니다.**
  - 세 모델이 같은 답을 내도 공통 오류일 수 있다.
  - 사람이 판정할 항목은 다음이다.
    - 모델 간 불일치 전부
    - 계약 미결 항목에 걸린 관계
    - 일치 항목의 무작위 표본
- **파일럿 결과로 정할 것:** 전체 검토의 범위와 인원(D-5).
  - 사례당 소요 시간
  - 판단 불가·모호 항목 수
  - 계약 보강 필요 여부(C2 후보)
