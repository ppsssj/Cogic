# EXP-01 Annotation Guide (Ground Truth 작성 지침)

- 적용 대상: `docs/thesis-experiments/fixtures/exp-01/` 아래 모든 fixture의 `expected.json`
- 상위 규칙: [exp-01-accuracy.md](../../experiments/exp-01-accuracy.md) §5–§7, §6.5(P0-R1)
- 버전: guide v1 (P1-A, 2026-10-26). 바꿀 때는 §10 절차를 따른다.

이 지침은 "어떤 관계가 정답인가"를 정한다. 정답은 **TypeScript 소스의 정적 의미**로만 정한다. Cogic analyzer가 실제로 무엇을 출력하는지는 정답의 근거가 아니다.

---

## 1. 기본 원칙

1. **Blind 작성**: GT 작성자는 해당 fixture에 Cogic을 실행하지 않고, Cogic 출력·테스트 snapshot·그래프 JSON을 보지 않는다.
2. **정적 의미 기준**: 정답은 TypeScript 5.9.3 타입 검사기가 해석하는 소스 의미와 아래 정의로 정한다. 실행 시점에만 정해지는 대상은 §6.2의 `indeterminate`로 분류한다.
3. **그래프 모델은 평가 대상 API에서 가져온다**: 무엇을 노드로 보는지(§2)는 Cogic 그래프 모델(`src/shared/protocol.ts`의 노드 6종·관계 5종)을 따른다. 노드를 어떻게 나누는지가 아니라, 그 노드 사이의 관계를 얼마나 정확히 추출하는지를 평가하기 때문이다. 관계의 참·거짓은 구현이 아니라 이 지침의 정의로 정한다.
4. **관계는 집합 단위**: `(kind, source, target)`(dataflow는 `+ argIndex`)가 같으면 호출 지점이 여러 개여도 관계 1개다. 근거 줄은 모두 `evidence`에 적는다.
5. **완전성**: 각 fixture의 활성 파일(`activeFile`)에 대해 다섯 관계 종류와 framework owner를 **빠짐없이** 적는다. 빠진 정답은 예측이 맞아도 FP로 처리되기 때문이다. 호출 지점 누락은 validator가 검사한다(§8). 참조(references)의 완전성은 사람이 확인한다.
6. **작성자 지식의 한계**: P1-A 작성자(Claude Code)는 Cogic 구현 소스를 읽었다. 지원 범위 분류(§6.1)에 필요했기 때문이다. 이 사실이 정답 선택에 영향을 줄 수 있으므로 독립 검토(`review/`)로 보완한다.

## 2. 노드(그래프 모델)

| GT 노드 type | 의미 | 정규화 키 |
|---|---|---|
| `file` | 활성 파일의 모듈 최상위 | `F\|<file>` |
| `callable` | 본문이 있는 함수 선언, 메서드(클래스·객체 리터럴), 화살표/함수 표현식으로 초기화된 변수·속성·클래스 필드 | `D\|<file>\|<line>\|callable` |
| `class` | 클래스 선언 | `D\|<file>\|<line>\|class` |
| `typeLike` | interface, type alias, enum | `D\|<file>\|<line>\|typeLike` |
| `synthetic` | framework owner·상태 source(§5) | `S\|<file>\|<line>` |
| `external` | 활성 파일 밖(다른 fixture 파일, shim)의 선언 | `X\|<file>\|<line>` |
| `module` | dynamic import 대상 모듈 | `M\|<file>` |
| `lib` | TypeScript lib 선언(`Array.map` 등) | `L\|<symbol>` |

- **노드가 아닌 것**: 이름 없는 화살표/함수 표현식(단 §5의 framework 콜백은 예외), 생성자, overload 시그니처(본문 없음), interface 메서드 시그니처, 일반 변수·속성, 함수 파라미터.
- **줄 번호(`line`)**: 1-based. 선언의 시작 토큰 줄이다(`getStart` 기준). 데코레이터와 수식어(`export`, `static` 등)는 포함하고 주석·JSDoc은 제외한다. 화살표 함수로 초기화된 변수·속성은 **화살표 함수의 시작 줄**이다. fixture는 이 줄이 선언 줄과 같도록 작성한다.
- **한 줄에 앵커 1개**: 같은 정규화 키가 두 노드에 붙지 않도록, fixture 한 줄에 같은 종류의 선언·앵커를 두 개 이상 두지 않는다. validator가 키 충돌을 검사한다.
- `external` 노드의 줄은 그 선언(함수, 메서드 시그니처, 클래스, interface 등)의 시작 줄이다. 생성(constructs)의 대상은 클래스 선언 줄이며 생성자 줄이 아니다.

