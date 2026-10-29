# EXP-01 AI 교차 검토 증거 (GPT-6, 2026-10-29)

이 폴더는 생성형 AI(GPT-6)가 EXP-01 검토 표본 146개를 판정한 결과다. **사람의 독립 검토 결과가 아니다.** 사람 검토 결과는 `fixtures/exp-01/review/filled/`에 둔다. 이 폴더는 그와 섞이지 않도록 `fixtures/exp-01/` 밖에 두었다.

해석과 사후 판정은 [p1d-ai-cross-review.md](../../p1d-ai-cross-review.md)에 있다.

| 파일 | 내용 | 원본 |
|---|---|---|
| `cogic_exp01_ai_review_146.csv` | GPT-6 판정 146행(`sampleId`, `reviewerLabel`, `reviewerConfidence`, `reviewerComment`, `reviewerId=GPT6-AI-REVIEW`, `reviewedAt`) | 사용자 제공 `Cogic_EXP01_AI_Review_146.csv` |
| `cogic_exp01_ai_review_report.md` | GPT-6 세션이 작성한 검토 기록 | 사용자 제공 `Cogic_EXP01_AI_Review_Report.md` |
| `agreement.recomputed.json` | 기존 `tools/exp01/review-agreement.mjs`로 다시 계산한 일치도(P1-D) | 이 저장소에서 생성 |

## 보존 규칙

- 두 원본 파일은 사용자가 제공한 파일을 바이트 그대로 복사했다. 이름만 소문자로 바꿨다. 판정, 코멘트, 인코딩(BOM)은 바꾸지 않았다.
- 같은 내용이 `Cogic_EXP01_AI_Review_Files.zip`에도 들어 있다. zip을 풀어 얻은 파일의 해시도 아래와 같았다.
- 원본 해시(SHA-256, 바이트 그대로)는 다음과 같다. 두 파일은 LF 줄바꿈이고, 커밋된 blob도 같은 바이트다.

  | 파일 | SHA-256 |
  |---|---|
  | `cogic_exp01_ai_review_146.csv` | `7537e1ee3d81f7eb1a8b249bdc25b2b4baf70c785741378dae74a819d7785863` |
  | `cogic_exp01_ai_review_report.md` | `679728dc79eb9734e61ea6a3e03138349e175cbb38817aa21e831e7203bb7a5f` |

- 이후 판정을 바꾸거나 다시 판정하면 새 파일로 추가한다. 이 파일들은 고치지 않는다.

## 재계산 방법

CSV는 UTF-8 BOM으로 시작한다. 그래서 `review-agreement.mjs`에 그대로 넣으면 첫 열 이름이 `﻿sampleId`로 읽힌다. 그 결과 146행이 모두 `invalid`가 된다(`reviewed 0, invalid 146`). 원본은 그대로 두고, BOM만 뺀 임시 사본으로 계산했다.

```bash
tail -c +4 docs/thesis-experiments/evidence/exp-01-ai-cross-review/cogic_exp01_ai_review_146.csv > /tmp/ai-nobom.csv
node docs/thesis-experiments/tools/exp01/review-agreement.mjs \
  --sheet /tmp/ai-nobom.csv \
  --key docs/thesis-experiments/fixtures/exp-01/review/review-key.csv \
  --json docs/thesis-experiments/evidence/exp-01-ai-cross-review/agreement.recomputed.json
# 기대: reviewed 146, unreviewed 0, invalid 0, kappa 0.9403594771241828
```

BOM 제거 사본의 SHA-256은 `0e2301bffa9642ca926d77f5af8332b914b4817d686949a779518f52118b7ea0`이다.

GPT-6 기록이 말하는 `merge_cogic_ai_review.py`는 제공되지 않아 쓰지 않았다.
