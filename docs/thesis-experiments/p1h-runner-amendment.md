# P1-H: EXP-01 runner 1.2 (사후 개정 평가 프로토콜)

- 작성일: 2026-10-29
- 기준: `research/thesis-p1g-scorer-amendment` `52ff632dacd14850d835604f80f9b3b4f4b916cc` (PR #8 HEAD, 미병합)
- 이 PR의 base: PR #8 브랜치(`main`이 아님)
- 상태: **runner 1.2 구현. 실제 EXP-01 실행은 하지 않았다(NOT_RUN).**

---

## 1. 변경 이유

PR #8의 scorer 1.2(P1-G)를 runner 1.1로는 실행할 수 없었다([p1g-scorer-amendment.md §12](p1g-scorer-amendment.md#12-runner-11과의-관계와-runner-12로-넘길-작업)).

1. runner 1.1은 `eval-manifest.r1.json`을 고정으로 검사한다. scorer 1.2에서는 r1이 drift 4개를 보고하므로, preflight에서 멈춘다.
2. runner 1.1은 허용 scorer 버전을 `lib.mjs`의 `SCORER_VERSION`에서 가져왔다. 그래서 scorer 버전이 바뀌면 runner의 기준도 **조용히** 함께 바뀌었다.
3. run 기록에 사후 개정 사실을 남기는 필드가 없었다. 실행 커밋(HEAD)과 측정 대상 analyzer의 관계를 확인하는 장치도 없었다.

## 2. 변경 내용 (`tools/exp01-run.mjs`)

| 항목 | runner 1.1 | runner 1.2 |
|---|---|---|
| `RUNNER_VERSION` | `exp01-runner/1.1` | `exp01-runner/1.2` |
| 평가 manifest | `eval-manifest.r1.json` | `eval-manifest.r2.json`(`PROTOCOL.evaluationManifest`). r1은 저장소에 그대로 두고 쓰지 않는다 |
| GT manifest | `gt-manifest.json`(`--scope gt`) | 같음 |
| 허용 scorer 버전 | `lib.mjs`의 `SCORER_VERSION` | runner 안의 문자열 상수 `"exp01-scorer/1.2"`. `lib.mjs` 값은 비교에만 쓴다 |
| r2 파일 내용 | 검사 없음 | LF 정규화 SHA-256을 `cb7bfd62…72b2`로 고정. 다르면 preflight 실패 |
| scorer 모듈 버전 | 검사 없음 | `lib.mjs`가 고정 버전과 다르면 preflight 실패 |
| analyzer 동일성 | 없음 | 기준 analyzer(`43ace0f`)와 비교(§4). 다르면 기술 게이트 실패 |
| 연구 상태 | 없음 | `evaluationProtocol`, `amendmentReason`, `researchStatus`, `preregisteredConfirmatory: false` |
| `confirmatory` | `eligible`, `reasons` | 같은 필드에 `scope: "TECHNICAL_EXECUTION_GATE"`와 설명 추가 |
| `env.json` | OS, CPU, 메모리, Node, V8, TypeScript | 위 항목에 npm, npm 오류, git HEAD, runner 버전, 도구 해시(LF 정규화 SHA-256) 추가 |
| CLI 출력 | `confirmatory: ELIGIBLE` | `technical gates: PASSED`. 그 아래 연구 상태(사전 등록 확증 결과 아님)와 analyzer 동일성을 한 줄씩 출력 |

그대로 유지한 것:

- 종료 코드(0, 2, 3, 4, 5)
- 채점 프로세스의 종료 코드·`summary.json`·`COMPLETE`·버전 검사(`scoringGate`)
- 결정성과 캐시 OFF/ON 비교, 캐시 hit 경로 판정
- D11 진단
- `docs/benchmarks` 보호
- 덮어쓰기 금지
- 변형별 즉시 저장
- `--allow-dirty`, `--cases`, `--no-score`, bootstrap 게이트

### 2.1 preflight 순서

아래 검사 중 하나라도 실패하면 analyzer를 불러오지 않는다. 이때 종료 코드는 3이고 status는 `aborted`다.

1. `manifest.mjs --check --scope gt`(GT 214개)
2. `manifest.mjs --check --manifest …/eval-manifest.r2.json`(평가 도구 227개)
3. 프로토콜 검사. 실패 사유는 `PROTOCOL_CHECK_FAILED:<사유>`로 기록한다.
   - `EVAL_MANIFEST_MISSING`
   - `EVAL_MANIFEST_HASH_MISMATCH`
   - `SCORER_MODULE_VERSION_MISMATCH:<버전>`
4. 빌드 신선도(`ANALYZER_BUILD_STALE_OR_MISSING`)
5. git 상태(`WORKING_TREE_DIRTY`, `GIT_STATE_UNKNOWN`)

## 3. 사후 개정 평가 프로토콜

runner 1.2의 모든 run 기록(`run.json`)에 다음이 들어간다. 중단된 run도 마찬가지다.

| 필드 | 값 |
|---|---|
| `runnerVersion` | `exp01-runner/1.2` |
| `scorerVersion` | `exp01-scorer/1.2`(고정) |
| `gtVersion` | 1 |
| `preregistrationCommit` | `41bbe19434b4d284c6368b5fb5158cf1a5dbdf1e`(그대로) |
| `evaluationToolCommit` | `ae82bfbf0e26b7cba67e40af2b1f0a1fe89b81ca`(사전 등록 이후 기존 평가 도구 기준, 그대로) |
| `scorerAmendmentCommit` | `52ff632dacd14850d835604f80f9b3b4f4b916cc` |
| `evaluationManifest`, `evaluationManifestSha256` | r2 경로와 실행 시점에 계산한 해시 |
| `analyzerBaselineCommit` | `43ace0fdfdf442d7871c3ef4a92d73b28f1b5e77` |
| `headCommit` | 실행 시점의 git HEAD(기준 커밋이 아님) |
| `analyzerSourceTrees` | HEAD의 `src/analyzer`, `src/shared` git tree SHA |
| `analyzerBuildHash` | 컴파일 산출물 해시(`out/analyzer`, `out/shared`) |
| `analyzerIdentity` | 기준값, 현재값, 불일치 목록, `identical` |
| `evaluationProtocol` | `POST_HOC_AMENDED` |
| `amendmentReason` | `EXTERNAL_NODE_KEY_COLLISION` |
| `researchStatus` | `POST_HOC_AMENDED_EVALUATION` |
| `preregisteredConfirmatory` | `false` |

원시 예측 파일의 `run` 블록에도 다음이 들어간다: `runnerVersion`, `scorerVersion`, `evaluationProtocol`, `analyzerBaselineCommit`.

### 3.1 사전 등록 확증과 기술 게이트의 차이

- `confirmatory.eligible: true`는 runner의 기술 게이트를 모두 통과했다는 뜻일 뿐이다. 필드 이름은 기존 기록과의 호환을 위해 유지했다.
  - 기술 게이트: manifest, 프로토콜, 빌드, git, 사례 전부 OK, 결정성, 캐시 정합성, D11, bootstrap 10,000, analyzer 동일성, scorer 종료 코드·summary·`COMPLETE`·버전
- runner 1.2의 결과는 항상 `researchStatus: POST_HOC_AMENDED_EVALUATION`, `preregisteredConfirmatory: false`다.
  - scorer 규칙을 첫 run의 결과를 본 뒤 정했기 때문이다(P1-G).
  - 따라서 어떤 run도 "사전 등록 확증 결과"가 되지 않는다.
- CLI도 게이트를 통과하면 `technical gates: PASSED`라고만 쓴다. 이어서 다음 줄을 출력한다: `research status: POST_HOC_AMENDED_EVALUATION … not a pre-registered confirmatory result`.
- 논문에서는 runner 1.2 결과를 "사후 개정 평가 결과"로 보고한다. 사전 등록 규칙 아래의 확증 결과는 "없음"으로 남는다.
- 사람 독립 검토는 여전히 하지 않았다. 이는 기술 게이트와 무관한 GT 한계다(P1-C, P1-D).

## 4. analyzer 동일성 확인

새 run의 HEAD는 runner·scorer 변경 때문에 `43ace0f`와 다르다. runner 1.2는 HEAD를 기준 커밋이라고 주장하지 않는다. 대신 측정 대상 구현이 같은지 아래 항목으로 확인한다(`ANALYZER_BASELINE`, `defaultAnalyzerIdentity`).

| 항목 | 기준값(`43ace0f`) | 얻는 방법 |
|---|---|---|
| `src/analyzer` tree | `33f97d7bb566937a0ea6e70759e1464c53bfde60` | `git rev-parse HEAD:src/analyzer` |
| `src/shared` tree | `110f25582a4420b023f2a1d47cce1d3eb888ef23` | `git rev-parse HEAD:src/shared` |
| `package.json` blob | `2374e831679e8b4dcc12b85c10f9d82b0bb85b08` | `git rev-parse HEAD:package.json` |
| `package-lock.json` blob | `eda5350ee58cd0689e2931e7b710da600b0ffe9d` | `git rev-parse HEAD:package-lock.json` |
| `tsconfig.json` blob | `8f51e5eb12e5c5fe259e0db25da8675533307de4` | `git rev-parse HEAD:tsconfig.json` |
| 컴파일 산출물 해시 | `958dbf677b6085ddf478265b3cc2b64c5fb1452bf28cfb4c255ed5ef00566270` | `defaultBuildCheck`. 두 기존 run이 기록한 값 |
| TypeScript | 5.9.3 | `node_modules/typescript/package.json` |

판정 규칙:

- 하나라도 다르거나 값을 얻을 수 없으면 `identical: false`다. 이때 기술 게이트 사유 `ANALYZER_NOT_IDENTICAL_TO_BASELINE:<항목>`이 붙는다(종료 코드 5).
- run은 진단용으로 끝까지 실행하고 기록한다. 기준 analyzer와 비교할 수 있는 결과로는 인정하지 않는다.

이 브랜치(PR #8 HEAD 기준)에서 확인한 결과:

- 7개 항목이 모두 기준값과 같다(`git diff 43ace0f HEAD -- src package.json package-lock.json tsconfig.json` 변경 0).
- `npm run compile` 후 컴파일 산출물 해시도 `958dbf67…`로 같다(테스트 H7).

한계:

- git id는 HEAD 기준이다. 작업 트리가 dirty이면 실제 파일과 다를 수 있다. 다만 dirty run은 이미 `DIRTY_WORKING_TREE`로 게이트를 통과하지 못한다.
- `node_modules` 전체를 해시하지는 않는다. 같은 `package-lock.json`과 `npm ci`를 전제로 하고, TypeScript 버전만 직접 확인한다.

## 5. 환경 기록 (`env.json`)

기존 항목(OS, CPU, 메모리, Node, V8, TypeScript, `execArgv`)에 다음을 더했다.

- `npm`: `npm --version`의 결과. 실패하면 `null`이고 `npmError`에 사유를 적는다. 값을 추측하지 않는다.
- `gitHead`, `runnerVersion`
- `toolHashes`: 다음 파일의 LF 정규화 SHA-256
  - `exp01-run.mjs`
  - `exp01/lib.mjs`, `score.mjs`, `manifest.mjs`
  - `gt-manifest.json`, `eval-manifest.r2.json`

npm 호출은 고정 명령 문자열(`npm --version`, 사용자 입력 없음)이다. Windows에서는 npm이 `npm.cmd`라서 shell로 실행한다.

## 6. 테스트와 manifest 결과

### 6.1 runner 테스트: 39/39 통과

- 기존 30개를 모두 통과한다.
- 기존 테스트에서 바꾼 것:
  - 모의 채점 결과의 버전 문자열 `exp01-scorer/1.1` → `1.2`
  - 실제 manifest 검사 테스트의 기대 경로 r1 → r2. r1을 쓰지 않는다는 단언을 추가했다.
  - 원시 파일의 `run` 블록 단언 보강
  - 테스트 helper에 동일성 결과(기준값)와 환경 stub 주입
- 실패를 기대하는 부정 테스트는 약화하지 않았다. 다음 두 가지를 오히려 **추가**했다.
  - 기존 1.0 버전 거부 테스트 옆에 **1.1 거부** 단언을 넣었다(`SCORER_VERSION_MISMATCH:exp01-scorer/1.1`, 종료 코드 5).
  - R1-1 게이트 표에 1.1 사례(s7)를 넣었다.

새 테스트 9개:

| 테스트 | 확인 내용 |
|---|---|
| H1 | runner 1.2, 고정 scorer 1.2, r2, `POST_HOC_AMENDED`, 사전 등록 식별자 유지, 기준 analyzer 커밋 |
| H2 | 허용 scorer 버전이 runner 안의 문자열이고 `lib.mjs` 상수가 아님. 코드에서 r1 참조 없음 |
| H3 | 이 checkout에서 실제 프로토콜 검사 통과(r2 해시, scorer 모듈 1.2) |
| H4 | r2 해시 불일치, scorer 모듈 불일치, r2 없음 → analyzer 실행 전 중단(종료 코드 3) |
| H5 | `run.json`(메모리와 파일 모두)에 §3 필드 기록, 기술 게이트 범위 표시, 중단된 run도 같은 필드 |
| H6 | 기준과 다른 analyzer(tree·빌드·TypeScript·lock, 값 없음)는 게이트 실패로 기록 |
| H7 | 실제 checkout의 analyzer git id가 기준과 같고 HEAD가 기준 커밋이 아님. 빌드가 있으면 산출물 해시도 같음 |
| H8 | `env.json`의 npm·Node·TypeScript·OS·CPU·git HEAD·도구 해시. npm 실패 시 `null`. 실제 npm 호출 결과 형식 |
| H9 | runner 1.2에서도 `--allow-dirty`, 사례 일부, bootstrap 변경은 게이트 실패 |

위 표에 없는 요청 항목은 기존 테스트가 계속 다룬다.

- GT manifest와 r2 검사: 기존 테스트 3번
- 채점 종료 코드 비정상과 BLOCKED summary 차단: R1-1, BLOCKED 테스트
- 원본 run 덮어쓰기 방지
- 캐시 정합성과 결정성

### 6.2 그 밖의 검증

| 항목 | 결과 |
|---|---|
| 채점 도구 테스트 | 53/53 통과(PR #8 그대로) |
| GT manifest | OK, 214개 |
| `eval-manifest.r2.json` | OK, 227개. runner 파일과 runner 테스트는 r2 범위(`fixtures/exp-01`, `tools/exp01`) 밖이라 영향 없음 |
| `eval-manifest.r1.json` | DRIFT 4개(PR #8과 같음). runner 1.2는 r1을 쓰지 않는다 |
| `npm run compile` / `npm run lint` | PASS / PASS |
| 바뀐 파일 | `tools/exp01-run.mjs`, `tools/test/exp01-run.test.mjs`, 이 문서, README, `p1b-runner.md`(runner 1.2 문서 안내 1줄) |
| 바꾸지 않은 것 | `src/`, `tools/exp01/`(scorer 1.2), `fixtures/exp-01/`(GT, 지침, manifest r1·r2·GT), `docs/benchmarks/`, 기존 run 결과(`data/`에는 `p0`만 있음) |

## 7. 기존 run 보존 상태

P1-G 그대로다([p1g-scorer-amendment.md §9](p1g-scorer-amendment.md#9-기존-run-증거-보존-상태)).

| run | 역할 | 상태 |
|---|---|---|
| `exp01-20261029-0651-43ace0f-50587` | baseline | runner 1.1, `EXP01_DIAGNOSTIC_ONLY`, 저장소 밖 보존(ZIP `63ec1f1b…`) |
| `exp01-20261029-0636-43ace0f` | replication | runner 1.1, 같은 상태, 저장소 밖 보존(ZIP `4be45afc…`) |

runner 1.2는 기존 run 폴더를 읽거나 바꾸지 않는다. 새 run ID가 이미 있으면 실행을 거부한다.

## 8. 실측 실행 준비도

PR #8과 이 PR을 병합한 깨끗한 checkout에서 다음 순서로 실행할 수 있다.

```powershell
npm ci
npm run compile
node docs/thesis-experiments/tools/exp01-run.mjs --repeat 2 --bootstrap 10000
```

- 기대 출력:
  - `technical gates: PASSED`
  - `research status: POST_HOC_AMENDED_EVALUATION`
  - `analyzer identity with 43ace0f: IDENTICAL`
- 결과는 "사후 개정 평가 결과"로 보고한다.
- 이번 PR에서는 이 명령을 실행하지 않았다.

## 9. PR #8과의 병합 순서

1. PR #8(scorer 1.2) 검토
2. 이 PR(runner 1.2) 검토. base가 PR #8 브랜치다.
3. 이 PR을 PR #8 브랜치로 병합하고, PR #8을 `main`으로 병합한다. PR #8을 먼저 `main`에 병합하고 이 PR의 base를 `main`으로 바꿔도 된다. 다만 그 사이에 `main`에서 runner 테스트가 실패하는 구간이 생긴다.
4. squash merge를 쓰면 `scorerAmendmentCommit`(`52ff632`)이 `main`의 이력에 없는 커밋이 된다.
   - 커밋 자체는 PR 기록에 남는다.
   - 그래도 merge commit 방식을 권장한다.

## 10. 남은 위험

| 위험 | 내용 | 대응 |
|---|---|---|
| 사후 개정 | 평가 규칙(scorer 1.2)이 결과를 본 뒤 정해졌다 | `researchStatus`와 `preregisteredConfirmatory: false`로 모든 run에 표시 |
| 병합 순서 | PR #8만 병합하면 runner 테스트가 실패한다 | §9 순서 |
| 고정 해시 | r2나 scorer를 다시 바꾸면 runner 상수도 바꿔야 한다 | 의도된 동작이다. 바꾸지 않으면 preflight가 막는다 |
| 동일성 범위 | `node_modules` 전체는 해시하지 않는다 | `npm ci` 전제, TypeScript 버전 확인, lock blob 확인 |
| analyzer 한계 | React `updates` FN, `REF-SHORTHAND-PROPERTY` FN | 결과로 보고. 개선은 별도 단계에서 "개선 후"로 측정 |
| 사람 검토 | 사람 독립 검토가 없다 | P1-C 결정 사항 |

## 11. 결론

**P1H_RUNNER_INTEGRATION_READY**

- runner 1.2는 GT manifest와 r2를 검사한다.
- scorer 1.2만 허용하며, 그 버전을 runner 안에 고정했다.
- 사후 개정 프로토콜과 analyzer 동일성을 모든 run에 기록한다.
- 기술 게이트를 사전 등록 확증과 구분해 표시한다.
- 실제 EXP-01 실행: **NOT_RUN**
