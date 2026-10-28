# P1-B: EXP-01 실행 도구 (Runner)

- 작성일: 2026-10-28(P1-B), 개정 2026-10-28(P1-B-R1, §10)
- 기준:
  - GT 사전 등록 커밋 `41bbe19434b4d284c6368b5fb5158cf1a5dbdf1e`
  - 평가 도구 기준 커밋 `ae82bfbf0e26b7cba67e40af2b1f0a1fe89b81ca`
  - 채점 도구 `exp01-scorer/1.1`
- 상태: **구현과 합성 입력 검증만 했다.** 실제 EXP-01 코퍼스에 Cogic analyzer를 실행하지 않았다(NOT_RUN). 정확도 수치도 만들지 않았다.

## 1. 산출물

| 파일 | 내용 |
|---|---|
| `tools/exp01-run.mjs` | 실행 도구(`exp01-runner/1.1`. P1-B 최초 버전은 1.0) |
| `tools/test/exp01-run.test.mjs` | 합성 fixture와 mock analyzer를 쓰는 단위 테스트 30개(P1-B 19개, P1-B-R1 회귀 11개) |

두 파일은 평가 도구 manifest(`eval-manifest.r1.json`)가 추적하는 `fixtures/exp-01/`와 `tools/exp01/` 밖에 있다. 그래서 manifest 대상 파일 집합은 바뀌지 않는다. runner는 `tools/exp01/lib.mjs`의 `listCaseDirs`·`SCORER_VERSION`을 읽기만 한다. 채점에는 `tools/exp01/score.mjs`를 수정 없이 자식 프로세스로 실행한다.

## 2. 사용법

저장소 루트에서 `npm run compile`을 실행하고, 작업 트리가 깨끗한 상태로 실행한다.

```powershell
node docs/thesis-experiments/tools/exp01-run.mjs [--run-id <id>] [--cases <id,id>] [--repeat 2] [--bootstrap 10000] [--no-score] [--allow-dirty]
```

| 인자 | 기본값 | 의미 |
|---|---|---|
| `--run-id` | `exp01-<UTC YYYYMMDD-HHmm>-<shortsha>[-dirty]` | 결과 폴더 이름. `[A-Za-z0-9._-]`만 허용한다. 이미 있으면 실행을 거부한다 |
| `--cases` | 전체 44개 | 일부 사례만 실행한다. 결과는 확증 결과가 될 수 없다(`CASE_SUBSET`) |
| `--repeat` | 2 | 캐시 OFF 반복 횟수(2 이상) |
| `--bootstrap` | 10000 | `score.mjs`에 그대로 넘긴다. 0 이상의 정수만 받는다. `NaN`, `Infinity`, 음수, 소수, `1e4` 같은 표기는 실행 전에 거부한다. **확증 결과는 사전 등록값 10,000일 때만 가능하다.** 다른 값(0 포함)은 진단용 run으로만 쓰고 `BOOTSTRAP_NOT_PREREGISTERED:<n>`이 된다(§10) |
| `--no-score` | — | 채점하지 않는다. 확증 결과가 될 수 없다(`NOT_SCORED`) |
| `--allow-dirty` | — | 작업 트리가 dirty여도 실행한다. `git-status.txt`·`git-diff.patch`를 저장하고 확증 결과에서 뺀다(P0 dirty 정책) |

코퍼스(`fixtures/exp-01`)와 출력 루트(`data/exp-01`)는 CLI에서 바꿀 수 없다. 테스트만 함수 인자로 임시 경로를 쓴다.

종료 코드는 다음과 같다.

| 코드 | 뜻 |
|---|---|
| 0 | 확증 결과로 쓸 수 있다 |
| 2 | 인자 오류, run 폴더가 이미 있음 |
| 3 | 사전 확인 실패. analyzer를 실행하지 않았다 |
| 4 | 실패 사례가 있거나 run이 무효다 |
| 5 | run은 끝났지만 확증 결과로 쓸 수 없다 |

