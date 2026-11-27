# 데코레이터 관계: 도구 비교

- **fixture:** `decorator-probe/fixtures/`.
  - `legacy`: `experimentalDecorators: true`, ES2022. NestJS가 쓰는 방식이다.
  - `standard`: TS 5 표준 데코레이터. 파라미터 데코레이터는 문법상 없다.
- **포함한 구문:** 클래스 데코레이터 팩토리, 일반 클래스 데코레이터, 프로퍼티 데코레이터 팩토리(인자에 호출 `helper()` 포함), 생성자·메서드 파라미터 데코레이터, 메서드 데코레이터 팩토리 + 일반 메서드 데코레이터(복수 데코레이터), 함수 안 클래스의 메서드 데코레이터.
- **환경:** TypeScript 5.9.3, VS Code 1.147.0, Windows 11. Cogic은 `out/analyzer`(main `9f4e867` 빌드)다.

## 1. 실행 결과와 문서 조사의 구분

| 도구 | 상태 | 근거 |
|---|---|---|
| TypeScript 컴파일러 emit | **직접 실행** | `probe.cjs` → `probe-result.json` |
| TypeScript Language Service (call hierarchy, references) | **직접 실행** | `probe.cjs` → `probe-result.json` |
| VS Code Call Hierarchy (UI, 내장 TypeScript) | **직접 실행** | `vscode-ui.mjs`, Shift+Alt+H, `ui-evidence/call-hierarchy-ui.json`, 스크린샷 3장 |
| Cogic | **직접 실행** | `probe.cjs`(`analyzeWorkspaceActive`, cache off) |
| Trace Function Flow 1.1.1 | **직접 실행(UI)**, 데코레이터 추적은 **불가** | `ui-evidence/tff-ui.json`, `tff-function-picker.png` |
| Context Graph 0.10.9 | **ENVIRONMENT_BLOCKED** | 패키지에 `bin/darwin-arm64` worker만 있다(VSIX 목록으로 재확인). P13에서 Windows 실행 실패를 기록했다 |
| CodeQL | **ENVIRONMENT_BLOCKED**(CLI 미설치). **문서 조사만** 했다 | codeql.github.com 표준 라이브러리 문서(javascript-all 3.0.2) |

## 2. 결과 (legacy fixture, VERIFIED)

### 2.1 평가 위치(컴파일러 emit)

| 데코레이터 | emit에서의 위치 |
|---|---|
| `ClassDeco("c")`, `PlainClass` | 모듈 최상위 `__decorate([...], Sample)` |
| `Prop(helper())`, `Method("m")`, `PlainMethod`, `Param("x")`, `Param("y")` | 모듈 최상위 `__decorate` / `__param` |
| 함수 `run()` 안 클래스의 `Method("inner")` | `run()` 안 |
| (standard fixture) 모든 데코레이터 | 클래스 static block 또는 클래스 IIFE 안 |

`PlainClass`, `PlainMethod`는 소스에서 호출되지 않는다. 런타임 헬퍼 `__decorate`가 호출한다.

### 2.2 관계 표현

