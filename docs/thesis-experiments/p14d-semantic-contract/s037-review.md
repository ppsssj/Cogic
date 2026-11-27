# S037 추가 검토 기록 (`nest/n04-local-decorators` R05·R06)

- GT v1은 변경하지 않는다.
- 이 문서는 세 가지 표현 모델을 비교하고, 판단 근거의 출처를 구분해 기록한다.
- 채택은 연구자 승인 항목이다(A-1).

## 1. 대상과 GT v1

```typescript
11  @Controller("fake")
12  export class FakeController {
13    @Get("a")
14    a(): string { return "a"; }
...
18    @Get("b")
19    b(): string { return "b"; }
```

| GT v1 | 관계 | 패턴(카탈로그) |
|---|---|---|
| R03 | `calls(file, Controller)` | `CALL-DECORATOR-CLASS`, owner=file, supported |
| R04 | `dataflow(file, Controller, 0)` | `DF-POSITIONAL` |
| R05 | `calls(file, Get)` | `CALL-DECORATOR-METHOD`, owner=file, unsupported-by-design |
| R06 | `dataflow(file, Get, 0)` | `DF-DECORATOR-METHOD` |

## 2. 검토 기록과 출처

| 검토 | 출처와 지위 | 핵심 판단 |
|---|---|---|
| Claude Code (GT 작성, P1-A) | `expected.json`, 카탈로그(사전 등록 `41bbe19`) | owner=file(평가 위치) |
| GPT-6 (P1-D 교차 검토) | `evidence/exp-01-ai-cross-review/` 원본 보존(바이트 그대로) | S037 `not-exists`(medium): "메서드 데코레이터 @Get의 owner는 바깥 클래스이며 모듈 최상위가 아님" |
| Claude Code (P1-D 사후 판정 초안) | `p1d-ai-cross-review.md` §4 | `GUIDE-AMBIGUOUS`, GT 유지 권장. 근거는 카탈로그 `owner = file`과 컴파일 결과 |
| Gemini (연구자 추가 검토) | **원문 미수령.** 아래 내용은 P14-D 작업 지시에 담긴 **연구자의 요약**이며 원문이 아니다 | 지침 문언 기준 owner=FakeController. 평가 위치 기준 file도 타당. `a()`가 `Get`을 호출한다는 표현은 부적절. 실행 위치와 구조적 소유권을 분리. 별도 `decorates` 관계 또는 메타데이터 제안. 지침의 모호성 인정 |

**입력 조건의 차이(중요):**
- Gemini에게는 카탈로그의 `owner = file` 정의(`CALL-DECORATOR-METHOD`)가 주어지지 않았다(연구자 전달).
- GPT-6의 입력은 P1-D 기록상 검토 시트, 저장소 `main`, 지침 v1이었다. 카탈로그의 `owner = file` 정의를 실제로 읽었는지는 기록에 없다(UNVERIFIED). 또한 GPT-6는 이전 대화에서 GT 구성을 알고 있어 완전한 blind가 아니었다(GPT-6 보고서 자기 기재).
- 세 모델은 같은 입력을 받지 않았다. 따라서 판단을 단순 비교하거나 다수결로 정하지 않는다. AI 간 일치·불일치는 정답의 증거가 아니다(evidence-matrix §2).

### 2.1 Gemini 원문 보존 절차

`evidence/s037-gemini/README.md`를 따른다.

1. 연구자가 대화 내보내기 또는 복사본을 **수정 없이** 파일로 제공한다.
2. 수령한 파일을 `evidence/s037-gemini/raw/`에 바이트 그대로 둔다. 시각, SHA-256, 모델·버전 표기, 인터페이스, 입력 자료 목록(특히 카탈로그 제공 여부)을 `meta.json`에 기록한다.
3. 요약이나 발췌는 별도 파일에 "요약"으로 표시한다. 원문 파일과 섞지 않는다.

현재 상태: **원문 없음.** 이 저장소의 Gemini 관련 서술은 모두 연구자 요약에 근거한다.

## 3. 세 표현 모델 비교

