# Corpus B 사람 검토 대기 항목 (P1-K1)

- 상태: **20개 사례 모두 `REVIEW_PENDING`.** 사람 검토를 하지 않았다. `case.json`은 모두 `humanReviewed: false`이다.
- 이 문서의 목적: 검토자가 무엇을 확인해야 하는지 정리한다.
- 검토 순서: 이 문서의 검토 → GT 확정 → `MANIFEST.json` 재확인 → P1-L 실행
- 검토자가 보면 안 되는 것: Cogic의 Corpus B 출력. 아직 만들어지지 않았고, 검토가 끝날 때까지 만들지 않는다.

## 1. 검토 범위

| 범위 | 내용 |
|---|---|
| 전수 | 20개 `expected.json`의 determinate 196개, indeterminate 14개, 부정 2개 |
| 호출 지점 | `excludedSites` 73개. 정말로 §2 노드가 없는 지점인지 확인 |
| 규칙 | [ANNOTATION_ADDENDUM.md](ANNOTATION_ADDENDUM.md) A1–A10이 지침 v1과 맞는지, 실행 전에 정할 만한 규칙인지 |
| 환경 | 사례 구성(import closure, untyped shim, tsconfig 파생)이 평가 목적에 맞는지 |

- 권장 방법: EXP-01 [p1c-review-readiness.md](../p1c-review-readiness.md)의 방식 A(독립 사람 검토)
  - 검토자는 원문과 지침만 보고 관계를 판정한다.
  - 불일치는 `GT-ERROR` / `GUIDE-AMBIGUOUS` / `REVIEWER-DIFF`로 분류한다.
- GT를 고칠 때
  - `corpus-b/review/<caseId>.mjs`에 결정을 추가한다.
  - `make-gt.mjs`로 다시 만든다.
  - 새 manifest를 만든다. 기존 `MANIFEST.json`은 남긴다.
  - `case.json`의 `humanReviewed`와 `reviewStatus`는 검토자가 바꾼다.

## 2. 판단이 들어간 항목 (우선 검토)

### 2.1 사례별

| ID | 사례 | 판단 | 근거 | 다른 판단을 하면 |
|---|---|---|---|---|
| R-01 | be02 | `app.use(requestLogger)`, `app.use(errorHandler())`의 handler를 배열 원소 함수(`addRequestId`·`captureResponseBody`, `unexpectedRequest`·`addErrorToRequestLog`)로 보고 `calls` 4개(FW-UNSUPPORTED-OWNER-EDGE)를 추가 | 지침 §5.3은 등록된 handler 값을 대상으로 한다. 배열 값은 Express가 펼쳐 등록한다(A6) | handler가 "배열 리터럴 값"이면 노드가 없다고 보면 4개를 삭제. 지원 범위 밖이므로 In-scope 지표는 그대로이고 Overall Recall만 바뀐다 |
| R-02 | be02 | `app.set(...)`을 부정 사례 `NEG-EXPRESS-NONROUTE`로 둠 | EXP-01 e03 N03 | — |
| R-03 | be01, be02 | 최상위 route 등록 12개를 `FW-EXPRESS-TOPLEVEL`(지원 범위 밖)로 둠. 앵커는 `userRouter.get`·`app.use` | EXP-01 e03 R01/R02 | — |
| R-04 | bv02, bv05 | 조건식으로 두 api 메서드 중 하나를 고른 지역 상수(`requester`/`requestor`)의 호출을 후보 2개짜리 indeterminate(`CALL-VARIABLE-ALIAS`, `DF-INDIRECT`)로 둠 | 지침 §4.1(정적으로 하나로 정해질 때만 determinate), §6.2 | 두 후보를 모두 determinate로 두면 calls·dataflow 각 2개가 확증 집합에 들어간다 |
| R-05 | bn05 | `this.fileRepository.create`(추상 클래스의 추상 메서드)를 unbounded indeterminate(`CALL-INTERFACE-DISPATCH`)로 둠 | 실제 구현은 Nest DI가 정한다(A5). 추상 메서드는 본문이 없어 지침 §2의 callable이 아니다 | 추상 메서드 선언을 대상으로 보면 calls 1개, dataflow 1개가 determinate가 된다 |
| R-06 | bn01 | route owner 앵커를 26행 `@ApiOkResponse(`로 둠(`@Post`는 32행) | 지침 §5.4: 노드 줄은 데코레이터를 포함한 메서드 시작 줄. 앵커는 그 줄의 문자열이어야 한다(validator) | — |
| R-07 | bn01, bn02 | 클래스·메서드·파라미터 데코레이터 인자 안의 참조 owner를 file로 둠 | 지침 §3.4, D10 | — |
| R-08 | bv03 | 지역 상수 `isAuthorized`(computed 값)가 같은 이름의 모듈 함수를 가린다. 30행 shorthand `isAuthorized`에는 references가 없다 | TypeScript 이름 해석 | — |
| R-09 | br01 | `useDisclosure()`(사용자 정의 hook)에 React owner가 없다는 부정 사례 `NEG-CUSTOM-HOOK` | EXP-01 h03 N04 | — |
| R-10 | br01 | `React.useEffect` 인라인 콜백 owner. 패턴 `FW-REACT-NAMESPACE-IMPORT` | 지침 §5.1 | — |
| R-11 | br02, br03, br05, bv03 | 외부 함수(`React.forwardRef`, `.then`, pinia `defineStore`)에 넘긴 익명 콜백 안 관계의 owner를 file로 둠. 패턴은 `CALL-IN-ANON-CALLBACK`/`REF-IN-ANON-CALLBACK` | 지침 §3.3, A4·A8 | — |
| R-12 | be03 | determinate 관계 0개 | 파일 전체가 untyped `rateLimit({...})` 호출과 그 설정 객체다. `env`는 일반 변수이고, `Request`는 express 타입이다 | 이 사례의 예측은 모두 FP다. 검토자는 놓친 관계가 없는지 확인한다 |
| R-13 | be04, bv04 | 파라미터로 받은 함수 호출(`next`, `fn`)을 unbounded indeterminate로 둠 | 지침 §6.2 | — |
| R-14 | 전 사례 | 외부 패키지 API 호출을 관계로 적지 않고 `excludedSites`에 둠 | A2. 대상 §2 노드가 없다 | 이 판단이 가장 크게 영향을 준다. §2.2 R-ENV-1 참고 |