| 질문 | TS Language Service / VS Code Call Hierarchy | Cogic | Trace Function Flow | CodeQL (문서) |
|---|---|---|---|---|
| 클래스 데코레이터 팩토리 호출의 owner | class `Sample` | `file` (`calls` + `dataflow`) | 시작점 없음(클래스는 추적 대상이 아님) | `Decorator`의 컨테이너: 일반 `getContainer()`("function or toplevel"), 데코레이터별 서술 없음 |
| 메서드 데코레이터 팩토리 호출의 owner | incoming: **메서드 `method`** / outgoing: **class `Sample`**에 나열되고 `method`의 outgoing에는 없음 | **없음** | 메서드가 추적 목록에 없음 | 문서에 없음 |
| 적용 대상 | 직접 표현 없음. incoming의 caller가 사실상 적용 대상 | 없음 | 없음 | `Decorator.getElement()` "the element this decorator is applied to", `Decoratable.getADecorator()` |
| 인자 전달 | 표현 없음(call hierarchy는 호출 지점만) | `dataflow file → ClassDeco/Prop/Param` (`name <- "c"` 등). 메서드 데코레이터·메서드 파라미터 데코레이터 없음 | — | 문서상 `getExpression()`만. 데이터 흐름 포함 여부는 문서에 없음 |
| 일반 데코레이터(`@PlainMethod`) | **호출**(caller = 메서드) | **`references` 메서드 → PlainMethod** | — | — |
| 프로퍼티 데코레이터 | caller = class | `calls file → Prop`, `calls file → helper`(인자 안의 호출) | — | 문서: 프로퍼티는 decoratable |
| 파라미터 데코레이터 | 생성자 파라미터: caller = class / 메서드 파라미터: caller = 메서드. class의 outgoing에는 `Param`이 **없음** | 생성자 파라미터: `calls file → Param` / 메서드 파라미터: **없음** | — | 문서: 파라미터는 decoratable 목록에 없음 |
| 함수 안 클래스 | incoming: `go(Inner)`가 `Method`를 호출 | 해당 없음(관계 없음) | — | — |
| incoming/outgoing 일관성 | **불일치.** `Method`의 caller는 `method`인데 `method`의 outgoing에 `Method`가 없다. `Param`의 caller는 class·method인데 class outgoing에 `Param`이 없다 | 단일 그래프라 양방향이 같다 | — | — |
| 시각화 | References 뷰 트리(Callers Of / Calls From) | 그래프 edge(`file` 노드에서) | 함수 노드 그래프. 데코레이터 정보 없음 | 쿼리 결과 표(실행 안 함) |

### 2.3 해석 (INFERRED)

- 같은 도구 안에서도 "데코레이터 호출의 owner"가 질문 방향에 따라 달라진다(TS: incoming은 적용 대상, outgoing은 클래스). 업계 도구에도 합의된 계약이 없다는 근거다.
- Cogic은 클래스·프로퍼티·생성자 파라미터 데코레이터는 평가 위치(file)로 표현하고, 메서드·메서드 파라미터 데코레이터는 표현하지 않는다. 일반 데코레이터는 꾸며진 선언의 참조로 표현한다. 이 세 규칙은 서로 다른 원리를 따른다. 그중 GT·카탈로그와 일치하는 것은 클래스 데코레이터(supported)와 메서드 데코레이터 미지원(unsupported-by-design)뿐이다.
- CodeQL은 문서상 꾸밈 관계를 호출과 별개의 AST 관계(`getElement`)로 둔다. 이는 모델 C(분리)와 같은 방향이다. 단 쿼리를 실행하지 않았으므로 CodeQL의 call graph가 데코레이터 호출을 어떻게 다루는지는 UNVERIFIED다.

## 3. 재현

```powershell
npm run compile
node docs/thesis-experiments/p14d-semantic-contract/decorator-probe/probe.cjs --out <file>
$env:VSCODE_EXE="<Code.exe>"; $env:PLAYWRIGHT_CORE="<playwright-core>"
node docs/thesis-experiments/p14d-semantic-contract/decorator-probe/vscode-ui.mjs <new folder>
$env:TFF_DIR="<unpacked sudopanda.trace-function-flow-1.1.1>"
node docs/thesis-experiments/p14d-semantic-contract/decorator-probe/vscode-ui.mjs <another new folder>
```

**UI 실행 시 주의:** 명령 팔레트의 "Calls: Show Incoming Calls"로는 뷰가 열리지 않았다(2회). 단축키 Shift+Alt+H("Show Call Hierarchy")로 열었다. 뷰의 방향 토글은 다음 실행에도 유지되므로, 결과는 뷰 제목(Callers Of / Calls From)으로 확인했다.