## 3. 실행 순서

1. **사전 확인**: 하나라도 실패하면 analyzer 모듈을 불러오지 않는다. 이때 `run.json`의 status는 `aborted`다.
   - `manifest.mjs --check --scope gt`
   - `manifest.mjs --check --manifest …/eval-manifest.r1.json`
   - `src/analyzer`, `src/shared`의 각 `.ts`에 대응하는 `out/*.js`가 있고 원본보다 새로운지 확인한다(`ANALYZER_BUILD_STALE_OR_MISSING`).
   - `git status --porcelain`이 비어 있는지 확인한다(`WORKING_TREE_DIRTY`, 확인 불가면 `GIT_STATE_UNKNOWN`).
   - manifest를 만들거나 덮어쓰지 않는다. 검사 출력은 `run.json`의 `preflight.manifests`에 그대로 남긴다.
2. **사례별 입력 구성**: 입력은 `case.json`, 활성 파일, `tsconfig.json`으로 구성한다.
   - 다음 경우는 `INVALID_INPUT`으로 기록하고 analyzer를 부르지 않는다.
     - `case.json` 스키마(`exp01-case/1`)가 다르거나 `caseId`가 폴더 이름과 다르다.
     - `activeFile`이 상대경로가 아니거나 사례 폴더 밖을 가리킨다.
     - 확장자가 `.ts/.tsx/.js/.jsx`가 아니다. `.vue`도 여기에 해당한다.
     - 파일이 없거나 `tsconfig.json`을 JSON으로 읽을 수 없다.
     - `expected.json`이 없다. 내용은 읽지 않는다.
   - analyzer 호출은 아래와 같다. `filePaths`는 사례 폴더의 `.ts/.tsx/.js/.jsx` 전체로, shim 포함이다.

     ```ts
     analyzeWorkspaceActive({
       active: { code, fileName: <사례 폴더>/<activeFile>, languageId },
       workspaceRoot: <사례 폴더>,
       filePaths,
       cacheEnabled,
       debug,
     })
     ```

3. **반복 실행**: 사례마다 아래 순서로 실행한다. 채점에 쓰는 원본은 `off#1`(`cacheEnabled: false`)이다. 각 변형의 결과는 **반환 직후에 바로 저장한다.** `off#1`은 `predictions/`에, 나머지는 `repeats/`에 저장한다. 따라서 뒤 변형에서 실패해도 앞 결과는 남는다.

   | 변형 | 캐시 | 직전 `clearAnalyzerCaches()` | 목적 |
   |---|---|---|---|
   | `off#1` … `off#N` | OFF | `off#1` 앞에서만 | 결정성 |
   | `on-cold` | ON | 예 | 캐시 OFF/ON 정합성 |
   | `on-warm` | ON | 아니요 | hit 경로 정합성(P0 핵심 결론 3: 기존 correctness 검증은 hit 경로를 거치지 않았다) |

   `on-warm`에서 `analyzer.sourceFileCache.hit` 이벤트가 0이면 hit 경로를 검증하지 못한 것이다. 이때는 경고(`cacheHitPathExercised: false`)를 남긴다. 해석 규칙은 §10.4에 있다.

   실패 처리는 다음과 같다.
   - 변형 실행 중 analyzer 예외가 나면 그 사례는 `ANALYZER_ERROR`다.
   - 결과 저장 중 runner 오류가 나면 그 사례는 `RUNNER_ERROR`다. 예를 들어 출력을 JSON으로 직렬화할 수 없는 경우다.
   - 두 경우 모두 다음을 기록한다. 기록 위치는 `run.json`의 `cases[]`와 `failures/<caseId>.json`이다. `RUNNER_ERROR`는 `run.json`에만 기록한다.
     - 실패한 변형(`failedVariant`)
     - 완료된 변형(`completedVariants`)
     - 오류 메시지, stack
     - 이미 저장한 파일과 SHA-256
   - 실패한 사례는 확증 결과에서 빠진다. 사례가 하나라도 실패하면 run 전체를 채점하지 않는다.