### 2.2 환경과 규칙

| ID | 결정 | 검토할 점 |
|---|---|---|
| R-ENV-1 | 외부 패키지를 모두 `declare module "x";`(untyped)로 둔다. 의존성을 설치하지 않는다 | framework API 관계와 외부 타입을 통한 관계를 평가하지 못한다. Cogic이 이 지점에 external 노드를 만들면 FP가 된다. 평가 목적(실제 코드에서의 로컬 관계 정확도)에 맞는지 |
| R-ENV-2 | Express·NestJS의 tsconfig `lib`을 DOM 없이 둔다 | untyped `Request`·`Response`가 DOM 전역 타입으로 해석되는 것을 막는다. upstream 설정과 다르다 |
| R-ENV-3 | lib 전역 객체를 멤버 접근의 수신 객체로만 쓰면 references로 적지 않는다(A3) | EXP-01 c07 선례를 실제 코드에 확장했다 |
| R-ENV-4 | references·calls·constructs 패턴은 owner 위치를 대상 형태보다 먼저 본다(A4) | 지원 분류에 영향을 준다. 예: REF-TOPLEVEL은 지원 범위 밖 |
| R-ENV-5 | 선정 도구 selection/1의 `REEXPORT_ONLY` 결함을 고친 뒤 Vue를 다시 추첨했다([README.md §3.1](README.md#31-선정-도구-수정-이력-selection1--selection2)) | 수정과 재추첨이 사전 고정 원칙에 맞는지 |
| R-ENV-6 | 코드 줄 10–120 범위만 선정한다 | 주석 작업량 때문에 정했다. 큰 파일을 대표하지 못한다 |
| R-ENV-7 | validator 경고 | 배열 handler(be02), 조건식 후보(bv02·bv05)에서 "근거 줄에 이름이 없다"는 경고가 나온다. 사유는 `note`·`reason`에 적었다 |

## 3. 작성자 독립성

- 작성자: Claude Code(생성형 AI). TypeScript checker로 초안을 만들고, 사례마다 원문과 지침을 대조해 검토했다.
- Cogic analyzer를 이 코퍼스에 실행하지 않았다. 초안 도구는 analyzer 코드를 import하지 않는다.
- 작성자는 EXP-01·P1-J1–J3 과정에서 analyzer 구현을 읽었다. 구현을 알고 쓴 GT일 수 있으므로 사람 검토가 필요하다.
  - 특히 "Cogic이 처리하는 형태"에 맞춰 관계를 넣거나 빼지 않았는지 확인해야 한다.
- 이 코퍼스의 파일은 EXP-01 fixture와 겹치지 않는다(`audit-report.json` `overlapWithExp01` 빈 목록).
