# P13 Stage B — 실제 프로젝트 과제 사전 등록 (측정 전 고정)

이 파일과 [data/stage-b-answer-key.json](data/stage-b-answer-key.json)은 Stage B 측정 전에 커밋한다. 측정 결과를 본 뒤 과제나 기준을 바꾸지 않는다. Cogic이 관계를 분석하지 못해도 과제는 교체하지 않는다.

## 과제 선정
P11과 같은 고정 커밋을 대상으로, 실제 소스를 검토해 프로젝트마다 2개 과제를 골랐다. 선정 기준:
- 둘 이상의 파일을 거치는 호출 경로
- 매개변수 전달이 포함됨
- TypeScript 소스로 정답을 확인할 수 있음
- 특정 도구를 위해 만든 코드가 아님

| 과제 | 프로젝트 | 시작 → 목표 | 경로(함수 수 / 파일 수) | 구조적 특징 |
|---|---|---|---|---|
| H1 | hono `cd50668` | `setCookie` (helper/cookie/index.ts:99) → `_serialize` (utils/cookie.ts:174) | setCookie → generateCookie → serialize → _serialize (4 / 2) | `export const` 화살표 함수, 조건별 호출 지점 3개 |
| H2 | hono `cd50668` | `Hono.request` (hono-base.ts:518) → `compose` (compose.ts:15) | request → fetch → #dispatch → compose (4 / 2) | 클래스 속성 화살표 함수, private 메서드, rest 매개변수 |
| V1 | vite `3567471` | `createServer` (server/index.ts:506) → `resolveConfig` (config.ts:1480) | createServer → _createServer → resolveConfig (3 / 2) | 함수 선언, 조건식 안의 호출 |
| V2 | vite `3567471` | `build` (build.ts:575) → `resolveConfig` (config.ts:1480) | build → createBuilder → resolveConfigToBuild → resolveConfig (4 / 2) | 같은 파일 안에서 멀리 떨어진 정의(578 → 1857 → 584) |

정확한 호출 지점과 인자→매개변수 대응: [data/stage-b-answer-key.json](data/stage-b-answer-key.json)

## 과제 유형과 성공 기준
| 유형 | 성공 기준(UI에서 관찰) | 부분 |
|---|---|---|
| R1 호출 경로 | 도구 UI에 경로의 연속된 호출 관계가 모두 보인다(트리 부모-자식 또는 그래프 엣지) | 일부 관계만 |
| R2 인자 전달 | answer key의 흐름 구간이 모두 **도구가 표시한 인자→매개변수 대응**으로 보인다 | 일부 구간만, 또는 매핑 표시 없이 정의 이동으로 코드를 읽어야 함 |
| R3 소스 이동·복귀 | 도구 뷰에서 목표 함수의 소스(목표 파일, 정의 위치)로 이동한 뒤, 시작 맥락(시작 파일 또는 시작점이 포함된 뷰)으로 돌아온다. 복귀 조작 수와 뷰·시작점·선택 유지 기록 | 이동만 성공 |
| R4 디버그 연계 | — | **NOT_TESTED(사전 결정)**: hono·vite 소스 경로를 디버거로 실행하려면 프로젝트별 빌드나 테스트 실행 구성이 필요하다. 도구 비교와 무관한 변수가 커서 Stage A T4로 대신한다 |

분류는 Stage A와 같다(`SUPPORTED_AND_VERIFIED` / `PARTIALLY_SUPPORTED` / `UNSUPPORTED_BY_DESIGN` / `EXECUTION_FAILED` / `ENVIRONMENT_BLOCKED` / `NOT_TESTED`).

## 도구별 조작 경로 (각 도구의 정상 사용 경로; 시작 상태 이후만 조작 수에 포함)
시작 상태(공통·미집계): 시작 파일을 열고, TS 서버 준비를 기다린 뒤, 커서를 시작 심볼 이름에 둔다.

| 도구 | R1 | R2 | R3 |
|---|---|---|---|
| VS Code 기본 | `Shift+Alt+H` → `Show Outgoing Calls` → 경로 함수 이름의 접힌 행만 펼침(펼침 1회 = 1, 최대 8회) | 경로를 따라 호출 지점 이름에 커서(1) + `F12`(1)를 반복. 매핑 표시 기능이 없으므로 모든 정의에 도달하면 부분, 도달 못 하면 실패 | Call Hierarchy의 목표 행 클릭(1) → 시작 행 클릭(1)으로 복귀 |
| Trace Function Flow | 시작 함수 위 CodeLens `Trace Function` 클릭. 없으면 명령 팔레트 `Trace Function Flow: Trace Function Flow` + 빠른 선택에서 시작 함수(제공될 때만) | 목표 노드 클릭(1) 후 상세 패널 확인: 매핑 표시 → 성공, 호출식만 → 부분, 정보 없음 → 미지원 | 목표 노드 더블클릭(1) → 그래프에 시작 노드가 있으면 그것을 더블클릭, 없으면 `Alt+Left` 최대 6회 |
| Context Graph | 패널 열기 + Generate. Windows worker 부재 메시지(`No usable worker runtime`)가 나오면 R1–R3 모두 `ENVIRONMENT_BLOCKED` | 〃 | 〃 |
| Cogic | `Cogic: Open Editor Panel`(1) → Depth 2 선택(1) → Generate(1) → 경로 파일의 접힌 파일 그룹 펼침(각 1). `Fit Graph`는 판독 보조로 미집계 | `dataflow` 엣지와 목표 노드 선택(1) 후 Inspector PARAM FLOW에서 구간별 인자→매개변수 표시 확인 | 목표 노드 더블클릭(1) → 시작 노드 더블클릭(1)으로 복귀. Root·노드 집합·선택 유지 기록 |

- Cogic의 Depth는 모든 과제에서 2로 고정한다. 경로가 파일 2개에 걸치므로 목표 파일까지 분석된다.
- 그래프 판독: React Flow 가상화 때문에 판독 전 `Fit Graph`를 누른다(미집계, P3와 같음). 노드와 엣지는 렌더링된 DOM(노드 제목, 엣지 id)에서 읽는다. 내부 API 응답만으로 성공을 판정하지 않는다.
- 이름 매칭: 경로 함수 이름이 노드나 행의 표시 텍스트에 함수 이름으로 나타나면 일치로 본다(`#dispatch`는 `dispatch` 표기도 허용). 과다 표시(정답 밖의 관계)는 실패로 보지 않고 기록만 한다.

## 반복, 순서, 안정성
- (도구, 과제)마다 VS Code를 새로 실행해 독립 실행 3회 한다. Context Graph는 프로젝트마다 3회 시도한다.
- 회차마다 도구 순서를 회전하고(r0: VS Code, TFF, Cogic / r1: TFF, Cogic, VS Code / r2: Cogic, VS Code, TFF), 과제는 H1, H2, V1, V2 순으로 한다.
- 실행 전 가용 메모리가 1,000 MB 이상이어야 하고, 한 번에 하나만 실행한다. 결과는 즉시 기록하고, 중단되면 재개한다.
- 작업 복사본(P11 `git worktree`)이 실행 전후 깨끗해야 한다.
- 3회의 분류가 다르면 모두 보고하고, 대표값은 2회 이상 나온 분류로 정한다.
