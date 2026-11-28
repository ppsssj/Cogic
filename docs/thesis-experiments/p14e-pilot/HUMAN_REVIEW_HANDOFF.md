# 사람 파일럿 검토 전달 안내 (연구자용)

> **2026-11-28 변경:** 일반 검토자용 방식은 웹 Focused Review로 바뀌었다([WORKBENCH_METHOD_CHANGE.md](WORKBENCH_METHOD_CHANGE.md)). 이 문서의 ZIP+CSV 전체 검토 절차는 연구자가 전체 검토를 할 때 쓰는 별도 경로(Full Review)로 유지한다.

- **이 문서의 용도:** 사람용 패킷을 검토자에게 넘길 때 쓴다. 기존 산출물만 다시 쓴다. 패킷·GT·C1·도구는 바꾸지 않았다.
- **이 문서를 검토자에게 주지 않는다.** 공개 저장소에 있고, AI 결과 문서를 링크하기 때문이다. 검토자에게는 §3의 안내문과 ZIP 하나만 준다.
- **작성 범위:** 이 문서는 사람 검토 결과를 만들지 않는다. 검토 결과는 검토자가 직접 작성한다.

## 1. 사람용 패킷의 상태 (VERIFIED, 2026-11-28)

| 항목 | 값 |
|---|---|
| 파일 | `C:\dev\p13\p14e-data\pilot-v1\deliver\p14e-pilot-human.zip` |
| ZIP SHA-256 | `b1f71c558d995b20fa71ad93b676be4906039f43fb8d4e44339ea79532b8963c` |
| 패킷 SHA-256(LF 정규화 manifest) | `9339ba35634280174d41e1f94a6d9d6f6d5e280ffdc0b69567c43ad530b2c46b` |
| 재현 | 현재 브랜치 HEAD에서 `pilot.mjs build`로 새로 만든 ZIP이 위 해시와 바이트까지 같다 |
| 누출 검사 | 0건. GT, 카탈로그, 지원 분류, analyzer 출력, 점수, 원 사례 ID, AI 응답이 없다 |
| AI 결과 포함 여부 | 없다. ZIP은 AI 응답을 받기 전에 만들어졌고, 그 뒤 해시가 바뀌지 않았다 |
| 배포 가능 여부 | **배포 가능** |

ZIP 안(`p14e-pilot-human/`)의 구성은 다음과 같다. 89파일이다.

| 구분 | 파일 |
|---|---|
| 안내 | `README.md`(파일럿 안내), `DECLARATION.md`(선언서) |
| 정의 문서 5개 | `SEMANTIC_CONTRACT_C1.md`(우선 적용), `RELATION_DEFINITIONS.md`, `REVIEW_CRITERIA.md`, `CORPUS_B_ENVIRONMENT.md`, `REVIEWER_GUIDE.md` |
| 양식 8개(`forms/`) | `relations`, `negatives`, `sites`, `ambiguities`, `outside-definitions`, `time-log`, `questions`, `pilot-feedback`(`.csv`). 머리글만 있다 |
| 사례 4개(`cases/`) | `B02`, `B04`, `B06`, `B18`. 각 폴더에 `case-info.json`, `source/`(소스, `tsconfig.json`, `shims/`), `provenance.json`, `LICENSE.upstream` |

사례 크기는 패킷에서 센 값이다. 정답 정보는 들어 있지 않다.

| 사례 | 검토 대상 파일 | 대상 파일 줄 수 | 사례 폴더 파일 수 |
|---|---|---|---|
| B02 | `src/api/user/userController.ts` | 18 | 22 |
| B04 | `src/main.ts` | 16 | 14 |
| B06 | `src/components/layouts/content-layout.tsx` | 24 | 8 |
| B18 | `src/session/infrastructure/persistence/relational/repositories/session.repository.ts` | 110 | 30 |

## 2. ZIP 해시 확인 (PowerShell)

보내기 전과, 검토자가 받은 직후에 같은 명령을 실행한다.

```powershell
Get-FileHash -Algorithm SHA256 "C:\dev\p13\p14e-data\pilot-v1\deliver\p14e-pilot-human.zip" | Format-List Hash, Path
```

