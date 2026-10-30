# Corpus B GT 영향 분석 (P1-K2)

- 질문: untyped shim 환경이 Ground Truth 관계를 바꿀 수 있는가?
- 근거
  - [README.md](README.md) §1.3의 진단 영향 분류
  - §1.4의 해석 비교(탐색적 조사, `exploratory/resolution-comparison.json`)
- GT는 바꾸지 않았다. Cogic 예측은 쓰지 않았다.

## 1. 판정 기준

| 판정 | 기준 |
|---|---|
| `GT_UNAFFECTED` | 관계의 대상·근거 지점이 upstream 의존성 환경(C)에서도 같은 선언으로 해석된다. 또는 관계가 지침상 구문으로 정해지고(framework owner 등), 관련 식별자가 C에서 같게 해석된다 |
| `GT_POTENTIALLY_AFFECTED` | GT 관계 자체는 A에서 맞지만, C라면 정답이 달라질 수 있는 지점이 있다. 예: C에서만 대상이 정해지는 호출 |
| `GT_INVALID_UNDER_ENVIRONMENT` | A 환경 때문에 GT 관계가 틀렸다. 예: C에서 대상이 다른 로컬 선언이다 |
| `INSUFFICIENT_EVIDENCE` | 비교로 판정할 수 없다 |

## 2. 전체 결과

| 항목 | 결과 |
|---|---|
| 비교한 active file 식별자 | 616 |
| A와 C가 같은 선언으로 해석 | 406 |
| A에서 로컬, C에서 다른 대상(`A_LOCAL_C_DIFFERENT`) | **0** |
| A에서 미해석, C에서 로컬 §2 노드(`A_UNRESOLVED_C_LOCAL_NODE`) | **0** |
| 같은 로컬 대상, 다른 signature | **0** |
| A에서 미해석·shim, C에서 외부 패키지 | 198 (A_NONE 141, A_SHIM 57) |
| A에서 미해석, C에서 로컬 비노드(객체 속성) | 4 |
| A에서 미해석, C에서 TS lib | 1 (bn03 `Array.includes`) |
| C에서만 로컬 signature가 정해지는 호출 | 3 (br01 `open`/`close`) |
| A shim, C 로컬 `.d.ts` | 1 (bv01 `App`: `*.vue` 모듈 선언) |

GT determinate 196개:

| 종류 | 관계 | C에서 같은 대상 확인 | 구문으로 정해짐(해석 비교 대상 아님) |
|---|---|---|---|
| calls | 52 | 47 | 5 (be02 배열 handler 4, bn01 Nest handler call 1) |
| dataflow | 37 | 37 (호출 대상과 파라미터 수 동일) | 0 |
| references | 82 | 77 | 5 (Vue·React 상태 synthetic 노드 대상) |
| constructs | 6 | 6 | 0 |
| owner | 17 | — | 17 |
| updates | 2 | — | 2 |
| **합계** | **196** | **167** | **29** |

- "구문으로 정해짐": 지침 §5의 framework 의미(import 출처와 구문)로 정해지는 관계다. C에서 확인한 내용은 다음과 같다.
  - 관련 식별자가 같게 해석된다. 예: Express `app`·`userRouter`·`requestLogger`·`errorHandler`, NestJS 핸들러 쪽 식별자 → 모두 같은 로컬 선언
  - framework API가 해당 패키지로 해석된다.
    - React `React` → @types/react
    - Vue `ref` → @vue/reactivity, `computed` → @vue/runtime-core
    - NestJS `ApiOkResponse` → @nestjs/swagger
- **판정**
  - GT_INVALID_UNDER_ENVIRONMENT: 0개 사례
  - GT_POTENTIALLY_AFFECTED: 2개 사례(bn03, br01)
  - GT_UNAFFECTED: 18개 사례
  - INSUFFICIENT_EVIDENCE: 0개 사례

## 3. 관계 종류별

### 3.1 calls

| 대상 | 결과 |
|---|---|
| 로컬 함수 | 로컬 대상 호출 지점 45개 중 41개는 대상과 resolved signature가 같다. 나머지 4개는 아래 두 사례다 |
| import 함수 | 같은 결과(대상 선언이 같다). 로컬 re-export(barrel)도 같은 선언으로 해석된다(br04 `Head`) |
| 메서드 | 로컬 클래스 메서드(`this.x.m()`, NestJS 서비스 주입) 모두 같다. bn02의 51개 관계는 모두 확인되었다 |
| overload | 로컬 overload 선택이 달라진 지점은 0이다 |
| 콜백 | 파라미터로 받은 함수(`next`, `fn`)는 GT에서 이미 unbounded indeterminate다. be04 `next()`는 C에서 express의 `NextFunction`이 된다. 대상이 외부 타입이므로 GT는 그대로다 |

