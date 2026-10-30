# Corpus B 분석 환경 결정 권고 (P1-K2)

- 권고: **`KEEP_UNTYPED_SHIMS`**
- 감사 판정: **`ENVIRONMENT_AUDIT_READY`**
- 이 문서는 권고다. Corpus B 입력·GT·MANIFEST·평가 절차는 바꾸지 않았다. 연구자가 채택하기 전까지 P1-K1의 고정 상태가 그대로 유효하다.

## 1. 근거

1. **진단 1,421건은 실패 건수가 아니다.**
   - 원인은 모두 환경으로 설명된다.
     - untyped 외부 모듈: 759
     - 선언 패키지 부재로 없는 전역 타입: 573
     - shim에 없는 `react/jsx-runtime`: 70
     - DOM 없는 lib override: 19
   - 원인 미상 0, vendored 코드 자체의 타입 오류 0, 로컬 모듈 해석 실패 0이다.
   - 95%(1,350건)가 의존 파일에 있다. 고유 진단은 978건이다.
2. **로컬 선언 해석은 upstream 의존성 환경과 같다.** active file 식별자 616개를 비교했다.
   - 로컬 대상이 달라진 지점: 0
   - C에서만 로컬 §2 노드가 되는 지점: 0
   - 로컬 overload·signature 변화: 0
3. **GT 대상은 C에서 그대로 확인된다.**
   - determinate 196개 중 167개는 C에서 같은 선언으로 확인되었다.
   - 나머지 29개는 지침상 구문으로 정해지는 framework 관계다. 관련 식별자의 해석이 A와 같다.
   - C 기준으로 틀린 GT 관계는 0이다.
4. **예외는 2건(4개 지점)이다.** 둘 다 GT가 A 정의(A1)상 맞고, C라면 정답이 달라질 수 있는 지점이다. 사람 검토 항목으로 넘긴다(§4).
   - bn03 `Array.includes`
   - br01 `useCallback` 반환 함수
5. **대안의 비용과 위험이 이득보다 크다.**
   - B(typed shim)는 연구자가 정한 타입이 정답과 analyzer 양쪽을 좌우한다.
   - C는 framework API 관계 198개 지점까지 범위를 넓힐 때만 의미가 있다. 그러려면 GT 범위를 새로 정의해야 한다([environment-options.md](environment-options.md)).
6. **현행 tsconfig 결정의 근거가 확인되었다.** DOM lib을 다시 넣으면 Express의 untyped `Request`·`Response`가 DOM 타입으로 잘못 해석된다.

## 2. 질문에 대한 답

**Q1. 현재 환경으로 일반화 정확도를 평가해도 타당한가?**

- 다음 조건에서 타당하다.
  - 연구 질문: "코퍼스 안에 선언된 함수·메서드·클래스·타입과 TS lib 사이의 관계 정확도"
  - 지원 범위: 이 관계들에 대한 지원 범위
  - 함께 쓰는 조건: framework 구문 의미(owner·updates)
- 이 범위에서 A의 해석은 upstream 의존성 환경과 같다.
- framework API와 외부 패키지 타입에 대한 관계까지 포함한 "실제 프로젝트 전체 그래프 정확도"는 평가할 수 없다.

**Q2. 유효하게 평가할 수 있는 관계 유형은?**

- calls·dataflow·constructs·references 중 대상이 코퍼스 로컬 선언인 것
  - 로컬 함수, import 함수, 로컬 클래스 메서드
  - 로컬 클래스 생성
  - 로컬 타입 참조
  - 인자→파라미터
- 대상이 TS lib인 것(수신 객체 타입이 코퍼스 안에서 정해지는 경우)
- framework 구문으로 정해지는 관계: Vue `ref`·`computed` owner/updates, Express route owner, NestJS route owner, React `useEffect` owner
- indeterminate 판정(파라미터 함수, 추상 메서드, 조건식 alias). C에서도 같은 근거가 유지된다.

