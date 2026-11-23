# 원인과 수정

## 함수 타입이 명시된 property

Hono `this.fetch(...)`의 TypeChecker resolved signature는 `fetch` property의 `FunctionType` 선언을 가리키지만, property 심볼 선언은 클래스 property이고 그래프 노드 ID는 arrow initializer의 위치를 쓴다. 기존 `resolveCallTarget`은 signature 위치에서만 로컬 노드를 찾았고 둘이 달라 관계를 누락했다. Hono의 구체적 AST·심볼 기록은 [P14-A](../p14-accuracy/hono-h2-diagnostic.md)에 있다.

수정 후 호출 표현식의 TypeScript 심볼이 **현재 활성 파일에 선언되고 arrow/function initializer가 있는 property**를 가리킬 때, 기존 `resolveLocalNodeIdForDeclaration`으로 그 initializer 노드를 찾는다. 문자열 이름만 비교하거나 외부 파일의 같은 위치를 로컬로 취급하지 않는다. 함수가 아닌 property에는 이 경로를 적용하지 않는다. 선택된 signature는 인자·매개변수 계산에 그대로 사용한다. 다른 선언과 일반 overload·외부 호출은 기존 경로를 유지한다.

## ECMAScript private method

`#dispatch`의 이름은 `PrivateIdentifier`다. 이전 class 선언 수집과 body owner 전환은 `Identifier`만 받아 `#dispatch` 노드가 없었고 본문 호출이 파일에 귀속됐다. 이제 두 곳에서 `PrivateIdentifier`도 허용한다. 기존과 동일하게 선언 파일·위치 기반 ID와 클래스 parent를 쓰므로 같은 이름의 다른 클래스 메서드는 서로 다르다. 정적 `#private` 메서드도 같은 규칙이다. getter/setter와 생성자 처리는 바꾸지 않았다.

## Spread와 rest

호출을 복구하면 기존 위치 기반 dataflow도 생성된다. 길이를 알 수 없는 spread를 하나의 위치 인자로 취급하거나 그 뒤 위치를 고정하면 잘못된 관계가 생길 수 있어 중단한다. TypeScript가 모든 원소를 필수로 아는 고정 튜플은 `tuple[0]`, `tuple[1]`처럼 각 위치에 매핑한다. 마지막 spread가 rest 매개변수로 직접 들어갈 때는 전체 spread에서 rest로의 관계를 기록한다. 선택적·가변 길이 튜플은 보수적으로 생략한다. 기존 정책대로 여러 일반 인자가 rest에 들어가면 첫 대응만 기록하므로 전체 인자 추적은 보장하지 않는다.
