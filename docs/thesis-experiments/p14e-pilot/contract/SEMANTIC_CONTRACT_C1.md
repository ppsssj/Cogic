# Semantic Contract C1 — 정적 관계의 의미 계약

- **버전:** C1 (2026-11-28).
- **지위:** 원 관계 정의([RELATION_DEFINITIONS.md](RELATION_DEFINITIONS.md))와 `B` 사례 환경 규칙([CORPUS_B_ENVIRONMENT.md](CORPUS_B_ENVIRONMENT.md))이 이미 정한 의미를 한 곳에 모아 명시한 문서다.
  - 새 의미를 더하지 않는다.
  - 기존 문장으로 정할 수 없는 항목은 정하지 않고 **미결(OPEN-n)** 로 표시했다.
- **우선순위:** 이 문서와 다른 정의 문서가 어긋나 보이면 이 문서를 따르고, 어긋난 곳을 `ambiguities.csv`에 적는다.
- **미결 항목을 만나면:** 가능한 해석을 모두 `ambiguities.csv`에 적고, 하나를 골라 `relations.csv`에 `confidence = low`로 적는다. 미결 항목에는 정해진 답이 없다.

## C1-1. 관계는 정적으로 가능한 관계다

- 관계는 "소스에 그 식이 있다"는 뜻이다. 실행 여부, 조건, 횟수와 무관하다.
  - 예: `if`·`switch` 분기, `try`/`catch`, 조건부로만 실행되는 콜백 안의 호출도 관계다.
- 실제 실행에서 관측되는 호출(runtime trace)과는 다르다. 실행되지 않았다고 관계가 없는 것이 아니다.
- 같은 `(종류, owner, 대상)`은 호출 지점이 여럿이어도 관계 1개다. `dataflow`는 인자 위치를 더한다.
- **OPEN-1:** 도달할 수 없는 코드(예: `return` 뒤의 문장, 항상 거짓인 조건)의 관계는 기존 정의가 정하지 않는다.

## C1-2. 한 지점이 어떤 관계가 되는가

| 소스의 형태 | 관계 | 같은 지점에서 함께 적지 않는 것 |
|---|---|---|
| 노드인 함수·메서드를 부르는 호출식 `f()`, `o.m()`, `this.m()`, `super.m()`, `f?.()` | `calls`. 인자마다 `dataflow` | — |
| `new C(...)` | `constructs`(대상은 클래스 선언). 인자마다 `dataflow`(대상은 클래스) | `calls` |
| JSX 컴포넌트 `<Comp />` (노드인 함수·클래스) | `calls` | JSX 속성의 `dataflow`(호출식 인자가 아니다) |
| intrinsic JSX `<div>` | 없음 | — |
| 상태 setter·dispatch 호출 `setX(v)`, `dispatch(a)` | `updates`(대상은 상태 source) | `calls`, 인자의 `dataflow` |
| 호출·생성·JSX 태그 대상이 **아닌** 위치의 노드 이름(값 전달·반환·대입, 타입 위치, `extends`/`implements`, `typeof X`, 멤버 접근의 수신 객체, 호출하지 않는 메서드 접근, shorthand) | `references` | — |
| `fn.call/apply/bind(...)`, `const g = f; g()`처럼 대상이 소스만으로 하나로 정해지는 간접 호출 | 그 함수로의 `calls`(determinate) | — |

- **호출과 참조의 구분:**
  - 같은 owner·대상 쌍에 `calls`와 `references`가 함께 있을 수 있다. 예: 한 번은 호출하고 한 번은 값으로 넘기는 경우. 각각 적는다.
  - `Cls.create()`는 `Cls`로의 `references`와 `create`로의 `calls` 둘이다.
- **상태:**
  - setter·상태 값 식별자를 호출하지 않고 쓰면 그 상태 source로의 `references`다.
  - setter를 감싸는 사용자 함수를 부르면 그 함수로의 `calls`다. `updates`는 setter를 직접 호출하거나 `ref.value`·`reactive` 속성에 쓰는 owner에만 있다.
- **OPEN-2:** 다음 형태는 기존 정의가 정하지 않는다.
  - 태그된 템플릿 `` tag`...` ``
  - getter·setter 접근
  - 생성자 호출 `super(...)`
  - 런타임 헬퍼가 대신 부르는 함수

## C1-3. Owner: lexical 소속과 평가 문맥

관계의 출발점(owner)은 기본적으로 **코드를 감싸는 가장 가까운 노드**(lexical 소속)다. 다음 세 경우만 평가 문맥으로 정한다.

