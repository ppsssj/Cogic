# Corpus B Ground Truth 독립 검토 준비 (P1-K3)

- 작성일: 2026-10-30
- 기준: `research/thesis-p1k-independent-validation` `3c882a570b301873bf50f1077de3ec7a43ad9b33`(PR #16 병합 후, PR #15 미병합)
- 상태
  - **검토 준비 완료. 사람 검토는 시작되지 않았다.**
  - 20개 사례 모두 `REVIEW_PENDING`이다.
  - 독립 검토자는 확보되지 않았다(`review-status.json` `independentReviewerSecured: false`).
- 판정
  - 검토 패키지: 준비됨
  - 채점 범위: **`SCORING_SCOPE_DECISION_REQUIRED`**([scoring-scope-audit.md](scoring-scope-audit.md))
- 이 단계에서 하지 않은 것
  - Cogic 실행, 정확도 계산
  - GT 변경, manifest 교체
  - 검토 완료 표시

| 문서·파일 | 내용 | 블라인드 패킷 포함 |
|---|---|---|
| 이 문서 | 개요, 패키지 구성, 커버리지, 재현 | 아니오 |
| [blind-review-guide.md](blind-review-guide.md) | 검토 단계·상태, 사례 검토 순서, 범위 | 예 |
| [reviewer-instructions.md](reviewer-instructions.md) | 검토자 조건·독립성 선언·양식·표기 규칙 | 예 |
| [blind-addendum.md](blind-addendum.md) | 보충 규칙 A1–A10 블라인드판(사례 예시 삭제, [검토 대상] 표시) | 예 |
| [review-checklist.csv](review-checklist.csv) | 체크 항목 30개(BLIND 24, RECONCILIATION 6). GT 입장 열 없음 | BLIND 행만 |
| [reconciliation-template.csv](reconciliation-template.csv) | 대조표 양식(29열) | 아니오 |
| [scoring-scope-audit.md](scoring-scope-audit.md) | scorer 1.2 채점 범위·FP 정책 감사, 합성 예측 11개 시나리오(정정 P1-K4), v2 프로토콜 초안. 확정 전 초안은 [EVALUATION_PROTOCOL.v2.md](EVALUATION_PROTOCOL.v2.md) | 아니오 |
| [corpus-c-proposal.md](corpus-c-proposal.md) | 층화 외부 검증 코퍼스 설계안 | 아니오 |
| [open-decisions.md](open-decisions.md) | 미결정 사항 D-1–D-9 | 아니오 |
| [review-status.json](review-status.json) | 사례별 검토 상태 기록 | 아니오 |
| `blind-packet-manifest.json` | 배포용 블라인드 패킷의 파일 목록·SHA-256·누출 검사 결과 | 아니오 |

## 1. 두 패키지

### A. Blind Review Packet (검토자에게 배포)

- 만드는 방법: `tools/corpus-b-review/build-blind-packet.mjs --out <새 폴더>`. 저장소 밖에 만들고 그 폴더만 검토자에게 준다.
  - **검토자에게 저장소 접근권을 주지 않는다.** 저장소에는 기존 GT가 있다.
- 포함하는 것
  - 사례별
    - workspace(`source/`: active file, 로컬 import closure, untyped shim, tsconfig)
    - `LICENSE.upstream`
    - `case-info.json`(저장소, 고정 commit, 라이선스, 파일 SHA-256)
    - `worksheet.md`
    - 양식 3종(sites·relations·negatives)
  - 공통
    - `ANNOTATION_GUIDE.md` v1
    - `blind-addendum.md`
    - `catalog.blind.csv`(patternId·종류·극성·지원 분류·설명. analyzer 코드 위치 열은 뺐다)
    - 검토자 지침, 검토 절차
    - BLIND 체크리스트
    - `questions-log.csv`
- 빼는 것
  - `expected.json`, `case.json`(작성·검토 메모)
  - `corpus-b/review/*.mjs`
  - REVIEW.md·ANNOTATION_ADDENDUM 원본
  - P1-K2 GT 영향 문서
  - Cogic 예측, ORIGINAL/IMPROVED 결과, 정확도 수치
- worksheet는 TypeScript parser·컴파일러가 만든 **구문 정보**다. §2 노드 여부와 지점의 호출 대상은 적지 않았다. 내용은 다음과 같다.
  - 줄 번호가 붙은 active file
  - import 해석표: 파일 또는 untyped 외부 모듈
  - 선언 목록
  - 호출·new·JSX·데코레이터 지점 목록
- 누출 검사(`leakScan`): 다음이 패킷에 있으면 빌드를 실패시킨다.
  - 모든 GT 노드 ID
  - GT의 note·reason·rationale 문장(25자 이상)
  - excludedSites 사유 문장
  - GT·예측 JSON 표지, review 모듈 코드 표지

### B. Reconciliation Packet (제출 후, 판정자용)

- 만드는 방법: `tools/corpus-b-review/reconcile.mjs --submission <제출 폴더> --out <새 폴더>`. 제출(`REVIEW_SUBMITTED`) 후에만 실행한다.
- 출력

| 파일 | 내용 |
|---|---|
| `gt-items.csv` | 기존 GT 285개 항목(determinate 196, indeterminate 14, 부정 2, excluded site 73). endpoint는 검토자 표기와 같은 형식 |
| `reconciliation.csv` | GT 항목마다, 그리고 검토자만 적은 항목마다 한 행. `matchStatus`: MATCH / ATTRIBUTE_DIFF / ENDPOINT_DIFF / GTSTATUS_DIFF / GT_ONLY / REVIEWER_ONLY / SITE_MATCH / SITE_DISPOSITION_DIFF / SITE_NOT_DISPOSED. `diffFields`: pattern·support·candidates·evidence·kind·source·target·argIndex·gtStatus |
| `checklist-reconciliation.csv` | 체크리스트 30개에 기존 GT·P1-K1 입장(`gtPosition`)을 붙인 판 |
| `summary.json` | 상태·항목 종류·사례별 개수 |

- 판정자가 채우는 열
  - `causeCode`: GT-ERROR / GUIDE-AMBIGUOUS / REVIEWER-DIFF / ENVIRONMENT / OPEN
  - `proposedChange`, `finalDecision`, `decisionRationale`, `guideClause`, `sourceCodeEvidence`, `adjudicator`, `decidedAt`
- 근거 없는 판정은 OPEN으로 남긴다.
- GT를 바꾸기로 하면 v1은 그대로 두고 `expected.v2.json`과 새 manifest를 만든다.

## 2. 커버리지

| 사례 | determinate | indet. | 부정 | excluded | 호출 지점 | 선언 | 사례별 체크 항목 |
|---|---|---|---|---|---|---|---|
| be01-userrouter | 11 | 0 | 0 | 5 | 11 | 2 | R-03, R-ENV-2 |
| be02-server | 14 | 0 | 1 | 2 | 18 | 2 | R-01, R-02, R-03, R-ENV-2, R-ENV-7 |
| be03-ratelimiter | 0 | 0 | 0 | 1 | 1 | 2 | R-12, R-ENV-2 |
| be04-errorhandler | 2 | 2 | 0 | 1 | 3 | 2 | R-13, R-ENV-2 |
| be05-usercontroller | 7 | 0 | 0 | 2 | 8 | 7 | R-ENV-2 |
| bn01-auth-google-controller | 13 | 0 | 0 | 5 | 9 | 4 | R-06, R-07, R-ENV-2 |
| bn02-session-repository | 51 | 0 | 0 | 12 | 29 | 15 | R-07, R-ENV-2 |
| bn03-main | 4 | 0 | 0 | 16 | 31 | 6 | R-ENV-2, R-ENV-9 |
| bn04-file-schema | 3 | 0 | 0 | 2 | 3 | 4 | R-ENV-2 |
| bn05-files-service | 4 | 2 | 0 | 3 | 4 | 3 | R-05, R-ENV-2 |
| br01-form-drawer | 5 | 0 | 1 | 11 | 15 | 2 | R-09, R-10, R-ENV-8 |
| br02-textarea | 8 | 0 | 0 | 1 | 4 | 2 | R-11 |
| br03-main | 8 | 0 | 0 | 2 | 8 | 1 | R-11 |
| br04-content-layout | 2 | 0 | 0 | 4 | 5 | 2 | — |
| br05-input | 8 | 0 | 0 | 1 | 4 | 2 | R-11 |
| bv01-main | 3 | 0 | 0 | 4 | 7 | 1 | R-ENV-5 |
| bv02-use-follow-profile | 9 | 4 | 0 | 0 | 4 | 5 | R-04, R-13, R-ENV-5, R-ENV-7 |
| bv03-user | 18 | 0 | 0 | 1 | 10 | 6 | R-08, R-11, R-ENV-5 |
| bv04-use-async | 17 | 2 | 0 | 0 | 6 | 6 | R-13, R-ENV-5 |
| bv05-use-favorite-article | 9 | 4 | 0 | 0 | 4 | 5 | R-04, R-13, R-ENV-5, R-ENV-7 |
| **합계** | **196** | **14** | **2** | **73** | **184** | **79** | |

- determinate 지원 분류: supported 78, unsupported-by-design 116, ambiguous 2. GT 총계와 같다.
- 전역 체크 항목(모든 사례): G-01–G-07, R-14, R-ENV-1, R-ENV-3, R-ENV-4, R-ENV-6
- excluded site 73개는 모두 블라인드 호출 지점 목록에 들어 있다. 검토자는 excluded 여부를 모르는 채로 모든 지점을 처분한다.
- 검토자가 판정해야 하는 항목(기존 GT의 Yes/No가 아니다)
  - 관계 전수(G-01)
  - 지점 처분(G-02)
  - owner(G-03)
  - endpoint·argIndex(G-04)
  - 패턴·지원 분류·결정성(G-05)
  - 부정 사례(G-06)
- GT에 없던 관계는 reconciliation에서 `REVIEWER_ONLY`로 잡힌다.

## 3. 체크리스트 (R-01–R-ENV-9)

- P1-K1 REVIEW.md의 R-01–R-14, R-ENV-1–7과 P1-K2 decision.md의 R-ENV-8·R-ENV-9를 모두 연결했다. 전역 항목 G-01–G-07을 더했다.
- 항목마다 다음을 적는다.
  - 위치(파일·줄), 중립 질문
  - 지침 조항, 보충 규칙
  - 검토자 기입 열: 판정, 원본 코드 근거, 인용 조항, 이유
  - 상태: 처음에는 OPEN
- 블라인드 단계(BLIND 24개)의 질문은 판정할 대상만 말하고 기존 GT 답은 말하지 않는다. 예외적으로 판단 기준을 유도할 수 있던 문구는 중립적으로 고쳤다(R-12 주제, R-ENV-9 질문).
- reconciliation 단계 항목(6개): G-07, R-ENV-1, R-ENV-2, R-ENV-5, R-ENV-6, R-ENV-7
  - 환경·절차 결정이나 validator 경고 같은 GT 작성 기록을 봐야 판단할 수 있는 항목이다.
  - 블라인드 패킷에는 들어가지 않는다.

## 4. 상태 관리

- 상태: `REVIEW_PENDING` → `REVIEW_IN_PROGRESS` → `REVIEW_SUBMITTED` → `RECONCILIATION_PENDING` → `REVIEW_ACCEPTED`, 그리고 `REVIEW_BLOCKED`
- `review-status.mjs --check`가 다음을 거부한다.
  - 독립 검토자 미확보 상태에서 진행 상태로 넘어가는 것
  - 사람이 아닌 검토자·판정자(AI·도구 이름, `reviewerType` ≠ human)
  - 제출물·패킷 SHA, reconciliation 기록, 판정 근거 없이 `REVIEW_ACCEPTED`가 되는 것
  - `REVIEW_PENDING`인데 검토 결과를 가진 것
  - `case.json`의 `humanReviewed: true`인데 `REVIEW_ACCEPTED`가 아닌 것
- 현재: 20개 모두 `REVIEW_PENDING`. 검토자·날짜·대상 SHA 칸은 비어 있다.

## 5. 재현

```sh
T=docs/thesis-experiments/tools/corpus-b-review
node $T/build-blind-packet.mjs --out <새 폴더(저장소 밖)>        # 패킷 + PACKET_MANIFEST.json + 누출 검사
node $T/reconcile.mjs --submission <제출 폴더> --out <새 폴더>  # 제출 후에만
node $T/review-status.mjs --check docs/thesis-experiments/corpus-b/review-preparation/review-status.json
node $T/scoring-scope-probe.mjs                               # 합성 예측 시나리오
node --test $T/test/review.test.mjs                           # 도구 테스트 8개
```

- 도구 위치는 `tools/corpus-b-review/`이다. Corpus B MANIFEST의 대상 경로(`corpus-b/fixtures`, `corpus-b/review`, `corpus-b/selection.json`, `tools/corpus-b`) 밖이라 MANIFEST(601개)는 그대로 통과한다.
- 이 폴더(`corpus-b/review-preparation/`)도 MANIFEST 대상 밖이다. MANIFEST는 다시 만들지 않았다.

## 6. 배포용 패킷

| 항목 | 값 |
|---|---|
| 생성 commit | `a65ed56d1f4c162235ef13726a5e9b831e334157` |
| packetSha256 | `d279f24a2c81131fd6e50bfcd4db475bfcd33abd4bbff918f303d52c1952415c` |
| 파일 | 616개(사례 20개, active file 725줄, 호출 지점 184개, 선언 79개) |
| 누출 검사 | 금지 문자열 188개, 걸린 파일 0, 걸린 문자열 0 |
| 결정성 | 같은 checkout에서 다시 빌드하면 같은 packetSha256 |

- 파일별 SHA-256은 [blind-packet-manifest.json](blind-packet-manifest.json)에 있다. 패킷 안의 `PACKET_MANIFEST.json`도 같은 내용이다.
- 패킷은 저장소에 넣지 않았다. 배포할 때 위 commit에서 다시 만들고 packetSha256이 같은지 확인한다.
- 다른 checkout에서 만들면 결과가 다를 수 있다. Markdown·CSV 문서의 줄바꿈이 git 설정(`core.autocrlf`)에 따라 달라지면 해시가 달라진다. 사례 소스(`source/`)는 `-text`라 바이트가 같다.
- 실제로 배포한 패킷의 해시를 `review-status.json`의 `packetSha256`에 적는다.
