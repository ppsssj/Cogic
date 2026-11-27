# `B` 사례의 환경 규칙

`B` 사례는 공개 저장소의 실제 파일이다. `provenance.json`에 원 저장소, 고정 commit, 라이선스, 파일별 SHA-256이 있다. 규칙은 Corpus B 보충 규칙(P1-K1, A1–A3, A5, A7, A8)에서 **환경과 정의 적용**에 관한 문장만 옮겼다. 패턴 분류에 관한 규칙은 이 검토와 무관하여 넣지 않았다. **[검토 대상]** 표시는 원 규칙에서 판단이 들어간 부분이다. 동의하지 않으면 정의에 따라 판정하고 `ambiguities.csv`에 이유를 적는다.

## 1. 정적 의미의 범위

- 정답은 "TypeScript 5.9.3 타입 검사기가 해석하는 소스 의미"이며, **각 사례 workspace 안에서** 해석한다.
- workspace에는 검토 대상 파일과 그 로컬 import closure가 upstream 원본 그대로 있다.
- 외부 패키지(React, Vue, Express, NestJS 포함)는 `shims/third-party.d.ts`에 `declare module "x";`로만 선언되어 있다. 따라서 외부 패키지에서 가져온 값과 타입은 `any`이고, 그 선언은 workspace 안에 없다.

## 2. 대상 노드가 없는 호출 지점

- 호출 대상이 workspace 안에 선언이 없는 외부 API면 대상 노드가 없다. 예: untyped 모듈에서 가져온 함수·메서드·데코레이터·JSX 컴포넌트.
- 이런 지점은 관계로 적지 않고 `sites.csv`에 `no-node-target`과 이유를 적는다.
- 다음도 같다.
  - 지역 변수·구조분해 바인딩처럼 노드가 아닌 선언을 부르는 경우
  - 이름 없는 default export 화살표 함수
  - intrinsic JSX(`<div>` 등, 정의 §4.1)

## 3. TypeScript 기본 라이브러리

- lib 노드는 `인터페이스.멤버`로 적는다. 예: `Promise.then`, `Document.getElementById`.
  - `XConstructor`의 정적 멤버는 `X.멤버`로 적는다. 예: `Number.parseInt`.
  - 전역 함수 호출은 그 이름으로 적는다. 예: `Number`, `Error`.
- lib 전역 객체를 멤버 접근의 **수신 객체로만** 쓴 경우는 `references`로 적지 않는다. 예: `Math.max`의 `Math`. **[검토 대상]**
- lib **타입** 참조는 적는다. 예: `Promise<…>`, `Partial<…>`, `HTMLInputElement`.

## 4. 정답 불확정(indeterminate) **[검토 대상]**

- 다음은 `candidates`를 `unbounded`로 둔다. 그 인자 `dataflow`도 같은 상태로 둔다(정의 §4.5).
  - 파라미터·파라미터 구조분해로 받은 함수의 호출
  - 인터페이스·타입 멤버 시그니처를 통한 호출
  - 추상 클래스의 추상 메서드 호출(실제 구현은 의존성 주입 등 실행 시점에 정해진다)
- 조건식으로 두 함수 중 하나를 고른 지역 상수의 호출은 후보를 열거한 `indeterminate`로 둔다.

## 5. NestJS

- route owner의 노드 줄은 메서드 선언의 시작 줄(첫 데코레이터)이다(정의 §5.4).
- 클래스·메서드·파라미터 데코레이터 식의 owner는 클래스를 감싸는 owner(파일)다(정의 §3).
- 생성자 파라미터 프로퍼티의 타입 참조 owner는 클래스다(정의 §3).

## 6. Express

- route 등록과 handler는 정의 §5.3을 따른다. 등록된 handler 값이 배열이면 배열 원소 중 노드인 함수를 handler로 본다(다른 파일에서 배열을 내보내거나 함수가 배열 리터럴을 반환하는 경우 포함). **[검토 대상]**
- 외부 패키지 호출의 반환값이나 router 값은 노드가 아니다.
- `app.set`은 route가 아니다(정의 §5.3).

## 7. React·Vue

- `react`/`vue` 모듈에서 가져온 hook·API만 framework owner로 본다(정의 §5.1–§5.2). untyped 선언이어도 import 출처로 판정한다.
- 외부 함수에 넘긴 이름 없는 콜백은 투명하다(정의 §3). 콜백 안 관계의 owner는 바깥 owner이고, 최상위면 파일이다.
- 사용자 정의 hook 호출에는 framework owner가 생기지 않는다(부정 사례 후보).
