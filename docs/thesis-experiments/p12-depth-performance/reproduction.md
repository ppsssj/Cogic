# 재현

## 준비
1. Cogic `cdc3196`에서 `npm ci && npm run compile` (`out/analyzer/*.js` 생성).
2. P11 고정 프로젝트 체크아웃(P11 [reproduction.md](../p11-real-world/reproduction.md)):
   - hono `cd50668335738d170ecd03e783f2f2d5317b95d6`
   - vite `3567471998e3da315675086f44368e266c9c0e33` (vite는 `pnpm install` 상태에서 측정. 루트 `tsconfig.json`이 없어 fallback 옵션을 쓴다)
3. 실행 위치: **Cogic 저장소 루트를 cwd로** 둔다(cwd에 따라 자동 `@types` 해석이 달라진다. [README.md](README.md) 별도 발견).
4. 가용 메모리 1.2 GB 이상에서 Vite D2를 실행하고, 동시에 다른 측정을 돌리지 않는다.

## 명령

```bash
T=docs/thesis-experiments/p12-depth-performance/tools/profile-depth-v2.cjs
H=<path>/hono; V=<path>/vite
HF=src/helper/cookie/index.ts; VF=packages/vite/src/node/server/index.ts
N="node --max-old-space-size=768"

# Depth별 기준
for d in 0 1 2; do $N $T --root $H --file $HF --depth $d --cache cold --instrument 1 --min-free-mb 400 --out out-h-d$d.json; done
for d in 0 1 2; do $N $T --root $V --file $VF --depth $d --cache cold --instrument 1 --min-free-mb 400 --out out-v-d$d.json; done

# 계측 ON/OFF (해시 비교)
$N $T --root $V --file $VF --depth 2 --cache cold --instrument 0 --min-free-mb 400 --out out-v-d2-off.json

# 캐시 정합성 (Hono)
for c in off warm; do $N $T --root $H --file $HF --depth 2 --cache $c --instrument 1 --min-free-mb 400 --out out-h-d2-$c.json; done

# P12-B 후보 (하네스 실험)
for m in 1 old old-sf; do $N $T --root $V --file $VF --depth 2 --cache cold --instrument 1 --share-program $m --min-free-mb 400 --out out-v-d2-$m.json --dump-graph g-v-$m.json; done
$N $T --root $V --file $VF --depth 2 --cache cold --instrument 1 --min-free-mb 400 --out out-v-d2-base.json --dump-graph g-v-base.json
node docs/thesis-experiments/p12-depth-performance/tools/graph-diff.cjs g-v-base.json g-v-1.json diff-shared-checker.json baseline sharedChecker
node docs/thesis-experiments/p12-depth-performance/tools/graph-diff.cjs g-v-base.json g-v-old-sf.json diff-structure-reuse.json baseline structureReuse
```

- `--out`이 이미 있으면 도구는 덮어쓰지 않고 멈춘다.
- 요약: 결과를 `data/v2/`에 두고 `node tools/summarize.cjs`를 실행하면 `data/summary-runs.csv`, `data/summary.json`이 만들어진다.
- 메모리 감시(선택): `powershell -File tools/monitor.ps1 -TargetPid <node pid> -Output mem.jsonl`

## 기대 결과 (이 환경)

| 조건 | 해시 앞 12자 | 노드/엣지 | 시간 |
|---|---|---|---|
| Hono D0 / D1 / D2 | `528638036df5` / `a7173a741456` / `45ea10193f03` | 10/14, 16/46, 85/207 | 4.7 / 4.6 / 7.7–7.8 s |
| Vite D0 / D1 / D2 | `a8cf81c5addb` / `a7892e4a1042` / `3f9848fc3404` | 46/73, 153/412, 1,078/3,755 | 8.3 / 5.7 / 66.8–80.0 s |
| Vite D2 `old-sf` | `3f9848fc3404` | 1,078/3,755 | 12.2–12.6 s |
| Vite D2 `1` (공유 checker) | `e2c94974111b` | 1,077/3,756 | 9.2–9.6 s |

해시는 절대 경로를 포함한 그래프 JSON 기준이라 **체크아웃 경로가 다르면 값이 달라진다**. 다른 환경에서는 같은 환경 안의 조건 간 일치 여부를 비교한다.

## 검증 명령
```bash
npm run compile
npm run lint
npm test          # pretest: compile + lint:all(웹뷰 포함)
```
