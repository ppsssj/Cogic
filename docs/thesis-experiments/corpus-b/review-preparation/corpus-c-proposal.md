# Corpus C — Pattern-Stratified External Validation (설계안)

- 상태: **설계안(PLANNED).** 구축·주석·평가하지 않았다. 저장소 선정·파일 추출도 하지 않았다.
- 목적: Corpus B로는 검증할 수 없는 "P1-J1–J3 개선이 실제 코드에서 일반화되는가"를 검증할 별도 표본을 설계한다.
- 원칙: Corpus B를 바꾸지 않는다. Corpus B(일반 표본)와 Corpus C(의도적으로 풍부화한 표본)의 결과는 합치지 않고 따로 보고한다.

## 1. Corpus B로 검증할 수 있는 주장과 없는 주장

| 주장 | Corpus B | 근거 |
|---|---|---|
| 독립 실제 코드에서 로컬 관계 추출 정확도(In-scope Recall, supported 78개) | 검증 가능(기술 통계 + 사례 단위 CI) | P1-K1 GT, P1-K2 환경 감사 |
| framework별 정확도 | React(13)·Express(9)는 불안정. 기술 통계만 | supported 분포 |
| 개선(IMPROVED)이 기존 관계를 해치지 않는다(회귀 없음) | 부분적으로 가능. 개선 대상 밖 관계의 전이 표로 본다 | EVALUATION_PROTOCOL §3 전이 표 |
| React setter·dispatch 개선(P1-J1)의 일반화 | **불가.** 관련 GT 0 | P1-K2 gt-impact-report §3.5 |
| shorthand references 개선(P1-J2)의 일반화 | **불가.** 2개 | GT 패턴 집계 |
| 생성자 관계 개선(P1-J3)의 일반화 | **불가.** supported 4개(CONS-TOPLEVEL 2, CONS-IMPORTED-IMPLICIT-CTOR 1, DF-CONSTRUCTOR 1). 명시적·상속 생성자 0 | GT 패턴 집계 |
| Precision의 일반화 | 해석 주의(scoring-scope-audit.md) | FP 정책 |

참고: 관계 n개에서 Recall 0.8의 Wilson 95% 구간

| n | 2 | 4 | 6 | 10 | 20 | 30 | 50 | 80 |
|---|---|---|---|---|---|---|---|---|
| 구간 | 0.34–1.00 | 0.30–0.95 | 0.44–0.97 | 0.49–0.94 | 0.58–0.92 | 0.63–0.90 | 0.67–0.89 | 0.70–0.87 |

- 계산: scorer 1.2 `wilson()`, 관계 독립 가정. 사례 단위 cluster bootstrap은 이보다 넓다.
- n이 6 이하면 구간 폭이 0.5 안팎이다. 이런 패턴에 대해서는 개선 효과의 크기를 말할 수 없다.

## 2. 층화 기준 (strata)

모든 판정은 TypeScript **parser(AST)** 로만 한다. 타입 검사기·Cogic 출력은 쓰지 않는다. 형태가 같으면 선정되므로, analyzer가 잘하는 형태만 고르는 편향을 줄인다.

| 층 | 대상 구문 (AST 탐지 규칙) | 개선 단계 | 목표 |
|---|---|---|---|
| C1 React setter | `const [a, setA] = useState(…)` 또는 `React.useState`, alias import 포함 + 같은 컴포넌트 안 `setA(…)` 호출. 함수형 업데이트 `setA(p => …)` 포함 | P1-J1 | 파일 15, 관계(updates) ≥ 30 |
| C2 React dispatch | `const [s, dispatch] = useReducer(…)` + `dispatch(…)` 호출 | P1-J1 | 파일 8, 관계 ≥ 15 |
| C3 shorthand reference | 객체 리터럴의 `{ fn }` shorthand. `fn`이 같은 파일 또는 import한 함수 선언·화살표 함수 변수 | P1-J2 | 파일 15, 관계 ≥ 30 |
| C4 명시적 생성자 | 로컬·import 클래스에 `constructor(…)` 선언이 있고 `new C(…)` 인자 ≥ 1 | P1-J3 | 파일 15, constructs ≥ 30, 생성자 dataflow ≥ 30 |
| C5 상속 생성자 | `class B extends A`이고 B에는 생성자가 없으며 `new B(…)`가 있다. A는 코퍼스 안 선언 | P1-J3 | 파일 8, constructs ≥ 15 |
| C0 대조군 | 위 구문이 하나도 없는 파일을 무작위로 | 회귀 확인 | 파일 10 |