**Q3. 제외하거나 제한을 명시해야 하는 관계 유형은?**

- 평가 범위 밖으로 명시할 것: 외부 패키지 선언을 대상으로 하는 관계
  - framework API 호출, 외부 타입 references, 외부 메서드 호출
  - C 기준 지점 198개
  - Corpus B GT에 없다. Cogic이 이런 지점에 external 노드를 만들면 FP로 집계된다. 이 규칙은 ANNOTATION_ADDENDUM A2에 실행 전에 정해 두었고, 평가하지 못하는 범위는 EVALUATION_PROTOCOL §6에 적혀 있다.
- 표본에 없어 평가할 수 없는 것
  - React 상태(`useState`·`useReducer` setter/dispatch, P1-J1 개선 대상)
  - 상속 생성자, 생성자 overload
  - 외부 클래스를 상속한 로컬 클래스의 생성
- 환경에 의존하는 작은 범주(보고 시 한계로 적을 것)
  - 외부 API의 generic 추론으로 로컬 타입이 돌아오는 값의 멤버 호출: bn03 1건
  - framework identity 함수(`useCallback`)를 거친 실행 함수: br01 3개 지점

**Q4. supported 78개가 연구 질문에 충분한가?**

- 전체 In-scope 지표의 추정: 사례 단위 cluster bootstrap CI로 보고할 수는 있다. 그러나 20개 사례·78개 관계라서 CI가 넓을 것이다. 정확한 폭은 실행 후에만 안다.
- framework별 추정
  - supported 관계 수: React 13, Vue 36, Express 9, NestJS 20
  - Express와 React는 framework별 결론을 내기에 부족하다. framework별 표는 기술 통계로만 쓴다.
- **ORIGINAL 대 IMPROVED 비교**
  - P1-J1–J3 개선 대상 패턴은 Corpus B GT에 매우 적다(GT만 센 값이다. 예측은 보지 않았다).
    - React 상태 updates: 0
    - shorthand references(REF-SHORTHAND-PROPERTY): 2
    - 생성자 관계: supported 4(CONS-TOPLEVEL 2, CONS-IMPORTED-IMPLICIT-CTOR 1, DF-CONSTRUCTOR 1)
  - 따라서 paired ΔF1은 최대 6개 안팎의 관계로 움직인다. "개선이 일반화된다"는 주장을 지지할 검정력이 없다.
  - 할 수 있는 주장: "독립 코퍼스에서 개선이 기존 관계를 해치지 않았다"(회귀 없음)를 확인하는 정도다.
- 결론: 환경 문제가 아니라 표본 설계 문제다.
  - 개선 효과의 일반화를 연구 질문으로 두려면 별도 표본이 필요하다. 개선 대상 패턴(React 상태 등)을 포함하도록 미리 정한 규칙으로 고른 표본이다.
  - 이 결정은 연구자 몫이다(§5 U-1).

**Q5. GT 사람 검토 전에 환경을 바꿔야 하는가?**

- 아니다.
  - 환경 때문에 틀린 GT 관계가 없다.
  - 예외 2건은 사람 검토에서 판단할 항목이다.
- 사람 검토는 현 환경(A)과 P1-K1 GT를 대상으로 시작할 수 있다. 검토자에게 이 감사의 §4 항목을 함께 준다.

**Q6. 환경을 바꾼다면 고정 절차와 버전 기록을 어떻게 보존하는가?**

- 다음 원칙은 환경 변경에도 적용한다(이번에는 변경하지 않는다).
  1. v1(`corpus-b/fixtures`, `MANIFEST.json`, P1-K1 문서)은 수정·삭제하지 않는다.
  2. 새 버전은 별도 경로에 만든다. 예: `corpus-b/v2/fixtures`, `corpus-b/v2/MANIFEST.json`
     - 같은 selection, 같은 upstream commit을 쓴다.
     - 환경만 다르면 사례 ID를 유지한다.
  3. 변경 기록에 남길 것
     - 무엇을 왜 바꿨는지
     - Option C라면 lockfile SHA-256, 패키지 매니저 버전, 설치 옵션
     - GT 범위 변화(새 노드 종류, 새 패턴)
     - 사람 검토를 다시 해야 하는 관계
  4. GT를 다시 쓰고 사람 검토를 거친 뒤, 평가 전에 새 MANIFEST로 고정한다. 평가 프로토콜에 사용 버전을 적는다.
  5. v1과 v2 결과를 둘 다 보고하는 경우, 어느 쪽이 사전 고정 결과인지 실행 전에 정한다.

