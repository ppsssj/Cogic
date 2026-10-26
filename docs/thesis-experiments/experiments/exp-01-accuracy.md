# EXP-01: Code Relationship Analysis Accuracy

- 상태: **PLANNED** (P1 대상)
- 준비도: **PARTIALLY_READY** — analyzer를 Node에서 직접 호출할 수 있다(TESTED). Ground Truth 코퍼스, 주석 지침, 매칭·채점 도구는 아직 없다.
- 평가 대상 코드: `src/analyzer/analyze.ts` `analyzeWithWorkspace` (공개 API `analyzeWorkspaceActive`), `src/analyzer/adapters/*`
- 공통 규칙: [../experimental-design.md](../experimental-design.md)
- 개정: P0-R1(2026-10-26, GT 작성·실험 실행 전). GT 결정성 축(determinate / indeterminate)과 평가 집합 규칙(§6.5)을 추가했다. 이에 맞춰 §2 H1-5, §3, §5.1, §6.4, §7, §10, §11, §12, §14를 고쳤다. strict/lenient와 in-scope/overall 구분은 그대로다. 사유는 [../README.md 변경 이력](../README.md#변경-이력)에 있다.

---

## 1. Research Question

- **RQ1-1**: 관계 유형(`calls`, `constructs`, `references`, `dataflow`, `updates`)별로 Cogic analyzer 출력의 Precision, Recall, F1은 얼마인가?
- **RQ1-2**: 프레임워크 관계(React, Vue, Express, NestJS)에서 owner 노드와 관계 추출의 Precision, Recall, F1은 얼마인가?
- **RQ1-3**: FP·FN은 어떤 코드 패턴에 집중되는가? 설계상 비지원 패턴은 전체 재현율을 얼마나 낮추는가?

## 2. Hypothesis

방향성 가설이다. 수치 기준은 판정 목적으로 사전 고정한다. 결과가 기준에 못 미쳐도 그대로 보고한다.

- **H1-1** (calls/constructs): 정적으로 해석 가능한 직접 호출(지원 패턴)에서 Precision ≥ 0.90, Recall ≥ 0.85.
- **H1-2** (references): 같은 파일 범위(in-scope)에서 Precision이 calls보다 낮다. 근거(INFERRED): 식별자 기반 수집이라 타입 위치 참조 등 잡음이 포함될 수 있다.
- **H1-3** (dataflow): 위치 기반 인자–파라미터 대응이라 spread·rest·구조분해 파라미터에서 FN/FP가 집중된다.
- **H1-4** (framework): 각 adapter의 지원 패턴에서 Recall ≥ 0.85이고, 비지원 패턴(예: Express 다중 handler)에서는 체계적 FN이 나타난다.
- **H1-5**: 전체 재현율(overall)은 in-scope 재현율보다 낮다. 그 차이는 설계상 비지원 범주(다른 파일 reference, TS lib 호출)와 정답이 결정 가능한 `ambiguous` 사례(예: 상수 키 동적 접근)로 설명된다. 정답이 결정 불가능한 사례는 두 재현율 모두에서 제외한다(§6.5).

## 3. Experimental Variables

| 구분 | 변수 | 수준 |
|---|---|---|
| 독립 | 관계 범주 | calls, constructs, references, dataflow, updates, react-hook-owner, vue-hook-owner, express-route-owner, nest-route-owner |
| 독립 | 패턴 분류 | `supported`(코드상 처리 경로 존재), `unsupported-by-design`(코드상 명시적 제외), `ambiguous`(정적 분석으로 일반적으로 결정 불가) — **실행 전에 코드 근거로 분류** |
| 독립 | GT 결정성(사례 단위) | `determinate`(소스만 보고 정답 관계를 확정할 수 있음), `indeterminate`(정답 관계가 실행 시점 값 등에 좌우되어 확정 불가) — **GT 작성 시 blind로 부여**(§6.5) |
| 독립 | 코퍼스 유형 | A: 마이크로 fixture, B: 실제 오픈소스 파일 표본 |
| 독립(보조) | 분석 모드 | workspace 모드(주), 단일 파일 모드(보조: 기존 테스트 대부분이 사용) |
| 종속 | TP, FP, FN, Precision, Recall, F1 | 범주별, 패턴 분류별, 코퍼스별 |

## 4. Controlled Variables

- Cogic 커밋(사전 등록 커밋), TypeScript 5.9.3, Node 버전 기록
- 진입점: `analyzeWorkspaceActive({ active, workspaceRoot, filePaths, cacheEnabled: false })`, 기본 adapter 목록
- 그래프 범위: **analyzer 원출력 = production depth 1과 동일**(`CodeGraphPanel.ts:1446`). depth 0의 `pruneGraphToFile`과 depth ≥2 병합은 평가 대상이 아니다
- fixture마다 고정 tsconfig. 외부 패키지(`react`, `vue`, `express`, `@nestjs/common`)는 `node_modules` 없이 **최소 선언 shim**(`*.d.ts`)으로 제공한다(`test-workspace/analyzer-stability/react-shim.d.ts`와 같은 방식). shim 내용은 fixture와 함께 고정한다
- 캐시 OFF로 실행한다. 보조 점검으로 캐시 ON 결과가 동일한지 확인한다(§10)

## 5. Dataset / Workload

### 5.1 코퍼스 A — 마이크로 fixture (확증 분석의 주 대상)

위치: `docs/thesis-experiments/fixtures/exp-01/<category>/<case-id>/` (활성 파일 1개 + 필요 시 의존 파일 + tsconfig + shim + `expected.json`)

패턴 카탈로그(최소 구성). 각 행의 "분류"는 코드 근거로 정했다. P1 착수 시 재확인하고 바꾸면 사유를 기록한다.

| 범주 | 패턴 | 분류(코드 근거) |
|---|---|---|
| calls | 같은 파일 함수 직접 호출 / 화살표 함수 변수 호출 | supported (`walk` `:2187`, `resolveCallTarget`) |
| calls | `this.method()`, 인스턴스 메서드, static 메서드 | supported (signature 선언 기준) |
| calls | named/default/namespace import 함수 호출 → external | supported |
| calls | barrel re-export, tsconfig `paths` alias 경유 | supported (기존 테스트 존재) |
| calls | optional call `a?.()` / `obj?.m()` | supported 추정 → 검증 대상 |
| calls | overload, generic 함수 | supported 추정(선언 위치 매칭 규칙 §6.3 적용) |
| calls | `obj[key]()` 동적 접근, `fn.call/apply/bind` | ambiguous (상수 키·고정 대상은 `determinate`, 런타임 키는 `indeterminate`로 사례마다 구분) |
| calls | 콜백으로 전달만 하고 호출하지 않음 | calls 아님(GT 부정 사례) → references 대상 |
| calls | `console.log`, `Array.prototype.map` 등 TS lib | unsupported-by-design (`isTypeScriptLibFile`) |
| calls | JSX 컴포넌트 사용 `<Comp/>` | supported (label `jsx`, `:2247`) |
| calls | `import("./m")` dynamic import → module external 노드 | supported (`:2022-2035`) |
| constructs | `new LocalClass()`, `new ImportedClass()` | supported (`:2254`) |
| references | 같은 파일 함수를 값으로 전달·대입 | supported (`addReferenceEdgesForOwner`) |
| references | 같은 파일 클래스·인터페이스·type을 타입 위치에서 사용 | supported 추정 → 검증 대상 |
| references | 다른 파일 심볼 참조 | **unsupported-by-design** (`:1955`) |
| dataflow | 위치 인자 n개 → 파라미터 n개 | supported (`:1999-2017`) |
| dataflow | 인자 수 < 파라미터 수(기본값/선택) | supported(min 개수만) |
| dataflow | spread 인자 `f(...xs)`, rest 파라미터 | ambiguous/검증 대상 |
| dataflow | 구조분해 파라미터 `f({a, b})` | supported(파라미터 단위) |
| dataflow | 생성자 인자 | supported (`:2255`) |
| updates | React `setX(v)`, `setX(prev => …)`, `dispatch(a)` | supported (`:2053`) |
| updates | Vue `x.value = …`, `state.a++`, `reactive` 속성 대입 | supported (`:2263-2310`) |
| react | `useEffect/useLayoutEffect/useInsertionEffect/useMemo/useCallback` 인라인 콜백 owner | supported |
| react | `React.useEffect`(default·namespace), alias import | supported (기존 테스트 존재) |
| react | named 함수를 hook 인자로 전달 | supported (synthetic owner → calls) |
| react | custom hook, `useRef`, `useContext` | unsupported-by-design (hook 목록 외) |
| vue | `computed/watch(arg1)/watchEffect…`, `ref/shallowRef/customRef/reactive` | supported |
| vue | `.vue` SFC | unsupported-by-design (탐색 glob 밖) — 기록만, 측정 제외 |
| express | `app.get("/p", handler)`, `app.use(mw)`, `router = express.Router()` | supported |
| express | `app.get("/p", mw, handler)` 의 두 번째 이후 handler | **unsupported-by-design** (callbackArgIndex 1개) |
| express | `app.route("/p").get(h)`, 다른 모듈에서 import한 `app` | unsupported-by-design |
| nest | `@Controller("users")` + `@Get(":id")` 등 | supported |
| nest | `@Controller` 없는 클래스의 `@Get` | 부정 사례(owner 생성되면 FP) |
| nest | namespace import `common.Get` | supported (`getDecoratorName`) |

규모 목표: 지원 범주별 **in-scope GT 관계 ≥ 30개**, 프레임워크 범주별 ≥ 15개, 부정 사례(생성되면 FP) 범주별 ≥ 5개, 전체 ≥ 250개. 30개는 Wilson CI 반폭이 p=0.9에서 약 ±0.11이 되는 최소 수준이다. 가능하면 50개 이상을 목표로 한다.

### 5.2 코퍼스 B — 실제 코드 표본 (외적 타당성 보조)

- 선정 기준: 공개 라이선스, TypeScript 주력, 프레임워크별 1개 이상(React, Vue Composition API, Express, NestJS), 커밋 SHA 고정, `npm install` 없이 shim 또는 `skipLibCheck`로 분석 가능
- 표본 추출: 저장소마다 비테스트·비생성 파일 중 무작위(seed 기록) 5–10개 파일, 파일당 owner 노드 전체의 관계를 라벨링
- 구체 저장소는 P1에서 기준에 따라 선정하고 선정 사유를 기록한다(P0에서는 지정하지 않음)

## 6. Measurement Metrics

### 6.1 집계 단위

**관계 집합(set) 단위**로 센다. Cogic은 `kind+source+target+label(+hint)`로 edge를 중복 제거하므로(`analyze.ts:1651`) 같은 owner가 같은 대상을 여러 번 호출해도 관계는 1개다. GT도 같은 단위로 작성한다. 호출 지점 단위 평가는 하지 않는다.

### 6.2 노드 식별(매칭 키) — 실행 전 고정

Cogic 노드 ID는 절대경로와 문자 오프셋(`kind:file:pos`)이라 사람이 작성하는 GT와 직접 비교하기 어렵다. 다음 **정규화 키**를 사용한다.

| 노드 | 정규화 키 |
|---|---|
| 로컬 선언 (function/method/class/interface 및 subkind) | `(fileRel, startLine, kindClass)` — `fileRel`: fixture 루트 기준 POSIX 상대경로. `startLine`: 1-based 선언 시작 줄(Cogic `range.start.line + 1`, `getStart` 기준이므로 데코레이터·수식어 포함, 주석 제외). `kindClass`: `callable`={function, method}, `class`, `typeLike`={interface} |
| synthetic owner (hook 콜백, 상태 hook 소스, route owner) | `(fileRel, anchorLine, "synthetic")` — 인라인 콜백은 콜백 함수 시작 줄, 식별자 인자·상태 hook·route는 hook/route 호출식 시작 줄, Nest route owner는 메서드 선언 시작 줄 |
| external 대상 | `(declFileRel, declStartLine)` — 선언 파일이 fixture 밖(shim 포함)이면 shim 기준 상대경로 |
| file 노드 | `(fileRel, "file")` |

같은 키에 Cogic 노드가 2개 이상 매핑되면 매칭 오류로 기록하고 해당 fixture를 수동 검토한다.

### 6.3 관계 매칭 규칙

- `calls`, `constructs`, `references`, `updates`: `(edgeKind, srcKey, tgtKey)`
- `dataflow`: `(srcKey, tgtKey, argIndex)` — `argIndex`는 Cogic edge id의 `arg#i`에서 추출한다. label 문자열은 비교하지 않는다(서식 의존)
- framework owner: 노드 존재(owner 키) + owner에서 나가는 관계(handler·callback 본문 대상)를 별도 범주로 센다
- **엄격(strict) 판정**: 끝점은 맞지만 kind가 다르면 예측 kind의 FP + GT kind의 FN
- **완화(lenient) 판정**: kind 무시, 끝점만 비교. 보조 보고
- overload: 선언이 여러 개면 Cogic이 고른 선언(`getResolvedSignature` 결과)이 GT에 적힌 구현/선언 중 하나와 맞으면 TP. GT에 허용 선언 목록을 적는다

### 6.4 지표

- 범주 c별: `TP_c, FP_c, FN_c`, `P = TP/(TP+FP)`, `R = TP/(TP+FN)`, `F1 = 2PR/(P+R)`
- **in-scope**(supported GT만 분모) vs **overall**(unsupported-by-design GT와 `determinate` ambiguous GT 포함) 재현율을 둘 다 보고한다. `indeterminate` 사례는 두 분모 모두에서 빠진다(§6.5)
- micro 평균(관계 합산)과 macro 평균(범주 평균)
- 오류 분류: 모든 FP·FN에 원인 코드를 부여한다(예: `E-LIB-EXCLUDED`, `E-CROSSFILE-REF`, `E-DYNAMIC`, `E-ADAPTER-ARGINDEX`, `E-SIGNATURE-RESOLUTION`, `E-GT-ERROR`, `E-MATCH-RULE`)

### 6.5 GT 결정성과 평가 집합 (사전 고정)

패턴 분류(supported / unsupported-by-design / ambiguous)는 **Cogic이 그 패턴을 처리하도록 만들어졌는지**를 나타낸다. GT 결정성(determinate / indeterminate)은 **소스만 보고 정답 관계를 확정할 수 있는지**를 나타낸다. 두 축은 독립이며, 평가 집합은 다음 표로 정한다.

| 패턴 분류 | GT 결정성 | Precision | in-scope Recall | overall Recall | 비고 |
|---|---|---|---|---|---|
| supported | determinate | 포함 | 포함 | 포함 | 주 평가 대상 |
| unsupported-by-design | determinate | 포함 | 제외 | **포함** | 정답이 명확하므로 누락은 overall FN이다 |
| ambiguous | determinate | 포함 | 제외 | 포함 | 예: `const k = "run"; obj[k]()` |
| 모든 분류 | **indeterminate** | **제외** | **제외** | **제외** | 확증 평가에서 빼고 §6.5.2에 따로 보고 |

`supported`인데 `indeterminate`인 사례가 나오면 분류 근거를 다시 검토하고 사유를 `case.json`에 기록한다. 원칙적으로는 없어야 한다.

#### 6.5.1 indeterminate 판정 기준과 기록

- **기준**: 정답 대상이 런타임 값(사용자 입력, 외부 데이터, 실행 순서), 타입 정보로 좁혀지지 않는 `any`/`unknown`, 또는 실행 환경에 따라 달라져 소스만으로 하나의 관계 집합을 확정할 수 없는 경우다. "Cogic이 처리하기 어렵다"는 기준이 아니다. 사람이 소스를 보고 답을 낼 수 있으면 `determinate`다.
- **부여 시점**: GT 작성 단계(§7 3번)에서 Cogic 출력을 보기 전에 부여하고, 사전 등록 커밋에 포함한다. 출력을 본 뒤 `determinate`를 `indeterminate`로 바꾸는 것은 금지한다. 바꿔야 하면 §7 9번의 GT 정정 절차(`expected.v2.json`)를 따르고 두 버전 결과를 모두 보고한다.
- **기록**: `expected.json`의 해당 사례에 `gtStatus: "indeterminate"`, 판정 사유, 원천 노드 키, **열거된 후보 대상 키 목록**을 적는다. 후보를 열거할 수 없으면 `candidates: "unbounded"`로 적는다.
- **검토**: 두 번째 검토자는 표본에 포함된 사례의 `gtStatus`도 독립 판정한다. 일치도는 관계 일치도와 별도로 보고한다.

#### 6.5.2 indeterminate 사례의 예측 처리와 별도 보고

- Cogic 예측 edge가 indeterminate 사례의 (원천 키, 열거된 후보 대상 키)와 맞으면 TP도 FP도 아닌 `EXCLUDED-INDETERMINATE`로 분류한다.
- 같은 edge가 다른 determinate GT 관계와도 맞으면 그쪽 판정(TP)을 따른다.
- **열거된 후보 밖의 대상으로 가는 예측은 FP로 남긴다.** `candidates: "unbounded"`이면 그 원천에서 determinate GT로 설명되지 않는 예측을 모두 `EXCLUDED-INDETERMINATE`로 두되, 개수를 따로 센다. 이렇게 제외된 예측이 FP를 가리는 정도를 보고서에서 볼 수 있게 하기 위해서다.
- 별도 보고 항목: 범주별 indeterminate 사례 수와 전체 GT 대비 비율, 사례별 Cogic 출력(edge 생성 여부, 생성된 대상), `EXCLUDED-INDETERMINATE` 예측 수(열거 후보 / unbounded 구분). 이 표는 기술 통계로만 보고하고 P/R/F1을 계산하지 않는다.
- 민감도 점검(보조): indeterminate 예측을 전부 FP로 간주한 Precision을 함께 제시한다. 확증 판정에는 쓰지 않는다.

strict/lenient 판정(§6.3)과 in-scope/overall 구분(§6.4)은 그대로 유지한다. 위 규칙은 두 구분 모두에 같은 방식으로 적용된다.

## 7. Execution Procedure

1. **지침 고정**: 주석 지침서(`fixtures/exp-01/ANNOTATION_GUIDE.md`)를 작성한다. 관계 정의, 범주 경계, 부정 사례 규칙, 키 작성법, 예시를 담는다.
2. **fixture 작성**: §5.1 카탈로그에 따라 작성한다. 각 case에 `case.json`(범주, 패턴 ID, 분류, 근거 코드 위치)을 둔다.
3. **GT 작성 (blind)**: Cogic을 그 fixture에 실행하기 **전에** 소스만 보고 `expected.json`을 작성한다. 사례마다 `gtStatus`(determinate / indeterminate)를 §6.5.1 기준으로 부여한다. 작성자는 fixture 작성 시 Cogic 출력을 보지 않는다.
4. **GT 검토**: 두 번째 검토자(지도교수·동료)가 GT의 ≥20%(무작위, seed 기록)를 독립 라벨링한다. 관계 후보 쌍 단위 Cohen's κ를 보고한다. 2인 검토가 불가능하면 작성 후 ≥48시간 뒤 자기 재검토를 하고, 이를 "single-annotator"로 명시한다.
5. **사전 등록 커밋**: fixture + GT + 지침 + 채점 도구를 커밋한다 → `preregistrationCommit`.
6. **채점 도구 검증**: 손으로 만든 예측 집합으로 TP/FP/FN 계산 단위 테스트를 통과시킨다(§10).
7. **실행**: 모든 case에 analyzer를 실행하고 원출력(JSON)을 `data/exp-01/<run-id>/predictions/`에 저장한다.
8. **채점**: strict/lenient, in-scope/overall 지표를 산출한다. indeterminate 사례는 §6.5.2에 따라 확증 지표에서 빼고 별도 표를 만든다.
9. **오류 분석**: 모든 FP·FN에 원인 코드를 부여한다. GT 오류(`E-GT-ERROR`)로 판명되면 GT를 **수정하지 않고** 정정본(`expected.v2.json`)을 별도 커밋한다. 두 버전 결과를 모두 보고한다.
10. **코퍼스 B**: 3–9를 반복한다(별도 표로 보고).

## 8. Repetition Strategy

- analyzer는 결정적이라고 가정하고 **같은 입력으로 2회 실행**해 정규화 출력 해시가 같은지 확인한다. 다르면 비결정성 자체를 결과로 보고한다.
- 캐시 OFF/ON(같은 프로세스 2회차 hit 경로)으로 출력이 같은지 확인한다.
- 통계적 반복은 run이 아니라 **관계·파일 표본 수**로 확보한다.

## 9. Statistical Analysis

- 범주별 P, R: Wilson 95% CI
- F1, micro/macro 평균: 파일(fixture) 단위 cluster bootstrap 95% CI (10,000 resamples, seed 기록)
- 범주 간 비교: CI 겹침으로 서술한다. 표본이 작으므로 유의성 검정으로 순위를 주장하지 않는다
- 주석자 간 일치도: Cohen's κ (2인 검토 시)

## 10. Correctness Validation (실험 장치 검증)

- 채점기 단위 테스트: 완전 일치, 전부 누락, kind 불일치, 중복 예측, 매칭 키 충돌, `arg#i` 파싱, indeterminate 처리(열거 후보 일치 → 제외, 후보 밖 → FP, determinate와 중복 → TP, unbounded 집계), unsupported-by-design 누락이 overall에만 FN으로 잡히는지
- 매칭 sanity check: TP로 판정된 쌍의 10%를 무작위로 사람이 원소스와 대조한다
- 결정성: 2회 실행 해시 동일
- 캐시 독립성: OFF와 ON(hit 경로)의 정규화 출력 동일
- 범위 확인: GT에 `calls` 목록(상위 60개 잘림)이 아니라 **graph edges**를 사용했는지 확인한다(baseline K1)

## 11. Threats to Validity

| 유형 | 위협 | 완화 |
|---|---|---|
| 구성 | GT 작성자 = 개발자 → 지원 패턴 위주로 fixture를 만들 위험 | 카탈로그에 unsupported·ambiguous·부정 사례를 의무 포함. 코퍼스 B로 보완 |
| 구성 | 매칭 규칙(줄 기반 키)이 결과를 좌우 | 규칙 사전 고정, strict/lenient 병기, 키 충돌 기록 |
| 구성 | "in-scope" 정의가 재현율을 부풀릴 위험 | in-scope와 overall을 항상 함께 보고 |
| 구성 | 어려운 사례를 `indeterminate`로 돌려 지표를 부풀릴 위험 | 판정 기준 사전 고정(§6.5.1), blind 부여와 사전 등록, 출력 확인 후 변경 금지, 제외 비율과 제외 예측 수 보고, 전부-FP 민감도 Precision 병기 |
| 내적 | blind 원칙 위반(출력을 보고 GT 수정) | 사전 등록 커밋, GT 정정은 별도 버전 |
| 내적 | shim 선언이 실제 패키지 타입과 다름 → 해석 결과 차이 | shim 고정, 코퍼스 B 일부에서 실제 `node_modules` 조건 비교(exploratory) |
| 외적 | 마이크로 fixture는 실제 코드 분포를 대표하지 않음 | 코퍼스 B 별도 보고, 일반화 주장 제한 |
| 외적 | 단일 TS 버전 | 버전 명시 |
| 결론 | 범주별 표본 수 부족 | 최소 표본 수 기준(§5.1), CI 보고 |

## 12. Expected Output Files

```text
docs/thesis-experiments/fixtures/exp-01/
├── ANNOTATION_GUIDE.md
├── catalog.csv                      # 패턴 ID, 범주, 분류, 코드 근거
└── <category>/<case-id>/{case.json, expected.json, *.ts(x), tsconfig.json, shims/}
docs/thesis-experiments/data/exp-01/<run-id>/
├── run.json, env.json
├── predictions/<case-id>.json       # analyzer 원출력(graph, calls, meta)
├── matches.csv                      # case, 범주, key, 판정(TP/FP/FN), 원인 코드
├── metrics-by-category.csv          # strict/lenient × in-scope/overall
├── metrics-by-pattern.csv
├── indeterminate.csv                # 별도 보고: 사례, 범주, 사유, 후보, Cogic 출력, 제외 예측 수
├── agreement.json                   # κ (해당 시)
└── summary.md                       # 도구 생성
docs/thesis-experiments/tools/exp01-score.mjs (+ 테스트)
```

## 13. Reproduction Procedure

```powershell
git checkout <preregistrationCommit 이후 run 커밋>
npm ci; npm run compile
node docs/thesis-experiments/tools/exp01-run.mjs --fixtures docs/thesis-experiments/fixtures/exp-01 --out docs/thesis-experiments/data/exp-01
node docs/thesis-experiments/tools/exp01-score.mjs --run docs/thesis-experiments/data/exp-01/<run-id>
```

도구 이름은 P1에서 확정한다. 재현자는 `predictions/`를 다시 생성해 해시를 비교하고, 채점 결과가 같은지 확인한다.

## 14. Acceptance Criteria

- [ ] GT·지침·카탈로그가 첫 예측 실행보다 먼저 커밋되었다(커밋 시각·SHA로 증명)
- [ ] §5.1 최소 표본 수를 충족했다(미충족 범주는 "표본 부족"으로 명시)
- [ ] 채점기 단위 테스트 전부 통과
- [ ] 결정성·캐시 독립성 점검 통과(실패 시 결과로 보고)
- [ ] 모든 FP·FN에 원인 코드가 부여되었다
- [ ] strict/lenient × in-scope/overall 표가 모두 생성되었다
- [ ] 모든 GT 사례의 `gtStatus`가 사전 등록 커밋에 포함되었고, indeterminate 사례가 확증 지표에서 빠진 채 별도 표(`indeterminate.csv`)로 보고되었다
- [ ] GT 검토 방식(2인 κ 또는 single-annotator)이 명시되었다
- [ ] 가설 H1-1~H1-5 판정이 사전 기준으로 기록되었다