- 목표 수치는 EXP-01 계획의 규모 기준(지원 범주별 in-scope GT ≥ 30, Wilson 반폭 기준)을 따랐다.
- 탐지 규칙은 구문을 넓게 잡는다. alias·namespace import, 구조분해 변형, 함수형 업데이트를 포함한다.
- 한 파일이 여러 층에 해당하면 미리 정한 우선순위(C1 > C2 > C4 > C5 > C3)의 층 하나로만 센다. 다른 층의 관계도 GT에는 모두 적는다.

## 3. 저장소 풀과 선정 규칙 (측정 전에 고정)

1. **저장소 풀**
   - 조건: 공개 GitHub, OSI 라이선스 파일, TypeScript 주 언어, 해당 framework 직접 사용
   - 검색 질의·날짜·결과 스냅샷(저장소 목록과 star 수)을 기록하고 해시를 고정한다.
   - 제외: Corpus A·B에 쓴 저장소와 그 fork
2. **commit 고정:** 저장소마다 스냅샷 날짜의 기본 branch HEAD
3. **저장소 상한:** 한 층에서 저장소당 파일 3개 이하. 한 저장소가 층을 지배하지 않게 한다.
4. **파일 제외 규칙:** Corpus B selection/2와 같다.
   - 테스트·생성·re-export 전용 파일, 코드 줄 10–120 밖의 파일을 뺀다.
   - re-export 판정은 parser로 한다.
5. **추첨:** 층마다 eligible 파일을 경로순으로 정렬하고, `seededShuffle`(seed는 사전 기록)로 섞는다. 저장소 상한을 지키며 앞에서부터 고른다.
6. **목표 미달:** 풀이 부족하면 저장소 풀을 넓히는 규칙(다음 star 구간 등)을 미리 정해 둔다. 결과를 보고 고르지 않는다.
7. **고정:** 선정 결과, 탐지 규칙 코드, seed, 저장소 스냅샷을 manifest로 고정한다. 그 뒤에 주석을 시작한다.

## 4. 주석·검토·평가 절차

1. GT 작성: EXP-01 지침 v1 + Corpus B 보충 규칙(채택된 판). 환경은 P1-K2 권고(untyped shim)를 따른다.
   - C1·C2는 React 상태를 다룬다. 타입 있는 setter가 개선 대상이므로 환경 결정을 다시 검토해야 한다. 이 결정은 주석 전에 한다(D-6).
2. 독립 사람 검토: Corpus B와 같은 블라인드 패킷·reconciliation 절차를 쓴다.
3. 평가 프로토콜을 실행 전에 고정한다. ORIGINAL·IMPROVED, scorer 1.2, 채점 범위 결정(D-1 결과)을 쓴다.
4. 결과 보고
   - 층별 Recall·전이 표를 보고한다.
   - Corpus C는 풍부화 표본이다. 그래서 모집단 빈도나 전체 F1로 해석하지 않는다. "해당 구문이 있을 때의 정확도"로만 보고한다.
   - Corpus B 결과와 합산하지 않는다.

## 5. 위험

| 위험 | 대응 |
|---|---|
| 탐지 규칙이 analyzer가 처리하는 형태와 같아 낙관적 표본이 된다 | 규칙을 구문 단위로 넓게 정한다. 탐지 규칙을 analyzer 구현을 보지 않은 사람이 검토한다 |
| 작은 파일 제한으로 실제 컴포넌트 크기를 대표하지 못한다 | 상한(120줄)의 영향을 한계로 보고한다. 필요하면 상한을 높인 하위 층을 따로 둔다 |
| React 상태 평가가 untyped 환경에서 불공정하다 | D-6에서 환경을 정한다(예: React 사례에만 고정 의존성 설치). 결과를 본 뒤 바꾸지 않는다 |
| 주석 비용 | 파일 약 70개, 관계 수백 개. 검토자 시간 확보가 선행 조건 |
