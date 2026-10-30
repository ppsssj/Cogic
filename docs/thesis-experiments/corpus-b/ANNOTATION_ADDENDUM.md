# Corpus B Annotation Addendum (EXP-01 지침 v1 보충)

- 적용 대상: `corpus-b/fixtures/` 아래 20개 사례의 `expected.json`
- 기본 지침: [EXP-01 ANNOTATION_GUIDE.md](../fixtures/exp-01/ANNOTATION_GUIDE.md) v1. 관계 정의(§2–§7)는 바꾸지 않는다.
- 이 문서의 역할: 실제 오픈소스 코드와 "의존성 미설치" 분석 환경에서 생기는 경우를 어떻게 적용했는지 고정한다. 모든 규칙은 Cogic을 이 코퍼스에 실행하기 **전에** 정했다.
- 상태: **REVIEW_PENDING.** 사람 검토 전이다.

---

## A1. 분석 환경과 "정적 의미"

- 지침 §1.2는 정답을 "TypeScript 5.9.3 타입 검사기가 해석하는 소스 의미"로 정한다. Corpus B에서는 그 의미를 **각 사례 workspace 안에서** 해석한다.
- workspace 구성:
  - 선정 파일과 그 파일의 로컬 import closure를 upstream 원본 그대로 넣는다.
  - 외부 패키지(React, Vue, Express, NestJS 포함)는 `declare module "x";` 형식의 untyped 선언만 둔다(`shims/third-party.d.ts`, 자동 생성).
- 따라서 외부 패키지에서 가져온 값과 타입은 `any`이고, 그 선언은 코퍼스 안에 없다.

## A2. 대상 노드가 없는 호출 지점

- 호출 대상이 코퍼스 안에 선언이 없는 외부 API면 대상 §2 노드가 없다. 예: `res.status()`, `express.Router()`, `@Controller()`, `<DrawerContent>`.
  - 이런 호출은 관계로 적지 않는다.
  - 대신 `excludedSites`에 `NO_NODE_TARGET: <사유>`로 남긴다. validator의 호출 지점 커버리지를 위해서다.
- 다음도 같은 방식으로 처리한다.
  - 지역 변수·구조분해 바인딩처럼 §2 노드가 아닌 선언
  - 이름 없는 default export 화살표 함수
  - intrinsic JSX(`JSX_INTRINSIC`, 지침 §4.1)
- 결과 해석: Cogic이 이런 지점에 external 노드를 만들면 FP가 된다. 이 규칙은 실행 전에 고정했다.
- EXP-01과의 차이: EXP-01은 framework를 typed shim으로 선언했고, framework API 호출을 `CALL-FW-API` 등의 정답으로 두었다. Corpus B에는 그런 정답이 없다.

## A3. TS lib

- lib 노드의 symbol은 `인터페이스.멤버`로 쓴다. 예: `Promise.then`, `Document.getElementById`.
  - `XConstructor`의 정적 멤버는 `X.멤버`로 쓴다. 예: `Number.parseInt`.
  - 전역 함수 호출은 그 이름으로 쓴다. 예: `Number`, `Error`.
- lib 전역 객체를 멤버 접근의 **수신 객체로만** 쓴 경우는 references로 적지 않는다. 예: `Math.max`의 `Math`, `document.getElementById`의 `document`. EXP-01 c07 선례다.
- lib **타입** 참조는 적는다. 예: `Promise<…>`, `Partial<…>`, `HTMLInputElement`. EXP-01 n04 선례다.

## A4. owner 위치에 따른 패턴 우선순위

catalog의 지원 분류에는 대상 종류가 아니라 **owner 위치** 때문에 지원 범위 밖인 패턴이 있다.

- `REF-TOPLEVEL`: file 노드가 references 계산의 owner가 아님
- `REF-IN-ANON-CALLBACK`: 화살표 함수가 references 계산의 경계
- `CALL-CTOR-BODY` 등

따라서 references 패턴은 다음 순서로 고른다.

1. `REF-LIB`, `REF-CROSS-FILE`(대상 위치)
2. `REF-IN-ANON-CALLBACK`(이름 없는 콜백 안)
3. `REF-TOPLEVEL`(owner가 file)
4. 대상 종류에 따른 패턴: `REF-STATE-*`, `REF-SHORTHAND-PROPERTY`, `REF-TYPE-ANNOTATION` 등

calls와 constructs도 같은 원칙을 따른다.

- `CALL-LIB` > `CALL-CTOR-BODY` > `CALL-IN-ANON-CALLBACK` > 대상·형태별 패턴
- file이 owner인 호출은 `CALL-TOPLEVEL`이다. EXP-01 e03 선례다.

