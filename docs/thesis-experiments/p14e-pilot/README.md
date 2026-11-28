# P14-E — Semantic Contract C1 고정과 독립 검토 파일럿

- **기준:** `main` `573d484`(PR #61 병합). 브랜치 `research/p14e-contract-freeze`.
- **변경하지 않은 것:**
  - 제품 코드
  - GT v1, fixtures, 카탈로그
  - scorer·runner
  - 기존 연구 결과
- **바꾼 연구 도구:** P14-C 패킷 생성기에 `blindIds` 옵션(중립 ID 부분집합)을 넣은 것뿐이다. 기존 두 패킷의 해시가 그대로임을 테스트로 확인했다.
  - P14-C 사람 패킷: `b44d15c…`
  - P14-D AI 패킷: `f3cfc92c…`
- **상태:**
  - 파일럿 패킷: **PACKET_READY**
  - AI 교차 검토: 연구자가 외부 세션에서 진행한 응답 12건을 받아 보존하고 재검증했다([ai-review-results.md](ai-review-results.md)). 모델은 Claude·Codex·Gemini다. 계획의 GPT-6 대신 Codex였다
  - 사람 검토: 수행하지 않음. 일반 검토자용 방식은 웹 Focused Review로 바뀌었다(DRAFT, [WORKBENCH_METHOD_CHANGE.md](WORKBENCH_METHOD_CHANGE.md))
  - 공식 정확도 판정: **BLOCKED**

| 문서 | 내용 |
|---|---|
| [contract/SEMANTIC_CONTRACT_C1.md](contract/SEMANTIC_CONTRACT_C1.md) | 계약 C1. 검토 패킷에 그대로 들어간다(링크는 패킷 안의 파일 기준) |
| [c1-provenance.md](c1-provenance.md) | 조항별 출처, GT v1 정합성 확인, 미결 항목, 계약 변경 후보, 지원 분류 분리 규칙(D-4) |
| [RESEARCHER_STEPS.md](RESEARCHER_STEPS.md) | 패킷 전달, 원문 보존, 형식 검증, 비교 절차 |
| [WORKBENCH_METHOD_CHANGE.md](WORKBENCH_METHOD_CHANGE.md) | 사람 검토를 웹 Focused Review(불일치 판정·그래프 선호·합의 표본)로 바꾼 기록. 문제 구성, 무결성, 제한, 승인 항목(DRAFT) |
| [HUMAN_REVIEW_HANDOFF.md](HUMAN_REVIEW_HANDOFF.md) | 사람 파일럿 전달: 패킷 상태·해시, 검토자 안내문, 질문 응답 규칙, 제출 뒤 조정 절차(연구자용) |
| `pilot/selection.json`, `pilot/build-result.json` | 선정 기록(중립 ID·framework·점수)과 패킷·ZIP 해시 |
| `templates/` | AI 패킷용 지시문·응답 형식, 사람 패킷용 안내문과 `pilot-feedback.csv` |
| `tools/pilot.mjs`, `tools/test/p14e.test.mjs` | 선정·패킷·ZIP 생성, 테스트 5개 |
| [ai-review-results.md](ai-review-results.md) | 받은 AI 응답 12건의 무결성, 절차 준수, 형식 오류와 의미 차이 구분, GT v1 대조, 사람 검토 항목 |
| `tools/ai-results/` | 형식 파생본(fence 삽입만), 엄격 CSV 검사, 필드·지점 비교. 테스트 `tools/test/p14e-ai-results.test.mjs` 2개 |

## 1. 승인 사항 반영

| 승인 | 반영 |
|---|---|
| A-1 데코레이터 모델 A | C1-4: 레거시 데코레이터는 평가 문맥이 owner이다. 최상위 클래스는 `<file>`, 함수 안 클래스는 그 함수다. 메서드 데코레이터는 메서드 본문과 구분한다 |
| A-2 계약 버전 C1 | 프로토콜 §2.1: GT 버전과 계약 버전을 분리한다. 보고 표기는 `(GT, 계약, scorer)`. `execution-gates.json`에 `semanticContract` 항목을 추가했다 |
| A-3 SC-1–SC-9 명문화 | 기존 의미 안에서 C1-1–C1-8로 명문화했다. 정할 수 없는 항목은 OPEN-1–6과 C-OPEN-7·8로 남겼다 |
| A-4 파일럿 | Corpus B 4개 사례 |
| A-5 Claude·GPT-6·Gemini | 같은 바이트의 패킷 3개를 만들었다. 이 세션에서 접근 가능한 독립 모델은 없다(§3) |
| A-6 Gemini 원문 | 미수령. S037 Gemini 판단은 계속 UNVERIFIED다 |
| A-7 `decorates` 보류 | C1-4 규칙 5: 꾸밈은 관계가 아니다. 계약 변경 후보 CC-2로만 기록 |
| D-1 strict 주 지표 | 프로토콜 §3, 게이트 3을 `STRICT_PRIMARY_DECIDED`로. lenient는 공식 평가에 쓰지 않는다 |
| D-2 Corpus B 고정 커밋 | 프로토콜 §2 |
| D-3 runner 1.3 | 승인됨, 미구현으로 기록 |
| D-4 의미 검토와 지원 분류 분리 | c1-provenance §5. 패킷에 지원 분류·패턴 ID가 없음을 누출 검사로 확인 |
| D-5 검토자 | 2명 권장. 실제 인원과 범위는 파일럿 뒤 확정(프로토콜 §7.1) |

## 2. 파일럿 사례 선정

- **규칙(`p14e-pilot/1`):**
  1. P14-C 생성기로 Corpus B 전체 blind 패킷을 만들어, 연구자용 키에서 중립 ID와 framework 폴더만 읽는다.
  2. framework마다 `sha256("p14e-pilot/1|20261128|<중립 ID>")`가 가장 작은 사례를 고른다.
- **쓰지 않은 것:** GT, analyzer 출력, 점수, 지원 분류, 사례 크기.
- **중립 ID:** 사람 패킷(P14-C)·P14-D AI 패킷과 같다. 테스트로 확인했다.

| framework | 선정 | 후보 |
|---|---|---|
| React | `B06` | B03, B06, B09, B10, B16 |
| Vue | `B04` | B04, B05, B08, B14, B20 |
| Express | `B02` | B02, B07, B11, B17, B19 |
| NestJS | `B18` | B01, B12, B13, B15, B18 |

## 3. 패킷

| 패킷 | 파일 | 패킷 SHA-256(LF 정규화 manifest) | ZIP SHA-256 |
|---|---|---|---|
| AI (Claude, GPT-6, Gemini 공통) | 87 | `9e1400b74d95114efc1f2ab98ceef03dde15b48d8751bf099b1e1834eb4d04d8` | `468c016eded3085b14fa8118891043ae4da720ce30871a24050cc7b607fb0e38` (세 ZIP 같음) |
| 사람 | 89 | `9339ba35634280174d41e1f94a6d9d6f6d5e280ffdc0b69567c43ad530b2c46b` | `b1f71c558d995b20fa71ad93b676be4906039f43fb8d4e44339ea79532b8963c` |

- **ZIP 형식:** stored 방식이다. 시각은 1980-01-01로 고정하고 항목은 정렬한다. 같은 작업 트리에서 다시 만들면 같은 바이트가 나온다.
  - 템플릿은 작업 트리에서 읽으므로, 줄바꿈 설정이 다른 checkout에서는 ZIP 바이트가 달라질 수 있다.
  - 내용의 기준 해시는 LF로 정규화한 패킷 SHA-256이다.
- **AI 패킷의 구성:**
  - 사례 4개
  - 정의 문서 5개(C1 포함)
  - 지시문과 응답 형식
  - 양식 5개
- **사람 패킷의 구성:**
  - 사례 4개
  - 정의 문서 5개
  - 선언서
  - 양식 7개와 `pilot-feedback.csv`
- **빠진 것(누출 검사 0건):**
  - GT, 카탈로그, 지원 분류, 패턴 ID
  - analyzer 출력, 점수
  - 원 사례 ID와 이름
  - 다른 검토자의 답

## 4. 독립성

- 이 패킷을 만든 Claude Code 세션은 GT와 analyzer를 읽었다. 그래서 이 세션이 검토하면 독립 검토가 아니다. 검토하지 않았고, 다른 모델의 답을 대신 만들지도 않았다.
- GPT-6와 Gemini는 이 환경에서 호출할 수 없다. Claude의 독립 검토도 새 claude.ai 대화에서 연구자가 진행해야 한다.
  - 조건: 기억·프로젝트·저장소 연결 없음
  - 절차: [RESEARCHER_STEPS.md](RESEARCHER_STEPS.md) §1.1

## 5. 테스트와 무결성 (VERIFIED, 이번 단계에서 실행)

| 검사 | 결과 |
|---|---|
| 연구 도구 테스트(P14-C 16 + P14-D 6 + P14-E 5) | 27/27 |
| Corpus A manifest | gt 214파일 OK, 평가 r2 227파일 OK |
| Corpus B manifest(`4c5a3e2` worktree) | 601파일 OK, 작업 트리 변경 없음 |
| GT·fixtures·카탈로그·scorer(`tools/exp01`)·corpus-b 변경 | 0파일(`git diff 573d484`) |
| `docs/thesis-experiments/` 밖 변경 | 0파일 |
| 패킷 누출 검사 | AI 0건, 사람 0건 |
| 패킷 결정성 | 두 번 빌드한 ZIP 4개와 패킷 해시가 같음 |
| ZIP 무결성 | Python `zipfile.testzip` 4개 OK. Windows `Expand-Archive`로 푼 트리가 패킷과 같음 |
| `git diff --check` | OK |

제품 코드를 바꾸지 않았으므로 `npm test`와 성능 벤치마크는 다시 실행하지 않았다.

## 6. VERIFIED / INFERRED / UNVERIFIED

- **VERIFIED:**
  - §5의 모든 검사
  - 선정 결과와 그 계산
  - 데코레이터 GT 항목 전수 확인(모두 owner `file`, c1-provenance §2)
  - 두 코퍼스의 `experimentalDecorators` 설정
  - 세 AI ZIP의 바이트 동일성
- **INFERRED:**
  - C1 각 조항이 기존 의미를 바꾸지 않는다는 판단(조항별 근거는 c1-provenance §1)
  - setter 래퍼 해석
  - 미결 항목 분류
- **UNVERIFIED:**
  - 실제 AI 교차 검토(이 문서 작성 시점에는 미수행, 응답 0건). 이후 받은 응답은 [ai-review-results.md](ai-review-results.md)에 정리했다
  - 사람 검토(미수행)
  - 접근 가능한 모델의 정확한 버전
  - Gemini S037 원문
  - 사례당 소요 시간(측정 전. 추정도 하지 않았다)
