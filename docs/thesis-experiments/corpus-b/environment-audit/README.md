# Corpus B 분석 환경 타당성 감사 (P1-K2)

- 작성일: 2026-10-30
- 기준: `research/thesis-p1k-independent-validation` `7d21bde560c84aa22d8774392a59c61b9def2557`(PR #15, 미병합)
- 대상: Corpus B 20개 사례의 TypeScript 분석 환경(untyped shim + 파생 tsconfig)
- 상태: **감사 완료. Cogic analyzer를 Corpus B에 실행하지 않았다. 정확도를 계산하지 않았다.**
- 결론: 권고 `KEEP_UNTYPED_SHIMS`, 감사 판정 `ENVIRONMENT_AUDIT_READY`([decision.md](decision.md))

| 문서·파일 | 내용 |
|---|---|
| 이 문서 | 감사 방법, 진단 집계, 원인 분류 기준, 주요 사례 분석 |
| [gt-impact-report.md](gt-impact-report.md) | 진단과 환경이 GT 관계를 바꿀 수 있는지(관계 종류별·framework별) |
| [environment-options.md](environment-options.md) | Option A(현행)/B(최소 typed shim)/C(고정 의존성 설치) 비교 |
| [decision.md](decision.md) | 권고안, 질문 6개에 대한 답, 미해결 사항 |
| `diagnostics.json` | 진단 1,421건 전체(사례·코드·위치·메시지·원인·영향·반복) |
| `diagnostic-summary.json` | 코드·원인·framework·사례·위치·영향별 집계, lib 변형 검증 |
| `baseline-hashes.json` | 감사 전 해시(Corpus B MANIFEST, expected/case/tsconfig/shim 각 20개, scorer, runner, analyzer) |
| `exploratory/resolution-comparison.json` | **탐색적 조사.** 현행 환경과 upstream 의존성 환경의 심볼 해석 비교 |

---

## 1. 방법

### 1.1 진단 재수집

- 도구: [collect-diagnostics.mjs](../../tools/corpus-b-env/collect-diagnostics.mjs)와 [diagnostics-lib.mjs](../../tools/corpus-b-env/diagnostics-lib.mjs)
- TypeScript: 저장소의 5.9.3(`npm ci`). TypeScript Compiler API만 쓴다. Cogic analyzer 코드를 import하거나 실행하지 않는다.
- 프로그램 구성은 `tools/exp01/validate-gt.mjs`와 같다: `parseJsonConfigFileContent(사례 tsconfig.json)` → `createProgram` → `getPreEmitDiagnostics`
- 진단마다 기록한 항목
  - 사례, framework, TS 코드, category
  - 파일과 upstream 경로, 줄·열, 메시지
  - active file 여부, 같은 upstream 진단이 나오는 다른 사례
  - 원인, 정적 의미 영향, 판정 근거(`basis`)
- 중복 판정: 같은 upstream 파일·줄·열·코드·메시지면 같은 진단으로 본다(`uniqueKey`). 같은 의존 파일이 여러 사례의 import closure에 들어가면 사례마다 다시 집계되기 때문이다.

### 1.2 원인 분류 기준

원인은 TS 코드와 AST 문맥으로 정한다. untyped 출처는 import 문의 모듈이 shim의 shorthand ambient module로 해석되는지 checker로 판정한다. specifier 모양으로 판정하지 않는데, `@/x`나 `src/x` 같은 path alias가 로컬이기 때문이다. 문맥 추적은 다음을 따라간다.
- property 접근, 호출, `as` 단언
- const 초기값, 구조분해, parameter property의 타입 주석
- 로컬 re-export, 로컬 type alias·interface
- 주석 없는 함수의 반환식
- 객체 리터럴·반환식을 거쳐 전달되는 contextual type

| 원인 | 기준 |
|---|---|
| `UNRESOLVED_MODULE` | specifier(상대·외부·암시적 `react/jsx-runtime`)가 파일로도 ambient 선언으로도 해석되지 않는다(TS2307, TS2792, TS2875). path alias가 아니다 |
| `MISSING_EXPORT` | 코퍼스 로컬 모듈이 내보내지 않는 이름을 가져온다(TS2305, TS2614, TS2724, 로컬 모듈의 TS2694) |
| `UNTYPED_EXTERNAL_DEPENDENCY` | 외부 모듈이 `declare module "x";`라서 생긴다. 해당 진단: 그 모듈의 namespace·타입 사용(TS2709, TS2694), `any` 값의 타입 인자·signature(TS2347, TS2635), 그 모듈의 호출·JSX·주석 때문에 contextual type을 잃은 implicit any(TS7006, TS7031, TS7019), 그 모듈에서 온 값의 타입 오류 |
| `TYPE_ASSIGNMENT_ERROR` | 환경으로 추적되지 않는 대입 오류(TS2322, TS2345 등). vendored 코드 자체의 오류 후보 |
| `INVALID_CALL_SIGNATURE` | 코퍼스에 선언된 대상의 signature와 맞지 않는 호출(TS2554, TS2555, TS2556, TS2769). 환경으로 추적되지 않는 것 |
| `MISSING_GLOBAL_TYPE` | upstream이 선언 패키지에서 받는 전역 이름·namespace·멤버가 없다. 예: @types/node `process`·`__dirname`, @types/react `JSX`, @types/express 전역 `Express`, vite/client `ImportMeta.env`. Corpus B는 패키지를 설치하지 않는다(`types: []`) |
| `TSCONFIG_MISMATCH` | 파생 tsconfig가 upstream 옵션을 쓰면 TypeScript 자체 lib에서 해석되는 이름. 여기서는 Express·NestJS의 DOM 없는 `lib` override. lib 변형 실행으로 확인했다 |
| `PATH_ALIAS_RESOLUTION` | 사례 tsconfig의 `paths` alias에 맞는 specifier가 해석되지 않는다 |
| `DECORATOR_CONFIGURATION` | 데코레이터 컴파일 옵션 때문에 생긴 진단(TS1206, TS1219, TS1238–1241, TS1270, TS1271) |
| `OTHER` | 원인은 확인했지만 위 분류에 맞지 않는다 |
| `UNKNOWN` | 규칙과 수동 판정표로 원인을 정하지 못했다 |

- 수동 판정표: 규칙으로 원인을 정할 수 없는 3건은 원문을 읽고 근거와 함께 `MANUAL`에 적었다.
  - br03 `notifications.tsx:14` TS2322: `key`는 @types/react의 `JSX.IntrinsicAttributes`가 정한다
  - br03 `env.ts:20` TS2322: `import.meta.env`가 없어서 생긴 연쇄 오류
  - br03 `db.ts:93` TS18046: untyped `@mswjs/data` 값
- 분류기 검증
  - 합성 입력 테스트 9개(`tools/corpus-b-env/test/diagnostics.test.mjs`): 10개 원인과 §2 노드 판정을 확인한다.
  - 무작위 표본 14건을 원문과 대조했다. 모두 근거가 맞았다.

### 1.3 정적 의미 영향 분류

| 영향 | 기준 |
|---|---|
| `NONE` | 심볼 해석에 영향이 없다. JSX runtime 모듈, intrinsic 요소 타입 |
| `EXTERNAL_OR_GLOBAL_TYPE_ONLY` | 외부·전역 엔티티의 타입만 없다. 이런 엔티티는 Corpus B에 §2 노드가 없다(ANNOTATION_ADDENDUM A2). 로컬 선언 해석은 같다 |
| `LOCAL_VALUE_TYPE_DEGRADED` | 로컬 값·파라미터가 `any`/`unknown`이 된다. 그 값의 멤버 접근은 해석되지 않는다. upstream 타입이 로컬 타입이면 관계가 가려질 수 있다. 해석 비교로 확인했다 |
| `DEPENDENCY_FILE_ONLY` | vendored 의존 파일의 진단. GT는 active file만 다루므로, active file이 가져오는 타입을 통해서만 영향이 있다. 해석 비교로 확인했다 |

### 1.4 해석 비교 (탐색적 조사)

진단 수는 영향을 간접적으로만 보여 준다. 그래서 같은 active file을 두 환경에서 TypeScript로 해석하고 결과를 비교했다([compare-resolution.mjs](../../tools/corpus-b-env/compare-resolution.mjs)).

- **A:** 고정된 Corpus B 사례 폴더
- **C:** 같은 commit의 upstream 프로젝트
  - lockfile 그대로 의존성 설치: `npm ci` / `pnpm@10.33.0 install --frozen-lockfile` / `yarn@1.22.22 install --frozen-lockfile`, 모두 `--ignore-scripts`
  - upstream tsconfig 사용
- 비교 단위: active file의 선언 이름이 아닌 모든 식별자 616개. 각 식별자에 대해 다음을 비교한다.
  - 해석된 선언(로컬 파일·줄 / TS lib / 패키지 / 없음)
  - 호출이면 resolved signature 선언
- 조건
  - C의 active file 진단은 20개 사례 모두 0건이다. C는 upstream이 의도한 타입 해석이다.
  - 설치 후 lockfile 4개는 upstream git blob과 바이트 단위로 같다. SHA-256은 결과 파일에 기록했다.
- 이 비교는 고정 코퍼스와 분리했다(설치 폴더는 저장소 밖).
  - 결과는 GT 수정이나 정확도 계산에 쓰지 않는다.
  - 결과 파일에는 상대 경로만 있다.

## 2. 진단 집계

### 2.1 전체

| 항목 | 값 |
|---|---|
| 사례 | 20 |
| 진단(사례별 합) | **1,421**. P1-K1 `validation-report.json`의 1,421건과 사례별로 모두 같다 |
| 고유 진단 | 978 |
| 중복 | 443 (31.2%) |
| category | Error 1,421 / Warning 0 / Suggestion 0 / Message 0 |
| 위치 | 의존 파일 1,350 / active file 71 |
| `UNKNOWN` | 0 |

### 2.2 원인별

| 원인 | 진단 | 고유 |
|---|---|---|
| UNTYPED_EXTERNAL_DEPENDENCY | 759 | 492 |
| MISSING_GLOBAL_TYPE | 573 | 417 |
| UNRESOLVED_MODULE | 70 | 56 |
| TSCONFIG_MISMATCH | 19 | 13 |
| MISSING_EXPORT, TYPE_ASSIGNMENT_ERROR, INVALID_CALL_SIGNATURE, PATH_ALIAS_RESOLUTION, DECORATOR_CONFIGURATION, OTHER, UNKNOWN | 0 | 0 |

- `UNRESOLVED_MODULE` 70건은 모두 TS2875(`react/jsx-runtime`)다. 이 모듈은 shim에 선언되지 않았고(`"react"`만 선언), 그 결과 JSX 태그마다 한 번씩 나온다. 로컬 모듈이나 path alias가 해석되지 않은 경우는 0이다.
- vendored 코드 자체의 타입 오류 후보(`TYPE_ASSIGNMENT_ERROR`, `INVALID_CALL_SIGNATURE`)와 로컬 export 누락은 0이다.
- 데코레이터 진단은 0이다. NestJS 사례는 `experimentalDecorators`·`emitDecoratorMetadata`를 upstream 값 그대로 쓴다.

### 2.3 TS 코드 상위 10개

| TS 코드 | 진단 | 고유 | 원인 |
|---|---|---|---|
| TS7026 JSX intrinsic 타입 없음 | 362 | 322 | MISSING_GLOBAL_TYPE |
| TS2709 namespace를 타입으로 사용 | 226 | 126 | UNTYPED_EXTERNAL_DEPENDENCY |
| TS7006 implicit any 파라미터 | 203 | 119 | UNTYPED_EXTERNAL_DEPENDENCY, MISSING_GLOBAL_TYPE |
| TS2591 Node 전역 없음 | 181 | 76 | MISSING_GLOBAL_TYPE |
| TS2694 namespace에 멤버 없음 | 141 | 101 | UNTYPED_EXTERNAL_DEPENDENCY |
| TS7031 implicit any 구조분해 | 120 | 91 | UNTYPED_EXTERNAL_DEPENDENCY |
| TS2875 `react/jsx-runtime` 없음 | 70 | 56 | UNRESOLVED_MODULE |
| TS2347 untyped 호출의 타입 인자 | 64 | 47 | UNTYPED_EXTERNAL_DEPENDENCY |
| TS2304 이름 없음(`URL`, `fetch`, `AbortSignal`, `__dirname`) | 17 | 14 | TSCONFIG_MISMATCH, MISSING_GLOBAL_TYPE |
| TS2503 namespace 없음(`Express`, `React`, `JSX`) | 9 | 8 | MISSING_GLOBAL_TYPE |

그 밖: TS2339 8, TS7019 7, TS2584 5, TS1064 4, TS2322 2, TS2635 1, TS18046 1

### 2.4 framework별

| framework | 진단 | 고유 | 원인(진단 수) |
|---|---|---|---|
| React | 837 | 706 | UNTYPED_EXTERNAL_DEPENDENCY 393, MISSING_GLOBAL_TYPE 374, UNRESOLVED_MODULE 70 |
| NestJS | 387 | 209 | MISSING_GLOBAL_TYPE 190, UNTYPED_EXTERNAL_DEPENDENCY 182, TSCONFIG_MISMATCH 15 |
| Express | 172 | 53 | UNTYPED_EXTERNAL_DEPENDENCY 164, MISSING_GLOBAL_TYPE 4, TSCONFIG_MISMATCH 4 |
| Vue | 25 | 10 | UNTYPED_EXTERNAL_DEPENDENCY 20, MISSING_GLOBAL_TYPE 5 |

출처: `diagnostic-summary.json` `causeByFramework`.

### 2.5 사례별

| 사례 | 진단 | active file | | 사례 | 진단 | active file |
|---|---|---|---|---|---|---|
| br01 | 62 | 9 | | be01 | 53 | 1 |
| br02 | 28 | 10 | | be02 | 53 | 1 |
| br03 | 706 | 1 | | be03 | 3 | 1 |
| br04 | 12 | 10 | | be04 | 10 | 10 |
| br05 | 29 | 11 | | be05 | 53 | 6 |
| bv01 | 5 | 0 | | bn01 | 79 | 0 |
| bv02 | 7 | 2 | | bn02 | 59 | 1 |
| bv03 | 1 | 0 | | bn03 | 209 | 2 |
| bv04 | 5 | 1 | | bn04 | 2 | 1 |
| bv05 | 7 | 2 | | bn05 | 38 | 2 |

- active file 진단 71건
  - 원인: UNTYPED_EXTERNAL_DEPENDENCY 50, MISSING_GLOBAL_TYPE 16, UNRESOLVED_MODULE 5
  - 영향: EXTERNAL_OR_GLOBAL_TYPE_ONLY 34, NONE 19, LOCAL_VALUE_TYPE_DEGRADED 18
- `LOCAL_VALUE_TYPE_DEGRADED` 18건의 내용
  - be04: Express handler 파라미터 6개(`ErrorRequestHandler`·`RequestHandler` 주석이 untyped)
  - br01: `onOpenChange={(isOpen) => …}` 1개
  - br02, br05: `React.forwardRef` render 함수의 구조분해·`ref` 각 5·6개
  - 이 값들의 upstream 타입은 모두 외부 패키지 타입이다(§2.6, gt-impact-report.md).

### 2.6 lib override 검증 (`TSCONFIG_MISMATCH`)

Express·NestJS 10개 사례를 upstream 기본 lib(DOM 포함)로 다시 실행했다. 이 실행은 진단 확인용 변형이고, 고정 환경은 바꾸지 않았다.

- 결과 1: `TSCONFIG_MISMATCH` 19건은 모두 사라졌다(`console`, `URL`, `fetch`, `AbortSignal`).
- 결과 2: Express 4개 사례(be01·be02·be03·be05)에서는 다른 진단이 사라지는 대신 TS2339·TS2349·TS7052가 새로 생겼다.
  - be01·be02·be05: 각각 15건이 사라지고 16건이 새로 생겼다.
  - be03: 1건이 사라지고 1건이 새로 생겼다.
  - 원인: untyped `Request`·`Response` 이름이 DOM 전역 `Request`·`Response`로 해석된다.
  - 이는 P1-K1 R-ENV-2(DOM 없는 lib) 결정의 근거와 같다. upstream lib을 쓰면 오히려 로컬 코드가 잘못된 타입으로 해석된다.

### 2.7 중복

- 중복 31.2%(443건): 같은 upstream 의존 파일이 여러 사례의 import closure에 들어가서 생긴다.
  - NestJS `src/database/config/database.config.ts`(고유 26건)는 3개 사례에 들어가 78건이 된다.
  - NestJS `src/config/app.config.ts`(고유 19건)와 `src/files/config/file.config.ts`(고유 11건)는 각각 4개 사례에 들어간다.
  - Express `src/common/middleware/requestLogger.ts`(고유 14건)는 3개 사례에 들어간다. `envConfig.ts`는 4개 사례에 들어간다.
- 고유 진단 기준으로 보면 Express는 172건 중 53건, NestJS는 387건 중 209건이다.

## 3. 주요 사례 분석

| 사례 | 진단 | active | 포함 파일 | 진단 있는 파일 | 다른 사례와 공유 | 주요 코드 | 주요 untyped 모듈 |
|---|---|---|---|---|---|---|---|
| br03-main | 706 | 1 | 100 | 76 | 112 | TS7026 322, TS2694 88, TS7031 86, TS7006 62, TS2875 56 | react 214, msw 25, react-hook-form 23, @tanstack/react-query 19 |
| bn03-main | 209 | 2 | 141 | 49 | 84 | TS2591 72, TS2709 54, TS7006 40, TS2304 14 | @nestjs/config 27, class-validator 11, @nestjs/common 10, mongoose 10 |
| bn01-auth-google-controller | 79 | 0 | 52 | 12 | 79 | TS2591 40, TS7006 13, TS2709 9 | class-validator 11, @nestjs/config 7 |
| br01-form-drawer | 62 | 9 | 9 | 6 | 62 | TS7026 17, TS2694 15, TS7031 11 | react 37 |
| bn02-session-repository | 59 | 1 | 25 | 6 | 59 | TS2591 40, TS7006 13 | class-validator 11, @nestjs/config 3 |

- br03과 bn03의 진단이 많은 이유: 둘 다 앱 시작 파일(`main.tsx`, `main.ts`)이다.
  - 앱 전체를 import하므로 import closure가 크다(100개, 141개).
  - 진단의 99.9%(br03), 99.0%(bn03)가 의존 파일에 있다.
  - active file 자체의 진단은 1건, 2건뿐이다.
- br03: 진단의 47%가 JSX intrinsic 타입(@types/react 없음), 45%가 untyped React·라이브러리 타입이다. 의존 파일 76개에 퍼져 있다(dropdown 54, table 48, form 47).
- bn03: Node 전역(`process`) 72, untyped `@nestjs/config`·class-validator 타입, DOM override 12다. 진단은 주로 config 파일에 있다.
- bn01·bn02: 진단 전부가 다른 NestJS 사례에도 나오는 진단이다. 대부분 config 파일에 있다(`database.config.ts` 26, `app.config.ts` 19).
- br01: 진단의 66%(41건)가 drawer·button 의존 파일의 untyped React 타입이다. active file 9건은 JSX intrinsic과 `onOpenChange` 콜백 파라미터다.
- 진단 수가 많다는 이유로 사례를 빼거나 바꾸지 않았다. 진단 수는 사례의 GT 영향과 비례하지 않는다(gt-impact-report.md §2).

## 4. 재현

```sh
T=docs/thesis-experiments/tools/corpus-b-env
node $T/baseline-hashes.mjs --check docs/thesis-experiments/corpus-b/environment-audit/baseline-hashes.json
node $T/collect-diagnostics.mjs --out <빈 폴더>          # diagnostics.json, diagnostic-summary.json
node --test $T/test/diagnostics.test.mjs                # 합성 입력 테스트 9개
# 탐색적 해석 비교 (upstream 4개를 commit 고정으로 풀고, lockfile 그대로 --ignore-scripts 설치한 폴더)
node $T/compare-resolution.mjs --upstream <react/ vue/ express/ nest/ 가 있는 폴더> --out <file>
```

- 감사 도구는 `tools/corpus-b-env/`에 두었다. `tools/corpus-b/`에 넣으면 Corpus B `MANIFEST.json`의 대상 경로(`tools/corpus-b/**`)에 파일이 추가되어 manifest 검사가 drift를 보고하기 때문이다.
- 감사 산출물(`corpus-b/environment-audit/`)도 MANIFEST 대상 경로 밖에 있다. MANIFEST는 다시 만들지 않았다. 검사 결과는 그대로 OK(601개)다.
