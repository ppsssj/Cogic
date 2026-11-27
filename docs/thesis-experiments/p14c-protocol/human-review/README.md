# 독립 사람 검토 절차 (연구자용)

이 폴더의 `packet-template/`만 검토자에게 간다(`tools/build-review-packet.mjs`로 생성). `adjudication/`과 생성기의 `researcher/` 출력은 연구자 전용이다.

## 단계

1. **패킷 생성:** `node docs/thesis-experiments/p14c-protocol/tools/build-review-packet.mjs --out <저장소 밖 새 폴더>`
   - `researcher/packet-manifest.json`의 `packetSha256`을 `adjudication/submission-log.csv`에 적는다.
   - 누출 검사 결과가 0건이어야 한다.
2. **선언서:** 검토자의 `DECLARATION.md`를 받는다. 예/아니오 답을 그대로 기록한다.
   - 도구 출력, GT, 점수를 본 적이 있는 검토자도 참여할 수 있다. 다만 그 사실을 결과 보고에 적는다.
3. **blind 작성:** 검토자에게 저장소 접근권을 주지 않는다.
   - 질문에는 정의 조항으로만 답한다.
   - 모든 질문과 답을 `questions.csv`에 남기고 모든 검토자에게 공유한다.
4. **고정:** 제출된 `forms/`의 파일별 SHA-256과 수신 시각을 `submission-log.csv`에 적는다. 이후 제출본은 수정하지 않는다.
5. **대조:** `node docs/thesis-experiments/p14c-protocol/tools/reconcile.mjs --forms <제출본> --key <researcher/blind-key.json> --out <reconciliation.csv>`
   - 일치하지 않은 행(AGREE·AGREE_ALTERNATIVE·NEGATIVE_AGREE가 아닌 행)이 조정 대상이다.
   - 검토자가 2명이면 검토자끼리도 같은 방식으로 대조한다. 한 쪽 양식을 GT 자리에 두고 비교하는 도구 확장이 필요하다.
6. **조정:** 두 번째 검토자 또는 조정자가 행마다 결정한다.
   - 결정자는 analyzer 예측과 점수를 보지 않는다(`predictionsSeenByDecider`, `scoresSeenByDecider`).
   - 결정마다 정의 조항을 인용하고 `adjudication-log.csv`에 적는다.
7. **GT 정정:** 필요한 경우에만 한다. `expected.v2.json`을 새 파일로 만들고, 변경을 `gt-change-log.md`에 기록한다. v1은 그대로 둔다.
8. **보고:**
   - 일치도: positive specific agreement, 결정성 일치, 유형별 건수.
   - 조정 결과 요약.
   - v1과 v2의 채점 결과.

## 검토가 끝나기 전에 하지 않는 것

- "human-validated GT"라는 표현
- 검토 결과를 보고 GT·지원 분류·scorer 정책을 바꾸는 일. 바꾸려면 위 절차와 버전 관리를 거친다.

## 기존 검토 자료와의 관계

| 자료 | 이번 패킷과의 관계 |
|---|---|
| Corpus A 146행 표본(`fixtures/exp-01/review/`, P1-C) | 보존한다. GT 항목을 제시하는 판정형이라 정박 효과가 있다. 이번 패킷은 전 사례를 처음부터 작성하는 방식이다. 146행 표본은 보조 자료로 쓸 수 있으나 독립 작성보다 뒤에 한다 |
| Corpus B P1-K3 패킷 | 보존한다. 지원 분류 열과 패턴 선택 규칙이 들어 있다. 이번 패킷은 그것을 빼고, 환경 규칙만 `CORPUS_B_ENVIRONMENT.md`로 옮겼다 |
