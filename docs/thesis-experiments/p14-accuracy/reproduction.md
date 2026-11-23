# 검증 절차와 보존 위치

Node 24.12.0 및 TypeScript 5.9.3으로 아래 명령을 저장소 루트에서 실행했다. P1-L의 브랜치는 main에 합치지 않고 별도 detached worktree에서 검사했다. 다음 명령의 검증용 출력 경로는 새 임시 파일·폴더를 사용한다. P1-L 원자료와 GT는 덮어쓰지 않는다.

```powershell
npm run compile
node docs/thesis-experiments/tools/exp01/manifest.mjs --check --scope gt
node docs/thesis-experiments/tools/exp01/manifest.mjs --check --manifest docs/thesis-experiments/fixtures/exp-01/eval-manifest.r2.json
node docs/thesis-experiments/tools/exp01/validate-gt.mjs --json <새-임시-파일>
node --test docs/thesis-experiments/tools/exp01/test/score.test.mjs
node --test docs/thesis-experiments/tools/test/exp01-run.test.mjs
node --test docs/thesis-experiments/p14-accuracy/tools/hono-h2-minimal.test.cjs docs/thesis-experiments/p14-accuracy/tools/scorer-overlap.test.mjs
```

Corpus A 현재 main 실행은 다음 명령으로 수행했다. runner는 저장소 안 새 run 폴더에 기록하고 기존 run을 덮어쓰지 않는다. 기존 baseline과 다르므로 완료 후 기술 게이트 실패가 예상된다. 실제 실행을 반복하기보다 보존 run을 우선 검사한다.

```powershell
node docs/thesis-experiments/tools/exp01-run.mjs --run-id <새-run-id> --bootstrap 10000
```

이번 원시 run과 ZIP은 연구실 PC의 저장소 밖 `<P14_RESULTS>/`에 보존한다. 예측에 절대 경로가 있어 Git에 올리지 않는다. ZIP SHA256과 실행 조건은 [Corpus A](results-corpus-a.md)에 있다. 재실행 시 결과가 자동으로 동일해진다고 가정하지 않으며 분석기 빌드, GT·평가 manifest, TypeScript, 정책 및 게이트를 별도 기록해야 한다.

Corpus B 확인에는 P1-L `4c5a3e2` 별도 checkout과 해당 checkout의 `npm ci --ignore-scripts`가 필요하다. 아래 원시 run 경로는 ZIP을 신뢰할 수 있는 위치에 복원한 새 디렉터리이며 원본을 수정하지 않는다.

```powershell
node docs/thesis-experiments/tools/corpus-b/manifest.mjs --check
node docs/thesis-experiments/tools/corpus-b/validate.mjs --json <새-임시-파일>
node docs/thesis-experiments/tools/corpus-b/audit.mjs --json <새-임시-파일>
node --test docs/thesis-experiments/tools/corpus-b-run/test/run.test.mjs docs/thesis-experiments/tools/corpus-b-scoring/test/scope-v2.test.mjs
node docs/thesis-experiments/tools/corpus-b-run/score-pair.mjs --original <original-run> --improved <improved-run> --out <새-출력-폴더> --bootstrap 10000
```

`audit.mjs`를 upstream checkout 없이 실행한 경우 포함 파일과 기록된 해시만 대조하며 upstream에서의 원본 재추출은 검증하지 않는다. 원본 P1-L ZIP은 연구실 PC의 `cogic-results/p1l/` 아래에 있다. GitHub에 공개된 pair summary와 재채점 결과는 JSON 구조와 값이 같았다.

Hono H2는 315개 `src` 파일이 추적된 clean `cd50668` worktree, 의존성과 빌드된 현재 main이 필요하다. `tsconfig.json`의 루트 파일이 비어 있어 analyzer와 동일하게 전달된 파일 목록으로 fallback한다.

```powershell
node docs/thesis-experiments/p14-accuracy/tools/hono-h2-diagnostic.cjs <고정-Hono-worktree>
```

이번 확인: 제품 `npm test`의 compile·lint·webview lint와 VS Code 테스트 48개 통과; EXP-01 scorer 53개, runner 41개, Corpus B runner·scope 19개, P14 특성화 테스트 2개 통과. 실제 사용자 연구와 독립 사람 GT 검토는 수행하지 않았다.
