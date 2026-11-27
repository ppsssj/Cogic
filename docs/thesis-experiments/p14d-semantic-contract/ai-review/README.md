# Corpus B 복수 AI 독립 교차 검토 (준비만, 실행하지 않음)

**상태:** 패킷과 도구 준비 완료. **외부 AI는 호출하지 않았다.** 교차 검토는 수행되지 않았다.

## 구성

| 항목 | 내용 |
|---|---|
| 패킷 | `tools/ai-review.mjs build --out <저장소 밖 새 폴더>` |
| | P14-C blind 패킷 생성기로 Corpus B 20개만 만든다(`B01`–`B20`). 중립 ID 대응은 사람 패킷과 같다(테스트로 확인) |
| | 확인한 빌드: 561파일, 누출 검사 0건, 패킷 해시 `f3cfc92c3267948a4d5a25d88d23b9679e71a8cd48384cdfc147e72692d6febe` |
| 넣는 것 | 사람 패킷과 같은 정의·기준·환경 규칙·양식, AI 지시문(`AI_REVIEW_PROMPT.md`), 응답 형식(`RESPONSE_FORMAT.md`) |
| 빼는 것 | 기존 GT, catalog, Cogic 예측, 점수, 다른 AI의 답, 사람 전용 선언서·질문·시간 기록 |
| 원문 보존 | `ai-review.mjs intake`: 응답 원문을 바이트 그대로 `<evidence>/<model>/<Bxx>/raw.*`에 두고 SHA-256과 메타데이터(모델, 버전, 인터페이스, 날짜, 설정)를 기록한다. 덮어쓰기를 거부한다 |
| 양식 추출 | `ai-review.mjs extract`: 응답의 이름 붙은 CSV 블록을 `forms/*.csv`로 모은다. 원문 해시가 바뀌었으면 거부한다. 형식이 틀린 응답은 고치지 않고 목록에 남긴다 |
| 불일치 추출 | `ai-review.mjs compare --a <forms> --b <forms>`: 사례별 AGREE / A_ONLY / B_ONLY / KIND_DIFF / ARG_DIFF / DETERMINACY_DIFF / CANDIDATES_DIFF / POLARITY_CONFLICT와 positive specific agreement. 어느 쪽도 정답으로 취급하지 않는다 |

## 절차

1. 패킷을 만들고 `researcher/packet-manifest.json`의 해시를 기록한다.
2. 모델마다 사례마다 **새 대화**를 연다. 지시문 전문 → 정의 문서 4개 → 사례 파일 순서로 같은 내용을 준다. 모델 이름과 버전, 날짜, 인터페이스, 설정(온도 등을 알 수 있으면)을 적는다.
3. 응답 원문 전체를 파일로 저장해 `intake`로 보존한다. 재요청이나 수정 요청을 했으면 그 대화도 원문으로 보존하고, 어떤 답을 채택했는지 `meta.json`의 `settings`에 적는다.
4. `extract`로 모델별 양식을 만든다. 형식 오류는 원문을 고치지 않고 보고한다.
5. `compare`로 모델 쌍마다 불일치를 뽑는다. GT v1과의 대조는 모든 AI 답을 고정한 **뒤에** P14-C `reconcile.mjs`로 한다.
6. 불일치는 사람 판정 후보다(human-review-options.md B). AI 간 일치는 정답의 증거로 보고하지 않는다.

## 한계

- AI 응답은 모델 버전과 시점에 따라 달라진다. 재현성은 원문 보존으로만 확보된다.
- 같은 계열의 모델은 같은 오류를 공유할 수 있다. 모델 계열을 다양하게 고르는 것을 권하지만, 그래도 독립성은 보장되지 않는다.
- 지시문과 정의 문서가 Claude Code가 작성한 GT 지침에서 왔으므로, 그 지침의 해석 틀은 공유된다.