기댓값과 자동으로 비교하려면 다음을 쓴다. 검토자에게 보낼 때는 경로만 바꾼다.

```powershell
$expected = "B1F71C558D995B20FA71AD93B676BE4906039F43FB8D4E44339EA79532B8963C"
$actual = (Get-FileHash -Algorithm SHA256 ".\p14e-pilot-human.zip").Hash
if ($actual -eq $expected) { "OK  $actual" } else { "MISMATCH  $actual" }
```

저장된 목록 전체를 확인하려면 다음을 쓴다.

```powershell
Get-Content "C:\dev\p13\p14e-data\pilot-v1\deliver\SHA256SUMS.txt"
Get-ChildItem "C:\dev\p13\p14e-data\pilot-v1\deliver\*.zip" | Get-FileHash -Algorithm SHA256 | Format-Table Hash, Path -AutoSize
```

## 3. 검토자에게 보낼 안내문

이 안내문은 AI 결과, 관계 개수, GT, 도구 이름, 저장소 주소를 일부러 넣지 않았다. 아래 블록을 그대로 복사해 보낸다. 같은 내용이 `C:\dev\p13\p14e-data\pilot-v1\deliver\REVIEWER_COVER_MESSAGE.txt`에도 있다.

```text
[정적 관계 독립 검토 파일럿 안내]

안녕하세요. TypeScript/JavaScript 소스에서 함수·클래스 사이의 정적 관계를
직접 적어 주시는 검토 파일럿을 부탁드립니다. 사례는 4개(B02, B04, B06, B18)입니다.

1. 받으실 파일
   - p14e-pilot-human.zip 하나입니다.
   - SHA-256: B1F71C558D995B20FA71AD93B676BE4906039F43FB8D4E44339EA79532B8963C
   - 확인 명령(PowerShell): Get-FileHash -Algorithm SHA256 .\p14e-pilot-human.zip
   - 값이 다르면 열지 말고 알려 주세요.

2. 시작 전에
   - 압축을 풀고 README.md를 먼저 읽어 주세요.
   - DECLARATION.md(선언서)를 작성해 검토 시작 "전에" 보내 주세요.

3. 지켜 주실 것
   - 패킷 안의 문서와 소스만 근거로 판단해 주세요.
   - 이 사례의 원 저장소, 다른 분의 검토, 분석 도구의 결과, 기존 정답 자료를 찾아보지 마세요.
   - 검토 내용은 다른 분과 상의하지 마세요. 질문은 저에게만 해 주세요.
     답은 정의 문서의 조항으로만 드리고, 같은 답을 모든 검토자와 공유합니다.
   - 생성형 AI는 관계 판정에 쓰지 말아 주세요. 다른 용도(예: 문법 확인)로 썼다면
     time-log.csv의 note에 도구와 용도를 적어 주세요.
   - 코드를 실행하거나 컴파일할 필요는 없습니다. 읽기만 하시면 됩니다.

4. 무엇을, 어떻게 적는가
   - 각 사례 case-info.json의 activeFile(검토 대상 파일)에서 출발하는 정적 관계를
     처음부터 직접 모두 적습니다. 관계 종류는 calls, constructs, references,
     updates, dataflow, owner 여섯 가지입니다.
   - 정의는 SEMANTIC_CONTRACT_C1.md가 가장 우선이고, 그다음
     RELATION_DEFINITIONS.md, REVIEW_CRITERIA.md, CORPUS_B_ENVIRONMENT.md를 봅니다.
   - 순서와 양식 작성법은 REVIEWER_GUIDE.md §2–§3에 있습니다.
     이번 파일럿은 B 사례만 있으므로 "A 사례 먼저" 권장은 해당하지 않습니다.
   - 검토 대상 파일의 모든 호출식, new, JSX 요소는 sites.csv에 빠짐없이 적어 주세요.
   - 판단이 갈리면 ambiguities.csv에 가능한 해석과 선택 이유를 적고,
     계약의 미결 항목(OPEN-n)에 해당하면 그 ID를 적어 주세요.
   - "정답이 하나로 정해지지 않는다"고 판단하신 것도 중요한 결과입니다.
     억지로 정하지 말고 ambiguities.csv와 pilot-feedback.csv에 남겨 주세요.

5. 파일럿 기록
   - time-log.csv: 사례마다 시작·종료 시각과 소요 시간(분), 중단 여부.
   - pilot-feedback.csv: 관계 종류별 난이도(1–5), 판단 불가 항목, 지침의
     모호한 부분, 양식 오류, 추가 설명이 필요했던 항목.
   - 소요 시간은 이 파일럿에서 처음 측정하는 값입니다. 정해진 시간은 없습니다.
     한 번에 2시간 넘게 이어서 하지 마시고 나눠서 진행해 주세요.

6. 제출
   - 4개 사례를 마친 뒤 forms/ 폴더 전체를 압축해 보내 주세요.
   - 받는 즉시 각 파일의 SHA-256을 기록해 제출본을 고정합니다.
     고정한 뒤에는 고치지 않으며, 이후 논의는 별도 기록에 남깁니다.

7. 사례 크기(참고)
   - B02 18줄, B04 16줄, B06 24줄, B18 110줄(검토 대상 파일 기준).
   - 정의 문서를 처음 읽는 시간이 따로 듭니다.

감사합니다.
```