## 3. Owner(관계의 출발 노드) 결정

관계의 `source`는 그 코드를 실행·포함하는 owner 노드다.

1. **가장 가까운 노드**: 코드를 감싸는 가장 가까운 §2 노드가 owner다. 함수 안의 지역 함수는 별도 노드다.
2. **생성자 본문과 인스턴스 필드 초기화식**: owner는 그 **클래스**다. 생성자와 필드 초기화식은 인스턴스를 만들 때 실행되는 클래스 코드이고, 생성자는 노드가 아니기 때문이다.
3. **이름 없는 콜백은 투명하다**: 이름 없는 화살표/함수 표현식 안의 코드는 그 함수를 감싸는 owner의 코드로 본다. 예: `items.map((x) => f(x))` 안의 `f` 호출은 감싸는 함수가 owner다. calls, constructs, references, dataflow, updates 모두에 같은 규칙을 적용한다. 예외는 §5의 framework 콜백이다.
4. **데코레이터 식**: 데코레이터는 꾸미는 선언 **바깥**에서 평가된다. owner는 꾸며진 선언을 감싸는 owner이며, 최상위 클래스라면 `file`이다. 클래스 데코레이터와 메서드 데코레이터 모두 같다.
5. **모듈 최상위**: 어떤 노드에도 속하지 않는 최상위 문장의 owner는 `file`이다.

## 4. 관계 정의

### 4.1 calls

owner가 함수·메서드를 **호출**하면 `calls(owner, 호출 대상)`이다.

- 대상은 실제로 실행되는 함수의 선언이다. 같은 파일이면 `callable`, 다른 파일이면 `external`, TS lib면 `lib`이다.
- 포함하는 경우:
  - 직접 호출, `this.m()`, `Cls.s()`, `obj.m()`, optional call(`f?.()`, `o?.m()`), `super.m()`
  - JSX 컴포넌트 사용(`<Comp />`)
  - `import("./m")`. 대상은 `module`이다.
  - 데코레이터 팩토리 호출(`@Get(":id")`)
- overload 함수의 정답 대상은 구현(본문이 있는 선언)이다. 다른 파일 overload처럼 허용 대상이 여럿이면 `targetAlternatives`에 적는다.
- `fn.call/apply/bind`나 `const g = f; g()`처럼 대상이 정적으로 하나로 정해지면 그 함수가 대상이다. 패턴 분류는 `ambiguous`이고 결정성은 determinate다.
- 포함하지 않는 경우(부정 사례):
  - 함수를 전달·대입만 한 경우. 이것은 references다.
  - `typeof f`
  - 주석·문자열
  - intrinsic JSX(`<div>`)
  - 상태 setter·dispatch 호출. 이것은 updates로만 표현한다(§4.4).

### 4.2 constructs

owner가 `new C(...)`를 실행하면 `constructs(owner, C)`이다.

- 대상은 클래스(같은 파일 `class`, 다른 파일 `external` 클래스 선언 줄, TS lib는 `lib`)이다.
- 상속받은 생성자를 쓰는 하위 클래스를 생성하면 대상은 하위 클래스다.
- `instanceof`, 정적 팩토리 메서드 호출, 타입 위치 사용, 객체 spread 복사, 클래스를 값으로만 반환하는 것은 생성이 아니다.

### 4.3 references

owner의 코드 안에서 §2 노드나 상태 source를 가리키는 **식별자가 호출·생성 대상 이외의 위치에 나타나면** `references(owner, 대상)`이다.

- 포함하는 위치:
  - 타입 위치(파라미터·반환·변수·필드 타입, interface·type 멤버)
  - `extends`/`implements`
  - `typeof X`
  - 값 사용(전달, 반환, 대입, 배열·객체 원소)
  - 멤버 접근의 수신 객체(`Cls.create()`의 `Cls`)
  - 호출하지 않는 메서드 접근(`obj.m`)
  - enum 멤버 접근
  - 객체 리터럴 shorthand(`{ a }`)
  - 상태 변수의 읽기·쓰기 대상(`count.value = 1`의 `count`)
- 상태 hook으로 선언된 값·setter 식별자(`count`, `setCount`)를 호출하지 않고 쓰면 그 상태 source를 참조한 것이다.
- 제외하는 위치:
  - 선언 이름
  - import/export 지정자
  - 호출·생성·JSX 태그의 대상 식별자(calls/constructs가 표현한다)
  - 노드가 아닌 것(변수·속성·파라미터·모듈 namespace)
  - 같은 이름의 지역 선언이 가리는 경우
  - 자기 자신 참조(이 코퍼스에는 없다)
