# P1-F: EXP-01 채점 차단(`SCORING_BLOCKED`) 원인 감사

- 작성일: 2026-10-29
- 기준 커밋: `43ace0fdfdf442d7871c3ef4a92d73b28f1b5e77` (`main`, PR #6 병합)
- 대상 run: `exp01-20261029-0651-43ace0f-50587`
- 대상 run의 상태: **`EXP01_DIAGNOSTIC_ONLY`** (그대로 유지)
- 이번 단계에서 바꾸지 않은 것: GT v1, 주석 지침, scorer 1.1, runner 1.1, analyzer, manifest, run 결과
- 결과: 차단 원인을 확인했다(§10)

이 문서는 첫 실측에서 React 5개 사례가 채점 차단된 원인을 원시 예측으로 추적한 기록이다. 수정안을 비교하고, 가장 작은 범위의 수정안을 제안한다. 아래의 진단 채점 수치는 사후 진단이며 EXP-01 정확도가 아니다.

---

## 1. 대상 run과 증거의 출처

| 항목 | 값 |
|---|---|
| run | `exp01-20261029-0651-43ace0f-50587` |
| 실행 위치 | 별도 worktree `Cogic-exp01-exp01-20261029-0651-43ace0f-50587`(detached `43ace0f`, 깨끗한 작업 트리) |
| 인자 | `--run-id exp01-20261029-0651-43ace0f-50587 --repeat 2 --bootstrap 10000` |
| run 결과 | `completed`, 종료 코드 5, analyzer 44/44 OK, 결정성·캐시 OFF/ON 정합성 44/44, `cacheHitPath: VERIFIED` |
| 채점 결과 | `BLOCKED`(scorer 1.1, 종료 코드 2). 차단 사례 5개, `node-key-collision` 6건 |
| `confirmatory.eligible` | `false` (`SCORER_EXIT_2`, `SCORING_BLOCKED`) |
| 사용자 ZIP | `exp01-20261029-0651-43ace0f-50587.zip`. worktree의 run 폴더와 186개 파일이 모두 같다(`diff -rq`) |
| 같은 커밋의 이전 run | `exp01-20261029-0636-43ace0f`(로컬 브랜치 `research/thesis-p1e-exp01-run`) |

두 run을 비교한 결과는 다음과 같다.

- 44개 사례 모두 `semanticHash`와 `inputHash`가 같다.
- `score/` 아래 파일은 `diagnostics.json`만 다르다. 그 차이도 원시 ID 안의 실행 경로(worktree 이름)뿐이다.
- 따라서 차단은 두 번 같은 방식으로 재현되었다.

## 2. 재현 증거

증거는 [evidence/exp-01-p1f-scoring-blocker/](evidence/exp-01-p1f-scoring-blocker/README.md)에 있다.

- `collision-audit.mjs`는 run의 원시 예측을 읽기만 한다. scorer 1.1이 쓰는 `lib.mjs`의 `normalizeCogicGraph`·`scoreCase`를 그대로 호출해 충돌을 재현한다.
- 출력 `collision-audit.exp01-20261029-0651-43ace0f-50587.json`의 충돌 키 6개는 `score/diagnostics.json`과 같다.

## 3. 사례별 충돌 구조

원시 노드 ID의 형식은 `external:<파일 절대 경로>:<문자 offset>`이다(`analyze.ts` `ensureExternalNode`). 아래 표에서는 절대 경로를 `<fixtureRoot>`로 줄였다. 범위는 0-based 줄을 1-based로 바꿔 적었다.

모든 사례의 shim은 같은 파일이다(`shims/react.d.ts`, 6개 사례 SHA-256 동일).

```text
5  export declare function useState<S>(initial: S): [S, (next: S | ((prev: S) => S)) => void];
6  export declare function useReducer<S, A>(reducer: (state: S, action: A) => S, initial: S): [S, (action: A) => void];
```

| 사례 | 정규화 키 | 원시 노드 1(선언) | 원시 노드 2(setter/dispatch 함수 타입) |
|---|---|---|---|
| h01-reducer-effect | `X\|shims/react.d.ts\|6` | `<fixtureRoot>/shims/react.d.ts:224`, `useReducer (react.d.ts)`, L6 c0–c116 | `…:319`, `dispatch (react.d.ts)`, L6 c95–c114, 시그니처 `(action: A): void` |
| h01-reducer-effect | `X\|shims/react.d.ts\|5` | `…:131`, `useState (react.d.ts)`, L5 c0–c91 | `…:184`, `setTicks (react.d.ts)`, L5 c53–c89, `(next: S \| ((prev: S) => S)): void` |
| h02-alias-namespace-memo | `X\|shims/react.d.ts\|5` | `…:131`, `useLocalState (react.d.ts)` | `…:184`, `setOpen (react.d.ts)` |
| h03-unsupported-negatives | `X\|shims/react.d.ts\|5` | `…:131`, `useState (react.d.ts)` | `…:184`, `setOn (react.d.ts)` |
| u01-react-usestate | `X\|shims/react.d.ts\|5` | `…:131`, `useState (react.d.ts)` | `…:184`, `setCount (react.d.ts)` |
| u02-react-todo | `X\|shims/react.d.ts\|5` | `…:131`, `useState (react.d.ts)` | `…:184`, `setDraft (react.d.ts)` |

### 3.1 단순 중복 출력이 아니다

충돌한 두 노드는 같은 줄에 있는 **서로 다른 TypeScript 선언**이다.

- 노드 1은 함수 선언(`useState`, `useReducer`)이다. 범위가 줄 전체(c0부터)를 덮는다.
- 노드 2는 그 반환 tuple 안의 함수 타입(setter·dispatch의 call signature)이다. 범위가 노드 1 안쪽(c53, c95부터)에 있다.
- 두 노드는 offset, 범위, 시그니처가 모두 다르고, 받는 간선도 다르다.
  - 노드 1은 `useState(...)`·`useReducer(...)` 호출 지점에서 온 `calls`·`dataflow`를 받는다.
  - 노드 2는 `setX(...)`·`dispatch(...)` 호출 지점에서 온 `calls`·`dataflow`를 받는다.
- 노드 2의 표시 이름은 처음 만난 호출 지점의 이름이다. 그래서 u01의 `setLabel(...)` 호출도 `setCount (react.d.ts)` 노드를 가리킨다. external 노드 캐시 키가 `파일:offset`이기 때문이다.

### 3.2 정규화 키가 둘을 구별하지 못하는 이유

- scorer 1.1의 `cogicNodeKey`는 external 노드를 `X|<fixture 상대 경로>|<range.start.line + 1>`로 만든다(`lib.mjs`). 열(column)도 이름도 쓰지 않는다.
- GT의 `nodeKey`도 external을 `X|file|line`으로 만든다.
- 지침 §2는 "fixture 한 줄에 같은 종류의 선언·앵커를 두 개 이상 두지 않는다"라고 정한다. 이 규칙은 GT 쪽 선언(`useState` 함수)에는 지켜졌다. 그러나 Cogic은 GT가 노드로 보지 않는 반환 타입 안의 함수 타입도 external 노드로 만든다. 그래서 같은 줄에 Cogic 노드가 두 개 생겼다.
- validator는 GT 노드의 충돌만 검사하므로 사전 등록 때 이 경우를 잡지 못했다.

## 4. Cogic analyzer 문제와 scorer 문제의 구분

충돌은 두 가지가 겹쳐서 생겼다. 서로 다른 문제이므로 따로 기록한다.

### 4.1 analyzer: 타입이 있는 React setter·dispatch 호출이 `updates`가 되지 않는다

`src/analyzer/analyze.ts`의 `resolveCallTarget`은 다음 순서로 대상을 고른다.

1. `checker.getResolvedSignature(node).getDeclaration()`(시그니처 선언)
2. 그것이 없을 때만 심볼 선언(`pickBestDeclaration`)

그다음 선언이 `BindingElement`일 때만 hook source로 가는 `updates`를 만든다.

```typescript
const decl = (declFromSig ?? declFromSym) as ts.Declaration | undefined;
...
if (ts.isBindingElement(decl)) {
  const hookSourceId = hookSourceIdByDeclPos.get(declLocation(decl).pos);
  if (hookSourceId) { return { tgtId: hookSourceId, ..., edgeKind: "updates", ... }; }
}
```

결과는 다음과 같다.

- `useState`가 타입으로 선언되어 있으면 `setCount`의 시그니처 선언은 shim 안의 함수 타입이다. 따라서 `decl`이 `BindingElement`가 아니게 된다.
- 결국 `updates` 대신 그 함수 타입을 가리키는 external `calls`·`dataflow`가 나온다.

합성 입력 시험(`react-setter-probe.mjs`, 같은 `main.ts`, 컴파일된 analyzer)에서 다음을 확인했다.

| `react` 타입 | `updates` 간선 | `increment`에서 나온 간선 | scorer 1.1 충돌 |
|---|---:|---|---|
| 타입 없음(`declare module "react";`) | 1 | `updates increment → Counter.useState#1 [setCount]` | 없음 |
| EXP-01 shim 형식(setter 타입이 같은 줄) | 0 | `calls`·`dataflow increment → external setCount (react.d.ts)@L1c53` | `X\|shims/react.d.ts\|1` |
| `@types/react` 형식(`Dispatch`·`SetStateAction` 별칭이 다른 줄) | 0 | `calls`·`dataflow increment → external setCount (react.d.ts)@L2c26` | 없음 |

- 기존 단위 테스트(`src/test/analyzer.test.ts` "connects useState and useReducer updates back to hook sources")는 `react` 타입이 없는 코드로만 검증한다. 그래서 이 문제를 잡지 못했다.
- 사전 등록 `catalog.csv`는 `UPD-REACT-SETTER`, `UPD-REACT-SETTER-FN`, `UPD-REACT-DISPATCH`를 코드 읽기(`analyze.ts:2045-2056`)에 근거해 `supported`로 분류했다. 이번 결과는 그 분류의 근거가 된 경로가 타입 있는 입력에서는 실행되지 않는다는 것을 보여 준다. 분류는 사전 등록대로 유지한다.
- 별칭이 다른 줄에 있는 일반적인 React 타입에서는 충돌 없이 채점된다. 그러면 이 문제는 차단으로 드러나지 않고 FN(`updates`)과 FP(`calls`·`dataflow`)로 조용히 나타났을 것이다.

### 4.2 scorer: external 키가 같은 줄의 서로 다른 선언을 구별하지 못한다

- `X|file|line`은 GT 지침의 "한 줄에 앵커 1개" 가정에 기대고 있다. 그러나 예측 쪽 노드는 이 가정을 따르지 않을 수 있다.
- P1-A-R1의 fail-closed 규칙은 이런 경우를 잘못 채점하지 않도록 사례를 차단하게 만든 것이다. 이번에 그 규칙이 설계대로 동작했다.

### 4.3 충돌이 수치를 왜곡했는가

`collision-audit.mjs`로 5개 사례를 행 단위 채점했다. 두 방식 모두 GT, 예측, `scoreCase`는 바꾸지 않았다.

- scorer 1.1 키 그대로
- 진단용 재키잉: 충돌 묶음 안에서 다른 노드를 감싸는 선언 노드만 `X|file|line`을 유지하고, 나머지는 열 접미사로 구별한다

| 사례 | GT TP | GT FN | 예측 FP | 부정 사례 위반 | 두 방식 차이 |
|---|---:|---:|---:|---:|---|
| h01-reducer-effect | 16 | 5 | 6 | 0 | 없음 |
| h02-alias-namespace-memo | 26 | 4 | 6 | 0 | 없음 |
| h03-unsupported-negatives | 14 | 4 | 2 | 0 | 없음 |
| u01-react-usestate | 5 | 9 | 6 | 0 | 없음 |
| u02-react-todo | 6 | 11 | 6 | 0 | 없음 |
| **합계(strict)** | **67** | **33** | **26** | **0** | **없음** |

- 두 방식의 TP·FP·FN이 행 단위까지 같다. 충돌 키 때문에만 생긴 TP(`tpOnlyUnderCollidedKey`)는 0개다.
  - 이유: setter·dispatch 호출의 owner(예: `increment`, effect 콜백)가 `useState` 호출의 owner(컴포넌트)와 달라서, 관계 키가 출발 노드에서 이미 갈라졌다.
- 그래도 같은 owner가 `useState`와 setter를 함께 호출하는 코드라면 가짜 TP가 생길 수 있다. 따라서 차단 자체는 정당했다.
- FP 26개는 **모두** setter·dispatch 함수 타입 노드로 가는 `calls`·`dataflow`다. 지침 §4.1·§4.5는 setter·dispatch 호출과 그 인자를 `calls`·`dataflow`에서 제외하므로 FP가 맞다.
- FN 33개의 내역은 다음과 같다.
  - `updates` 19개: React setter·dispatch. §4.1의 analyzer 문제
  - `references` 14개: 패턴 `REF-SHORTHAND-PROPERTY`(반환 객체 shorthand `{ count, increment }`). 충돌과 무관한 별도 analyzer 한계다. 차단되지 않은 39개 사례에서도 이 패턴은 25개 중 TP 0개였다(`score/metrics-by-pattern.csv`)
- 진단용 재키잉에서 5개 사례 모두 `SCORED`가 되었다. 감싸는 선언이 하나로 정해지지 않은 충돌은 없었다.

### 4.4 차단되지 않은 39개 사례에 대한 영향

- 39개 사례에는 충돌이 없다. 재키잉 규칙은 충돌 묶음에만 작용하므로, 그 사례들의 채점에는 영향이 없다.
- 다만 첫 run의 진단 수치에서 `updates` 범주는 Vue 사례만으로 계산되었다. `UPD-VUE-REF` 10/10, `UPD-VUE-REACTIVE-PROP` 6/6이다. React `updates` 19개는 모두 차단 사례 안에 있어 빠졌다.
- 따라서 첫 run의 진단 수치는 `updates` 재현율과 React 범주를 실제보다 좋게 보이게 한다. 그 수치를 인용할 때 이 점을 함께 적어야 한다.

## 5. 해결 방법 비교

허용하지 않는 방법은 다음과 같다. 충돌 무시, 차단 해제, 모든 노드를 같은 키로 합치기.

| 기준 | A. 정규화 키 식별력 강화(scorer 1.2) | B. analyzer의 setter·dispatch 처리 수정 | C. 별도 진단 채점기로 원시 예측 재평가 |
|---|---|---|---|
| GT 보존 | 보존(GT 키 형식 그대로) | 보존 | 보존 |
| 원본 예측 보존 | 보존. 기존 run을 그대로 재채점할 수 있다 | 기존 run은 보존. 새 analyzer로 새 run을 만든다 | 보존 |
| TP·FP·FN 영향 | 5개 사례가 채점된다. 진단 결과로는 TP 67, FP 26, FN 33(strict, §4.3)이 더해진다. 나머지 39개 사례는 변화 없음 | React `updates` FN 19개와 setter·dispatch FP 26개가 줄 것으로 보인다(측정 전이라 추정). shorthand FN 14개는 그대로 | A와 같은 수치를 진단 자료로만 낸다 |
| 같은 줄의 다른 선언 구분 | 구분한다. 감싸는 선언 노드만 GT 키와 맞추고, 나머지는 열로 구별한다. 감싸는 노드가 하나로 정해지지 않으면 계속 차단한다 | 이번 경우는 setter 노드가 생기지 않아 충돌이 사라진다. 그러나 scorer의 한계는 남는다 | A와 같음(진단) |
| GT 키와의 호환 | 호환. GT external은 선언 시작 줄이므로 감싸는 선언 노드와 대응한다 | 호환(키 변화 없음) | 호환 |
| 사전 등록 평가 규칙 변경 | **변경**(정규화 규칙). 사후 개정으로 기록해야 한다 | 평가 규칙은 그대로. **측정 대상 시스템이 바뀐다**(analyzer 개선 후 측정) | 변경 없음(진단이므로 규칙 밖) |
| 새 버전 필요 | scorer 1.2, `eval-manifest.r2.json`, runner 1.2(현재 runner는 `exp01-scorer/1.1`과 `eval-manifest.r1.json`을 고정으로 검사한다) | analyzer 커밋 변경. runner·scorer는 그대로 쓸 수 있다. 다만 scorer 1.1로는 같은 줄 충돌 위험이 남는다 | 없음 |
| 확증 분석 사용 | 사전 등록 확증 결과로는 쓸 수 없다. "사후 개정 평가 규칙(amendment)에 따른 결과"로 따로 보고하면 쓸 수 있다 | 원래 analyzer의 정확도가 아니다. "개선 후 결과"로 따로 보고해야 한다 | 쓸 수 없음(진단 전용) |

## 6. 권장 수정안(가장 작은 범위)

**A를 먼저 하고, B는 별도 단계로 한다.** C는 이 PR의 진단 자료로 이미 했다.

### 6.1 이유

- 차단의 직접 원인은 scorer 키다. 측정 대상(analyzer 커밋 `43ace0f`)을 바꾸지 않고, 첫 run의 원시 예측을 그대로 다시 채점할 수 있는 방법은 A뿐이다.
- A의 규칙은 충돌 묶음에만 작용한다. 차단되지 않은 39개 사례의 결과는 바뀌지 않는다(§4.4).
- B를 먼저 하면 "원래 Cogic의 정확도"를 측정할 기회가 사라진다. 또 analyzer 수정 효과와 평가 규칙 변경이 섞인다.

### 6.2 scorer 1.2 규칙 초안

- external 노드의 기본 키는 그대로 `X|file|line`이다.
- 같은 키의 external 노드가 둘 이상이면 다음처럼 처리한다.
  - 다른 노드를 모두 감싸는 범위의 노드 하나는 `X|file|line`을 유지한다.
  - 나머지는 `X|file|line|c<열>`로 둔다. 이 키는 GT에 없으므로 그 관계는 FP가 된다.
- 감싸는 노드가 하나로 정해지지 않는 충돌, external이 아닌 노드끼리의 충돌은 지금처럼 `node-key-collision`으로 차단한다(fail-closed 유지).
- 진단 출력에 재키잉된 노드 목록을 남긴다.
- 테스트를 추가한다.
  - 같은 줄 선언 2개
  - 감싸는 노드 없음 → 차단 유지
  - 비 external 충돌 → 차단 유지
  - 기존 44개 테스트 유지

### 6.3 보고 원칙

- 첫 run(`exp01-20261029-0651-43ace0f-50587`)은 계속 `EXP01_DIAGNOSTIC_ONLY`다.
- 사전 등록 규칙(scorer 1.1) 아래에서 EXP-01 확증 결과는 **없음**으로 기록한다.
- scorer 1.2 결과는 "사후 개정 평가(첫 run 예측을 본 뒤 정한 규칙)"로 표시한다. 개정 이유(같은 줄 선언 충돌), 영향 범위(5개 사례), 39개 사례 불변을 함께 적는다.
- 사전 등록 결과와 같은 표에 섞지 않는다.
- B를 하면 그 결과는 "analyzer 개선 후" 결과로, 개선 전 결과(A)와 나란히 보고한다.

## 7. 정확도 평가 타당성에 대한 영향

1. **사전 등록 확증 결과가 없다.** scorer 1.1 기준으로는 확증 결과를 만들 수 없다. 이후 결과는 모두 사후 개정이나 개선 후 결과다.
2. **이번 감사는 측정 결과를 보고 진행했다.** 원인 조사와 규칙 초안(§6.2)은 예측을 본 뒤에 만들었다. 규칙이 충돌 묶음에만 작용하고, 차단되지 않은 사례의 결과를 바꾸지 않는다는 점(§4.3–§4.4)을 근거로 제시한다. 다만 사후 개정이라는 사실은 그대로 남는다.
3. **실제 analyzer 한계를 하나 찾았다.** 타입이 있는 React의 setter·dispatch가 `updates`가 되지 않는다. 이것은 EXP-01이 겨냥한 "기존 테스트는 존재만 확인한다"는 문제의 구체적인 사례이며, 결과로 보고할 대상이다.
4. **사전 등록 지원 분류와 실제 동작이 다르다.** `UPD-REACT-*`는 `supported`로 사전 분류되었지만 동작하지 않았다. 분류를 바꾸지 않고, in-scope 재현율의 FN으로 그대로 집계한다.
5. **GT 문제는 발견되지 않았다.** 차단 원인은 GT나 지침의 정답 오류가 아니다. GT v1과 지침은 바꿀 필요가 없다.
6. **`REF-SHORTHAND-PROPERTY` FN은 별개다.** 이번 충돌과 관계없는 analyzer 한계로, 오류 분석 때 따로 다룬다.

## 8. 후속 수정 PR 계획

모두 사용자 승인 후 진행한다. 순서대로 별도 PR로 한다.

| 순서 | PR | 내용 | 바뀌는 것 | 바뀌지 않는 것 |
|---|---|---|---|---|
| 1 | scorer 1.2(사후 개정) | §6.2 규칙과 테스트. `SCORER_VERSION = "exp01-scorer/1.2"`. `eval-manifest.r2.json` 새로 작성(기존 r1은 보존). 개정 기록 문서 | `tools/exp01/lib.mjs`, 테스트, 새 manifest, 문서 | GT v1, 지침, `gt-manifest.json`, `eval-manifest.r1.json`, analyzer |
| 2 | runner 1.2 | 검사할 평가 manifest를 r2로, 허용 scorer 버전을 1.2로 바꾼다. 사전 등록 프로토콜(1.1)과 개정 프로토콜을 run 기록에 구별해 남긴다 | `tools/exp01-run.mjs`, 테스트, 문서 | 위와 같음 |
| 3 | 재채점과 재측정 | ① 첫 run의 원시 예측을 scorer 1.2로 재채점(새 출력 폴더, 기존 `score/`는 보존). ② 같은 커밋에서 runner 1.2로 새 run 1회 | 새 데이터 폴더, 결과 문서 | 기존 run 폴더 |
| 4 | analyzer 개선(선택, B) | `resolveCallTarget`에서 심볼 선언이 hook source 바인딩이면 시그니처 선언보다 먼저 `updates`로 처리한다. 타입 있는 React 테스트를 추가한다. 이후 새 run을 "개선 후"로 따로 보고한다. `REF-SHORTHAND-PROPERTY`도 같은 방식으로 따로 다룰 수 있다 | `src/analyzer/analyze.ts`, `src/test/` | 평가 도구, GT |

## 9. 재측정 필요 여부

**필요하다.**

- 확증에 가까운 결과(사후 개정으로 표시)를 얻으려면 PR 1–2 후에 다시 채점해야 한다. 같은 커밋에서 runner 1.2로 재실행하는 것을 권장한다.
- analyzer 출력은 같은 커밋에서 결정적이었다(두 run 동일). 따라서 원시 예측 재채점만으로도 같은 수치가 나올 것으로 보인다. 그래도 runner의 모든 게이트를 다시 통과한 기록이 필요하다.
- analyzer 개선(B)을 하면 개선 후 run이 따로 필요하다.

## 10. 결론

**P1F_ROOT_CAUSE_CONFIRMED**

- 충돌한 노드는 같은 줄에 있는 서로 다른 선언이다. `useState`·`useReducer` 함수 선언과, 그 반환 tuple 안의 setter·dispatch 함수 타입이다. 실행 경로만 다른 두 run에서 같게 재현되었다.
- 원인은 둘이다.
  - analyzer: 타입이 있는 React setter·dispatch 호출을 `updates` 대신 함수 타입을 가리키는 external `calls`·`dataflow`로 출력한다(`resolveCallTarget`의 선언 선택 순서). 합성 입력으로 재현했다.
  - scorer 1.1: external 키(`X|file|line`)가 같은 줄의 두 선언을 구별하지 못한다. fail-closed 규칙이 설계대로 차단했다.
- 충돌이 행 단위 수치를 왜곡하지는 않았다. 차단 사례 5개의 FP 26개는 모두 setter·dispatch 관계이고, FN 33개는 `updates` 19개와 `REF-SHORTHAND-PROPERTY` 14개다.
- GT v1, 지침, scorer, runner, analyzer, manifest, run 결과는 바꾸지 않았다. 실제 analyzer 실행은 합성 입력 진단(`react-setter-probe.mjs`)뿐이다. EXP-01 코퍼스에 analyzer를 다시 실행하지는 않았다.