| | A. `File → Get` (GT v1) | B. `FakeController → Get` | C. 적용 관계를 calls/dataflow와 분리 |
|---|---|---|---|
| 정의 | 팩토리 호출의 owner = 평가 위치 | owner = 꾸며진 선언을 감싸는 노드(lexical) | 팩토리 호출(`calls`/`dataflow`)과 꾸밈(`decorates`: 데코레이터 → 대상)을 별도 관계로 둠. 호출 owner는 A 또는 B 중 하나로 명시 |
| 코드 의미와의 관계 | `experimentalDecorators`의 emit과 일치(최상위 `__decorate`). 함수 안 클래스는 그 함수. 표준 데코레이터에서는 static block/IIFE라 일치하지 않음 | 소스 구조와 일치. 실행 위치와는 다름 | 실행(호출)과 구조(꾸밈)를 둘 다 표현 |
| 지침 §3 4번 | "바깥에서 평가", "클래스·메서드 모두 같다"와 일치 | "꾸며진 선언을 감싸는 owner"의 문자 그대로의 읽기와 일치 | 지침 보강 필요(새 관계) |
| 카탈로그(사전 등록) | `owner = file` 명시와 일치 | 불일치(v2 필요) | 새 패턴 필요 |
| 사용자에게 주는 정보 | "이 파일이 Get을 부른다"는 정보. 어느 메서드의 route인지는 잃음 | 어느 클래스의 데코레이터인지 보존. 어느 메서드인지는 잃음 | 어느 메서드에 적용됐는지까지 보존 |
| 다른 도구와의 대응 | Cogic 클래스 데코레이터 구현과 같은 방식 | TS Call Hierarchy의 **outgoing**(class → 메서드 데코레이터)과 같은 방식 | TS Call Hierarchy의 **incoming**(메서드 → Get)은 사실상 "적용 대상"을 caller로 보여 준다. CodeQL은 `Decorator.getElement()`로 적용 대상을 따로 제공한다(문서) |
| GT·채점 영향 | 없음(현행) | P1-D §4.7: 메서드 데코레이터 관계 15 → 20, class 노드 7개 추가. 모두 `unsupported-by-design`이라 in-scope 영향 없음 | 계약 v2. 새 관계는 기존 strict 비교 밖에 둘 수 있다(별도 범주) |
| 위험 | 컴파일 설정 의존이 숨어 있다 | 실행 위치와 달라 "calls"의 의미가 lexical로 바뀐다(생성자 규칙 §3 2번과 다른 기준) | 제품 변경 범위가 크다(decorates-design.md) |

## 4. 판단 (INFERRED, 채택 아님)

1. **R05·R06은 GT 오류가 아니다.** 사전 등록 카탈로그의 명시적 계약(A)을 따른다. 불일치의 원인은 **지침 문장이 계약을 다 담지 못한 것**이다(SC-1, SC-2).
2. **B로 바꾸는 것은 "정정"이 아니라 계약 변경이다.** 바꾼다면 v2 계약으로 기록하고 v1과 v2를 모두 채점한다. 결과를 본 뒤 유리한 쪽을 고르지 않는다. 메서드 데코레이터 관계는 모두 `unsupported-by-design`이라 in-scope 지표는 변하지 않는다.
3. **C가 코드 의미와 사용자 가치를 가장 잘 분리한다.** 다만 제품 변경이 필요하므로 정확도 평가 계약과 분리해 별도 결정으로 다룬다. 평가에서는 A를 유지하면서 지침에 전제(`experimentalDecorators` 의미론의 평가 위치)를 명시하는 것이 가장 작은 변경이다.
4. **Gemini의 "a()가 Get을 호출한다는 표현은 부적절"은 실행으로 확인된 사실과 맞다.** 메서드 `a`의 본문은 `Get`을 실행하지 않는다. TS Call Hierarchy의 incoming은 이 표현을 쓰지만, 같은 도구의 outgoing은 이를 메서드가 아니라 클래스에 둔다(VERIFIED, 비대칭).