## 4. 검토자가 알아야 할 것 (패킷 문서 요약)

검토자가 읽는 원문은 패킷 안의 문서다. 이 절은 연구자가 질문에 답할 때 어디를 인용할지 정리한 것이다.

| 주제 | 패킷 문서 |
|---|---|
| 노드(무엇이 관계의 끝점인가) | `RELATION_DEFINITIONS.md` §2 |
| owner(관계의 출발점) | 정의 §3, C1-3(평가 문맥 예외), C1-4(레거시 데코레이터) |
| 관계 6종 | 정의 §4.1 calls, §4.2 constructs, §4.3 references, §4.4 updates, §4.5 dataflow, §4.6 owner |
| 한 지점이 어떤 관계가 되는가 | C1-2 표 |
| 인자 위치 | C1-5 |
| 결정성 | 정의의 결정성 절, C1-6 |
| framework 의미(React, Vue, Express, NestJS) | 정의 §5, C1-7 |
| 외부 패키지와 TS 기본 라이브러리 | `CORPUS_B_ENVIRONMENT.md` §1–§3 |
| 도구 능력은 무관함 | C1-8, REVIEWER_GUIDE §1 |
| 미결 항목 | C1 끝의 OPEN-1–OPEN-6 |
| 양식의 열과 표기 | REVIEWER_GUIDE §3 |
| 제출과 고정 | REVIEWER_GUIDE §4 |

### 질문에 답할 때 지킬 것

- 정의 조항만 인용한다. 특정 사례의 정답, 관계 개수, AI 결과를 알려 주지 않는다.
- **C2 후보 두 가지는 아직 정해지지 않았다:**
  - JSX Fragment(`<>`)의 지점 결정
  - 지점의 `relNos`에 하위 식의 references를 연결하는지
- 이 둘을 물으면 "정의 문서에 규정이 없으니, 가능한 해석과 고른 이유를 `ambiguities.csv`에 적어 달라"고만 답한다. AI 결과에서 나온 항목이라는 것도 알리지 않는다.
- 모든 질문과 답을 `questions.csv`(연구자 사본)에 남기고 모든 검토자에게 공유한다.

### 작업량

- 측정값은 아직 없다. 이 파일럿이 처음 측정한다.
- 아래는 추정(INFERRED)이며, 근거는 대상 파일 크기와 정의 문서 분량뿐이다.
  - 정의 문서 첫 읽기: 1–2시간
  - B02·B04·B06: 각 30–60분
  - B18: 2–3시간
  - 합계: 약 5–8시간
- 결과 보고에는 `time-log.csv`의 실측값만 쓴다.

## 5. 제출 이후의 기존 절차 (GT 조정)

새 도구 없이 기존 절차를 그대로 따른다.

### 5.1 기존 절차의 단계

