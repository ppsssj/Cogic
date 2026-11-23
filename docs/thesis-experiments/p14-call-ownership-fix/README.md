# P14-B — 함수형 속성과 private 호출 owner

P14-A의 사후 진단 Hono H2를 제품 분석기에서 수정했다. 제품 변경 커밋은 `6a92f070921b7fb59d2b4b6de0a7a288d6d9303a`, 수정 전 기준은 `48e7058d7d9457d78f1648163c5e77d79ffbc72b`다. P13·P14-A의 원본 관찰과 GT는 수정하지 않았다.

고정 Hono `cd50668335738d170ecd03e783f2f2d5317b95d6`에서 analyzer 원출력의 `Hono.request → Hono.fetch → Hono.#dispatch → compose` calls와 해당 source owner를 확인했다. `Env`, `request`, `rest[0]`을 포함한 dataflow도 확인했다. 이 사례는 결과를 먼저 본 **사후 진단**이며, P13 당시의 측정이나 확증 코퍼스 결과를 대체하지 않는다.

[원인과 수정](root-cause.md) · [수정 전후](before-after.md) · [회귀 결과와 한계](regression-results.md) · [재현](reproduction.md)
