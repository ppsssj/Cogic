# Stage B 결과 — 실제 프로젝트(hono, vite)

4개 과제 × 4개 도구 × 독립 실행 3회 = 48회 모두 실행했다. 실행 순서는 사전 등록대로 회차 → 과제 → 도구 회전이다. 작업 복사본은 매 실행 후 깨끗했다. **모든 (과제, 도구, 유형)에서 3회의 분류가 같았다.**

원자료:
- 요약: [data/stage-b-summary.csv](data/stage-b-summary.csv)
- 실행별 결과: [data/stage-b-per-run.json](data/stage-b-per-run.json)
- 실행별 증거: [data/runs/](data/runs/) (`p13-tasks.json`, `evidence.json`, `run.log`)

## 1. 분류 (3회 대표값)
| 과제 | 유형 | VS Code 기본 | Trace Function Flow | Context Graph | Cogic |
|---|---|---|---|---|---|
| H1 hono `setCookie → _serialize` | R1 호출 경로 | SUPPORTED_AND_VERIFIED | SUPPORTED_AND_VERIFIED | ENVIRONMENT_BLOCKED | SUPPORTED_AND_VERIFIED |
| | R2 인자 전달 | PARTIALLY_SUPPORTED | PARTIALLY_SUPPORTED | ENVIRONMENT_BLOCKED | **SUPPORTED_AND_VERIFIED** |
| | R3 이동·복귀 | SUPPORTED_AND_VERIFIED | SUPPORTED_AND_VERIFIED | ENVIRONMENT_BLOCKED | SUPPORTED_AND_VERIFIED |
| H2 hono `Hono.request → compose` | R1 | EXECUTION_FAILED | EXECUTION_FAILED | ENVIRONMENT_BLOCKED | PARTIALLY_SUPPORTED |
| | R2 | PARTIALLY_SUPPORTED | EXECUTION_FAILED | ENVIRONMENT_BLOCKED | EXECUTION_FAILED |
| | R3 | EXECUTION_FAILED ^C3 | EXECUTION_FAILED ^C2 | ENVIRONMENT_BLOCKED | SUPPORTED_AND_VERIFIED |
| V1 vite `createServer → resolveConfig` | R1 | SUPPORTED_AND_VERIFIED | SUPPORTED_AND_VERIFIED | ENVIRONMENT_BLOCKED | **EXECUTION_FAILED** |
| | R2 | PARTIALLY_SUPPORTED | EXECUTION_FAILED ^C1 | ENVIRONMENT_BLOCKED | **SUPPORTED_AND_VERIFIED** |
| | R3 | SUPPORTED_AND_VERIFIED | EXECUTION_FAILED | ENVIRONMENT_BLOCKED | **EXECUTION_FAILED** |
| V2 vite `build → resolveConfig` | R1 | SUPPORTED_AND_VERIFIED | SUPPORTED_AND_VERIFIED | ENVIRONMENT_BLOCKED | PARTIALLY_SUPPORTED |
| | R2 | PARTIALLY_SUPPORTED | EXECUTION_FAILED ^C1 | ENVIRONMENT_BLOCKED | **SUPPORTED_AND_VERIFIED** |
| | R3 | SUPPORTED_AND_VERIFIED | EXECUTION_FAILED | ENVIRONMENT_BLOCKED | **EXECUTION_FAILED** |
| 모든 과제 | R4 디버그 연계 | NOT_TESTED (사전 결정) | NOT_TESTED | NOT_TESTED | NOT_TESTED |

### 판독 정정 C1–C3
집계 단계에서 하네스 로그의 실패 단계 기록을 근거로 스펙 자체의 판정 오류를 정정했다. 원래 값은 `rawClasses` 열에 보존했다.

| # | 대상 | 스펙의 판정 → 정정 | 근거 |
|---|---|---|---|
| C1 | TFF V1·V2 R2 | UNSUPPORTED_BY_DESIGN → EXECUTION_FAILED | 목표 노드 클릭이 30초 시간 초과로 실패했다(노드는 DOM에 있지만 좁은 패널 밖). 사전 등록상 '미지원'은 노드를 선택한 뒤 상세 패널에 정보가 없을 때만 쓴다 |
| C2 | TFF H2 R3 | 기록 없음(스펙 종료) → EXECUTION_FAILED | 시작 함수에서 그래프를 만들지 못해 R3를 수행할 뷰가 없었다. 스펙이 R3를 기록하기 전에 예외로 끝났다(exit 1) |
| C3 | VS Code H2 R3 | SUPPORTED_AND_VERIFIED → EXECUTION_FAILED | 목표 행이 Call Hierarchy에 없어서 열기 단계가 실패했다. 편집기가 목표 파일에 있던 것은 R2의 F12 결과였다 |

## 2. 조작 수 (스크립트 경로 기준, 3회 동일)
| 과제 | 유형 | VS Code | TFF | Cogic |
|---|---|---:|---:|---:|
| H1 | R1 / R2 / R3 | 4 / 6 / 2 | 1 / 1 / 2 | 5 / 1 / 2 |
| H2 | R1 / R2 / R3 | 2 / 6 / 1 | 2 / 0 / – | 5 / 2 / 3 |
| V1 | R1 / R2 / R3 | 3 / 4 / 2 | 1 / 1 / 2 | 3 / 0 / 0 |
| V2 | R1 / R2 / R3 | 4 / 6 / 2 | 1 / 1 / 2 | 3 / 0 / 1 |

- Cogic R1의 조작에는 패널 열기, Depth 2, Generate, 폴더·파일 그룹 펼침, 진단 알림을 피하는 캔버스 드래그(H2 1회)가 들어 있다.
- 실패한 과제의 조작 수는 실패 지점까지의 수다. 성공 과제끼리만 비교해야 한다.
- 복귀 조작은 성공한 R3에서 모든 도구가 1회였다.