4. **구조 검증**:
   - 다음 중 하나라도 해당하면 `INVALID_OUTPUT`이다. 원본은 그대로 저장한다.
     - `graph.nodes`·`graph.edges`가 배열이 아니다.
     - node id가 비었거나 중복이다.
     - node kind나 edge kind가 알 수 없는 값이다.
     - range가 0 이상의 정수가 아니다.
     - endpoint가 노드 목록에 없다.
     - dataflow id에 `arg#i`가 없다.
     - `meta.mode`가 `workspace`가 아니다.
     - `meta.usedTsconfig`가 `true`가 아니다. 이 경우 fixture tsconfig가 적용되지 않은 것이다.
   - edge id 중복은 경고로만 남긴다. 채점기는 같은 키를 합치고 `duplicates`로 기록한다.
5. **D11 진단**: `node_modules/typescript/lib/` 선언을 끝점으로 갖는 edge를 사례별 `tsLibRelations`에 기록한다. 하나라도 있으면 `D11_TS_LIB_RELATIONS_REVIEW_REQUIRED`가 되어 검토 전에는 확증 결과로 쓰지 않는다(§5).
6. **채점**: 모든 사례가 `OK`이고 보호 경로가 바뀌지 않았을 때만 `score.mjs`를 실행한다. 일부 사례만 성공한 run은 채점하지 않는다. `--allow-missing`처럼 빠진 사례를 빈 예측으로 채점하면 FN이 부풀기 때문이다.
   - 확증 결과로 쓰려면 다음 네 조건을 **모두** 만족해야 한다(`scoringGate`). 실패한 조건은 `run.json`의 `scoring.gateFailures`에 남는다.

     | 조건 | 실패 사유 코드 |
     |---|---|
     | 채점 프로세스 종료 코드 0 | `SCORER_EXIT_<code>` |
     | `summary.json`이 있고 읽을 수 있다 | `SCORING_MISSING_SUMMARY` |
     | `scoringStatus === "COMPLETE"` | `SCORING_<status>` |
     | `scorerVersion === "exp01-scorer/1.1"` | `SCORER_VERSION_MISMATCH` |

   - 채점기 실행 자체가 예외로 끝나면 `scoring.status`는 `SCORER_ERROR`다. 이때 오류와 stack을 `run.json`에 남긴다.
   - 채점 프로세스의 signal, spawn 오류, `summary.json` 읽기 오류, 로그 끝 4,000자도 `run.json`의 `scoring`에 남긴다. 로그 전체는 `score-log.txt`에 있다.
   - `SCORING_BLOCKED`이면 원본(`predictions/`)과 진단(`score/diagnostics.json`)을 그대로 둔다. 원인은 사람이 규명한다. runner는 채점기나 GT를 고치지 않는다.
7. **보호 경로**: `docs/benchmarks/`의 파일 해시를 실행 전후로 비교한다. 바뀌었으면 run은 `invalid`다.

## 4. 결과 폴더

```text
docs/thesis-experiments/data/exp-01/<run-id>/
├── run.json             # 마지막에 쓴다. status, 사유, 사전 확인, 사례별 결과·해시, 채점 상태, confirmatory
├── env.json             # OS, CPU, 메모리, Node, V8, TypeScript, 실행 플래그
├── predictions/<caseId>.json   # exp01-raw/1 (off#1 원본)
├── failures/<caseId>.json      # INVALID_INPUT / ANALYZER_ERROR 기록(실패 변형, 완료 변형, 오류, stack, 저장 파일)
├── repeats/<caseId>.<variant>.json   # off#1 외 모든 변형 출력(exp01-raw/1, 생성 직후 저장)
├── git-status.txt, git-diff.patch    # dirty 실행일 때만
├── score/               # score.mjs 출력(matches.csv, metrics-*.csv, diagnostics.json, summary.json …)
└── score-log.txt
```