**br01 — GT_POTENTIALLY_AFFECTED (3개 호출 지점, 35·44·46행)**

- 코드: `const { open, close } = useDisclosure()` 뒤의 `close()`·`open()` 호출이다. `useDisclosure`는 로컬 hook이고, 그 안에서 `open`/`close`는 `React.useCallback(() => …)`의 반환값이다.
- A에서: `useCallback`이 untyped라 호출 signature가 없다. GT는 이 지점을 `excludedSites`(`NO_NODE_TARGET`)로 두었다.
- C에서: `useCallback<T>(cb: T): T` 덕분에 signature가 `use-disclosure.ts` 6·7행의 익명 콜백으로 정해진다.
- 지침 §4.1("대상은 실제로 실행되는 함수의 선언")을 적용하면 C에서는 대상이 하나로 정해진다. 다만 그 대상은 다른 파일의 이름 없는 framework 콜백이라 §2 노드가 아니고, 지침에는 이 경우의 규칙이 없다.
- 이 판단은 사람 검토 항목으로 넘긴다(decision.md §4 R-ENV-8). GT는 바꾸지 않았다.

**bn03 — GT_POTENTIALLY_AFFECTED (1개 호출 지점, 33행)**

- 코드: `corsOrigins.includes('*')`. `corsOrigins`는 untyped `ConfigService.getOrThrow('app.corsOrigins', { infer: true })`의 값이다.
- A에서: 값이 `any`라 `includes`가 해석되지 않는다. GT는 `excludedSites`로 두었다.
- C에서: 로컬 `AllConfigType`을 통해 `string[]`로 추론되어 TS lib `Array.includes`로 해석된다.
- 영향: C라면 `calls bootstrap → Array.includes`(CALL-LIB)와 `dataflow`(DF-LIB) 2개가 더 있었을 것이다. 둘 다 `unsupported-by-design`이므로 Overall 지표에만 영향이 있다. In-scope 지표에는 영향이 없다.
- 사람 검토 항목: R-ENV-9

### 3.2 constructs

- 6개 모두 확인되었다.
  - lib 생성자 3: 모두 `new Error(…)`(bn02, br03, bv04)
  - 최상위 생성 2: be05 `UserController`, bv03 `Storage`
  - import 클래스의 암시적 생성자 1: bn03 `ResolvePromisesInterceptor`
- 상속 생성자와 생성자 overload는 Corpus B active file에 없다. 그래서 이 유형의 환경 영향은 판정할 수 없다(표본에 없음).
- 외부 클래스를 상속한 로컬 클래스(예: NestJS 저장소 패턴)를 `new`로 만드는 지점도 active file에 없다.

### 3.3 dataflow

- 37개 모두 호출 대상이 같고, A와 C의 resolved signature 파라미터 수가 같다.
- 인자→파라미터 대응은 signature 선언으로 정해지므로 환경 영향이 없다.
- 예외: br01 `open`/`close`는 인자가 없어 dataflow가 없다.

### 3.4 references

- 77개 확인. 나머지 5개는 상태 synthetic 노드(Vue `ref`, React state) 대상이다.
- shorthand property(`{ run }`)는 값 심볼로 해석했고, A와 C가 같다.
- C에서만 해석되는 로컬 식별자 4개는 모두 객체 속성이다(§2 노드 아님).
  - Express `envConfig`의 `CORS_ORIGIN`, `COMMON_RATE_LIMIT_*`
  - `userModel`의 `params`
- 외부 타입 위치(TS2709·TS2694, 예: `Request`, `ConfigService`)는 C에서 패키지 선언으로 해석된다. 이 references는 Corpus B 범위 밖이다(A2).

### 3.5 framework 의미

| framework | Corpus B active file 사용 | GT 적용 범위 |
|---|---|---|
| React | `useEffect` 1(br01), `useState`·`useReducer` 0 | 지침 §5.1의 owner는 `react` import 출처로 정해지므로 untyped여도 같다. **React 상태 관계(updates, setter)는 표본에 없다.** 그래서 P1-J1 개선 대상(타입 있는 setter)은 Corpus B로 평가할 수 없다. 환경 문제가 아니라 표본 구성의 한계다 |
| Vue | `ref` 2, `computed` 1 | 상태 source·updates·computed owner는 import 출처와 `.value` 구문으로 정해진다. C에서도 `ref`·`computed`는 @vue 패키지로 해석된다. 영향 없음 |
| Express | `express()` 1, `Router()` 1, route 등록 12(`use` 10, `get` 2) | §5.3은 `express()`/`Router()` 값과 구문으로 owner를 정한다. C에서 `app.use`는 @types/express-serve-static-core로 해석되고, `app`·handler 식별자는 A와 같다. 영향 없음 |
| NestJS | `@Controller` 1, route `@Post` 1, `@Injectable` 2 | §5.4는 `@nestjs/common` import 출처로 정한다. C에서 데코레이터는 @nestjs 패키지로 해석된다. 영향 없음 |