| 규칙 | owner |
|---|---|
| 기본 | 코드를 감싸는 가장 가까운 노드. 함수 안의 이름 있는 지역 함수는 별도 노드다 |
| 이름 없는 화살표·함수 표현식 | **투명하다.** 그 함수를 감싸는 owner. framework 콜백(C1-7)은 예외 |
| 모듈 최상위 문장 | 파일(`<file>`) |
| 예외 1. 생성자 본문, 인스턴스 필드 초기화식 | 그 **클래스**. 인스턴스를 만들 때 실행되고, 생성자는 노드가 아니기 때문이다 |
| 예외 2. 데코레이터 식 | C1-4 |
| 예외 3. framework 콜백 | C1-7 |

- 생성자 파라미터 프로퍼티(`constructor(private s: S)`)의 타입 참조 owner는 클래스다.
- **OPEN-3:** static 필드 초기화식과 static block의 owner는 기존 정의가 정하지 않는다.

## C1-4. 데코레이터 (레거시 데코레이터에 한함)

### 전제

- 이 규칙은 `tsconfig.json`의 `experimentalDecorators`가 `true`인 사례에만 적용한다. 이 패킷에서 데코레이터가 있는 사례는 모두 이 설정이다.
- 레거시 데코레이터와 TypeScript 5의 표준 데코레이터는 평가 위치가 다르다. 둘을 같은 의미론으로 보지 않는다.
  - **OPEN-4:** 표준 데코레이터(`experimentalDecorators` 없음)는 C1이 정하지 않는다.

### 규칙

1. **평가 문맥이 owner다.**
   - 레거시 데코레이터 식은 클래스 선언이 평가되는 곳에서 평가된다. 꾸며진 선언(클래스, 메서드, 프로퍼티, 파라미터)의 **안**이 아니다.
   - 따라서 owner는 **클래스 선언을 감싸는 owner**다.
     - 최상위 클래스: 파일(`<file>`)
     - 함수 안에서 선언한 클래스: 그 함수(C1-3 기본 규칙)
2. **모든 데코레이터 위치에 같다.** 클래스·메서드·프로퍼티·생성자 파라미터·메서드 파라미터 데코레이터 모두 owner가 같다.
3. **데코레이터 식 안의 모든 관계에 같다.**
   - 팩토리 호출 `@Get(":id")`: 팩토리로의 `calls`
   - 그 인자: `dataflow`
   - 인자 안의 노드 이름(예: `@Inject(SomeClass)`의 `SomeClass`): `references`
   - 이 셋 모두 owner는 위 1번의 owner다.
4. **메서드 데코레이터는 메서드 본문이 아니다.**
   - 메서드의 관계는 그 메서드의 본문(과 시그니처의 타입)에서만 생긴다.
   - 메서드에 붙은 데코레이터 식의 관계를 그 메서드의 것으로 적지 않는다.
5. **꾸밈 자체는 관계가 아니다.** "데코레이터가 이 선언에 적용된다"는 연결은 C1에 정의된 관계 종류가 없다.
   - 의미가 있다고 보면 `outside-definitions.csv`에 적는다.
6. **대상 노드가 없으면 관계가 없다.**
   - 데코레이터 팩토리가 untyped 외부 모듈에서 왔으면 대상 노드가 없다(환경 규칙 §2).
   - 이때 `sites.csv`에 `no-node-target`으로 적는다.
   - 인자 안의 노드 이름 `references`는 대상이 노드면 그대로 적는다.
7. **OPEN-5:** 팩토리가 아닌 일반 데코레이터 `@dec`(호출식이 없음)는 기존 정의가 정하지 않는다. 가능한 해석은 셋이다.
   - `references`(호출식이 아니므로)
   - `calls`(런타임이 그 함수를 부르므로)
   - 둘 다 아님
   - 이 해석들의 owner도 정해지지 않았다.

- **NestJS route:** route owner(C1-7)는 위 규칙과 별개다.
  - framework 노드다. 기준 줄은 메서드 선언의 시작 줄(첫 데코레이터)이다.
  - 그 노드가 메서드를 `calls`한다.
  - route 데코레이터 팩토리 호출 자체의 `calls`는 위 1–3번을 따른다.

## C1-5. `dataflow`의 인자 위치

- **기본:**
  - `argIndex`는 값을 받는 **파라미터의 0부터 센 위치**다. TypeScript `this` 파라미터는 세지 않는다.
  - `paramName`은 그 파라미터 이름이다.