## 3. 과제별 관찰
**H1 (hono 쿠키 헬퍼, `export const` 화살표 함수, 파일 2개)**
- **세 도구 모두 호출 경로를 보여 줬다.**
  - VS Code: Call Hierarchy 4단계
  - TFF: CodeLens 한 번으로 4개 함수와 엣지
  - Cogic: Depth 2 + `utils` 폴더·`cookie.ts` 파일 그룹 펼침 후 세 `calls` 엣지
- **인자 전달은 Cogic만 구간별로 보여 줬다.** `dataflow` 엣지 `value <- value` 3개(S1–S3, 모두 그래프 엣지)를 확인했다. TFF는 호출식 `_serialize(name, value, opt)`만 보여 줬고, VS Code는 F12로 세 정의에 도달한 뒤 코드를 읽어야 한다.
- [figures/b-H1-cogic-dataflow.png](figures/b-H1-cogic-dataflow.png), [b-H1-tff-graph.png](figures/b-H1-tff-graph.png), [b-H1-vscode-call-hierarchy.png](figures/b-H1-vscode-call-hierarchy.png)

**H2 (hono `Hono` 클래스: 클래스 속성 화살표 함수 `request`·`fetch`, private 메서드 `#dispatch`)**
- **세 도구 모두 이 경로를 끝까지 잇지 못했다.**
  - VS Code: `request`의 outgoing 호출에 `fetch`가 나오지 않았다(행: `test`, `mergePath`).
  - TFF: `request` 위에 CodeLens가 없고, 명령 팔레트 빠른 선택에도 `request`가 없어 그래프를 만들지 못했다.
  - Cogic: `request`, `fetch`, `#dispatch`(멤버 행), `compose`는 표시했다. 하지만 클래스 속성 화살표 함수와 private 메서드에서 나가는 `calls`/`dataflow` 엣지가 없었다(클래스에서 `compose`로 가는 엣지는 `route→compose`뿐).
- Cogic은 `compose` 노드 더블클릭으로 `compose.ts`로 이동하고 시작 노드로 돌아왔다(R3 성공). 진단 알림을 피하려고 캔버스를 1회 드래그했다.
- **Cogic 분석기의 한계**: 클래스 속성 화살표 함수와 `#private` 메서드 안의 호출을 그래프 엣지로 만들지 않는다. VS Code TypeScript Call Hierarchy도 `this.fetch`(속성 화살표 함수 호출)를 따라가지 못했다.

**V1·V2 (vite, 큰 파일과 큰 그래프)**
- VS Code와 TFF는 호출 경로를 모두 보여 줬다. TFF는 CodeLens 한 번이었다.
- **Cogic의 그래프 표시는 실패하거나 부분에 그쳤다.**
  - Depth 2 Generate에 V1 약 385–391초, V2 약 221–264초가 걸렸다(캐시 ON, 실행마다 새 프로필).
  - 생성된 그래프는 엣지가 V1 833개, V2 703개였다. Fit(최소 배율 0.1)에서 경로 노드가 화면 밖에 남았고, React Flow 가상화 때문에 DOM에도 그려지지 않았다(V1: 경로 함수 0개 표시, V2: `createBuilder`, `resolveConfigToBuild`만 표시). P8에서 확인한 대형 그래프 가시성 문제와 같다. [figures/b-V1-cogic-fit-not-rendered.png](figures/b-V1-cogic-fit-not-rendered.png)
  - 그래서 Cogic R3(노드 더블클릭 이동)도 대상 노드가 없어 실패했다.
- **반면 인자 전달은 Cogic만 구간별로 보여 줬다.** Inspector PARAM FLOW에 `createServer -> _createServer inlineConfig <- inlineConfig`, `_createServer -> resolveConfig (config.ts) inlineConfig <- inlineConfig`가 나타났다(V1 S1–S2 모두 PARAM FLOW 행, V2 S1·S3는 행, S2는 그래프 엣지).
  - 이 행은 노드를 선택하지 않은 상태의 기본 목록(처음 20개)에 포함되어 보였다. 목록 순서에 따라서는 보이지 않을 수도 있다.
- TFF는 V1·V2 그래프(보이는 노드 75개 수준)가 좁은 패널보다 넓어서 목표 노드를 클릭하지 못했다. 그래서 R2(상세 패널)와 R3(이동)를 수행하지 못했다. [figures/b-V1-tff-node-outside-panel.png](figures/b-V1-tff-node-outside-panel.png)

## 4. Context Graph
모든 실행에서 Generate 후 `No usable worker runtime found for win32-x64` 메시지가 나왔다. **기능을 평가하지 못했다(ENVIRONMENT_BLOCKED).** 원인은 [tools-and-versions.md](tools-and-versions.md)에 있다.

## 5. 실행 시간 (보조 기록)
Cogic Generate 시간(Depth 2, 캐시 ON):

| 과제 | 3회 (ms) |
|---|---|
| H1 | 18,694 / 15,652 / 18,824 |
| H2 | 36,468 / 42,000 / 41,830 |
| V1 | 385,285 / 391,011 / 387,068 |
| V2 | 225,711 / 221,061 / 264,017 |

- 스모크 실행에서는 캐시 OFF(P3 하네스 기본값)일 때 V1이 5분 안에 끝나지 않았다.
- 같은 PC에서 P11의 Depth 1 UI 측정(vite 첫 Generate 약 7–8초)과 큰 차이가 있다. Depth 2는 확장된 외부 파일마다 분석을 반복하기 때문으로 보인다(원인 분석은 하지 않음).
- 이 시간은 자동화 기록이며 사용자 대기 시간이나 이해 시간으로 해석하지 않는다.