- 모든 파일은 `wx` 플래그로 쓴다. 이미 있는 파일은 덮어쓰지 않는다. run 폴더가 이미 있으면 실패한 run이라도 시작하지 않는다.
- 사전 확인에서 실패해도 `run.json`(status `aborted`)과 `env.json`을 남긴다(P0 결과 보존 원칙). 같은 run-id는 다시 쓸 수 없다.
- run의 status 값: `completed`, `incomplete`(실패 사례 있음), `invalid`(보호 경로 변경, 모르는 사례 ID), `aborted`(사전 확인 실패 또는 analyzer 모듈 로드 실패). P0 실험 설계 §3의 `completed | aborted | invalid`에 `incomplete`를 더했다.
- 사례의 status 값: `OK`, `INVALID_INPUT`, `ANALYZER_ERROR`, `RUNNER_ERROR`, `INVALID_OUTPUT`.

`exp01-raw/1`의 필드는 다음과 같다.

| 필드 | 내용 |
|---|---|
| `caseId`, `fixtureRoot` | `fixtureRoot`는 실행 시 절대경로다. 채점기가 경로를 상대화할 때 쓴다 |
| `analyzerInput` | 활성 파일, languageId, `filePaths`(상대), `cacheEnabled`, 변형 이름(`predictions/`는 항상 `off#1`) |
| `run` | run-id, runner 버전, `headCommit`, `dirty`, 사전 등록·평가 도구 커밋, 채점 도구 버전, analyzer 빌드 해시, Node, 플랫폼 |
| `inputHash`, `inputFiles` | 사례 폴더 파일별 SHA-256과 그 목록의 해시 |
| `analyzerOutput` | `analyzeWorkspaceActive` 반환값 전체(graph, calls, imports, exports, diagnostics, trace, meta) |

`run.json`의 `cases[].files`에는 저장한 파일의 SHA-256을 남긴다. 이 해시로 채점 전에 원본이 바뀌지 않았음을 확인할 수 있다.

## 5. 반복 비교 규칙

비교 필드(`run.json` `comparedFields`):

- `graph.nodes`
- `graph.edges`
- `imports`, `exports`, `calls`, `diagnostics`
- `meta.mode`, `meta.rootFiles`, `meta.usedTsconfig`

제외하는 필드와 이유는 다음과 같다.