| 단계 | 할 일 | 기존 근거 |
|---|---|---|
| 1. 선언서 수령 | 답을 그대로 `p14c-protocol/human-review/adjudication/submission-log.csv`의 `declarationAnswers`에 적는다. "예" 답이 있어도 참여할 수 있고, 보고에 적는다 | `human-review/README.md` §2 |
| 2. 제출 고정 | `forms/` 파일별 SHA-256과 수신 시각을 같은 로그에 적는다(`formsSha256`, `frozenAt`, `packetSha256`). 받은 그대로 저장소 밖에 보존한다 | README §4, 프로토콜 §7.1 |
| 3. GT v1 대조 | `node docs/thesis-experiments/p14c-protocol/tools/reconcile.mjs --forms <제출본 forms> --key C:\dev\p13\p14e-data\pilot-v1\human\researcher\blind-key.json --out <저장소 밖>\gt-vs-human.csv` | README §5 |
| 4. 사람 대 AI·사람 대 사람 대조 | `node docs/thesis-experiments/p14d-semantic-contract/tools/ai-review.mjs compare --a <사람 forms> --b C:\dev\p13\p14e-data\ai-review-v1\forms-<model> --out <저장소 밖>\cmp-human-<model>.csv`. AI 결과는 2단계 고정 **뒤에만** 연다 | 프로토콜 §7.1. 이 도구는 검토자끼리의 대조에도 쓸 수 있다 |
| 5. 조정 | 조정 대상은 AGREE·AGREE_ALTERNATIVE·NEGATIVE_AGREE가 아닌 행과 [ai-review-results.md](ai-review-results.md) §7의 H-1–H-8이다. 결정마다 정의 조항을 인용해 `adjudication-log.csv`에 적는다. `predictionsSeenByDecider`·`scoresSeenByDecider`도 적는다 | README §6 |
| 6. GT 정정 | 필요할 때만 한다. v1(`expected.json`)은 그대로 두고 `expected.v2.json`을 새로 만든다. `gt-change-log.md`에 한 줄씩 적는다(근거 조항, 조정 결정 번호, 발견 시점, 결정자의 예측 열람 여부) | `gt-change-log.md` |
| 7. 계약 | C2 후보(Fragment, `relNos` 연결 규칙 등)는 연구자 승인으로만 정한다. C1 문서는 고치지 않고 새 버전으로 낸다 | 프로토콜 §2.1 |
| 8. 보고 | 일치도(positive specific agreement, 결정성 일치, 유형별 건수), 조정 요약, 파일럿 실측(시간·판단 불가·모호 항목). 그 결과로 D-5(인원·범위)를 정한다 | 프로토콜 §7, §7.1 |

4단계의 `ai-review.mjs compare`는 기존 도구다. `human-review/README.md` §5가 말하는 "도구 확장"은 P14-D에서 이 도구로 이미 해결됐다.

### 5.2 조정 단계의 독립성

- 이 저장소의 Claude Code 세션은 GT를 읽었다. 그래서 이 세션이 조정 결정자가 되면 독립 판정이 아니다.
- 이 세션은 대조표 생성과 형식 검증만 한다.
- 결정은 연구자 또는 두 번째 검토자가 한다.

### 5.3 보고 표기

- 사람 검토와 조정이 끝나기 전에는 GT를 `AI-authored GT v1 (not human-validated)`로 표기한다.
- 공식 정확도는 **BLOCKED**다. 게이트 4(독립 사람 검토)와 게이트 5(프로토콜 고정)가 열려 있다.

## 6. 연구자가 직접 할 일 (순서대로)

1. **검토자 선정:** D-5 권장은 2명이다. 선언서 항목을 미리 알려 주고, GT·Cogic 출력·AI 결과를 본 적 없는 사람을 우선한다.
2. **해시 확인:** §2의 명령으로 ZIP 해시를 확인한다.
3. **전달:** ZIP과 §3 안내문만 보낸다.
   - 저장소 링크, 이 문서, `ai-review-results.md`, AI 응답은 보내지 않는다.
   - 받은 검토자에게도 같은 해시를 확인하게 한다.
4. **선언서:** 검토 시작 전에 받아 `submission-log.csv`에 적는다.
5. **질문:** §4 규칙대로 답하고 `questions.csv`에 남긴다.
6. **고정:** 제출을 받는 즉시 SHA-256을 기록한다. 원본은 저장소 밖에 보존한다.
7. **조정:** 고정 뒤 §5의 3–6단계를 진행한다. 대조표 생성은 이 세션에 맡길 수 있다. 조정 결정은 직접 하거나 두 번째 검토자가 한다.