- **rest와 spread:**
  - rest 파라미터(`...args`)로 모이는 인자들은 rest 파라미터 위치 하나로 센다. 관계 1개다.
  - 튜플 spread `f(...[a, b])`는 원소가 받는 파라미터 위치마다 센다.
  - 배열을 rest 파라미터로 spread하면 rest 위치 하나다.
  - **OPEN-6:** 길이를 알 수 없는 배열을 rest가 아닌 일반 파라미터들로 spread하는 경우는 정하지 않는다.
- **구조분해 파라미터**(`f({ a, b })`): 파라미터 하나다. 그 위치로 센다.
- **dataflow가 아닌 것:**
  - 넘기지 않은 선택·기본값 파라미터
  - 인자 없는 호출
  - JSX 속성
  - 상태 setter·dispatch의 인자
- **dataflow인 것:** 데코레이터 팩토리의 인자.
- **대상이 불확정이면:** 호출 대상이 `indeterminate`면 그 인자 `dataflow`도 `indeterminate`다.

## C1-6. 불확정(indeterminate) 관계

- **determinate:** 소스와 타입만 보고 대상이 하나로 정해진다. 도구가 해석하기 어렵다는 것은 기준이 아니다.
- **indeterminate:** 대상이 런타임 값, 동적 디스패치, 외부 공급 값에 따라 달라진다.
  - 후보를 열거할 수 있으면 `candidates`에 `;`로 적는다.
  - 열거할 수 없으면 `unbounded`로 적는다. 사례 밖 코드가 타입 안전하게 값을 공급할 수 있는 경우가 그렇다.
- `B` 사례에서는 다음을 `unbounded`로 둔다(환경 규칙 §4, **[검토 대상]**).
  - 파라미터(구조분해 포함)로 받은 함수의 호출
  - 인터페이스·타입 멤버 시그니처를 통한 호출
  - 추상 메서드 호출
- 조건식으로 두 함수 중 하나를 고른 지역 상수의 호출은 후보를 열거한 `indeterminate`다.
- 동의하지 않으면 정의에 따라 판정하고 `ambiguities.csv`에 이유를 적는다.

## C1-7. Framework 노드와 관계의 owner

용어를 나눈다.

| 용어 | 뜻 |
|---|---|
| **owner (관계의 출발점)** | 관계의 `source`. C1-3·C1-4로 정한다 |
| **framework 노드** | framework가 실행·관리하는 콜백·상태·route를 나타내는 노드. `<callback-owner>`, `<state-source>`, `<route-owner>` |
| **`owner` 관계 종류** | framework 노드가 **존재한다**는 기록. 노드 하나에 1개. 대상이 없다 |

- framework 노드는 해당 framework 모듈(`react`, `vue`, `express`의 `express()`/`Router()` 값, `@nestjs/common`)에서 가져온 API에만 생긴다.
  - alias import와 namespace import를 포함한다.
  - untyped 선언이어도 import 출처로 판정한다.
  - 같은 이름의 지역 함수·다른 모듈 함수·사용자 정의 hook에는 생기지 않는다.
- framework 콜백 노드 안의 코드는 그 framework 노드가 owner다. 이름 없는 콜백 투명 규칙의 예외다.
- 이름 있는 함수를 hook·route에 넘기면 framework 노드가 그 함수를 `calls`한다.
- 각 framework의 목록과 기준 줄은 원 정의 §5를 따른다.

## C1-8. 관계의 존재와 도구의 처리 능력

- 관계가 있는지는 **정의로만** 정한다. 어떤 분석 도구가 그 관계를 처리하는지, 처리하기 쉬운지는 관계의 존재와 무관하다.
- 다른 파일·외부 선언·TypeScript 기본 라이브러리로 가는 관계도 관계다. 표기는 [REVIEWER_GUIDE.md](REVIEWER_GUIDE.md) §3을 따른다.
- 대상 노드가 없는 지점(untyped 외부 API, 노드가 아닌 변수·파라미터)은 관계가 아니다. `sites.csv`에 `no-node-target`으로 적는다.

## 미결 항목 요약

| ID | 항목 |
|---|---|
| OPEN-1 | 도달할 수 없는 코드의 관계 |
| OPEN-2 | 태그된 템플릿, getter·setter 접근, `super(...)` 생성자 호출, 런타임 헬퍼가 부르는 함수 |
| OPEN-3 | static 필드 초기화식·static block의 owner |
| OPEN-4 | 표준(TypeScript 5) 데코레이터 |
| OPEN-5 | 팩토리가 아닌 일반 데코레이터 `@dec` |
| OPEN-6 | 길이를 알 수 없는 배열의 일반 파라미터 spread |
