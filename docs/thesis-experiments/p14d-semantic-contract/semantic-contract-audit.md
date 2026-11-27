# Semantic Contract 감사

GT의 관계 의미가 어디에서 정해지는지, 그리고 그 출처들이 서로 맞는지 비교한다. 비교한 출처는 다섯 가지다.

| 출처 | 위치 | 성격 |
|---|---|---|
| 주석 지침 | `fixtures/exp-01/ANNOTATION_GUIDE.md` v1 (§2–§7), Corpus B `ANNOTATION_ADDENDUM.md` (A1–A10) | 정답의 **정의** |
| 패턴 카탈로그 | `fixtures/exp-01/catalog.csv` (143개 패턴: 설명, support, analyzer 코드 위치) | 정의 보충 + **analyzer 범위** |
| 그래프 모델 | `src/shared/protocol.ts` `GraphEdgeKind` = calls·constructs·dataflow·updates·references. framework owner는 edge가 아니라 노드 종류 | 제품의 **추상화** |
| analyzer 구현 | `src/analyzer/analyze.ts` (owner 추적 `walk`, 참조 수집) | 제품의 **실제 동작** |
| 채점 규칙 | `tools/exp01/lib.mjs` (scorer 1.2), `experiments/exp-01-accuracy.md` §6 | **평가 계약** |

판정 표기:

| 표기 | 뜻 |
|---|---|
| CLEAR | 정의가 하나로 읽힌다 |
| AMBIGUOUS | 두 가지 이상의 합리적 읽기가 있다 |
| GAP | 정의가 없다 |
| CONFLICT | 출처끼리 다르다 |

모두 이 문서의 판단(INFERRED)이며, 근거 위치를 함께 적었다.

## 1. 관계별 의미

| 관계 | 지침의 정의(요약) | 카탈로그·구현과의 관계 | 판정 |
|---|---|---|---|
| `calls` | owner의 코드 안 호출식의 대상 노드 함수·메서드. 메서드는 수신 객체의 정적 타입으로 해석. 같은 owner·대상은 1개 관계 | 일치. 데코레이터 호출 owner는 §3 4번 | 대부분 CLEAR. 데코레이터는 AMBIGUOUS(§3) |
| `constructs` | `new X()`의 클래스 X. 같은 지점의 `calls`는 적지 않음 | 일치 | CLEAR |
| `references` | 호출·생성·JSX 태그 대상이 아닌 위치에서 노드를 이름으로 사용(값 전달, 타입 위치, 상속절). 상태 식별자의 비호출 사용 포함 | 구현은 owner 선언 범위 안의 식별자를 수집한다. 데코레이터가 붙은 선언은 데코레이터 식까지 범위에 들어간다(일반 데코레이터 `@Plain` → 꾸며진 선언의 `references`, probe로 확인) | CLEAR(정의). 데코레이터 범위는 GAP |
| `dataflow` | 노드 함수 호출의 인자 위치 i → 그 파라미터. 호출식 인자 목록에만 정의(JSX props 제외) | 채점 키는 `(src, tgt, argIndex)`. label 문자열은 비교하지 않음 | 위치 인자는 CLEAR. spread·rest는 AMBIGUOUS(§2.7) |
| `updates` | framework 상태 setter·dispatch 호출, Vue ref·reactive 쓰기 → 상태 source | 카탈로그가 framework·API별로 지원을 나눈다 | framework별 CLEAR. 사용자 래퍼는 GAP |
| framework owner | React·Vue·Express·Nest 공개 API가 실행·관리하는 콜백·상태·route를 synthetic 노드로 보고, 그 존재를 `owner(synthetic)` 1개로 센다 | 그래프에서는 edge가 아니라 노드 종류다. scorer는 `owner|src` 키로 센다 | 존재 판정은 CLEAR. "owner" 이름이 §3의 owner(관계의 출발점)와 겹쳐 혼동 소지가 있다(용어 CONFLICT) |

## 2. 쟁점별 감사

### 2.1 Lexical ownership과 evaluation context — **AMBIGUOUS (핵심)**

- 지침 §3은 owner를 "코드를 **실행·포함**하는 노드"로 정의한다. 대부분의 코드에서는 포함(lexical)과 실행(evaluation)이 같다. 다르게 정하는 예외는 다음 셋뿐이다.
  - 2번: 생성자 본문과 인스턴스 필드 초기화식은 class가 owner다(평가 시점 기준).
  - 3번: 이름 없는 콜백은 투명하다(lexical 기준 유지).
  - 4번: 데코레이터는 꾸며진 선언 "바깥"이다.
- 데코레이터에서는 세 가지가 갈라진다. probe에서 확인했다(`decorator-probe/`, VERIFIED).
  - **포함(lexical):** 메서드 데코레이터는 클래스 본문 안, 메서드 선언 앞에 있다.
  - **평가 위치(emit):** 설정에 따라 다르다.
    - `experimentalDecorators: true`: 최상위 클래스의 모든 데코레이터 팩토리 호출이 **모듈 최상위**의 `__decorate([...])`에서 실행된다. 함수 안의 클래스면 **그 함수 안**이다.
    - 표준(TC39) 데코레이터(TS 5 기본): 클래스 **static block / 클래스 IIFE 안**에서 실행된다.
    - 즉 "평가 위치"는 소스만으로 정해지지 않고 **컴파일 설정에 의존**한다.
  - **구조적 대상:** 데코레이터가 적용되는 선언(메서드·클래스·프로퍼티·파라미터)이다.
