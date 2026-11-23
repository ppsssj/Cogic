# Hono H2 — 사후 진단

## DIAGNOSTIC: 관찰

P13에서 이미 발견한 Hono `cd50668335738d170ecd03e783f2f2d5317b95d6`의 경로 `Hono.request → fetch → #dispatch → compose`를 별도로 조사했다. 이것은 사후 발견 사례이며 정확도 확증 코퍼스나 독립 holdout에 넣지 않았다. 현재 `fdaecd4`의 analyzer 원출력을 cache OFF, workspace 모드, `src/hono-base.ts` active, 추적된 src의 315개 TS/JS 파일을 입력해 확인했다. 로컬 Hono worktree는 지정 커밋이며 clean이었다. 결과는 [hono-h2-observation.json](hono-h2-observation.json), 도구는 [hono-h2-diagnostic.cjs](tools/hono-h2-diagnostic.cjs)다. 이 출력은 active 파일 분석이며 P13 UI depth 2 전체 그래프와 동일하다고 주장하지 않는다.

| 호출 지점 | TypeScript 해석 | 해당 active 파일 analyzer 결과 |
|---|---|---|
| 525·528행 `this.fetch(...)` | `fetch` 심볼은 498행 property declaration, resolved signature는 그 property의 `FunctionType` | `Hono.request`, `Hono.fetch` 노드는 있으나 둘을 잇는 calls/dataflow 없음 |
| 503행 `this.#dispatch(...)` | 425행 `#dispatch` method declaration | `#dispatch` 노드와 `Hono.fetch → #dispatch` calls/dataflow 없음 |
| 469행 `compose(...)` | `src/compose.ts:15` arrow-function signature | `compose` external 노드와 calls/dataflow는 있으나 source가 `hono-base.ts` 파일 노드로 귀속됨. 별도 `Hono.route → compose`도 존재 |

P13에서 말한 호출 경로 엣지 누락의 최소한 일부는 **원출력 단계의 분석 문제**다. `#dispatch → compose`는 단순히 모든 호출이 사라진 것이 아니라 source owner가 잘못 기록됐다. 원출력에 없는 관계는 UI 렌더링만으로 복원되지 않는다. P13 UI 관찰에서 다른 가시성 영향이 전혀 없었다는 뜻은 아니다. `Env → env/rest`, `request → request`, `rest[0] → env`에 대한 기대 dataflow는 각 호출 관계가 누락되어 해당 소스·대상 사이에서 관찰되지 않았다.

## 원인과 최소 재현

현재 `src/analyzer/analyze.ts`의 class 선언 수집과 body owner 전환은 메서드 이름에 `ts.isIdentifier`를 요구한다. ECMAScript `#dispatch`는 `PrivateIdentifier`이므로 메서드 노드 및 owner 전환 대상에서 빠지는 것이 코드와 원출력에 부합한다. 또한 `resolveCallTarget`은 resolved signature 선언을 심볼 선언보다 우선하며 같은 파일 선언 위치를 `idByDeclPos`에서 찾는다. `fetch`의 signature는 property의 function type인 반면 graph 노드는 arrow initializer 위치에 있다. 이 위치 불일치가 누락과 부합한다. `#dispatch`의 경우 선언 위치를 가리키더라도 해당 노드가 수집되지 않는다. 이 원인 설명은 코드 경로와 진단 결과에 근거한 해석이며 수정 효과는 아직 검증하지 않았다.

독립적인 최소 코드에서 typed arrow property, `this.fetch`, `#dispatch` 및 내부 일반 함수 호출을 [특성화 테스트](tools/hono-h2-minimal.test.cjs)로 재현했다. 현재 동작을 확인하는 테스트이지 수정 후 통과해야 할 성공 기준은 아니다. P14-B에서는 private method의 노드·owner 처리와 typed function-valued property의 대상 해석을 각각 분리해 수정하고, 부정 사례·재귀·dataflow와 기존 adapter 회귀를 검증한다. 제품 수정은 이번 연구 범위 밖이다.
