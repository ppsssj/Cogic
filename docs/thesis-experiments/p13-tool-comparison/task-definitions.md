# 과제 정의

모든 과제와 기준은 측정 전에 커밋했다(커밋 시각은 git 기록으로 확인할 수 있다).

| 문서 | 커밋 | 내용 |
|---|---|---|
| [preregistration-stage-a.md](preregistration-stage-a.md) | `8162be9` (16:14) | Stage A T1–T4, 성공 기준, 분류, 조작 수 규칙, 실행 순서 |
| [preregistration-stage-b.md](preregistration-stage-b.md), [data/stage-b-answer-key.json](data/stage-b-answer-key.json) | `9edaa87` (16:17) | Stage B 실제 프로젝트 과제 H1, H2, V1, V2와 정답, R1–R3 기준, 도구별 조작 경로 |
| [preregistration-stage-b-addendum.md](preregistration-stage-b-addendum.md) | `310bafe` (16:51) | 스모크 실행 후·본 측정 전의 절차와 판독 보완 A1–A6. 과제·정답·기준은 바꾸지 않음 |

## Stage A — 4파일 예제 (P3 과제 재현)
실행 흐름: `runDemo → CheckoutDemo.process → formatReceipt → formatMoney` (`src/demo.ts`, `receipt.ts`, `money.ts`)

| 과제 | 내용 | 성공 기준 |
|---|---|---|
| T1 | 다중 파일 호출 관계 | 세 호출 관계가 모두 UI에 보임 |
| T2 | 인자 전달 `120 → total → amount` | 세 구간이 도구가 표시한 매개변수 대응으로 보임 |
| T3 | 뷰 → 소스 이동 → 복귀 | 목표 소스로 이동하고 시작 맥락으로 돌아옴 |
| T4 | 디버그 프레임 ↔ 뷰 | `receipt.ts` 5행에서 멈춘 프레임이 구조 뷰의 노드로 식별됨 |

## Stage B — 실제 프로젝트 (hono `cd50668`, vite `3567471`)
| 과제 | 시작 → 목표 | 경로 | 인자 전달 구간 |
|---|---|---|---|
| H1 | `setCookie` (`src/helper/cookie/index.ts:99`) → `_serialize` (`src/utils/cookie.ts:174`) | setCookie → generateCookie → serialize → _serialize | `value`가 3구간 |
| H2 | `Hono.request` (`src/hono-base.ts:518`) → `compose` (`src/compose.ts:15`) | request → fetch → #dispatch → compose | `Env`→`env`(rest), `request`→`request`, `rest[0]`→`env` |
| V1 | `createServer` (`packages/vite/src/node/server/index.ts:506`) → `resolveConfig` (`config.ts:1480`) | createServer → _createServer → resolveConfig | `inlineConfig` 2구간 |
| V2 | `build` (`packages/vite/src/node/build.ts:575`) → `resolveConfig` (`config.ts:1480`) | build → createBuilder → resolveConfigToBuild → resolveConfig | `inlineConfig` 3구간 |

유형:
- R1: 호출 경로
- R2: 인자 전달
- R3: 소스 이동·복귀
- R4: 디버그 연계. hono·vite 소스를 디버거로 실행하려면 프로젝트별 빌드 구성이 필요해서 **사전 결정으로 NOT_TESTED**로 두었다. Stage A T4로 대신한다.

과제 선정의 근거와 도구별 적용 범위는 사전 등록 문서에 있다.