- 지침의 "평가 위치 기준" 읽기는 `experimentalDecorators` 의미론을 전제한다. Corpus A fixture의 tsconfig가 모두 `experimentalDecorators: true`이므로 GT v1과 일관되지만, 이 전제가 지침에 적혀 있지 않다.

### 2.2 직접 호출과 간접 호출 — CLEAR(정의) / GAP(경계)

- 직접 호출식만 `calls`다. 함수 값을 넘겨 다른 함수가 부르는 경우는 `references` + (정의상) `dataflow`이고 `calls`가 아니다.
- **경계:** 런타임 헬퍼가 대신 호출하는 경우(`__decorate`가 일반 데코레이터 `@Plain`을 호출, 태그된 템플릿, getter)는 정의에 명시가 없다.
  - TypeScript Call Hierarchy는 `@Plain`을 **호출**로 보여 준다(VERIFIED).
  - Cogic과 GT v1의 지침 해석은 호출식이 없으므로 `references`로 본다.

### 2.3 함수 참조와 호출 — CLEAR

§4.3 제외 위치(호출 대상 식별자)로 구분한다. 같은 owner·대상에 `calls`와 `references`가 함께 있을 수 있다. GT v1에 같은 끝점·다른 kind 쌍이 41개 있다(P14-C).

### 2.4 조건부 관계와 반드시 발생하는 관계 — CLEAR(정의) / 문서화 필요

- 관계는 "코드에 그 호출식이 존재함"이며 실행 여부와 무관하다(정적 가능성, may-relation).
- 지침에 이 문장이 명시되어 있지 않다. Runtime trace와 비교할 때 혼동 소지가 있다(evidence-matrix 참조).

### 2.5 동적 디스패치와 union type — CLEAR(정의) / 구현 범위 별도

- 대상이 소스와 타입으로 정해지지 않으면 `indeterminate`(후보 열거 또는 `unbounded`)다.
- union 수신 객체의 메서드 호출은 후보 열거 대상이다. Corpus B의 A5는 인터페이스 시그니처·추상 메서드 호출을 `unbounded`로 둔다.
- "선언 대상 하나(인터페이스 메서드)"로 답하는 도구와 "구현 후보 집합"으로 답하는 도구가 다르게 채점될 수 있다.
  - TS Call Hierarchy는 선언 기준이다.
  - 이 차이는 정의가 아니라 **평가 계약**(indeterminate의 EXCLUDED 처리)이 흡수한다.

### 2.6 별칭과 고차 함수 — CLEAR / AMBIGUOUS(고차)

- import 별칭과 barrel은 원 선언으로 해석한다(CLEAR, 카탈로그 `CALL-BARREL-ALIAS` 등).
- 함수 인자를 부르는 고차 함수 안의 호출은 정의상 `indeterminate`(파라미터 호출)다. 다만 호출 지점에서 넘긴 함수가 하나로 정해질 때(지역 고차 함수에 상수 함수 전달)도 `unbounded`로 둘지는 Corpus A(`CALL-CALLBACK-PARAM`)와 Corpus B A5의 문장이 다르다. A5는 "파라미터로 받은 함수의 호출"을 일괄 `unbounded`로 둔다(AMBIGUOUS).

### 2.7 Tuple spread와 rest parameter — AMBIGUOUS

- `f(...args)`에서 인자 위치 i가 어느 파라미터로 가는지, rest 파라미터로 들어가는 여러 인자가 몇 개의 `dataflow`인지는 §4.5가 일부만 정한다.
- 채점 키에 `argIndex`가 있으므로, 위치를 세는 방식의 차이가 바로 FP/FN이 된다.

### 2.8 React/Vue 상태 변경 — CLEAR(framework API) / GAP(래퍼)

- setter·dispatch 직접 호출과 `ref.value =`는 정의되어 있다.
- 사용자 정의 hook이 setter를 감싸 반환하는 경우, 다른 컴포넌트로 setter를 넘기는 경우는 `references`·`dataflow`로만 남는다. 그렇게 둔다는 문장이 없다(GAP).

### 2.9 클래스 초기화와 생성자 — CLEAR (P14-B 이후 구현과 일치)

- 생성자 본문과 인스턴스 필드 초기화식은 class가 owner다(§3 2번). 구현도 같다(`analyze.ts`의 생성자·필드 분기).
- static 필드 초기화식은 바깥 owner다. 지침에는 명시가 없고 구현 주석에만 있다(GAP).

### 2.10 Decorator factory와 적용 대상 — **AMBIGUOUS + GAP + 구현 불일치**