| 제외 | 이유 |
|---|---|
| `meta.projectRoot` | 절대 실행 경로다 |
| 비교 필드 안의 절대 경로 | `<fixtureRoot>`, `<repoRoot>`로 바꾼 뒤 비교한다. 드라이브 문자 대소문자와 `/`·`\` 표기를 모두 처리한다 |
| `trace` | 같은 graph 노드·edge의 방출 순서 기록이다. `orderedHash`에만 포함한다 |
| 실행 시각 | 결과 객체에 없다. `run.json`에만 기록한다 |

해시는 두 가지를 계산한다.

- `semanticHash`: 노드·edge를 id 순으로 정렬하고 키 정렬 JSON으로 만든 SHA-256이다. 결정성(`deterministic`)과 캐시 정합성(`cacheConsistent`) 판정은 이 값으로 한다.
- `orderedHash`: 출력 순서와 `trace`를 포함한다. `orderStable`로 보고만 하고 판정에는 쓰지 않는다.

## 6. D11 결정

`D11_KEEP_PRE_REGISTERED_SCORING`(2026-10-28)으로 결정했다.

- TS lib 대상 GT 17개는 `unsupported-by-design`으로 유지한다. 정규화 규칙과 GT는 바꾸지 않는다.
- 이 관계는 overall Recall에 포함하고 in-scope Recall에서는 뺀다. 지금 채점기가 이미 이렇게 동작한다.
- 실제 출력에 TS lib 대상 관계가 있으면 runner가 `tsLibRelations`로 따로 기록한다. 이때 그 run은 검토 전까지 확증 결과로 쓰지 않는다. `run.json`의 `d11Decision`에 결정 이름을 남긴다.

## 7. 검증(합성 입력)

| 항목 | 결과 |
|---|---|
| runner 단위 테스트(`tools/test/exp01-run.test.mjs`) | PASS 30/30(P1-B 19개 + P1-B-R1 11개) |
| 채점 도구 단위 테스트(`tools/exp01/test/score.test.mjs`) | PASS 44/44(변경 없음) |
| manifest `--scope gt` | OK(214 files) |
| manifest `eval-manifest.r1.json` | OK(227 files). 추적 파일 집합이 바뀌지 않았다 |
| 실제 빌드 신선도 검사(`defaultBuildCheck`, analyzer는 불러오지 않음) | OK |
| 실제 EXP-01 코퍼스 analyzer 실행 | **NOT_RUN** |

테스트가 다루는 것은 다음과 같다.

- manifest 실패, 낡은 빌드, dirty 트리, git 상태를 알 수 없을 때 analyzer를 불러오지 않는다.
- 이 checkout에서 실제 manifest 검사가 통과한다.
- 잘못된 fixture 입력 7종(스키마, 경로 탈출, tsconfig 없음, `.vue`, 깨진 JSON, 파일 없음, id 불일치)을 거부한다.
- analyzer 입력 구성이 맞다(호출 순서 OFF, OFF, ON, ON).
- 원본이 `exp01-raw/1` 형식으로 저장되고, 기록한 해시와 일치하며, `score.mjs`의 `loadPrediction`과 호환된다.
- analyzer 예외는 `ANALYZER_ERROR`로 기록하고 나머지 사례는 계속 실행한다.
- 잘못된 GraphPayload는 `INVALID_OUTPUT`으로 기록하고 원본은 보존한다.
- 구조 검증기가 문제 유형별로 동작한다.
- 기존 run 폴더를 덮어쓰지 않고, run-id 경로 탈출을 거부한다.
- 경로·순서와 무관한 해시를 계산한다.
- 비결정성과 캐시 OFF/ON 불일치를 탐지하고 증거 파일을 보존한다.
- D11 진단을 기록한다.
- 보호 경로가 바뀌면 run을 무효로 한다.
- mock 채점기의 `BLOCKED`, summary 없음, 채점 도구 버전 불일치는 모두 확증 결과로 쓰지 않는다.
- 실제 `score.mjs`를 합성 GT에 연결한 end-to-end 테스트에서 `COMPLETE`와 `BLOCKED`(노드 키 충돌)가 모두 나온다.
- `--no-score`와 사례 일부 실행은 확증 결과로 쓰지 않는다.
- CLI 인자 파싱이 맞다.

end-to-end 테스트의 GT와 예측은 테스트가 임시 폴더에 만든 합성 데이터다. EXP-01 fixture나 Cogic 출력이 아니므로, 여기서 나온 수치는 정확도 결과가 아니다.

## 8. P0 계획과의 차이

| P0 | P1-B | 비고 |
|---|---|---|
| exp-01 §13: `exp01-run.mjs --fixtures … --out …` 후 `exp01-score.mjs --run …` | 경로를 고정했다(인자 없음). 채점은 runner가 `tools/exp01/score.mjs`를 부른다 | 도구 이름은 P1에서 확정하기로 했다(§13). P0 문서는 고치지 않았다 |
| 실험 설계 §3.1: `workloads.json`, `samples.csv`, `summary.md` | 사례별 입력 해시와 SourceFile 이벤트 수는 `run.json`의 `cases[]`에, rootFiles와 `usedTsconfig`는 각 원본의 `analyzerOutput.meta`에, 예측 목록과 지표는 `score/`에 있다. `summary.md`는 만들지 않는다 | 필요하면 P1-B 측정 전에 생성 도구를 추가한다 |
| run status `completed / aborted / invalid` | `incomplete`를 추가했다 | 실패 사례가 있는 완료 run을 구분한다 |

## 9. P1-B 실제 측정 착수 조건

다음을 확인한 뒤에만 실제 측정을 시작한다.

1. PR #2(GT·채점 도구)와 이 PR을 검토한다. 병합 순서는 사용자가 정한다.
2. 사람이 GT를 검토한다. 측정 전 검토를 권장한다. 검토하지 않으면 single-annotator임을 명시한다.
3. 깨끗한 작업 트리에서 `npm run compile`을 실행한 뒤 `exp01-run.mjs`를 실행한다.
4. 결과가 `run.json`의 `confirmatory.eligible: true`일 때만 확증 결과로 보고한다.

## 10. P1-B-R1: 실행 도구 신뢰성 수정

PR #3 검토에서 찾은 결함을 실제 측정 전에 고쳤다. runner 버전은 `exp01-runner/1.1`이 됐다. GT, fixture, 채점 도구, 두 manifest, production analyzer는 바꾸지 않았다. 이번에도 실제 analyzer 실행과 정확도 측정은 하지 않았다(NOT_RUN).

### 10.1 채점 종료 코드 검증

- **결함**: 확증 판정이 `scoringStatus`와 `scorerVersion`만 보고, 채점 프로세스의 종료 코드는 보지 않았다. 그래서 종료 코드가 1이어도 `summary.json`에 `COMPLETE`가 남아 있으면 확증 결과로 판정될 수 있었다. 채점기가 예외를 던지면 runner가 중단되어 `run.json`도 남지 않았다.
- **수정**: §3의 6번 네 조건을 모두 확인한다(`scoringGate`). 채점기 예외는 잡아서 `SCORER_ERROR`로 기록한다. `summary.json`을 읽을 수 없거나 spawn이 실패해도 그 사유를 기록한다.
- **회귀 테스트**: 다섯 경우를 확인한다.
  - 종료 코드 0 + `COMPLETE` → 허용
  - 1 + `COMPLETE` → 차단
  - 2 + `BLOCKED` → 차단
  - 0 + summary 없음 → 차단
  - signal 종료 → 차단

  이와 별도로 채점기 예외, 실제 `defaultScorer`의 프로세스 실패와 깨진 summary도 확인한다.

### 10.2 부분 실행 결과 보존

- **결함**: 네 변형이 모두 끝난 뒤에야 `off#1`을 저장했다. `off#2`, `on-cold`, `on-warm` 중 하나가 실패하면 이미 성공한 결과까지 사라졌다. 저장 중 오류(직렬화 실패 등)는 run 전체를 중단시켰다.
- **수정**: 각 변형의 결과를 반환 직후 `wx` 플래그로 저장한다. `off#1`은 `predictions/<caseId>.json`, 나머지는 `repeats/<caseId>.<variant>.json`이다. 형식은 `exp01-raw/1` 그대로라 `score.mjs`와 호환된다. 채점기는 `predictions/`만 읽는다.
  - 실패하면 실패 변형, 완료 변형, 오류, stack, 저장 파일 해시를 기록한다.
  - runner 오류는 `RUNNER_ERROR`로 기록하고 다음 사례로 넘어간다. `run.json`은 마지막에 항상 쓴다.
  - analyzer 모듈을 불러오지 못하면 `aborted`(`ANALYZER_LOAD_FAILED`)로 기록한다.