- 다른 파일·TS lib 선언 참조도 정답이다(`external`/`lib` 대상, §6.1 분류상 unsupported-by-design).

### 4.4 updates

owner가 **상태 source의 값을 바꾸면** `updates(owner, 상태 source)`이다.

- React: setter 호출(`setX(v)`, `setX(prev => …)`), `dispatch(a)`.
- Vue: `ref.value`에 대입·복합 대입·증감, `reactive` 객체 속성에 대입·증감.
- 포함하지 않는 경우(부정 사례):
  - 읽기만 하는 경우
  - 상태의 복사본을 수정하는 경우
  - 같은 이름 지역 변수를 수정하는 경우
  - setter와 이름만 비슷한 일반 함수를 호출하는 경우
  - setter를 호출하지 않고 반환·전달하는 경우. 이것은 references다.
  - `useRef().current` 수정. 렌더 상태가 아니므로 해당하지 않는다(§5.1).

### 4.5 dataflow

owner의 **호출식·생성식 인자 목록**에서 값이 대상 함수·생성자의 파라미터로 전달되면 `dataflow(owner, 대상, argIndex)`이다.

- 대상은 같은 calls/constructs 관계의 대상이다. constructs면 클래스다.
- `argIndex` 정의:
  - **값을 받는 파라미터의 0-based 위치**다. TypeScript `this` 파라미터는 세지 않는다.
  - rest 파라미터로 모이는 인자들은 모두 rest 파라미터 위치 하나로 센다. 관계 단위이므로 1개다.
  - 튜플 spread는 원소가 받는 파라미터 위치마다 센다.
  - 배열을 rest 파라미터로 spread하면 rest 위치 하나다.
- 포함하지 않는 경우(부정 사례):
  - 넘기지 않은 선택·기본값 파라미터
  - 인자 없는 호출
  - JSX 속성(호출식 인자가 아니다)
  - 상태 setter·dispatch 인자(updates 영역)
- 데코레이터 팩토리 인자는 dataflow다(§4.1).
- 호출 대상이 indeterminate면 dataflow도 indeterminate로 적는다.

### 4.6 owner (framework 노드 존재)

§5에서 정의한 framework 콜백 owner·상태 source·route owner가 존재하면 `owner(synthetic)` 관계 1개로 센다. 대상은 없다.

## 5. Framework 의미

framework owner는 그 framework가 **실행하거나 관리하는** 콜백·상태다. 정의는 각 framework의 공개 API 의미에서 가져왔다. 작성자가 Cogic adapter 목록을 읽었다는 점은 §1.6에 밝혔다.

### 5.1 React (`react` 모듈에서 가져온 것만, alias·namespace import 포함)

- **상태 source**:
  - `useState`, `useReducer` 호출 하나가 상태 하나다.
  - 앵커는 hook 호출식의 시작 줄이다.
  - `useReducer`의 상태 source는 reducer 함수를 `references`한다(`FW-REACT-REDUCER-BINDING`).
- **콜백 owner**:
  - `useEffect`, `useLayoutEffect`, `useInsertionEffect`, `useMemo`, `useCallback`의 첫 인자 함수다.
  - 인라인 함수면 앵커는 그 함수의 시작 줄이다.
  - 이름 있는 함수를 넘기면 앵커는 hook 호출식의 시작 줄이고, owner가 그 함수를 `calls`한다.
- **owner가 아닌 것**:
  - `useRef`. 렌더 상태가 아닌 가변 컨테이너다.
  - `useContext`, `createContext`
  - 사용자 정의 hook. 일반 `calls`로 표현한다.
  - `react`가 아닌 모듈의 같은 이름 함수
- **"owner가 아닌 것"의 범위**(P1-A-R1 명확화, 의미 변경 없음):
  - 위 항목에 대한 부정 사례(`NEG-USEREF`, `NEG-USECONTEXT`, `NEG-CUSTOM-HOOK`)는 그 호출 위치에 **React synthetic 노드(콜백 owner·상태 source)가 생기면 안 된다**는 뜻이다. `kind: "owner"` 부정 사례이고, 대상은 그 줄의 synthetic 노드다.
  - 같은 호출의 일반 관계는 부정하지 않는다. 바깥 owner → `useRef`/`useContext`/사용자 hook의 `calls`, 인자의 `dataflow`, 식별자의 `references`는 §4의 정의대로 정답(positive)이다. 예: `h03` R10–R15.
  - 사용자 정의 hook **본문 안의** `useState` 등은 그 자체로 상태 source다(예: `h03` R03). 부정되는 것은 사용자 hook 호출 위치에 생기는 owner뿐이다.

