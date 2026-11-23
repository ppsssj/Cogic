# Hono H2 수정 전후

`src/hono-base.ts`를 활성 파일로 지정하고 동일한 Hono commit의 추적된 315개 TS/JS 파일을 workspace 입력으로 사용했다. 수정 전 analyzer는 `48e7058`, 수정 후 analyzer는 `6a92f070921b7fb59d2b4b6de0a7a288d6d9303a`이며 Node v24.12.0, TypeScript 5.9.3이다. 결과는 analyzer 원출력이고 UI 경쟁 실험을 재수행한 결과가 아니다. [수정 후 H2 진단 기록](hono-h2-after.json)과 [P14-A 기록](../p14-accuracy/hono-h2-observation.json)은 별개다.

| 관계 | 수정 전 | 수정 후 |
|---|---|---|
| `Hono.request → Hono.fetch` | 호출·전달 누락 | calls, `env <- Env`, `executionCtx <- executionCtx`, 두 request 분기 확인 |
| `Hono.fetch → Hono.#dispatch` | private 노드 및 호출 누락 | calls, `request <- request`, `executionCtx <- rest[1]`, `env <- rest[0]`, `method <- request.method` |
| `Hono.#dispatch → compose` | calls/dataflow의 source가 파일 노드 | calls 및 `middleware`, `onError`, `onNotFound` 전달이 `Hono.#dispatch` owner에 귀속 |

별도의 기존 `Hono.route → compose`는 유지됐다. 두 개의 request 호출 지점은 같은 calls 관계로 중복 제거되며 서로 다른 request 인자 표현의 dataflow는 별도로 남는다. 복구된 `rest[0]`은 함수 본문에서 `#dispatch`의 `env`로 가는 표현식 전달이다. 이 기록만으로 호출 간 여러 단계를 합성한 전체 값 추적을 주장하지 않는다.

## 그래프 비교

| 항목 | 전 | 후 |
|---|---:|---:|
| 노드 | 36 | 40 |
| 엣지 | 84 | 124 |
| 기존 노드 ID·속성 | 36개 | 36개 모두 동일 |
| 엣지 ID | — | 28개 제거, 68개 추가 |

제거된 28개는 모두 동일 kind·target·label·인자 인덱스를 가진 관계가 수정 후 다른 owner에도 존재한다. 이는 파일에 잘못 귀속된 관계의 이동과 부합하지만, 이 자동 대조만으로 모든 새 owner의 의미적 정확성이나 새 FP 부재를 증명하지 않는다. 새 노드 4개는 `#addRoute`, `#handleError`, `#dispatch`, `#clone`이다. 수정 후 중복 edge ID는 0이다.

동일 PC에서 순차 측정한 cache OFF 3회는 전 3010/2507/2527 ms, 후 2958/2470/2449 ms다. cache ON cold/warm은 전 2366/953 ms, 후 2351/952 ms였다. 각 버전 내 세 OFF 출력 및 ON cold/warm 출력의 정규화 그래프 해시가 일치했다. 단일 PC의 소수 관측치이므로 성능 동등성의 통계적 증명은 아니다.
