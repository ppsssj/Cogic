# Corpus B 주석 보충 규칙 A1–A10 (블라인드 검토용 판)

- 원본: `corpus-b/ANNOTATION_ADDENDUM.md`(P1-K1, 고정)
- 이 판의 차이: 규칙 문장은 그대로 두고, Corpus B 사례 ID와 사례별 결론 예시만 지웠다(문서 끝 "삭제 목록"). 검토자가 기존 정답을 미리 알지 않게 하기 위해서다.
- 기본 지침: `ANNOTATION_GUIDE.md` v1. 이 보충 규칙은 지침의 관계 정의(§2–§7)를 바꾸지 않는다.
- 표시 **[검토 대상]**: P1-K1에서 판단이 들어간 규칙이다. 검토자는 이 규칙에 동의하지 않을 수 있다. 동의하지 않으면 지침 조항을 근거로 자신의 판정을 적고, review-checklist.csv의 해당 항목에 이유를 적는다.

## A1. 분석 환경과 "정적 의미"

- 지침 §1.2의 정답은 "TypeScript 5.9.3 타입 검사기가 해석하는 소스 의미"다. Corpus B에서는 그 의미를 **각 사례 workspace 안에서** 해석한다.
- workspace에는 선정 파일과 그 로컬 import closure가 upstream 원본 그대로 들어 있다.
- 외부 패키지(React, Vue, Express, NestJS 포함)는 `shims/third-party.d.ts`에 `declare module "x";`로만 선언되어 있다. 따라서 외부 패키지에서 가져온 값과 타입은 `any`이고, 그 선언은 코퍼스 안에 없다.

## A2. 대상 노드가 없는 호출 지점

- 호출 대상이 코퍼스 안에 선언이 없는 외부 API이면 대상 §2 노드가 없다. 예: untyped 모듈에서 가져온 함수·메서드·데코레이터·JSX 컴포넌트
- 이런 지점은 관계로 적지 않고, sites-form에 "대상 노드 없음(NO_NODE_TARGET)"과 사유를 적는다.
- 다음도 같다.
  - 지역 변수·구조분해 바인딩처럼 §2 노드가 아닌 선언을 부르는 경우
  - 이름 없는 default export 화살표 함수
  - intrinsic JSX(지침 §4.1)

## A3. TS lib

- lib 노드는 `인터페이스.멤버`로 적는다. 예: `Promise.then`, `Document.getElementById`
  - `XConstructor`의 정적 멤버는 `X.멤버`로 적는다. 예: `Number.parseInt`
  - 전역 함수 호출은 그 이름으로 적는다. 예: `Number`, `Error`
- lib 전역 객체를 멤버 접근의 **수신 객체로만** 쓴 경우는 references로 적지 않는다. 예: `Math.max`의 `Math` **[검토 대상]**
- lib **타입** 참조는 적는다. 예: `Promise<…>`, `Partial<…>`, `HTMLInputElement`

## A4. owner 위치에 따른 패턴 우선순위 **[검토 대상]**

- catalog에는 대상 종류가 아니라 **owner 위치** 때문에 지원 범위 밖인 패턴이 있다. 예: `REF-TOPLEVEL`, `REF-IN-ANON-CALLBACK`, `CALL-CTOR-BODY`
- references 패턴 선택 순서
  1. `REF-LIB`, `REF-CROSS-FILE`(대상 위치)
  2. `REF-IN-ANON-CALLBACK`(이름 없는 콜백 안)
  3. `REF-TOPLEVEL`(owner가 file)
  4. 대상 종류에 따른 패턴
- calls·constructs 패턴 선택 순서
  1. `CALL-LIB`
  2. `CALL-CTOR-BODY`
  3. `CALL-IN-ANON-CALLBACK`
  4. 대상·형태별 패턴
- file이 owner인 호출은 `CALL-TOPLEVEL`이다(EXP-01 선례).

## A5. 정답 불확정(indeterminate) **[검토 대상]**

- 다음은 `candidates: unbounded`로 둔다. 인자 dataflow도 같은 상태로 둔다(지침 §4.5).
  - 파라미터·파라미터 구조분해로 받은 함수의 호출
  - 인터페이스·타입 멤버 시그니처를 통한 호출
  - 추상 클래스의 추상 메서드 호출(실제 구현은 의존성 주입 등 실행 시점에 정해진다)
- 조건식으로 두 함수 중 하나를 고른 지역 상수의 호출은 후보를 열거한 indeterminate로 둔다.

## A6. Express **[검토 대상]**

- 최상위 등록은 `FW-EXPRESS-TOPLEVEL`(지원 범위 밖)이다. 그 owner의 handler `calls`는 `FW-UNSUPPORTED-OWNER-EDGE`다(EXP-01 선례).
- 등록된 handler 값이 배열이면, 배열 원소 중 §2 노드인 함수를 handler로 본다. 두 경우가 있다.
  - 다른 파일에서 배열을 내보내는 경우
  - 함수가 배열 리터럴을 반환하는 경우
  - 이때 근거 줄에 함수 이름이 없을 수 있다.
- 외부 패키지 호출의 반환값이나 router 값은 노드가 아니다. 이 경우 owner만 있고 calls는 없다.
- `app.set`은 route가 아니다(지침 §5.3).

## A7. NestJS

- route owner의 노드 줄은 메서드 선언의 시작 줄(첫 데코레이터)이다(지침 §5.4).
- 앵커 문자열은 그 줄에 실제로 있는 문자열이어야 한다. **[검토 대상]**
- 클래스·메서드·파라미터 데코레이터 식의 owner는 클래스를 감싸는 owner(file)다(지침 §3.4).
- 생성자 파라미터 프로퍼티의 타입 참조 owner는 클래스다(§3.2).

## A8. React·Vue

- `react`/`vue` 모듈에서 가져온 hook·API만 framework owner로 본다(§5.1–§5.2). untyped 선언이어도 import 출처로 판정한다.
- 외부 함수에 넘긴 이름 없는 콜백은 투명하다(§3.3). 콜백 안 관계의 owner는 바깥 owner이고, 최상위면 file이다.
- 사용자 정의 hook 호출에는 framework owner가 생기면 안 된다(부정 사례 후보, §7).

## A9. 부정 사례

- 코드에 자연스럽게 나타나는 부정 관계만 적는다.

## A10. 작성 보조 도구

- 기존 GT는 TypeScript checker로 만든 초안을 사람이 아닌 생성형 AI가 검토해 만들었다.
- 검토자는 그 초안이나 결과를 보지 않는다. 이 검토는 원문과 지침만으로 한다.

---

## 삭제 목록 (원본 대비)

| 원본 위치 | 삭제한 내용 | 이유 |
|---|---|---|
| A2 | `res.status()`, `express.Router()`, `@Controller()`, `<DrawerContent>` 예시와 "Cogic이 external 노드를 만들면 FP" 문장 | Corpus B 사례의 지점·채점 결과 |
| A5 | 사례 ID와 호출식(bn05, bv02/bv05) | 개별 GT 결론 |
| A6 | 사례 ID와 함수 이름, `cors()`·`helmet()`·`rateLimit()` 예시, validator 경고 문장 | 개별 GT 결론 |
| A7 | 사례 ID, 줄 번호, 앵커 예시 | 개별 GT 결론 |
| A8 | 부정 사례의 사례 ID | 개별 GT 결론 |
| A9 | 부정 사례 개수와 적지 못한 사례 설명 | GT 총계 |
| A10 | 도구·review 모듈 경로와 재생성 절차 | 기존 GT 작성 기록 |