### 5.2 Vue (`vue` 모듈에서 가져온 것만, namespace import 포함)

- **상태 source**:
  - `ref`, `shallowRef`, `customRef`, `reactive`, `shallowReactive`. 앵커는 호출식의 시작 줄이다.
  - `computed`는 파생 읽기 전용 값이므로 상태 source가 아니다.
- **콜백 owner**:
  - `computed`의 getter, `watch`의 두 번째 인자, `watchEffect`/`watchPostEffect`/`watchSyncEffect`의 effect
  - lifecycle hook(`onMounted` 등)의 콜백
- `.vue` SFC는 정량 평가에서 제외한다(카탈로그 `VUE-SFC`).
- `vue`가 아닌 모듈의 같은 이름 함수는 owner가 아니다.

### 5.3 Express (`express` 모듈의 `express()`/`Router()`로 만든 값)

- **route owner**:
  - 이런 값에 대한 route 등록 호출 하나다. 메서드는 `use`, `get`, `post`, `put`, `patch`, `delete`, `options`, `head`, `all`, 그리고 `route(path)`가 반환한 객체의 같은 메서드다.
  - 등록 위치(최상위, 함수 안)와 값의 출처(같은 파일, import)와 무관하다.
- **앵커**:
  - handler가 인라인 함수 하나면 그 함수의 시작 줄이다(그 함수가 owner).
  - 그 밖에는 등록 호출식의 시작 줄이다.
- **관계**:
  - owner는 등록된 **모든** handler 함수를 위치와 무관하게 `calls`한다. Express가 handler 목록을 순서대로 실행하기 때문이다.
  - router 객체를 mount(`app.use("/api", router)`)하면 owner는 있지만 함수 handler가 없으므로 calls는 없다.
- **route가 아닌 것**: 인자가 하나인 `app.get(name)`(설정 조회), `app.set`, `app.listen`, `router.param`, Express 값이 아닌 객체의 `get()`.

### 5.4 NestJS (`@nestjs/common`에서 가져온 것만, namespace import 포함)

- **route owner**:
  - `@Controller`가 붙은 클래스의 메서드 중 route 데코레이터(`Get`, `Post`, `Put`, `Patch`, `Delete`, `Options`, `Head`, `All`)가 붙은 메서드 하나다.
  - 앵커는 메서드 선언의 시작 줄(데코레이터 포함)이고, owner가 그 메서드를 `calls`한다.
- **owner가 아닌 것**:
  - route 데코레이터가 없는 메서드
  - `@Controller`가 없는 클래스(`@Injectable` 포함)
  - `@nestjs/common`이 아닌 같은 이름 데코레이터

## 6. 지원 분류와 결정성

### 6.1 패턴 지원 분류 (`catalog.csv`의 `support`)

| 분류 | 의미 | 평가 |
|---|---|---|
| `supported` | 코드상 처리 경로가 있다 | in-scope·overall Recall, Precision |
| `unsupported-by-design` | 코드상 명시적으로 제외했거나 처리 경로가 없다 | overall Recall, Precision |
| `ambiguous` | 정적 분석으로 일반적으로 결정하기 어려운 패턴이다 | 결정 가능하면 overall에 넣고, 아니면 §6.2 |

