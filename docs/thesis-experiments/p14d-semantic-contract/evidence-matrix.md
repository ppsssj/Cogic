# 관계별 검증 근거 매트릭스

## 1. 근거의 종류와 범위

| 근거 | 입증할 수 있는 것 | 입증할 수 없는 것 | 독립성 |
|---|---|---|---|
| **AST evidence** (구문 위치) | 호출식·`new`·JSX·식별자 사용이 **존재**한다. owner의 lexical 위치 | 대상이 무엇인지, 실행되는지 | 높음. 파서는 결정적이다. 단 Cogic도 같은 파서를 쓴다 |
| **Symbol resolution** (TS checker) | 이름이 가리키는 선언(별칭·barrel·import 해석) | 런타임 디스패치, `any` 너머 | **낮음.** Cogic과 같은 TypeScript Compiler API다. 공통 오류를 공유한다. 독립 oracle이 아니다 |
| **Type signature** | overload 선택, 파라미터 위치, 수신 객체의 정적 타입 | 실제 인스턴스 타입(union·인터페이스 구현) | 낮음(같은 checker) |
| **Compiler emit** | 데코레이터·필드 초기화 등의 **평가 위치**와 순서. 단 컴파일 설정에 의존한다 | 관계를 그래프로 어떻게 표현할지(추상화 정책) | 중간. 같은 컴파일러지만 analyzer 코드와 다른 경로다 |
| **Runtime observation** (trace) | **실행된 경로에서** 실제로 일어난 호출과 값 전달 | 실행되지 않은 경로(정적 관계는 may-relation). 입력에 의존 | 높음(다른 기술). 실행된 경로에 한정된 증거다. 없다는 것은 증명하지 못한다 |
| **Framework specification** | framework API가 콜백·상태를 실행·관리한다는 계약(문서) | 이 코드의 특정 호출 | 높음. 단 버전에 따라 다르다. untyped shim 환경에서는 import 출처 판정만 가능 |
| **Independent tool output** (TS LS, CodeQL 등) | 다른 구현이 같은 결론을 내는지 | 정답. 도구마다 계약이 다르다(decorator-tools.md: TS incoming/outgoing도 서로 다름) | 도구별로 다르다. TS LS는 Cogic과 기반을 공유한다 |
| **AI cross-review** | 정의를 다른 해석자가 같은 방식으로 적용하는지. 모호성 발견 | **정답의 증명이 아니다.** AI 간 일치는 같은 오류의 공유일 수 있다. 입력이 다르면 비교할 수 없다(S037) | 낮음~중간. 모델 계열과 학습 데이터를 공유할 수 있다 |
| **Human adjudication** | 정의에 비춘 최종 판정과 근거 기록 | 판정자 편향. 표본 밖 항목 | 판정자의 독립성 선언에 따라 다르다 |

원칙:
- 한 근거로 "정답"을 주장하지 않는다. 관계마다 **어떤 근거가 무엇을 확인했는지**를 기록한다.
- TypeScript Compiler API 기반 근거(Symbol, Type, LS)는 Cogic과의 **공통 원인 오류**를 배제하지 못한다. 그래서 이 근거와 Cogic이 일치해도 독립적 확인으로 세지 않는다.

## 2. 관계 범주별 적용 가능한 근거

분류는 `tools/gt-profile.mjs`의 휴리스틱이다(패턴 이름과 대상 노드 종류 기준, INFERRED). 결과는 `gt-profile.json`에 있다.

| 범주 | Corpus A | Corpus B | 결정적 근거 | 보조 근거 | 주의 |
|---|---:|---:|---|---|---|
| local-syntax (같은 파일, 직접) | 274 | 15 | AST + Symbol | Runtime(실행된 경우) | 공통 원인 위험은 낮음 |
| cross-file (`external`, `module`) | 180 | 96 | Symbol resolution | Runtime, 다른 도구 | 해석 경로가 Cogic과 같음 |
| ts-lib | 17 | 52 | Symbol(lib 선언) | — | D11 매핑 |
| type-resolution (overload·generic·alias·callback 등) | 11 | 4 | Type signature | Runtime | 공통 원인 위험이 가장 큼 |
| framework-semantics (owner, updates, 상태 참조) | 151 | 30 | Framework specification + AST | Runtime(framework 실행 시) | untyped shim 환경(B)에서는 import 출처만 |
| decorator | 20 | 0 | Compiler emit(평가 위치) + **계약 결정** | 다른 도구(계약이 서로 다름) | SC-1·SC-2: 근거보다 정책 문제 |
| dynamic / indeterminate | 6 (+indeterminate 8개 중 일부) | 13 | AST(후보 열거) | Runtime(후보 중 실행된 것) | 정답이 집합이다 |
| **합계** | 659(determinate 651, indeterminate 8) | 210(196, 14) | | | |

- Corpus A의 class 데코레이터 dataflow(`DF-POSITIONAL`)는 decorator 범주가 아니라 local-syntax로 분류되었다(휴리스틱 한계).
- Corpus B에는 데코레이터 패턴의 GT가 없다. Nest 데코레이터는 untyped shim에서 와서 대상 노드가 없다(A2).

## 3. 각 근거를 쓰는 방법 (권고)

1. **자동 근거 기록:**
   - 관계마다 AST 지점(`file:line`)과 Symbol 해석 결과(선언 위치)를 자동으로 붙인다.
   - 데코레이터처럼 평가 위치가 쟁점인 범주는 emit 위치를 붙인다.
   - 이는 GT를 바꾸지 않는 **주석 데이터**이며 별도 파일로 둔다.
2. **Runtime 근거:**
   - 실행 가능한 사례(Corpus A 합성 fixture 다수)에서 trace를 수집해 "실행된 관계" 집합을 만든다.
   - GT에 있으나 실행되지 않은 관계는 반증이 아니다.
   - GT에 없는데 실행된 관계는 **검토 우선순위 신호**다.
3. **AI 교차 검토:** 같은 입력과 지침, 서로 비공개로 진행한다. 불일치는 사람 판정 대상으로 고르는 **선별 도구**로만 쓴다.
4. **Human adjudication:** 위 근거를 모두 보고 판정하되, Cogic 예측과 점수는 보지 않는다.