| 질문 | 지침 | 카탈로그 | Cogic 구현(probe, VERIFIED) | TS Call Hierarchy(VERIFIED) |
|---|---|---|---|---|
| 클래스 데코레이터 팩토리 호출의 owner | 바깥 owner(최상위면 file) | `CALL-DECORATOR-CLASS` owner=file, supported | `calls file → ClassDeco` + dataflow | incoming: class `Sample`이 호출 |
| 메서드 데코레이터 팩토리 호출의 owner | 문장이 두 가지로 읽힘(S037) | `CALL-DECORATOR-METHOD` owner=file, unsupported-by-design | **없음**(메서드는 본문만 순회) | incoming: **메서드 자신**. 그러나 메서드의 outgoing에는 없고 class outgoing에 있음 |
| 프로퍼티 데코레이터 팩토리 | 명시 없음 | 패턴 없음 | `calls file → Prop` + dataflow | incoming: class |
| 생성자 파라미터 데코레이터 | 명시 없음 | 패턴 없음 | `calls file → Param` + dataflow | incoming: class |
| 메서드 파라미터 데코레이터 | 명시 없음 | 패턴 없음 | **없음** | incoming: 메서드 |
| 일반 데코레이터(`@Plain`, 팩토리 아님) | 명시 없음(호출식 없음) | 패턴 없음 | `references 꾸며진 선언 → Plain` | **호출**(incoming: 꾸며진 선언) |
| 데코레이터 → 적용 대상(꾸밈 관계 자체) | 없음 | 없음 | 없음 | 없음 |

- **결론:** 데코레이터 관계에는 세 개념이 섞여 있다.
  1. 팩토리 **호출**(그 인자의 dataflow 포함)
  2. 반환된 데코레이터 함수의 **적용**(런타임 헬퍼가 호출)
  3. 꾸밈이라는 **구조적 연결**
- 현재 계약은 1만 `calls`로 다루고, 그 owner를 컴파일 설정에 의존하는 평가 위치로 정한다. 2와 3은 정의되어 있지 않다.
- 일반 데코레이터는 2의 경우인데 GT·Cogic은 `references`로, TS는 `calls`로 다룬다.

## 3. 코드 의미와 그래프 추상화의 구분

| 층 | 질문 | 이 감사의 결론 |
|---|---|---|
| 코드 의미 | 소스에서 무엇이 무엇을 부르고, 어디서 평가되는가 | 컴파일러와 런타임으로 확인 가능. 단 평가 위치는 컴파일 설정에 의존한다 |
| 그래프 추상화 정책 | 그 의미를 어느 노드의 어떤 edge로 **표현**하기로 했는가 | 지침·카탈로그가 정하는 **선택**이다. "정답"이 아니라 계약이다. 데코레이터 owner를 file로 둘지 class로 둘지는 이 층의 결정이다 |
| 평가 계약 | 그 표현을 어떻게 맞다·틀리다로 셀 것인가 | scorer와 프로토콜. GT가 계약을 따르는지(적합성)와 계약이 코드 의미를 잘 반영하는지(타당성)를 분리해 보고해야 한다 |

S037의 불일치는 코드 의미의 오류가 아니다. **추상화 정책이 명시되지 않은 것**이다. 정책을 정하면 그것은 "GT 정정"이 아니라 "계약 버전 변경"이다(P14-C 프로토콜의 v1/v2와 별도의 축).

## 4. 식별한 모호 항목 목록

| ID | 항목 | 영향 범위(Corpus A GT v1) | 권고 |
|---|---|---|---|
| SC-1 | 데코레이터 팩토리 호출의 owner(lexical / evaluation / 적용 대상) | 메서드 데코레이터 관계 15개(`CALL-DECORATOR-METHOD` 8, `DF-DECORATOR-METHOD` 7), 클래스 데코레이터 5개 + 그 dataflow | 계약에 명시(s037-review 참조) |
| SC-2 | 평가 위치가 컴파일 설정(`experimentalDecorators`)에 의존함이 지침에 없음 | 데코레이터 관계 전체 | 전제 조건으로 명시 |
| SC-3 | 일반 데코레이터(`@Plain`)를 calls로 볼지 references로 볼지 | Corpus A·B에 해당 GT 없음(INFERRED, 패턴 없음) | 정의 추가 또는 범위 밖 명시 |
| SC-4 | 파라미터·프로퍼티 데코레이터 | 패턴 없음. Corpus B Nest의 파라미터 데코레이터는 untyped shim이라 대상 노드가 없음 | 범위 명시 |
| SC-5 | "관계 = 정적 가능성(may)" 명시 없음 | 전체 | 지침 1문장 |
| SC-6 | spread·rest의 `argIndex` 규칙 | dataflow 일부 | 규칙 보강 |
| SC-7 | 파라미터 함수 호출의 indeterminate 범위(A와 B 문장 차이) | Corpus B indeterminate 14개 중 일부 | 문장 통일 |
| SC-8 | "owner" 용어 중복(관계 출발점 vs framework owner 노드) | 문서 전반 | 용어 분리(예: framework node) |
| SC-9 | static 필드 초기화식·사용자 상태 래퍼 | 소수 | 명시 |