분류는 **패턴 단위로 실행 전에 코드 근거와 함께** 정하고 `catalog.csv`에 고정한다. 관계는 자기 패턴의 분류를 따른다. P0 카탈로그에 있는 패턴은 P0 분류를 유지한다. P1-A의 코드 읽기와 어긋나는 점은 [p1a-ground-truth.md §8](../../p1a-ground-truth.md#8-p0-문서와의-차이와-의문점)에 보고한다.

### 6.2 결정성 (`gtStatus`)

- `determinate`: 소스만 보고 정답 관계를 하나로 확정할 수 있다. "Cogic이 처리하기 어렵다"는 기준이 아니다.
- `indeterminate`: 정답 대상이 런타임 값, 동적 디스패치, 외부 공급 값에 따라 달라진다.
  - `candidates`에 후보를 적는다.
  - fixture 밖 코드가 타입 안전하게 값을 공급할 수 있으면 후보를 열거할 수 없다. export된 함수의 파라미터, export된 클래스의 public 가변 필드, 구조적 타입 인자가 그런 예다. 이때는 `"unbounded"`로 적는다.
  - 판정 사유(`reason`)는 필수다.
- 결정성은 GT 작성 시 blind로 부여하며, 예측을 본 뒤 바꾸지 않는다(§10).

### 6.3 평가 집합

P0-R1 [exp-01-accuracy.md §6.5](../../experiments/exp-01-accuracy.md#65-gt-결정성과-평가-집합-사전-고정)를 그대로 따른다.

### 6.4 비지원 노드에 붙은 관계

관계의 끝점이 비지원 framework 노드면 관계도 `unsupported-by-design`으로 분류한다. 예: 최상위 Express route owner → handler, `onMounted` 콜백 내부 호출, `shallowReactive` 상태 갱신. 끝점 노드가 없으면 그 관계를 찾을 수 없기 때문이다. 해당 패턴은 `FW-UNSUPPORTED-OWNER-EDGE`, `UPD-UNSUPPORTED-STATE`, `REF-UNSUPPORTED-STATE`다.

## 7. 부정 사례(negatives)

- 정답이 아닌데 분석기가 만들 수 있는 관계를 `negatives`에 적는다(`rationale` 필수).
- 부정 사례는 채점에서 별도 지표가 아니다. 예측되면 일반 FP이고, `negatives.csv`에 "위반"으로 표시된다.
- framework 부정 사례는 존재하면 안 되는 synthetic 노드를 정의하고 `kind: "owner"`로 적는다.
  - 이 부정 사례는 해당 framework synthetic 노드(owner/state-source/route-owner)의 **존재만** 부정한다. 같은 위치의 `calls`·`references`·`dataflow`는 별개 관계이며, 정답 여부는 §4로 정한다(P1-A-R1 명확화).
- 범주별로 최소 5개를 둔다(P0 §5.1).

## 8. 근거와 호출 지점 커버리지

- 모든 항목은 `evidence: ["<file>:<line>", …]`를 가진다. 관계를 판단한 소스 위치다.
- validator는 활성 파일의 **모든** 호출식·`new`·JSX 요소 줄이 어떤 relation·negative·indeterminate의 evidence나 `excludedSites`에 포함되는지 검사한다. 빠지면 오류다.
- 노트(`note`)에는 판정이 갈릴 수 있는 이유를 적는다. 검토자가 가장 먼저 볼 부분이다.

## 9. 파일 형식

### `case.json`

`schema`, `caseId`(=폴더 이름), `category`, `title`, `activeFile`, `description`, `authoring`(작성자, 날짜, 방법, `cogicOutputUsed`, `implementationKnowledge`, `humanReviewed`), `reviewStatus`, `reviewNotes`.

### `expected.json` (`schema: "exp01-gt/1"`)

| 필드 | 내용 |
|---|---|
| `caseId`, `gtVersion`, `activeFile` | 식별 정보. v1 파일 이름은 `expected.json` |
| `nodes[]` | `id`, `type`(§2), `file`, `line`, `name`(local·external), synthetic은 `framework`·`role`(`callback-owner`/`state-source`/`route-owner`)·`anchor`(그 줄에 있어야 하는 문자열), lib는 `symbol` |
| `relations[]` | `id`, `kind`, `source`, `target`(owner 제외), `argIndex`(dataflow), `targetAlternatives`(선택), `pattern`, `gtStatus`, `evidence`, `note`. indeterminate는 `target` 대신 `candidates`와 `reason` |
| `negatives[]` | `id`, `kind`, `source`, `target`/`argIndex`, `pattern`(NEG-*), `evidence`, `rationale` |
| `excludedSites[]` | 커버리지 검사에서 의도적으로 뺀 호출 지점: `site`, `reason`. P1-A 코퍼스에서는 비어 있다 |

## 10. 수정과 버전 관리

- 사전 등록 커밋 이후 `expected.json`(v1)은 **고치지 않는다**.
- 정정이 필요하면 `expected.v2.json`을 새로 만들고, `GT_CHANGELOG.md`에 다음을 기록한 뒤 별도 커밋한다.
  - 사례
  - 항목
  - 변경 전·후
  - 사유
  - 발견 경위: 검토, 측정 후 오류 분석 등. 측정 후 발견이면 그렇다고 적는다.
- 채점은 `--gt-version`으로 버전을 고르며, 정정이 있으면 v1과 v2 결과를 모두 보고한다(P0 §7 9번).
- 이 지침이나 `catalog.csv`를 바꾸면 같은 방식으로 버전과 사유를 남기고, `tools/exp01/manifest.mjs`로 manifest를 새로 만든다.
