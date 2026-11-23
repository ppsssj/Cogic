# 재현

수정 전 `48e7058d7d9457d78f1648163c5e77d79ffbc72b`, 제품 수정 `6a92f070921b7fb59d2b4b6de0a7a288d6d9303a`다. Node v24.12.0, TypeScript 5.9.3, Windows에서 실행했다. Hono는 `cd50668335738d170ecd03e783f2f2d5317b95d6`의 clean 작업 복사본과 설치된 의존성을 사용한다. 원본 프로젝트나 기존 데이터에 출력하지 않는다.

```powershell
npm run compile
npm run lint
npm test
node docs/thesis-experiments/tools/exp01/manifest.mjs --check --scope gt
node docs/thesis-experiments/tools/exp01/manifest.mjs --check --manifest docs/thesis-experiments/fixtures/exp-01/eval-manifest.r2.json
node docs/thesis-experiments/p14-accuracy/tools/hono-h2-diagnostic.cjs <Hono-worktree>
```

P14-A `hono-h2-minimal.test.cjs`는 수정 전 결함이 있어야 통과하는 역사적 테스트이며 기본 실행에서는 skip된다. 수정 전 `48e7058`에서 원본이 통과함을 확인했다. 수정 후에는 새 제품 테스트가 성공 조건이다. opt-in 정책과 원본 사본은 [UI smoke 실행 문서](ui-smoke/README.md)에 있다.

## 그래프와 시간 비교

두 제품 커밋을 별도 checkout에서 각각 설치·컴파일한다. 이 디렉터리의 `tools/hono-snapshot.cjs`를 두 checkout의 같은 상대 경로에 복사해 실행하고, 출력은 각각 존재하지 않는 별도 파일로 지정한다. snapshot은 원본 그래프와 절대 경로를 포함하므로 그대로 공개하지 않는다. 두 결과를 같은 Hono worktree와 동일 환경에서 비교한다.

```powershell
node docs/thesis-experiments/p14-call-ownership-fix/tools/hono-snapshot.cjs <Hono-worktree> <새-snapshot.json>
node docs/thesis-experiments/p14-call-ownership-fix/tools/compare-snapshots.cjs <before.json> <after.json>
```

OFF는 캐시를 지운 뒤 3회, ON은 cold와 warm 각 1회다. 비교 도구의 owner 변경 판단은 같은 kind·target·label·인자 인덱스가 수정 후 존재하는지 검사할 뿐 사람의 관계 검토를 대체하지 않는다.

## Corpus A 회귀 진단

P14-A의 baseline과 새 실행의 `score/matches.csv`를 비교한다. 원시 파일에는 로컬 절대 경로가 있을 수 있어 저장소 밖에 둔다. 해당 runner는 기존 baseline 동일성·clean 작업 트리 등 기술 게이트를 적용한다. 이 작업의 수정 후 결과는 `--allow-dirty --bootstrap 0` 진단으로만 실행했으며 공식 정확도 점수가 아니다.

```powershell
node docs/thesis-experiments/tools/exp01-run.mjs --run-id <새-고유-ID> --allow-dirty --bootstrap 0
node docs/thesis-experiments/p14-call-ownership-fix/tools/compare-exp01-runs.cjs <수정전-matches.csv> <수정후-matches.csv>
```

P14-A GT v1·사후 개정 scorer 1.2의 strict 행만 대조한다. 수정 전후 관계의 판정 전이는 [regression-results.md](regression-results.md)에 있으며, 독립 사람 검토를 대신하지 않는다.