## 3. Original/Improved 공정성

- A에서는 두 analyzer가 같은 입력, 같은 TypeScript, 같은 GT를 받는다.
- 다만 analyzer가 TypeChecker 타입을 쓰는 기능(예: 타입 있는 setter 처리)은 untyped 환경에서 드러나지 않을 수 있다.
  - Corpus B에는 그런 관계(React 상태)가 없다. 그래서 현재 표본에서 이 효과가 결과를 바꿀 여지는 작다(INFERRED).
  - 실제 영향은 analyzer를 실행해야 알 수 있다. 이번 단계에서는 확인하지 않았다.
- 선택 사항
  - C 환경에서 같은 GT로 민감도 분석을 할 수 있다(로컬 관계만, 외부 노드 예측은 범위 밖으로 처리).
  - 하려면 P1-L 실행 전에 프로토콜에 탐색적 분석으로 미리 적어야 한다. 이번 PR에서는 제안만 한다(U-2).

## 4. 사람 검토에 추가할 항목 (제안)

P1-K1 [REVIEW.md](../REVIEW.md)는 고치지 않았다. 다음 두 항목을 검토자에게 함께 준다.

| ID | 사례 | 내용 | 검토할 점 |
|---|---|---|---|
| R-ENV-8 | br01 35·44·46행 | `const { open, close } = useDisclosure()` 뒤의 `open()`/`close()`. 실행 함수는 `use-disclosure.ts`의 `React.useCallback(() => …)` 익명 콜백이다. A에서는 해석되지 않아 `excludedSites`에 있다 | 지침 §4.1("실제로 실행되는 함수")을 적용하면 C에서는 대상이 정해진다. 그 대상은 다른 파일의 이름 없는 framework 콜백이다. 이를 §2 노드로 볼지, 현행처럼 대상 없음으로 둘지 |
| R-ENV-9 | bn03 33행 | `corsOrigins.includes('*')`. C에서는 `Array.includes`(TS lib)로 해석되고, A에서는 수신 객체가 `any`다 | A1(사례 workspace 안의 정적 의미)을 유지할지. 유지하면 현행 GT가 맞다. C 기준을 택하면 CALL-LIB·DF-LIB 2개(unsupported-by-design)가 추가된다 |

## 5. 미해결 사항

| ID | 내용 | 결정 주체 |
|---|---|---|
| U-1 | 표본 규모(Q4). 개선 효과 일반화를 연구 질문으로 둘지, 그렇다면 개선 대상 패턴을 포함하는 추가 표본을 미리 정한 규칙으로 만들지 | 연구자 |
| U-2 | C 환경 민감도 분석을 P1-L 프로토콜에 탐색적 분석으로 추가할지 | 연구자 |
| U-3 | R-ENV-8, R-ENV-9의 판단 | 사람 검토자 |
| U-4 | `react/jsx-runtime`을 shim에 추가하면 TS2875 70건이 사라진다. 해석에는 영향이 없다(영향 `NONE`). v1은 바꾸지 않는다. 새 버전을 만들 때 함께 고려한다 | 연구자 |

## 6. 다음 단계

- **P1-K3 착수 가능:** 환경을 바꿀 필요가 없다. GT 사람 검토(P1-K1 REVIEW.md + 이 문서 §4)를 시작할 수 있다.
- 사람 검토가 끝나기 전에는 Corpus B에 Cogic을 실행하지 않는다.