- **형식 변화**: `repeats/`에는 이전에는 해시가 다른 변형만 있었다. 이제는 모든 변형이 들어간다. 사례마다 파일이 3개 늘어나고, 비교에 쓰인 출력을 모두 다시 확인할 수 있다.
- **회귀 테스트**:
  - `off#2`, `on-cold`, `on-warm` 실패 시 앞 결과가 남고 기록된 해시와 일치한다.
  - `off#1` 실패 시 예측 파일이 없다.
  - 모든 변형이 저장되고 채점기와 호환된다.
  - 직렬화 실패가 `RUNNER_ERROR`로 기록되고 다른 사례가 계속 실행된다.
  - analyzer 로드 실패가 기록된다.

### 10.3 Bootstrap 입력

- **결함**: `Number(...)`를 검증하지 않았다. 그래서 `NaN`, `Infinity`, 음수, 소수가 그대로 `score.mjs`에 넘어갔다.
- **결정**:
  - P0 계획(exp-01 §9, 실험 설계 §4)의 cluster bootstrap 10,000회를 확증 기준으로 유지한다.
  - `score.mjs`는 0을 "bootstrap CI 생략"으로 처리한다(`bootstrap: null`). 따라서 0은 입력으로 허용하되 진단용 run에서만 쓴다.
  - 10,000이 아닌 값(0 포함)은 모두 `BOOTSTRAP_NOT_PREREGISTERED:<n>`이 되어 확증 결과로 쓸 수 없다. P0에는 0에 대한 규정이 없어서 이렇게 정했다.
  - CLI는 10진 숫자 문자열만 받는다. 그래서 `1e4`, `0x10`도 거부한다. 함수 인자도 0 이상의 정수 number만 받는다.