## A5. 정답 불확정(indeterminate)

다음은 `candidates: "unbounded"`로 둔다. 인자 dataflow도 같은 상태로 둔다(지침 §4.5).

- 파라미터나 파라미터 구조분해로 받은 함수의 호출(`CALL-PARAM-CALLBACK`)
- 인터페이스·타입 멤버 시그니처를 통한 호출(`CALL-INTERFACE-DISPATCH`)
- **추상 클래스의 추상 메서드** 호출(`CALL-INTERFACE-DISPATCH`)
  - 실제 구현은 Nest 의존성 주입이 정한다.
  - 사례: bn05 `this.fileRepository.create`

조건식으로 두 함수 중 하나를 고른 지역 상수의 호출은 후보를 열거한 indeterminate(`CALL-VARIABLE-ALIAS`)로 둔다. 사례: bv02, bv05의 `requester`/`requestor`.

## A6. Express

EXP-01 e02·e03의 규칙을 그대로 쓴다.

- 최상위 등록은 `FW-EXPRESS-TOPLEVEL`이다(지원 범위 밖). 그 owner의 handler `calls`는 `FW-UNSUPPORTED-OWNER-EDGE`다.
- 등록된 handler가 배열 리터럴 값이면 그 배열 원소 중 §2 노드인 함수를 handler로 본다(be02).
  - 경우 1: 다른 파일에서 `export default [a, b, c]`로 내보낸 배열
  - 경우 2: 함수가 배열 리터럴을 그대로 반환하는 경우
  - 근거 줄에 함수 이름이 없으므로 validator 경고가 나온다. 사유는 `note`에 적었다.
- 외부 패키지 호출의 반환값(`cors()`, `helmet()`, `rateLimit()`)이나 router 값은 노드가 아니다. 이 경우 owner만 있고 calls는 없다.
- `app.set`은 route가 아니다. `NEG-EXPRESS-NONROUTE` 부정 사례로 둔다.

## A7. NestJS

- route owner의 앵커 줄은 메서드 선언의 시작 줄(첫 데코레이터)이다(지침 §5.4).
- 앵커 문자열은 그 줄에 실제로 있는 문자열이다. 예: bn01 26행 `@ApiOkResponse(`. route 데코레이터 `@Post`는 32행에 있다.
- 클래스·메서드·파라미터 데코레이터 식의 owner는 클래스를 감싸는 owner(file)다(지침 §3.4, D10).
- 생성자 파라미터 프로퍼티의 타입 참조 owner는 클래스다(§3.2).

## A8. React·Vue

- `react`/`vue` 모듈에서 가져온 hook·API만 framework owner로 본다(§5.1–§5.2). untyped 선언이어도 import 출처로 판정한다.
- 외부 함수에 넘긴 이름 없는 콜백은 투명하다(§3.3). 예: `React.forwardRef(...)`, pinia `defineStore(...)`, `.then(...)`. 콜백 안 관계의 owner는 바깥 owner이고, 최상위면 file이다.
- 사용자 정의 hook 호출에는 framework owner가 생기면 안 된다. 이 경우를 `NEG-CUSTOM-HOOK` 부정 사례로 둔다(br01).

## A9. 부정 사례

- 실제 코드는 부정 사례를 위해 설계된 것이 아니다. 그래서 코드에 자연스럽게 나타나는 부정 관계만 적었다(2개).
- 다음은 적을 수 없었다.
  - intrinsic JSX 부정 사례: 대상 선언이 없음(EXP-01은 JSX shim 선언을 대상으로 썼다)
  - 같은 줄에 정답 synthetic 노드가 있는 경우(예: Vue `computed`): synthetic 키 충돌

## A10. 작성 보조 도구

- `tools/corpus-b/annotate-assist.mjs`가 TypeScript checker로 초안을 만들었다. 초안은 지침 §2–§5 규칙에 따라 노드·owner·관계를 제안한다.
- 사례별 검토 결정은 `corpus-b/review/<caseId>.mjs`에 코드로 남겼다. 포함하는 내용은 패턴 수정, 항목 삭제·추가, 앵커 수정, note다.
- `tools/corpus-b/make-gt.mjs`가 "초안 + 검토 결정"으로 `expected.json`을 다시 만든다.
- 보조 도구와 검토 모두 Cogic 출력을 사용하지 않았다.
- 작성자(Claude Code)는 Cogic 구현을 읽은 적이 있다(EXP-01 §1.6과 같음). 그래서 사람 검토가 필요하다.
