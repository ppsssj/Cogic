# Cogic EXP-01 — GPT-6 AI 교차 검토 기록

- 작업 일자: 2026-10-29
- 검토 대상: 사전 추출된 고정 표본 146개 / 40개 fixture
- 기존 GT 작성 모델: Claude Code(기존 저장소 문서의 저자 기록 기준)
- 본 검토: GPT-6 — **사람의 독립 검토가 아님**
- 원본: `docs/thesis-experiments/fixtures/exp-01/review/review-sheet.csv`
- 기준: 저장소 `main`, 사전 등록 주석 지침 `ANNOTATION_GUIDE.md` v1
- 비교 이전 접근 제한: `expected.json` 및 `review-key.csv`를 보지 않고 판단 파일을 먼저 생성함
- 주의: 이전 대화에서 GT의 전체 구성, 일부 예시 및 데이터셋 구조를 알고 있었으므로 **완전히 정보 차단된 독립 blind review라고 주장하지 않는다**.
- 실험 실행: **NOT_RUN** (Cogic analyzer, EXP-01 runner 실행 없음)
- 정확도 측정: **NOT_RUN** (아래 일치도는 GT와 AI 재판정의 일치도일 뿐 Cogic 정확도가 아님)

## 정답 키 비교 이전 AI 판정(고정)

| 판정 | 개수 |
|---|---:|
| exists | 126 |
| not-exists | 18 |
| undeterminable | 2 |
| 합계 | 146 |

확신도: high 138, medium 7, low 1.

## 판정 고정 후 GT v1과 비교

- 일치: **144/146 (98.63%)**
- 불일치: **2/146**
- Cohen's κ(두 AI 산출물 사이의 일치도): **0.9404**
- 우연 일치율: **0.7703**
- 사람 간 주석자 일치도 또는 정답의 정확도로 해석할 수 없음.

GT 라벨(행) × GPT-6 판정(열):

| GT \ GPT-6 | exists | not-exists | undeterminable |
|---|---:|---:|---:|
| exists | 126 | 2 | 0 |
| not-exists | 0 | 16 | 0 |
| undeterminable | 0 | 0 | 2 |

### 불일치 2개 — 연구자 판단이 필요

1. **S037 — `n04-local-decorators`, dataflow, `@Get()`**
   - GT v1: `exists`
   - GPT-6: `not-exists` (medium)
   - 문제: `main.ts:13,18`의 메서드 데코레이터 `@Get("a")`, `@Get("b")`에 대한 `dataflow` owner가 `main.ts` 모듈 최상위인지, `FakeController` 클래스인지.
   - Annotation Guide §3.4의 "데코레이터를 꾸미는 선언 바깥의 owner" 규칙은 **메서드가 속한 클래스**를 가리키는 것으로 읽을 수 있다. 그러나 GT는 모듈 최상위 owner를 사용하였다.
   - 판단 전 반드시 지침의 실제 의미와 사례별 anchor를 재확인한다. **GT 오류로 자동 확정하지 않는다.**

2. **S107 — `c08-dynamic-access`, dataflow, `greet.call(null, "hi")`**
   - GT v1: `exists`
   - GPT-6: `not-exists` (low)
   - 문제: `Function.call` 자체에 `thisArg`를 전달하는 `dataflow`도 별도 관계로 기록하는지, 아니면 `fn.call`을 정적으로 해석해 실제 대상 `greet`에 대한 호출·인자 전달만 기록하는지.
   - Annotation Guide §4.1 및 §4.5의 해석이 충돌할 여지가 있다. **가이드 모호성일 수 있으므로 사람이 확인해야 한다.**

### 사전 알려진 정답 노출 우려 2개 제외 민감도

시트 target 표기가 답을 일부 드러낼 수 있었던 S014, S104를 제외한 분석:

- 일치: **142/144 (98.61%)**
- Cohen's κ: **0.9333**
- 이 결과도 AI 간의 일치도일 뿐 사람 검증이나 Cogic 정확도 아님.

## 연구자가 추가 검토할 행

- **의견 불일치:** S037, S107 (최우선)
- **그 외 medium/low 확신도:** S014, S019, S031, S074, S104, S135
- 특히 S014 및 S104는 시트 문구가 판단 방향을 일부 노출한다.

원본 `review-sheet.csv`, GT v1, 두 manifest, Cogic 분석기, 채점기를 **변경하지 않았다**.

## 사용법

AI 보조 판정 자료는 `cogic_exp01_ai_review_146.csv`에 있다.
이 파일은 `reviewerId=GPT6-AI-REVIEW`로 기재해 사람의 검토처럼 오인되지 않도록 했다.
원래 시트와 결합하려면 `merge_cogic_ai_review.py`를 사용한다.

```powershell
python merge_cogic_ai_review.py `
  --sheet docs/thesis-experiments/fixtures/exp-01/review/review-sheet.csv `
  --ai cogic_exp01_ai_review_146.csv `
  --output ai-review-sheet.csv
```

이후 원본 도구 `review-agreement.mjs`로 일치도를 재계산할 수 있다.
비교 전에 판단한 내용과 비교 후 보고서는 별도 보존하고, 사람이 직접 확인한 판정은 별도 기록한다.