- **테스트 변경**: 기존 테스트의 공통 실행 함수가 쓰던 기본값을 `bootstrap: 0`에서 10,000으로 바꿨다. 기존 테스트 19개는 확증 가능 판정을 기대하기 때문이다. 단언은 하나도 바꾸지 않았다.
- **회귀 테스트**:
  - 잘못된 입력 8종을 거부한다.
  - 0과 10,000을 받는다.
  - 0, 1,000, 20,000은 확증 결과가 될 수 없다.
  - 10,000은 채점기에 그대로 전달된다.

### 10.4 캐시 hit 경로 검증과 해석 규칙

`run.json`의 `cacheHitPath.status`는 정확도 확증 판정(`confirmatory`)과 **별개로** 기록한다.

| status | 조건 | 쓸 수 있는 주장 |
|---|---|---|
| `VERIFIED` | 모든 사례가 OK이고 OFF/ON 정합(`cacheConsistent`)이며, 모든 사례의 `on-warm`에 SourceFile cache hit가 1건 이상 있다 | "SourceFile cache hit 경로에서 ON/OFF 분석 결과의 정합성이 검증되었다"(이 코퍼스와 이 run 한정) |
| `NOT_VERIFIED_NO_HITS` | 정합하지만 hit가 0인 사례가 있다(`casesWithoutHits`) | 위 주장을 **하지 않는다.** "캐시 ON의 cold/warm 출력이 OFF와 같았다"까지만 쓴다. hit 경로 검증은 미완료로 보고한다 |
| `MISMATCH` | OFF/ON 출력이 다른 사례가 있다(`mismatchedCases`) | 불일치 자체를 결과로 보고한다. 정확도 확증 결과로도 쓰지 않는다(`CACHE_OFF_ON_MISMATCH`) |
| `NOT_EVALUATED` | 실패 사례가 있거나 사례가 없다 | 캐시 관련 주장을 하지 않는다 |

- hit가 없다는 이유로 정확도 채점을 막지는 않는다. 정확도는 `off#1`(캐시 OFF) 출력으로 채점하기 때문이다. hit 경로의 정합성은 EXP-01의 보조 검증이고, 본격적인 검증은 EXP-02에서 한다.
- `VERIFIED`는 이 run에서 hit 이벤트가 생긴 경로만 검증했다는 뜻이다. result 수준 캐시 등 다른 캐시 경로는 포함하지 않는다.
- **회귀 테스트**: hit 있음은 `VERIFIED`, hit 없음은 `NOT_VERIFIED_NO_HITS`(정확도 확증 판정은 유지), 출력 불일치는 `MISMATCH`, 실패 사례가 있으면 `NOT_EVALUATED`인지 확인한다.

