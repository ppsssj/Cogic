# P1-D: EXP-01 AI 교차 검토 기록과 GT 불일치 판정

- 작성일: 2026-10-29
- 기준: `main` `0c90ef04e3201af2a765e63d09530171d6699eb6` (PR #5 병합 커밋)
- 상태: **AI 교차 검토 결과 보존, 불일치 2건 사후 판정 초안.** 사람의 검토는 아직 없다. Cogic analyzer 실행과 정확도 측정도 하지 않았다(NOT_RUN).

이 문서는 GPT-6가 EXP-01 검토 표본 146개를 판정한 결과를 보존하고, GT v1과 다르게 판정한 2개 행(S037, S107)을 소스코드와 지침으로 다시 검토한 기록이다. GT v1, 지침, 검토 표본, 도구, manifest는 바꾸지 않았다.

---

## 1. 수행 주체와 한계

| 단계 | 수행 주체 | 비고 |
|---|---|---|
| GT v1 작성 | Claude Code(생성형 AI, claude-opus-5-5) | [p1a-ground-truth.md §4](p1a-ground-truth.md#4-생성형-ai-활용-범위) |
| 146개 표본 판정 | GPT-6(생성형 AI), `reviewerId=GPT6-AI-REVIEW` | 사용자가 별도 세션에서 수행하고 파일로 제공 |
| 일치도 재계산과 불일치 사후 판정(이 문서) | Claude Code(생성형 AI, claude-opus-5-5) | GT v1 작성자와 같은 모델이다 |
| 최종 채택 | 연구자(사람) | 아직 안 함 |

한계:

1. **사람의 독립 검토가 아니다.** 이 결과는 생성형 AI 두 개의 산출물을 비교한 것이다. κ는 "AI가 작성한 GT"와 "다른 AI의 재판정" 사이의 일치도다. 이 값을 주석자 간 일치도, 사람 검증, GT의 정확도, Cogic의 정확도로 보고하지 않는다.
2. **GPT-6는 완전히 blind가 아니었다.** GPT-6 기록에 따르면, GPT-6는 이전 대화에서 GT의 전체 구성, 일부 예시, 데이터셋 구조를 알고 있었다.
3. **"정답 키를 보기 전에 판정을 고정했다"는 자기 보고다.** 판정 파일과 보고서는 같은 시각(zip 내부 시각 2026-10-29 05:55)에 함께 전달되었다. 판정이 먼저 고정되었다는 것을 저장소 기록으로는 확인할 수 없다.
4. **이 문서의 사후 판정자도 독립적이지 않다.** 사후 판정은 GT 작성자와 같은 모델(Claude Code)이 했다. 따라서 GT를 옹호하는 쪽으로 기울 위험이 있다. 그 위험을 줄이려고 판정 근거를 다음처럼 확인 가능한 자료로 한정했다.
   - 사전 등록된 `catalog.csv`의 패턴 정의
   - TypeScript 컴파일 결과
   - TS lib 선언
   - 지침 원문

   두 판정의 최종 채택은 연구자가 한다(§9).
5. **표본 2개 행은 정답 방향이 드러나 있었다.** S014, S104는 `target`이 `(후보를 열거할 수 없는 호출 대상)`으로 표시되어 GT의 indeterminate 판정을 드러낸다([p1c-review-readiness.md §3.3](p1c-review-readiness.md#33-알려진-blind-한계)). 이 2개 행을 뺀 값도 함께 적는다(§3.3).

## 2. 증거 보존

증거는 [evidence/exp-01-ai-cross-review/](evidence/exp-01-ai-cross-review/README.md)에 있다.

| 파일 | 처리 |
|---|---|
| `cogic_exp01_ai_review_146.csv` | 사용자 제공 원본을 바이트 그대로 복사(SHA-256 `7537e1ee…7863`) |
| `cogic_exp01_ai_review_report.md` | 사용자 제공 원본을 바이트 그대로 복사(SHA-256 `679728dc…7a5f`) |
| `agreement.recomputed.json` | 기존 `review-agreement.mjs`의 출력 |

- 폴더는 `fixtures/exp-01/` 밖에 있다. manifest 검사 대상(`fixtures/exp-01`, `tools/exp01`)이 아니므로 두 manifest 검사에 영향이 없다(§8).
- 사람 검토자용 `review/filled/`에는 넣지 않았다.
- 원래의 146개 AI 판정은 고치지 않았다. 사후 판정(§4–§5)은 이 문서에만 기록한다.
- 원본 CSV는 UTF-8 BOM으로 시작한다. 그래서 `review-agreement.mjs`에 그대로 넣으면 146행이 모두 `invalid`가 된다. 재계산은 BOM만 뺀 임시 사본으로 했다. 절차는 증거 폴더 README에 있다.

## 3. 원래 AI 판정과 GT v1 비교(재계산)

기존 도구 `tools/exp01/review-agreement.mjs`(사전 등록 커밋 포함, 변경 없음)로 다시 계산했다. GPT-6 보고서의 숫자와 모두 일치한다.

### 3.1 입력 확인

| 항목 | 결과 |
|---|---|
| 행 수 | 146. `sampleId` 고유 146개, 집합이 `review-sheet.csv`와 같음 |
| 판정 분포 | exists 126, not-exists 18, undeterminable 2 |
| 확신도 | high 138, medium 7, low 1 |
| `reviewerId` / `reviewedAt` | 146행 모두 `GPT6-AI-REVIEW` / `2026-10-29` |
| 도구 집계 | reviewed 146, unreviewed 0, invalid 0 |

### 3.2 전체 결과

| 지표 | 재계산 값 | GPT-6 보고서 |
|---|---|---|
| 관찰 일치 | 144/146 = 0.98630 | 144/146 (98.63%) |
| 우연 일치율 | 0.77031 | 0.7703 |
| Cohen's κ | 0.94036 | 0.9404 |

혼동 행렬(GT v1 라벨 × GPT-6 판정):

| GT \ GPT-6 | exists | not-exists | undeterminable |
|---|---:|---:|---:|
| exists | 126 | 2 | 0 |
| not-exists | 0 | 16 | 0 |
| undeterminable | 0 | 0 | 2 |

범주별 값은 기술 통계일 뿐이다([p1c-review-readiness.md §6.3](p1c-review-readiness.md#63-보고-방법권장-결과를-보기-전에-확정할-것)). 불일치 2건이 모두 dataflow 범주라 dataflow만 κ가 낮다(n 38, 관찰 0.947, κ 0.648). 나머지 8개 범주는 관찰 일치율 1, κ 1이다.

### 3.3 민감도: S014, S104 제외

| 지표 | 값 |
|---|---|
| n | 144 |
| 관찰 일치 | 142/144 = 0.98611 |
| 우연 일치율 | 0.79167 |
| Cohen's κ | 0.93333 |

이 2개 행을 빼면 표본에 `undeterminable` 정답이 하나도 남지 않는다. 따라서 이 값은 2-라벨(`exists`/`not-exists`) 일치도에 가깝다.

### 3.4 불일치 행

| sampleId | 사례 | GT 항목 | 패턴 | GT v1 | GPT-6 |
|---|---|---|---|---|---|
| S037 | `nest/n04-local-decorators` | R06 | `DF-DECORATOR-METHOD` | exists | not-exists (medium) |
| S107 | `calls/c08-dynamic-access` | R06 | `DF-LIB` | exists | not-exists (low) |

## 4. S037 검토: 메서드 데코레이터의 owner

### 4.1 대상

`nest/n04-local-decorators/main.ts`:

```typescript
11  @Controller("fake")
12  export class FakeController {
13    @Get("a")
14    a(): string {
15      return "a";
16    }
17
18    @Get("b")
19    b(): string {
20      return "b";
21    }
22  }
```

GT v1의 관련 관계는 다음과 같다. 표본에는 R06만 들어 있다(S037).

| 항목 | 관계 | 패턴 | 근거 |
|---|---|---|---|
| R03 | `calls(file, Controller)` | `CALL-DECORATOR-CLASS` | main.ts:11 |
| R04 | `dataflow(file, Controller, 0)` | `DF-POSITIONAL` | main.ts:11 |
| R05 | `calls(file, Get)` | `CALL-DECORATOR-METHOD` | main.ts:13, 18 |
| R06 | `dataflow(file, Get, 0)` | `DF-DECORATOR-METHOD` | main.ts:13, 18 |

GPT-6의 주장: 메서드 데코레이터의 owner는 메서드를 감싸는 클래스 `FakeController`이고, 모듈 최상위(`file`)가 아니다.

### 4.2 지침 문장의 두 가지 읽기

[ANNOTATION_GUIDE.md §3](fixtures/exp-01/ANNOTATION_GUIDE.md#3-owner관계의-출발-노드-결정) 4번:

> 데코레이터는 꾸미는 선언 **바깥**에서 평가된다. owner는 꾸며진 선언을 감싸는 owner이며, 최상위 클래스라면 `file`이다. 클래스 데코레이터와 메서드 데코레이터 모두 같다.

이 문장은 두 가지로 읽을 수 있다.

| 읽기 | 근거 문구 | 메서드 `a`의 `@Get("a")` owner |
|---|---|---|
| (가) 문자 그대로 | "꾸며진 선언을 감싸는 owner". 메서드 `a`를 감싸는 노드는 클래스다(§3 1번 "가장 가까운 노드") | `FakeController` |
| (나) 평가 위치 기준 | "선언 **바깥**에서 평가된다", "클래스 데코레이터와 메서드 데코레이터 **모두 같다**". 최상위 클래스의 클래스 데코레이터 owner가 `file`이므로, 메서드 데코레이터도 같다 | `file` |

GPT-6는 (가)로 읽었고, GT v1은 (나)로 작성되었다.

### 4.3 사전 등록 자료가 정한 의미

지침 문장만으로는 하나로 정해지지 않는다. 그러나 같은 사전 등록 커밋(`41bbe19`)의 다른 자료는 (나)를 명시한다.

- `catalog.csv` 30행: `CALL-DECORATOR-METHOD … 메서드 데코레이터 팩토리 호출(owner = file)`
- `catalog.csv` 26행: `CALL-DECORATOR-CLASS … 클래스 데코레이터 팩토리 호출(owner = file)`
- [p1a-ground-truth.md §8](p1a-ground-truth.md#8-p0-문서와의-차이와-의문점) D10: "생성자 본문과 인스턴스 필드 초기화식의 owner는 class, 데코레이터 식의 owner는 file이다(지침 §3.2, §3.4)"
- 지침 §3 2번은 클래스를 owner로 쓰는 경우를 "인스턴스를 만들 때 실행되는 클래스 코드"(생성자 본문, 인스턴스 필드 초기화식)로 한정한다. 메서드 데코레이터는 인스턴스 생성 때 실행되지 않는다.

### 4.4 소스 의미 확인(TypeScript 컴파일)

이 fixture의 `tsconfig.json`은 `experimentalDecorators: true`, `target: ES2022`다. 같은 설정으로 임시 폴더에 컴파일했다(진단 0건, 저장소에는 산출물 없음). 결과에서 데코레이터 팩토리 호출이 실행되는 위치는 다음과 같다.

```javascript
let FakeController = class FakeController {
    a() { return "a"; }
    b() { return "b"; }
};
__decorate([
    Get("a")
], FakeController.prototype, "a", null);
__decorate([
    Get("b")
], FakeController.prototype, "b", null);
FakeController = __decorate([
    Controller("fake")
], FakeController);
```

- `Get("a")`, `Get("b")`는 클래스 본문 밖, 모듈 최상위 문장에서 `Controller("fake")`와 같은 방식으로 호출된다.
- 클래스의 생성자나 메서드 안에서 호출되지 않는다.
- 이것은 지침 §3 5번("어떤 노드에도 속하지 않는 최상위 문장의 owner는 `file`")과 (나)의 읽기에 맞는다.

### 4.5 `FakeController` 노드가 GT에 없는 이유

- GT v1은 관계에 쓰이는 노드만 적는다. P1-A에서 쓰이지 않는 노드를 정리한 기록이 [p1a-ground-truth.md §3.3](p1a-ground-truth.md#33-사전-등록-전-수정-내역)에 있다(Nest 4개 사례 12개 제거). validator도 쓰이지 않는 노드를 경고한다.
- 이 활성 파일에서 `FakeController`를 출발점이나 도착점으로 하는 관계는 (나)의 읽기에서 없다.
  - 선언 이름은 references에서 제외된다.
  - `new FakeController`도 없다.
- 따라서 노드가 "누락"된 것이 아니라, 필요하지 않아 적지 않은 것이다.
- (가)를 채택하면 노드가 필요하다. 지침 §2의 줄 규칙(`getStart`, 데코레이터 포함)에 따르면 선언 시작 줄은 **11**이다(`@Controller("fake")` 줄). 클래스 이름 줄(12)이 아니다. 정규화 키는 `D|main.ts|11|class`다. TypeScript 파서로 확인했다.

### 4.6 판정

| 항목 | 판정 |
|---|---|
| 원인 분류 | **`GUIDE-AMBIGUOUS`** |
| GT v1 R05·R06 | 사전 등록된 패턴 정의(`owner = file`)와 컴파일 결과에 맞는다. `GT-ERROR`로 보지 않는다 |
| GPT-6 판정 | 지침 §3 4번 문장의 문자 그대로의 읽기로는 근거가 있다. 검토자의 단순 오판(`REVIEWER-DIFF`)으로 보지도 않는다 |
| GT v2 | 필요 없음(권장) |
| 지침 | 문장을 명확히 할 필요가 있다. 예: "메서드·속성 데코레이터도 그 클래스를 감싸는 owner로 본다". 다만 측정 전에 지침을 고치면 평가 도구 manifest가 바뀐다(§7.2). 따라서 이번에는 고치지 않고 한계로 기록한다(§9 결정 D-P1D-2) |

R05와 R06은 같은 owner 규칙을 쓴다. 따라서 둘을 따로 판단할 수 없고, 정정한다면 함께 정정해야 한다. 판정이 "정정 없음"이므로 둘 다 v1 그대로다.

### 4.7 (가)를 채택할 경우의 영향(참고)

연구자가 (가)를 채택하면 `GT-ERROR`로 바뀌고 v2가 필요하다. 영향 범위는 n04에 그치지 않는다. 코퍼스 전체에서 같은 owner 규칙을 쓰는 메서드 데코레이터 관계는 15개다.

| 사례 | 현재 관계(`source = file`) | (가)에서의 owner(클래스 선언 시작 줄) | (가)에서의 관계 수 |
|---|---|---|---:|
| `n01-controller` | R14, R15, R16, R17, R18 | `UsersController`(7) | 5 |
| `n02-namespace-negatives` | R08(근거 6·11·23·30), R09(같음) | `HealthController`(4): 6·11, `Service`(21): 23, `Plain`(29): 30 | 6 |
| `n03-paths` | R16(근거 9·27), R17–R21 | `ItemsController`(7): 9·14·19, `RootController`(25): 27 | 7 |
| `n04-local-decorators` | R05, R06 | `FakeController`(11) | 2 |
| **합계** | **15** | 클래스 노드 7개 추가(현재 4개 사례 모두 class 노드 없음) | **20** |

- determinate 관계 수가 651에서 656으로 바뀐다.
- 이 관계들의 패턴(`CALL-DECORATOR-METHOD`, `DF-DECORATOR-METHOD`)은 모두 `unsupported-by-design`이다. 따라서 in-scope 지표에는 영향이 없고 overall 지표에만 영향이 있다.
- 클래스 데코레이터(`CALL-DECORATOR-CLASS`)는 두 읽기 모두에서 `file`이라 바뀌지 않는다.
- 검토 표본(v1 기준)은 바뀌지 않는다.

## 5. S107 검토: `greet.call(null, "hi")`의 dataflow

### 5.1 대상

`calls/c08-dynamic-access/main.ts`:

```typescript
20  function greet(greeting: string): string {
21    return `${greeting}!`;
22  }
23
24  export function callBound(): string {
25    const bound = greet.bind(null);
26    return greet.call(null, "hi") + bound("yo");
27  }
```

GT v1은 26줄에 대해 두 계열의 관계를 따로 적었다.

| 계열 | 항목 | 관계 | 패턴 |
|---|---|---|---|
| ① `Function.call` 자체의 호출 | R05 | `calls(callBound, Function.call)` | `CALL-LIB` |
| | **R06** | `dataflow(callBound, Function.call, 0)`: `null` → `thisArg` | `DF-LIB` |
| | R07 | `dataflow(callBound, Function.call, 1)`: `"hi"` → `...argArray` | `DF-LIB` |
| ② 실제 실행 대상 `greet` | R08 | `calls(callBound, greet)` | `CALL-FN-CALL-APPLY-BIND` |
| | R09 | `dataflow(callBound, greet, 0)`: `"hi"`, `"yo"` → `greeting` | `DF-INDIRECT` |

25줄의 `greet.bind(null)`도 같은 방식으로 적혀 있다(R03 `calls(callBound, Function.bind)`, R04 `dataflow(callBound, Function.bind, 0)`).

GPT-6의 주장(low): 지침은 `fn.call`의 대상을 `greet`으로 보므로, `Function.call`로 가는 dataflow는 맞지 않을 수 있다.

### 5.2 근거

1. **TS lib 선언**: 이 저장소의 TypeScript 5.9.3 `lib.es5.d.ts` 288행은 `call(this: Function, thisArg: any, ...argArray: any[]): any;`이다.
2. **argIndex**: 지침 §4.5에 따르면 TypeScript `this` 파라미터는 세지 않는다. 따라서 `thisArg`가 0번, rest `argArray`가 1번이다. 26줄의 첫 인자 `null`은 0번 `thisArg`로 간다. 인자 목록 안의 값이므로 dataflow 정의("호출식 인자 목록에서 값이 파라미터로 전달")에 해당하고, `null` 리터럴을 제외하는 규칙은 없다.
3. **`Function.call`도 호출 대상이다**:
   - 지침 §4.1은 "대상은 실제로 실행되는 함수의 선언이다. … TS lib면 `lib`이다"라고 정한다.
   - `greet.call(...)`은 런타임에 `Function.prototype.call`을 실행하고, 그것이 다시 `greet`을 실행한다.
   - 지침 §4.5는 "대상은 같은 calls 관계의 대상"이라고 정한다. 따라서 R05가 있으면 R06·R07의 인자 전달도 정답이다.
4. **`fn.call/apply/bind` 조항은 대상을 추가한다**: 지침 §4.1의 "`fn.call/apply/bind` … 대상이 정적으로 하나로 정해지면 그 함수가 대상이다"는 계열 ②(R08, R09)를 정답으로 만든다. 계열 ①을 빼라는 문장은 없다. GT는 `bind`(R03, R04)에도 같은 방식을 일관되게 적용했다.

### 5.3 판정

| 항목 | 판정 |
|---|---|
| 원인 분류 | **`REVIEWER-DIFF`** |
| GT v1 R06 | 타당하다. 지침 §4.1, §4.5와 TS lib 시그니처에 맞는다 |
| GPT-6 판정 | 지침 §4.1의 call/apply/bind 조항을 "대상을 `greet`으로 **바꾼다**"로 읽었다. 그러나 지침은 lib 호출을 제외하지 않으며, GPT-6도 확신도를 `low`로 적었다 |
| GT v2 | 필요 없음 |
| 남는 점 | §4.1 조항이 "추가"인지 "대체"인지 문장으로 명시되어 있지는 않다. 측정 후 이 패턴의 FP·FN을 해석할 때 이 점을 함께 적는다. 지침 개정은 하지 않는다 |

## 6. 원인 분류 요약

| sampleId | GT 항목 | 원인 코드([p1c §6.4](p1c-review-readiness.md#64-불일치-처리)) | GT v1 | v2 필요 |
|---|---|---|---|---|
| S037 | n04 R06(R05도 같은 규칙) | `GUIDE-AMBIGUOUS` | 유지 | 아니오(권장) |
| S107 | c08 R06 | `REVIEWER-DIFF` | 유지 | 아니오 |

- 일치도는 원래 판정으로 계산한 값만 보고한다(§3). 사후 판정 결과로 κ를 다시 계산하거나 원래 값을 바꾸지 않는다.
- 확신도가 medium·low인 나머지 행(S014, S019, S031, S074, S104, S135)은 모두 GT와 일치했다. 이 문서에서는 따로 사후 판정하지 않았다. 사람이 검토한다면 우선 확인할 행으로 남긴다.

## 7. GT v1 보존과 v2 도입 조건

### 7.1 이번 단계에서 바꾸지 않은 것

다음은 모두 변경 없다.

- `src/`
- `expected.json`, `case.json`, `catalog.csv`, `ANNOTATION_GUIDE.md`, `GT_CHANGELOG.md`
- `review-key.csv`, `review-sheet.csv`, `sample.json`, `REVIEW_FORM.md`
- `gt-manifest.json`, `eval-manifest.r1.json`
- `tools/exp01/`(채점 도구), `tools/exp01-run.mjs`(실행 도구)
- `docs/benchmarks/`

이 PR은 이 문서, 증거 폴더, README 색인만 추가·수정한다. 판정이 "정정 없음"이므로 `GT_CHANGELOG.md`에도 기록하지 않았다. 이 파일은 v1 데이터나 지침이 바뀔 때 쓴다. 또한 고치면 평가 도구 manifest가 바뀐다.

### 7.2 v2 또는 지침 개정이 필요해질 경우

연구자가 S037에 (가)를 채택하거나, 이후 사람 검토에서 `GT-ERROR`가 나오면 다음이 별도 PR로 필요하다. 근거는 [p1c-review-readiness.md §7.3](p1c-review-readiness.md#73-v2-도입-전에-확인된-도구-제약)이다.

| 대상 | 필요한 변경 | 이유 |
|---|---|---|
| GT 데이터 | 44개 사례 모두에 `expected.v2.json`(`gtVersion: 2`). 정정 없는 사례는 v1 내용을 옮긴다. S037 (가)라면 n01–n04에서 관계 15개 → 20개, class 노드 7개(§4.7) | `score.mjs`의 `scoreCorpus`가 사례마다 `expected.v<N>.json`을 읽고, 없으면 예외 |
| `GT_CHANGELOG.md` | 사례, 항목, 변경 전·후, 사유(원인 코드), 발견 경위("P1-D AI 교차 검토 + 연구자 판정"), 측정 전/후 | 지침 §10 |
| 지침(선택) | §3 4번 문장 명확화와 guide 버전 표시 | S037 모호성 해소 |
| manifest | 새 GT manifest(예: `gt-manifest.v2.json`)와 새 평가 도구 manifest(예: `eval-manifest.r2.json`). 기존 두 파일은 다시 쓰지 않는다 | v2 파일은 `--scope gt`에서 `added`, `GT_CHANGELOG.md`·지침 변경은 `eval-manifest.r1.json`에서 `changed`가 된다 |
| 채점 도구 | v2 파일만 바꾸면 변경 없이 `--gt-version 2`로 쓸 수 있다. 일부 사례만 v2를 두려면 v1으로 대체하는 개정과 버전 표시(`exp01-scorer/1.2`)가 필요하다 | §7.3(p1c) |
| 실행 도구 | 검사할 manifest 경로 개정(`exp01-runner/1.2`). v2 채점을 실행 도구에서 하려면 `--gt-version` 전달도 필요하다. 현재는 v1으로만 채점한다 | preflight가 `gt-manifest.json`과 `eval-manifest.r1.json`을 고정으로 검사한다 |
| 보고 | 확증 결과는 v1(사전 등록 기준), v2는 "사후 정정 결과"로 함께 제시 | 지침 §10, P0 §7 9번 |

## 8. 검증 결과

2026-10-29, `main` `0c90ef0`에서 만든 브랜치 `research/thesis-p1d-ai-review-adjudication`에서 실행했다. 증거 파일을 추가한 상태다.

| 명령 | 결과 |
|---|---|
| `node docs/thesis-experiments/tools/exp01/manifest.mjs --check --scope gt` | `manifest OK (214 files; …gt-manifest.json, scope gt)` |
| `node docs/thesis-experiments/tools/exp01/manifest.mjs --check --manifest docs/thesis-experiments/fixtures/exp-01/eval-manifest.r1.json` | `manifest OK (227 files; …eval-manifest.r1.json, scope all)` |
| `node --test docs/thesis-experiments/tools/exp01/test/score.test.mjs` | 44 pass / 0 fail |
| `node --test docs/thesis-experiments/tools/test/exp01-run.test.mjs` | 30 pass / 0 fail (mock analyzer, 합성 입력) |
| `npm run compile` | 종료 코드 0 |
| `npm run lint` | 종료 코드 0 |
| `review-agreement.mjs`(BOM 제거 사본) | `reviewed 146, unreviewed 0, invalid 0, kappa 0.9403594771241828` |
| `docs/thesis-experiments/data/` | `p0`만 있음 |

- 실제 EXP-01 코퍼스에 Cogic analyzer 실행: **NOT_RUN**
- 정확도 측정: **NOT_RUN**
- 사람 검토: **NOT_RUN**
- S037 확인용 TypeScript 컴파일은 n04 fixture를 임시 폴더로 컴파일해 데코레이터 호출 위치만 본 것이다. Cogic analyzer와 무관하다.

## 9. 실제 측정 전 남은 일

| # | 결정·작업 | 권장 |
|---|---|---|
| D-P1D-1 | S037, S107 사후 판정의 채택. 이 문서의 판정은 GT 작성자와 같은 모델의 초안이다 | 연구자가 §4.3–§4.4, §5.2의 근거를 직접 확인하고 채택하거나 뒤집는다. 뒤집으면 §7.2 절차 |
| D-P1D-2 | 지침 §3 4번 문장 명확화 여부 | 측정 전에는 고치지 않는다(manifest·실행 도구 개정이 필요). 논문 타당성 위협에 "지침 문장 모호성 1건, 사전 등록 카탈로그로 해소"라고 적는다 |
| D-P1D-3 | 사람 검토 방식(P1-C R1) | 그대로 남아 있다. AI 교차 검토는 사람 검토를 대신하지 않는다. 사람 검토자를 확보하면 같은 146개 표본으로 방식 A를 진행한다. 검토자에게 이 문서나 AI 판정을 보여 주지 않는다 |
| D-P1D-4 | 논문 보고 방식 | AI 교차 검토는 "AI 간 교차 검토(보조 자료)"로 따로 보고한다. κ 0.940(n=146)과 민감도 κ 0.933(n=144)을 한계 1–5와 함께 적는다. 사람 검토나 주석자 간 일치도로 부르지 않는다 |
| D-P1D-5 | 방식 B를 고를 경우 | single-annotator(생성형 AI) GT라는 서술은 유지한다. "독립 AI 교차 검토를 보조로 수행했다"를 덧붙일 수 있지만, 독립 검증으로 표현하지 않는다 |

이 밖의 착수 조건은 [p1b-runner.md §9](p1b-runner.md#9-p1-b-실제-측정-착수-조건)와 [p1c-review-readiness.md §9](p1c-review-readiness.md#9-실제-실험-착수-전에-남은-결정)를 따른다.