- 범위 제한: framework API 자체를 대상으로 하는 관계는 Corpus B GT에 없다(A2).
  - 대상: `app.use`, `useEffect`, `ref`, `@Post` 등의 호출과, 외부 타입 references
  - C에서 패키지 선언으로 해석되는 지점 198개가 여기에 해당한다(호출 84, 타입 39, 멤버 23, 값 19, 데코레이터 12, JSX 16, new 5).
  - framework별: Express 56, NestJS 77, React 42, Vue 23
  - 이 관계들은 "틀린 정답"이 아니라 "평가하지 않는 범위"다.

## 4. 사례별 판정

| 사례 | determinate | C 확인 | 구문 | 판정 | 비고 |
|---|---|---|---|---|---|
| br01 | 5 | 4 | 1 | GT_POTENTIALLY_AFFECTED | `open`/`close` 실행 함수(§3.1) |
| br02 | 8 | 8 | 0 | GT_UNAFFECTED | |
| br03 | 8 | 8 | 0 | GT_UNAFFECTED | 진단 706건은 의존 파일 |
| br04 | 2 | 2 | 0 | GT_UNAFFECTED | |
| br05 | 8 | 8 | 0 | GT_UNAFFECTED | |
| bv01 | 3 | 3 | 0 | GT_UNAFFECTED | |
| bv02 | 9 | 9 | 0 | GT_UNAFFECTED | |
| bv03 | 18 | 12 | 6 | GT_UNAFFECTED | |
| bv04 | 17 | 13 | 4 | GT_UNAFFECTED | |
| bv05 | 9 | 9 | 0 | GT_UNAFFECTED | |
| be01 | 11 | 9 | 2 | GT_UNAFFECTED | |
| be02 | 14 | 4 | 10 | GT_UNAFFECTED | 배열 handler 4개는 구문(R-01) |
| be03 | 0 | 0 | 0 | GT_UNAFFECTED | C에서도 로컬 §2 노드 대상 없음 |
| be04 | 2 | 2 | 0 | GT_UNAFFECTED | `next`는 C에서도 파라미터 |
| be05 | 7 | 7 | 0 | GT_UNAFFECTED | |
| bn01 | 13 | 12 | 1 | GT_UNAFFECTED | 진단 79건은 공유 config 파일 |
| bn02 | 51 | 51 | 0 | GT_UNAFFECTED | |
| bn03 | 4 | 4 | 0 | GT_POTENTIALLY_AFFECTED | `Array.includes`(§3.1) |
| bn04 | 3 | 3 | 0 | GT_UNAFFECTED | |
| bn05 | 4 | 4 | 0 | GT_UNAFFECTED | 추상 메서드 indeterminate는 C에서도 추상 선언 |

- "구문" 열: owner·updates·synthetic 대상 references·synthetic handler call. 위 §2의 29개다.
- indeterminate 14개
  - 파라미터 함수 호출(be04, bv04)은 C에서도 파라미터라 그대로다.
  - 추상 메서드 호출(bn05)은 C에서도 추상 선언이라 그대로다.
  - 조건식 alias 호출(bv02, bv05)의 후보 2개씩은 C에서도 같은 로컬 api 메서드다(`ComputedRef` 값에 따른 선택).

## 5. 해석의 한계

- 비교는 active file의 식별자 해석만 본다. GT의 owner 결정(익명 콜백 투명성 등)은 구문 규칙이므로 타입과 관계가 없다.
- C는 upstream이 고정한 의존성 버전 하나의 해석이다. 의존성 버전이 다르면 패키지 쪽 해석은 달라질 수 있다. 로컬 선언 해석은 같을 것으로 본다(INFERRED).
- `Array.includes`처럼 "외부 API의 generic 추론을 거쳐 로컬 타입이 돌아오는" 경로는 active file에서 1건만 나타났다. 다른 표본에서는 더 흔할 수 있다.
- 이 비교는 Cogic analyzer가 두 환경에서 다르게 동작하는지는 답하지 않는다(analyzer를 실행하지 않았다). decision.md §3에서 다룬다.
