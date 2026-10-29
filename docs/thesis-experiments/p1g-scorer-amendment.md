# P1-G: EXP-01 run 보존과 scorer 1.2 사후 개정

- 작성일: 2026-10-29
- 기준: `main` `2c52de4f65770d0855275d89e5227b91f9b6acc3` (PR #7 병합)
- 측정 대상 analyzer 커밋: `43ace0fdfdf442d7871c3ef4a92d73b28f1b5e77`
- 상태: **scorer 1.2 구현. 사후 개정이다.**
  - 첫 run은 계속 `EXP01_DIAGNOSTIC_ONLY`다.
  - 사전 등록 평가 규칙(scorer 1.1) 아래의 EXP-01 확증 결과는 없다.

---

## 1. P1-F 원인 요약

[p1f-scoring-blocker-audit.md](p1f-scoring-blocker-audit.md)에서 확인한 내용이다.

- **analyzer:** 타입이 있는 React의 setter·dispatch 호출을 `updates` 대신 external `calls`·`dataflow`로 출력한다. 대상은 `useState`·`useReducer` 반환 tuple 안의 함수 타입이다.
- **scorer 1.1:** external 키 `X|file|line`이 같은 줄의 두 선언을 구별하지 못한다. 이 경우는 `useState` 선언과 setter 함수 타입이다. 그래서 React 5개 사례가 `node-key-collision`으로 차단되었다(6건).
- 충돌이 행 단위 수치를 왜곡하지는 않았다. 차단 자체는 fail-closed 규칙이 설계대로 동작한 결과다.

## 2. scorer 1.2 규칙

구현 위치: `tools/exp01/lib.mjs`의 `resolveExternalCollision`, `normalizeCogicGraph`

1. 기본 키 형식은 그대로다(`X|file|line` 등). 충돌이 없는 노드에는 아무 처리도 하지 않는다.
2. 같은 키를 가진 노드가 둘 이상인 묶음에서만 해결을 시도한다. 아래 조건을 **모두** 만족할 때만 해결한다.
   - 키가 `X|`로 시작한다.
   - 묶음의 모든 노드가 module이 아닌 external 노드다(ID가 `:-1`로 끝나지 않음).
   - 모든 노드에 완전한 범위(`range.start/end`의 `line`, `character`)가 있다.
   - 다른 노드를 **모두** 감싸는 노드가 정확히 하나다. 범위가 같은 노드가 둘이면 서로를 감싸므로 후보가 둘이 되고, 해결하지 않는다.
3. 해결하면 다음처럼 키를 정한다.
   - 감싸는 노드는 기본 키를 유지한다.
   - 나머지 노드는 `X|file|line|c<시작 열>`을 받는다.
4. 새 키끼리 겹치거나 이미 쓰인 키와 겹치면 해결하지 않는다.
5. 해결하지 못한 묶음은 기존처럼 `node-key-collision`으로 차단한다. external이 아닌 노드끼리의 충돌도 그대로 차단한다.
6. GraphPayload와 GT는 바꾸지 않는다. 키는 정규화 결과에만 있다.
7. 해결 내역은 `resolvedCollisions`(`code: external-same-line-resolved`, 원래 키, 유지한 ID, 바뀐 ID와 키)로 남긴다. `score/diagnostics.json`에도 기록된다(`score.mjs`).
8. `SCORER_VERSION = "exp01-scorer/1.2"`

### 2.1 규칙의 타당성

- **GT 쪽 기준과 맞다.** GT의 external 노드는 선언의 시작 줄이다(지침 §2). 지침은 "fixture 한 줄에 같은 종류의 선언·앵커를 두 개 이상 두지 않는다"라고 정한다. 따라서 한 줄의 GT external 노드는 그 줄의 선언 하나뿐이다.
  - Cogic 쪽에서 그 선언에 해당하는 노드는 줄 전체를 감싸는 선언 노드다.
  - 선언 안에 있는 함수 타입 노드는 GT에 대응하는 노드가 없다.
- **새 키는 GT에 없는 형식이다.** `|c<열>` 형식은 GT `nodeKey`가 만들지 않는다. 따라서 안쪽 노드의 관계는 TP가 될 수 없고 FP가 된다. 지침 §4.1·§4.5는 setter·dispatch 호출을 `calls`·`dataflow`에서 제외하므로 FP가 맞다.
- **불확실하면 계속 차단한다.** 감싸는 노드가 정해지지 않거나, 겹치거나, 범위가 빠진 경우는 차단을 유지한다.
- 충돌을 무시하거나 노드를 합치지 않는다.

## 3. 사후 개정이라는 사실

- 이 규칙은 첫 run(`exp01-20261029-0651-43ace0f-50587`)의 예측과 채점 차단을 본 **뒤** 정했다. 사전 등록 평가 규칙의 변경이다.
- scorer 1.2 결과는 "사후 개정 평가 결과"로 따로 보고한다. 사전 등록(scorer 1.1) 결과와 같은 표에 섞지 않는다.
- 근거는 다음 두 가지다.
  - 규칙이 충돌 묶음에만 작용한다.
  - 충돌이 없는 39개 사례의 행이 바뀌지 않았다(§5).

  이 근거가 있어도 개정이 사후라는 사실은 바뀌지 않는다.

## 4. 바뀌지 않은 것

| 대상 | 상태 | 확인 |
|---|---|---|
| GT v1, `case.json`, fixture, `catalog.csv` | 변경 없음 | `manifest.mjs --check --scope gt` → 214개 일치 |
| 주석 지침, `GT_CHANGELOG.md` | 변경 없음 | `git diff` 0 |
| `gt-manifest.json`, `eval-manifest.r1.json` | 변경 없음(다시 쓰지 않음) | `git diff` 0 |
| runner(`exp01-run.mjs`)와 runner 테스트 | 변경 없음 | `git diff` 0 |
| analyzer(`src/`) | 변경 없음 | `git diff` 0 |
| 기존 run 결과 | 변경 없음 | §7 |
| `docs/benchmarks/` | 변경 없음 | `git diff` 0 |

바뀐 평가 도구 파일은 다음 4개다.

- `tools/exp01/lib.mjs`(규칙, 버전)
- `tools/exp01/score.mjs`(`diagnostics.json`에 `resolvedCollisions` 기록)
- `tools/exp01/manifest.mjs`(제외 목록에 `eval-manifest.r2.json` 추가)
  - r2를 제외하지 않으면 r2 자신이 `fixtures/exp-01` 아래 파일로 잡힌다.
  - 그러면 GT 범위 검사가 `added …/eval-manifest.r2.json`을 보고한다.
- `tools/exp01/test/score.test.mjs`(회귀 테스트)

## 5. 기존 39개 사례 불변성

[compare-scorers.mjs](evidence/exp-01-p1g-scorer-1.2/compare-scorers.mjs)로 baseline run의 원시 예측을 두 scorer로 채점했다. scorer 1.1은 기준 커밋 `2c52de4`의 `lib.mjs`, scorer 1.2는 이 브랜치의 `lib.mjs`다. 비교한 행은 다음과 같다.

- GT 행(항목 ID, 키, 판정, 매칭 예측)
- 예측 행(키, 판정, 비고, 출현 수)
- 부정 사례 위반
- indeterminate 제외 수

| 항목 | 결과 |
|---|---|
| scorer 1.1에서 충돌이 없던 사례 | 39 |
| 그중 strict·lenient 모든 행이 같은 사례 | **39** |
| 39개 사례에서 scorer 1.2가 해결한 충돌 | 0 |
| 비교 중 원시 예측 객체 변경 | 없음 |
| replication run(0636)에서 같은 비교 | 같은 결과(39/39, 문제 0) |

## 6. 차단 5개 사례의 처리

| 사례 | 1.1 | 1.2 | 해결한 충돌(원래 키 → 안쪽 노드의 새 키) | TP | FP | FN | 1.1 대비 새 TP | 가짜 TP |
|---|---|---|---|---:|---:|---:|---:|---:|
| h01-reducer-effect | BLOCKED | SCORED | `X\|shims/react.d.ts\|6` → `…\|6\|c95`; `…\|5` → `…\|5\|c53` | 16 | 6 | 5 | 0 | 0 |
| h02-alias-namespace-memo | BLOCKED | SCORED | `…\|5` → `…\|5\|c53` | 26 | 6 | 4 | 0 | 0 |
| h03-unsupported-negatives | BLOCKED | SCORED | `…\|5` → `…\|5\|c53` | 14 | 2 | 4 | 0 | 0 |
| u01-react-usestate | BLOCKED | SCORED | `…\|5` → `…\|5\|c53` | 5 | 6 | 9 | 0 | 0 |
| u02-react-todo | BLOCKED | SCORED | `…\|5` → `…\|5\|c53` | 6 | 6 | 11 | 0 | 0 |
| **합계(strict)** | | | 충돌 6건 모두 해결 | **67** | **26** | **33** | **0** | **0** |

표 항목의 뜻은 다음과 같다.

- 1.1 대비 새 TP: scorer 1.1의 행 판정(충돌 키 기준)에서는 TP가 아니었는데 1.2에서 TP가 된 GT 항목
- 가짜 TP: TP로 판정된 예측 관계가 열 번호 키를 받은 노드의 간선을 포함하는 경우

결과:

- 5개 사례 모두 GT 행 판정이 scorer 1.1의 행 판정과 같다.
- FP 26개는 모두 열 번호 키(`|c53`, `|c95`)로 가는 setter·dispatch 관계다.
- P1-F 진단(TP 67, FP 26, FN 33)과 같다. lenient도 사례별로 같다.

## 7. fail-closed 유지 검증

회귀 테스트(`score.test.mjs`의 R3, 합성 데이터)는 다음과 같다.

| 테스트 | 기대 | 결과 |
|---|---|---|
| scorer 버전 | `exp01-scorer/1.2` | PASS |
| `useState` 선언 + setter 함수 타입(L5 c0–91, c53–89) | 해결. 선언 관계 TP 2, setter 관계 FP 2(`\|c53`). GraphPayload 불변 | PASS |
| `useReducer` 선언 + dispatch 함수 타입(L6 c0–116, c95–114) | 해결. `\|c95` | PASS |
| 감싸는 선언이 유일하고 안쪽 노드가 둘 | 서로 다른 키 2개 | PASS |
| 감싸는 노드 없음, 같은 범위 후보 둘, 일부만 겹침, 범위 누락 | 모두 `node-key-collision` 차단 유지 | PASS |
| external이 아닌 노드끼리의 충돌(범위가 겹쳐도), module external | 해결하지 않음, 차단 유지 | PASS |
| 새 키 중복(안쪽 노드 둘의 시작 열이 같음, 이미 쓰인 키) | 해결하지 않음 | PASS |
| 같은 owner가 선언과 안쪽 함수 타입을 함께 호출 | TP 관계에는 선언 간선만 있음, 안쪽 호출은 FP | PASS |
| 코퍼스 44개 GT 기반 합성 그래프(충돌 없음) | `resolvedCollisions` 없음, 모든 키가 `cogicNodeKey`와 같음 | PASS |

- 채점 도구 테스트는 **53/53 통과**한다(기존 44 + R3 9). 기존 R2의 "각 진단 유형이 사례를 차단한다" 테스트도 그대로 통과한다.
- 실제 run 데이터에 대한 불변성(§5)과 재채점 검증(§6)은 원시 예측을 저장소에 넣지 않기 때문에 단위 테스트가 아니라 진단 스크립트로 했다.

## 8. 사후 개정 진단 재채점(참고)

scorer 1.2 CLI로 baseline run의 원시 예측을 다시 채점했다. bootstrap은 10,000이다.

- 출력은 저장소 밖 보존 폴더에 새로 만들었다. 기존 `score/`는 바꾸지 않았다.
- **사후 개정 진단 결과이며 확증 결과가 아니다.** runner 게이트를 거치지 않았다. 논문에는 runner 1.2 run의 결과를 쓴다.

| 항목 | strict | lenient |
|---|---|---|
| `scoringStatus` | COMPLETE(차단 0, 채점 사례 44) | 같음 |
| Precision | 0.9010 (TP 464, FP 51) | 0.8992 (FP 52) |
| In-scope Recall | 0.7947 (FN 116) | 0.7947 |
| Overall Recall | 0.7127 (FN 187) | 0.7127 |
| F1 in-scope / overall | 0.8445 / 0.7959 | 0.8437 / 0.7952 |
| bootstrap 95% CI, F1 in-scope | 0.7741–0.9061 | 0.7736–0.9051 |

`summary.json` 사본은 [evidence/exp-01-p1g-scorer-1.2/rescore-scorer-1.2-diagnostic.summary.json](evidence/exp-01-p1g-scorer-1.2/rescore-scorer-1.2-diagnostic.summary.json)에 있다. 다른 출력은 해시만 [run-preservation.json](evidence/exp-01-p1g-scorer-1.2/run-preservation.json)에 기록했다.

## 9. 기존 run 증거 보존 상태

보존 폴더는 저장소 밖 로컬 폴더(`<evidenceRoot>` = Cogic 저장소와 같은 상위 폴더의 `Cogic-EXP01-Evidence/`)다.

| run | 역할 | 원본 위치 | 보존본 | ZIP SHA-256 | 파일 | 무결성 |
|---|---|---|---|---|---:|---|
| `exp01-20261029-0651-43ace0f-50587` | 공식 baseline | 사용자 worktree(커밋 안 됨), 사용자 ZIP | 사용자 ZIP을 바이트 그대로 복사(원본 ZIP 해시 불변) | `63ec1f1be2d768046d649e204583a857e97949264289d4458ab04c60bebebc1a` | 186 | ZIP 내부 186개 = worktree 186개. `run.json`에 기록된 해시 176개 일치 |
| `exp01-20261029-0636-43ace0f` | replication | 로컬 브랜치 `research/thesis-p1e-exp01-run`(커밋 `3a3593a`, push 안 함) | `git archive`(줄바꿈 변환 없음)로 만든 ZIP | `4be45afc74e528e195225b23108ac7e3e7504fe4b28ec6d9970d708c46cb5835` | 186 | git blob 186개와 일치. `run.json`에 기록된 해시 176개 일치 |

두 run의 공통 기록은 다음과 같다.

| 항목 | 값 |
|---|---|
| Git SHA | `43ace0f` |
| Node | v24.12.0 |
| TypeScript | 5.9.3 |
| npm | runner 1.1이 기록하지 않음(보존 시점 이 컴퓨터는 11.6.2) |
| analyzer 빌드 해시 | `958dbf67…` |
| runner / scorer | runner 1.1 / scorer 1.1 |
| status | `completed`, 종료 코드 5 |
| scoring | `BLOCKED`(5개 사례, `node-key-collision`) |

- 44개 사례 모두 네 변형(off#1, off#2, on-cold, on-warm)의 `semanticHash`와 `inputHash`가 두 run에서 같다.
- 원시 파일의 해시는 run마다 다르다. 노드 ID에 실행 경로가 들어 있기 때문이다.
- 원본 데이터의 절대 경로는 수정하지 않았다. worktree, 로컬 브랜치, 사용자 ZIP은 삭제하거나 덮어쓰지 않았다.
- 보존 작업 중 처음 만든 0636 압축본에 문제가 있었다.
  - 하위 트리만 archive하면 상위 `.gitattributes`가 적용되지 않는다. 그래서 `core.autocrlf`가 LF를 CRLF로 바꿨다.
  - 해시 대조로 발견했고, 그 압축본은 지웠다. 이번에 처음 만든 보존 폴더 안의 파일이다.
  - 줄바꿈 변환을 끄고 다시 만들었다. 표의 값이 다시 만든 결과다.

## 10. 원본 ZIP의 공개 저장소 미포함

이 PR에 원시 run 폴더, run ZIP 두 개, 로컬 보존 기록, 진단 재채점의 `diagnostics.json`은 없다. 공개 저장소에는 파생 기록만 넣었다.

- [run-preservation.json](evidence/exp-01-p1g-scorer-1.2/run-preservation.json): 상대 경로와 해시
- 비교 결과
- `summary.json` 사본

이 세 파일에서 사용자 이름이나 절대 경로가 검색되지 않는 것을 확인했다.

## 11. manifest 상태

| manifest | 결과 | 비고 |
|---|---|---|
| `gt-manifest.json` (`--scope gt`) | **OK, 214개** | GT 불변 |
| `eval-manifest.r2.json` (새 파일) | **OK, 227개** | scorer 1.2 기준 |
| `eval-manifest.r1.json` | **DRIFT 4개**(`lib.mjs`, `manifest.mjs`, `score.mjs`, `test/score.test.mjs` changed) | 예상한 결과다. r1은 고치거나 다시 쓰지 않았다 |

## 12. runner 1.1과의 관계와 runner 1.2로 넘길 작업

runner는 이번 단계에서 바꾸지 않았다. 그 결과는 다음과 같다.

- runner 테스트는 **25/30 통과, 5개 실패**다. 원인 두 가지는 모두 예상된 것이다.
  1. `real manifest checks pass on this checkout`: runner 1.1은 `eval-manifest.r1.json`을 고정으로 검사한다. r1은 위 4개 파일을 drift로 보고한다.
  2. 나머지 4개(`successful cases are stored as exp01-raw/1…`, `R1-1 scorer gate…`, `R1-3 …10,000 resamples…`, `R1-4 cache hit-path claim…`):
     - runner의 `PROTOCOL.scorerVersion`은 `lib.mjs`의 `SCORER_VERSION`을 import한다. 그래서 이제 1.2가 된다.
     - 그런데 테스트의 mock 채점 결과는 문자열 `"exp01-scorer/1.1"`을 쓴다. 그래서 `SCORER_VERSION_MISMATCH`가 나온다.
- 즉 runner 1.1은 scorer 1.2와 함께 실행할 수 없다. preflight에서 r1 검사가 실패해 analyzer를 부르기 전에 멈춘다. 확증 결과로 잘못 기록될 위험은 없다.
- **이 PR을 단독으로 `main`에 병합하면 `main`의 runner 테스트가 실패한다.** runner 1.2 PR과 함께 병합하거나, runner 1.2를 이 브랜치 위에서 만든 뒤 병합하는 것을 권장한다.

runner 1.2에서 할 일:

1. 평가 manifest 검사 대상을 `eval-manifest.r2.json`으로 바꾼다.
2. 허용 scorer 버전을 runner 안에 명시적으로 고정한다(`exp01-scorer/1.2`). 이번처럼 `lib.mjs`의 상수를 따라 조용히 바뀌지 않게 한다.
3. run 기록에 "사후 개정 프로토콜(P1-G)"을 표시한다. 사전 등록 식별자(`41bbe19`, `ae82bfb`)와 개정 식별자(이 PR 커밋, r2)를 함께 남긴다.
4. npm 버전을 `env.json`에 기록한다.
5. runner 테스트의 scorer 버전 문자열을 1.2에 맞춘다.
6. 같은 analyzer 커밋 `43ace0f`에서 새 run 1회를 수행하고, 결과를 "사후 개정 평가 결과"로 보고한다.

## 13. 남은 위험

| 위험 | 내용 | 대응 |
|---|---|---|
| 사후 개정 | 규칙을 결과를 본 뒤 정했다 | 39개 불변 증거와 함께 사후 개정으로 표시. 사전 등록 결과는 "없음"으로 유지 |
| runner 테스트 실패 | 이 PR만 병합하면 runner 테스트 5개가 실패 | runner 1.2와 함께 병합 |
| analyzer 한계 | React `updates` FN 19개, `REF-SHORTHAND-PROPERTY` FN(39개 사례에서 25/25, 차단 사례에서 14) | scorer와 별개. 결과로 보고하고, 개선은 따로 측정 |
| 규칙의 일반성 | 감싸는 범위 규칙은 선언 안에 타입 노드가 있는 경우를 가정한다. 다른 모양의 같은 줄 충돌은 계속 차단된다 | fail-closed 유지. 새 유형이 나오면 다시 감사 |
| 사람 독립 검토 | 아직 없음 | P1-C 결정 사항 그대로 |
| 원본 보존 | 보존본은 이 컴퓨터 한 곳에만 있다 | 별도 매체나 비공개 저장소에 한 부 더 복사할 것을 권장 |

## 14. 결론

**P1G_SCORER_AMENDMENT_READY**

- 조건: 이 PR은 runner 1.2와 함께 병합해야 한다(§12).
- scorer 1.2는 P1-F의 충돌 6건을 모두 해결한다.
- 기존 39개 사례의 행 판정은 바뀌지 않는다.
- 해결할 수 없는 충돌과 external이 아닌 충돌은 계속 차단한다.
- GT·지침·analyzer·runner·기존 manifest·기존 run은 그대로다.
- 첫 run이 확증 결과로 쓸 수 없었다는 사실은 바뀌지 않는다.
