# Baseline Audit (Task A · Task D)

- 감사 일자: 2026-10-26
- 기준 커밋: `fed34a0950f1dc7b4b9e922a8c0b3b331c8aaa19` (`origin/main`과 동일, fetch 후 확인)
- 감사 방법: 소스코드 직접 열람, 프로젝트 표준 빌드·린트·테스트 실행, 1회성 계측 probe(성능 측정 아님)
- 증거 라벨 정의: [README.md](README.md#증거-라벨-evidence-labels)

README와 2026년 4월 중간보고서는 구현 여부의 근거로 사용하지 않았다. 아래 표의 판단은 모두 코드 위치를 근거로 한다. 줄 번호는 기준 커밋 기준이다.

---

## 1. 구현 기능과 코드 위치

### 1.1 정적 분석 엔진 (Analyzer)

| 기능 | 코드 위치 | 판단 근거 | 라벨 |
|---|---|---|---|
| 단일 파일 분석 | `src/analyzer/analyze.ts:69` `analyzeTypeScriptWithTypes` | 활성 파일만 root로 하는 in-memory `ts.createProgram` (`:148`) | IMPLEMENTED, TESTED |
| Workspace 분석 | `src/analyzer/analyze.ts:199` `analyzeWithWorkspace` (공개 진입점 `src/analyzer/index.ts:38` `analyzeWorkspaceActive`) | 다중 파일 `ts.createProgram(rootNames, options, host)` (`:307`), `TypeChecker` 사용 (`:308`) | IMPLEMENTED, TESTED |
| tsconfig 처리 | `src/analyzer/analyze.ts:473` `buildWorkspaceRoots`, `:435` `readParsedTsConfig`, `:461` project references | tsconfig가 있으면 `parsed.fileNames`를 root로 사용하고, 비어 있을 때만 `filePaths` 사용 (`:488`) | IMPLEMENTED, TESTED(path alias) |
| 미저장 버퍼 반영 | `src/analyzer/analyze.ts:270-305` | `readFile`/`getSourceFile`에서 활성 파일은 항상 메모리 코드로 `ts.createSourceFile` | IMPLEMENTED, TESTED |
| 그래프 생성 | `src/analyzer/analyze.ts:969` `buildActiveFileGraph` | **활성 파일 중심 그래프**: 활성 파일의 선언 노드 + 다른 파일 대상은 `external` 노드 | IMPLEMENTED, TESTED |
| 노드 ID 규칙 | `src/analyzer/analyze.ts:1001` `mkId` | `${kind}:${absoluteFile}:${pos}`, `pos` = `decl.getStart()` (`:2618`, 주석 제외·데코레이터/수식어 포함) | IMPLEMENTED |
| import/export 추출 | `src/analyzer/analyze.ts` `extractImports`, `extractExports` | top-level statement 기반 | IMPLEMENTED, TESTED |
| 호출 목록(`calls`) | `src/analyzer/analyze.ts:2323` `extractCallsResolved` | **빈도 상위 60개로 잘림** (`:2372` `.slice(0, 60)`) | IMPLEMENTED |
| 진단 수집 | `src/analyzer/analyze.ts:366` `collectDiagnostics` | options/global/syntactic/semantic diagnostics | IMPLEMENTED |
| TS 표준 lib 제외 | `src/analyzer/analyze.ts:2639` `isTypeScriptLibFile` | `/typescript/lib/` 경로의 선언은 calls·references·dataflow 대상에서 제외 | IMPLEMENTED |

### 1.2 GraphNodeKind / GraphEdgeKind (실험 범위 확정용)

`src/shared/protocol.ts:125` `GraphNodeKind` = `file | function | method | class | interface | external` (6종)

- `type` alias와 `enum`은 별도 kind가 아니라 `kind: "interface"` + `subkind: "type" | "enum"`으로 표현된다 (`analyze.ts:1534-1568`).
- 화살표 함수/함수 표현식 변수, 객체 리터럴 메서드, 클래스 필드 화살표 함수도 `function`/`method` 노드가 된다 (`analyze.ts:1401-1447`, `:1333`, `:1493`).
- 프레임워크 훅 콜백, 상태 훅 소스, 라우트 owner는 `function` kind의 synthetic 노드다. 이름 규칙은 `<owner>.<hook>#<n>` (`analyze.ts:1172-1188` `getHookCallbackName`/`getHookSourceName`)이다.

`src/shared/protocol.ts:151` `GraphEdgeKind` = `calls | constructs | dataflow | updates | references` (5종)

| Edge | 생성 위치 | 생성 조건(요약) |
|---|---|---|
| `calls` | `analyze.ts:2232` (call), `:2247` (JSX, label `jsx`), `:1843/:1871` (synthetic owner → handler), `:2179` (Nest route owner → method) | `getResolvedSignature` 또는 symbol 선언 기준. 같은 파일 선언이면 로컬 노드, 다른 파일이면 `external` 노드. TS lib 선언이면 생성하지 않음 |
| `constructs` | `analyze.ts:2254` | `new` 식, construct signature 선언 기준 |
| `dataflow` | `analyze.ts:1999-2017` `addDataflowEdgesFromSignature` | 호출/생성 인자 i → 파라미터 i의 **위치 기반 대응**. `min(params, args)`개만 생성, edge id에 `arg#i` 포함. label은 `param <- argText` |
| `updates` | `analyze.ts:2053`, `:2263-2310` | React `useState`/`useReducer` setter 호출, Vue `ref`/`reactive` 대상 대입·증감 |
| `references` | `analyze.ts:1912-1972` `addReferenceEdgesForOwner`, `:1756-1824` `addHookReferenceEdge` (useReducer reducer/initializer) | owner 본문의 식별자가 **같은 파일의 노드 선언**으로 해석될 때만 생성. 호출 callee 위치는 제외. **다른 파일을 가리키는 reference는 설계상 생성되지 않음** (`:1955`) |

Edge는 `kind + source + target + label + dedupeHint` 키로 중복 제거된다 (`analyze.ts:1651-1680`). 따라서 같은 관계를 여러 번 호출해도 edge는 1개이며, 호출 횟수는 그래프에 남지 않는다.

### 1.3 Framework Adapter

등록 위치: `src/analyzer/adapters/index.ts` `defaultFrameworkSemanticAdapters = [react, vue, express, nest]`

| Adapter | 파일 | 인식 범위 (코드 기준) | 코드상 비지원/제약 |
|---|---|---|---|
| React | `adapters/react.ts` | callback hook: `useEffect`, `useLayoutEffect`, `useInsertionEffect`, `useMemo`, `useCallback` (arg 0). state hook: `useState`, `useReducer` (tuple). `"react"`에서 named/default/namespace import된 symbol만 인식, alias import 지원 | custom hook, `useRef`/`useContext` 등 기타 hook, `"react"` 외 re-export 경유 import |
| Vue | `adapters/vue.ts` | callback: `computed`, `watch`(arg 1), `watchEffect`, `watchPostEffect`, `watchSyncEffect`. state: `ref`, `shallowRef`, `customRef`, `reactive` (identifier binding). `"vue"` named/namespace import | **`.vue` SFC 비지원**: 파일 탐색 glob이 `**/*.{ts,tsx,js,jsx}` (`CodeGraphPanel.ts:1028`)이다. Options API, default import |
| Express | `adapters/express.ts` | `use/get/post/put/patch/delete/options/head/all`. 수신 객체가 **같은 스코프 변수**이고 initializer가 `express()` 또는 `Router()`/`express.Router()`일 때만 인식. route path가 문자열 리터럴이면 이름에 포함 | callback은 **인자 1개만** (path가 있으면 index 1, 없으면 0)이라 `app.get(path, mw, handler)`의 `handler`는 owner에 연결되지 않음. `app.route().get()` chaining, 다른 모듈에서 import한 app/router, 템플릿 path 미인식 |
| NestJS | `adapters/nest.ts` | `@nestjs/common`의 `@Controller(path)` 클래스 + `@Get/@Post/@Put/@Patch/@Delete/@Options/@Head/@All` 메서드 → `route.<method>:<path>` synthetic owner가 메서드를 `calls` | `@Controller` 없는 클래스, custom decorator, 다른 패키지 경유 re-export |

### 1.4 VS Code Extension · Panel

| 기능 | 코드 위치 | 비고 | 라벨 |
|---|---|---|---|
| 명령/뷰 등록 | `src/extension.ts:44-50` | `codegraph.open`, `codegraph.openSidebar`, `registerWebviewViewProvider` | IMPLEMENTED |
| 분석 요청 처리 | `src/panel/CodeGraphPanel.ts:1103` `postAnalysis`, `:1384` `analyzeWorkspaceWithDepth` | production 분석 경로 | IMPLEMENTED |
| Graph depth | `CodeGraphPanel.ts:68` `clampGraphDepth` (0–3), `:282` 기본값 `0`, webview 기본값도 `0` (`webview-ui/src/App.tsx:683`) | depth 0은 `pruneGraphToFile`로 external 제거, depth 1은 analyzer 결과 그대로, **depth ≥2는 frontier 파일마다 `analyzeWorkspaceActive`를 다시 호출해 Program을 새로 만든다** (`:1457-1501`) | IMPLEMENTED (테스트 없음) |
| 자동 분석 debounce | `CodeGraphPanel.ts:516` `scheduleAnalysis`, 문서 변경 시 `350` ms (`:604`) | | IMPLEMENTED |
| Trace mode | `CodeGraphPanel.ts:126` `pruneGraphToFile`, `:142` `pruneTraceToGraph` | | IMPLEMENTED |
| Runtime Debug | `src/panel/runtimeDebug.ts:146` `RuntimeDebugBridge` | DAP `stackTrace`/`scopes`/`variables` 요청 (`:372`, `:433`, `:498`)으로 frame을 노드에 매핑 | IMPLEMENTED (테스트 없음) |
| Export | `webview-ui/src/components/CanvasPane.tsx:3010-3019` (`toSvg`/`toJpeg`), `App.tsx:2222` → `CodeGraphPanel.ts:1543` `saveExportFile` | JSON/JPG/SVG | IMPLEMENTED (테스트 없음) |
| Scaffold Lab | `src/codegen/index.ts:46` `buildPatchPreview`, `webview-ui/src/components/ScaffoldLab.tsx` | patch preview/apply | IMPLEMENTED, TESTED(3) |

### 1.5 캐시 계층 (EXP-02/03 핵심)

| 계층 | 코드 위치 | 정책 (실제 구현) | 라벨 |
|---|---|---|---|
| Disk SourceFile cache | `analyze.ts:37` `MAX_DISK_SOURCE_FILE_CACHE_ENTRIES = 800`, `:579` `getCachedDiskSourceFile`, `:710` `pruneDiskSourceFileCache` | 모듈 전역 `Map`. 키: 정규화 절대경로(Windows 소문자). 재사용 조건: `mtimeMs`, `size`, `scriptKind`, `languageVersionKey` 일치. 활성 파일은 이 경로를 타지 않는다. 용량 초과 시 **저장할 때마다 전체 엔트리를 `lastAccessedAt`(`Date.now()`, ms 해상도)으로 정렬**해 오래된 것부터 제거한다(O(n log n)). hit 시 Map 삽입 순서는 갱신되지 않아 같은 ms 동률은 삽입 순서로 정해진다. **근사 LRU**이고 용량은 상수라 외부에서 바꿀 수 없다 | IMPLEMENTED, TESTED(1) |
| Full analysis result cache | `CodeGraphPanel.ts:35` `MAX_ANALYSIS_RESULT_CACHE_ENTRIES = 40`, `:1274` `getAnalysisCacheKey`, `:1299` `getCachedAnalysisResult`, `:1330` `storeAnalysisResult`, `:1341` `pruneAnalysisResultCache` | 키: 파일경로, languageId, 코드 SHA-256, depth, traceMode, traceScope, workspaceRoot, 파일목록 해시. 저장·조회 시 JSON deep clone. 근사 LRU | IMPLEMENTED (테스트 없음) |
| Workspace file list cache | `CodeGraphPanel.ts:1020` `getWorkspaceFilePaths` | **10초 TTL**, `findFiles("**/*.{ts,tsx,js,jsx}", "**/{node_modules,dist,build,out,.next}/**", 4000)` → **최대 4000개** | IMPLEMENTED (테스트 없음) |
| 사용자 설정 | `package.json` `cogic.analysisCache.enabled` (기본 true), `CodeGraphPanel.ts:746` `isAnalysisCacheEnabled` | 이 설정 하나로 result cache와 SourceFile cache를 함께 켜고 끈다 (`:1394`, `:1429`) | IMPLEMENTED |
| 무효화 | `CodeGraphPanel.ts:813` `invalidateCachesForFiles` | `onDidChangeTextDocument` (`:581`), save (`:607`), 파일 생성/삭제/이름변경, FS watcher, tsconfig watcher, 설정 변경. **호출될 때마다 result cache 전체를 `clear()`** 하고, SourceFile cache는 해당 파일만 제거(파일 목록이 없으면 전체 제거) | IMPLEMENTED (테스트 없음) |

---

## 2. 테스트 현황

실행 결과는 [§6](#6-task-d--실행-환경과-baseline-검증)에 있다. 기준 커밋에서 `npm test` 결과는 **25 passing / 0 failing**이다.

| Suite | 파일 | 개수 | 검증 성격 |
|---|---|---:|---|
| Analyzer | `src/test/analyzer.test.ts` | 21 | SourceFile cache 1, import/export·barrel·alias·dynamic import·JSX 8, React 3, Vue 3, Express 2, Nest 1, workspace sibling 1, object literal 1, references 2 |
| Codegen | `src/test/codegen.test.ts` | 3 | Scaffold patch preview |
| Extension | `src/test/extension.test.ts` | 1 | 템플릿 sample test (기능 검증 없음) |

테스트의 성격 (논문 서술에 영향):

1. Analyzer 테스트는 거의 모두 `assert.ok(result.graph.edges.some(...))` 형태의 **존재 단언**이다. 기대 관계가 있는지만 확인하고, 생성되지 말아야 할 관계(FP)가 없는지는 확인하지 않는다. 따라서 현재 테스트는 사례별 재현율 근거는 되지만 **정밀도(precision) 근거가 되지 못한다**.
2. 대부분 `analyzeTypeScriptWithTypes`(단일 파일 모드)로 실행된다. workspace 모드는 alias, JSX, sibling, cache 테스트에서만 쓰인다.
3. Webview(React UI), Export, Runtime Debug, graph depth ≥2, result cache, 무효화 이벤트를 다루는 테스트는 **없다**.
4. 캐시 테스트(`analyzer.test.ts:18`)는 두 번째 분석에서 `helper.ts`가 hit하고 활성 파일은 hit하지 않음을 검증한다. 용량·축출 동작은 검증하지 않는다.

---

## 3. 실제 검증 가능한 범위

| 범위 | 검증 가능 여부 | 이유 |
|---|---|---|
| Analyzer 관계 추출 정확도 | **가능** | `analyzeWorkspaceActive`를 VS Code 없이 Node에서 직접 호출할 수 있다 (기존 벤치마크와 테스트가 이렇게 실행됨) |
| SourceFile cache 성능 | **가능** | 동일 API에 `cacheEnabled`와 `debug` 콜백이 있다. hit/miss/stale/store 이벤트에 `filePath`와 `entries`(occupancy)가 포함된다 (`analyze.ts:647-690`) |
| Result cache 성능 | **부분 가능** | production 메서드는 private이고 VS Code 상태에 의존한다. harness의 등가 구현으로만 측정할 수 있다 |
| 캐시 용량 변화 | **현재 불가** | 용량이 `const 800` 상수이고 주입 경로가 없다 |
| 축출(eviction) 수 | **간접 가능** | 전용 이벤트는 없다. `store` 이벤트의 `entries` 시퀀스로 유도할 수 있다 |
| 메모리 사용량 | **harness 추가 시 가능** | 현재 harness는 메모리를 기록하지 않는다 |
| UI 응답시간(end-to-end) | **현재 불가** | 측정 장치가 없다. debounce·직렬화·렌더링이 측정 대상에서 빠져 있다 |

---

## 4. README와 실제 구현의 차이

| # | README 서술 | 실제 구현 | 영향 |
|---|---|---|---|
| D1 | Code entities에 `type`, `enum` 포함 | `GraphNodeKind`에 없다. `interface` + `subkind`로 표현된다 | 논문에서 노드 종류를 "6종 + subkind"로 정확히 기술해야 한다 |
| D2 | "Framework semantics for ... Vue" | Composition API 함수 호출만 인식한다. `.vue` SFC 파일은 탐색 대상이 아니다 | Vue 지원 범위를 "TS/JS 내 Composition API"로 한정해야 한다 |
| D3 | Express "router handlers" | 같은 스코프에서 `express()`/`Router()`로 만든 변수만 인식한다. handler는 인자 1개만 연결된다 | EXP-01에서 제약 사례로 측정해야 한다 |
| D4 | "analysis caching reduced median ... from approximately 1.09 s to 0.38 s" | 원시 데이터의 SourceFile-only p50은 366.03 ms(0.366 s)다. 0.38 s는 Full result 모드 p50(378.67 ms)이다. 또 과거 단일 환경(i5-4690)의 1회 실행 값이다 | 인용 시 모드와 환경을 명시해야 한다. 재현 전에는 MEASURED[HIST]로만 쓸 수 있다 |
| D5 | Analysis cache가 "workspace file state"를 키로 사용 | 키는 파일 **경로 목록의 해시**다. 파일 내용 변경은 무효화 이벤트로 처리된다 | 의미 차이(경미). 논문에서 정확히 기술한다 |
| D6 | "Depth-based graph expansion" | depth ≥2는 frontier 파일마다 Program을 새로 생성한다 (증분 재사용 없음) | 깊이별 비용 분석 시 고려해야 한다 |
| D7 | Roadmap "Incremental workspace analysis" | 미구현이다. `ts.createProgram`에 `oldProgram`을 전달하지 않는다 (`analyze.ts:307`) | 캐시 효과를 "증분 분석"으로 표현하면 안 된다 |
| D8 | License "MIT License" | `LICENSE`는 MIT이고 `package.json`은 `"SEE LICENSE IN LICENSE"`다 | 연구와 무관(일치) |

---

## 5. 논문 활용 가능 근거, 추가 실험, 왜곡 요인

### 5.1 지금 논문에 사용할 수 있는 근거

- 시스템 설계 서술: 위 §1의 모든 IMPLEMENTED 항목(코드 위치 인용).
- 기능 동작 사례: 25개 테스트 통과(TESTED, 2026-10-26). 각 테스트가 다루는 패턴의 **존재 확인** 수준이다.
- 캐시 설계: 3계층 정책과 무효화 규칙(IMPLEMENTED).
- 과거 캐시 측정: MEASURED[HIST-0829]. 원시 데이터와 문서 수치가 일치함을 P0에서 확인했다([existing-benchmark-audit.md](existing-benchmark-audit.md)). **재현된 결과는 아니다.**
- SourceFile 요청 구성: Cogic 대상 분석 1회당 172건 중 155건(90.1%)이 TS lib/`@types`/`undici-types` 선언 파일이다(MEASURED[P0-PROBE], counts only).

### 5.2 추가 실험이 필요한 부분

- 관계 유형별 정밀도·재현율: 현재 근거가 없다 → EXP-01
- 캐시 효과 재현, hit 경로 결과 동일성 → EXP-02
- 용량·규모·메모리, 스래싱 인과 → EXP-03
- (범위 밖) end-to-end UI 지연, depth ≥2 비용, 다중 파일 편집

### 5.3 실험 결과를 왜곡할 수 있는 구현상 제약

| ID | 제약 | 위치 | 왜곡 방향 |
|---|---|---|---|
| K1 | `calls` 목록이 상위 60개로 잘린다 | `analyze.ts:2372` | `calls` 목록으로 정확도·정합성을 세면 큰 파일에서 과소 집계된다. 기존 correctness 표의 `calls 60`이 이 상한값이다 |
| K2 | Edge 중복 제거(관계 집합 의미) | `analyze.ts:1651` | GT를 호출 지점 단위로 만들면 FN이 과대 계산된다 |
| K3 | 다른 파일 reference는 생성되지 않음 | `analyze.ts:1955` | reference 재현율 정의에 따라 결과가 크게 달라진다 |
| K4 | TS lib 호출 제외 | `analyze.ts:2060` 등 | GT에 `console.log` 같은 호출을 포함하면 FN이 된다 |
| K5 | SourceFile cache 용량 상수, ms 해상도 근사 LRU, 저장마다 전체 정렬 | `analyze.ts:37`, `:646`, `:710` | 용량 실험에는 코드 변경이 필요하다. 정렬 비용이 zero-hit 조건에서 ON 지연을 키울 수 있다(INFERRED) |
| K6 | 문서 변경 이벤트마다 result cache 전체 clear | `CodeGraphPanel.ts:581`, `:820` | 실제 편집 흐름에서 result cache hit는 harness의 repeated 시나리오보다 훨씬 드물다 |
| K7 | production 기본 depth 0, 벤치마크 depth 1 | `CodeGraphPanel.ts:282`, harness | analyzer 비용은 같고 depth 0은 사후 prune만 추가한다. depth ≥2 비용은 측정되지 않았다 |
| K8 | `findFiles`에 명시적 exclude를 주므로 `files.exclude` 기본값이 적용되지 않음(VS Code API 동작에 근거한 INFERRED). 저장소에 `.vscode-test/` JS 7,828개 존재 | `CodeGraphPanel.ts:1027-1031` | production 파일 목록이 4000 상한에 걸리고 harness 목록과 달라질 수 있다. tsconfig가 없는 workspace에서는 Program root가 달라진다 |
| K9 | tsconfig가 있으면 Program root는 `filePaths`가 아니라 tsconfig `include` | `analyze.ts:488` | "workspace 파일 수"와 실제 분석 규모가 다르다. Cogic 대상은 harness 목록 84개, Program root 18개 |
| K10 | 합성 workspace가 저장소 하위에 생성되어 상위 `node_modules/@types`를 자동 포함 | 벤치마크 `generateSyntheticWorkspace` (tsconfig에 `types` 미지정) | 분석 1회당 요청 수 = N + 159. 용량 경계가 N이 아니라 N+159에서 나타난다 |

---

## 6. Task D — 실행 환경과 Baseline 검증

### 6.1 환경 (2026-10-26, 명령 실행 결과)

| 항목 | 값 | 수집 명령 |
|---|---|---|
| OS | Microsoft Windows 11 Pro 10.0.26100 (x64) | `Get-CimInstance Win32_OperatingSystem`, `os.type/release` |
| CPU | Intel Core i5-9400F @ 2.90GHz, 6 cores / 6 logical | `Win32_Processor` |
| Memory | 8.0 GB physical (`os.totalmem` 7.9 GiB), 측정 시점 가용 1.1 GiB | `Win32_PhysicalMemory`, `os.freemem` |
| 전원 구성 | 균형 조정 (Balanced), 배터리 없음(데스크톱) | `powercfg /getactivescheme` |
| Node.js / npm | v24.12.0 / 11.6.2 | `node -v`, `npm -v` |
| TypeScript | 5.9.3 (root `node_modules`, webview `node_modules` 동일) | `npx tsc -v`, `require('typescript/package.json')` |
| Git / gh | 2.52.0.windows.1 / 2.102.0 | |
| VS Code (설치본 CLI) | 1.142.0 | `code --version` |
| VS Code (테스트 실행본) | 1.143.1 (`@vscode/test-electron`이 `stable`을 새로 다운로드, 343 MB) | `npm test` 로그 |
| Extension engine | `vscode ^1.108.1` | `package.json` |

과거 벤치마크 환경(2026-08-29): Windows_NT 10.0.19045, Intel i5-4690 @ 3.50GHz 4 logical, 15.9 GB, Node v22.16.0. **OS, CPU, 메모리, Node 메이저 버전이 모두 다르다.** 비교 방법은 [reproducibility.md](reproducibility.md)에 정리했다.

### 6.2 실행한 명령과 결과

| 명령 | 결과 | 비고 |
|---|---|---|
| `git fetch origin` / `git rev-parse HEAD origin/main` | PASS | 둘 다 `fed34a0…` |
| `npm run compile` (`tsc -p ./`) | PASS | 오류 없음, `out/` 갱신(gitignored) |
| `npm run lint` (`eslint src`) | PASS | 경고·오류 없음 |
| `npm run lint:webview` (`eslint .` in webview-ui) | PASS | |
| `npx tsc -b --noEmit` (webview-ui) | PASS | 타입 검사만 수행 |
| `npm test` (pretest: compile + lint:all → VS Code Extension Host) | **PASS: 25 passing, 0 failing** | VS Code 1.143.1, 약 6 s |
| `node docs/thesis-experiments/tools/audit-existing-benchmark.mjs .` | PASS (ISSUES: none) | 읽기 전용 |
| `node docs/thesis-experiments/tools/probe-sourcefile-requests.cjs .` | PASS | counts only, 타이밍 미측정 |
| `npm run build:webview` / `build:all` | NOT_RUN | P0 판단에 불필요하다. 타입 검사와 린트로 대체했다 |
| `npm run benchmark:cache` | **NOT_RUN (의도적)** | P0 범위 밖이다. 또 스크립트가 `docs/benchmarks/analysis-cache/` 원본을 덮어쓴다([risks-and-limitations.md](risks-and-limitations.md) R-01) |

실패한 명령이 없으므로 production 코드는 수정하지 않았다.

### 6.3 실험 자동화 가능성과 제약

- Analyzer 기반 실험(EXP-01/02/03)은 VS Code 없이 Node에서 `out/analyzer`를 직접 호출하는 방식으로 자동화할 수 있다.
- 전제: `npm run compile` 선행. 합성 workspace는 `.benchmark-workspaces/`(gitignored)에 생성된다. 외부 저장소는 `git clone`(네트워크)이 필요하다.
- 제약 1: 메모리 8 GB, 가용 약 1.1 GiB(측정 시점). 2000 파일 이상 규모나 메모리 측정 시 다른 프로세스의 영향을 받는다.
- 제약 2: 전원 구성이 "균형 조정"이다. 측정 시 "고성능"으로 바꾸고 기록해야 한다.
- 제약 3: `npm test`는 매번 최신 `stable` VS Code를 받는다. 재현성을 위해 `VSCODE_TEST_VERSION`을 고정해야 한다(`scripts/run-vscode-tests.mjs:16`).
- 제약 4: 과거 실험의 Node v22.16.0과 현재 v24.12.0이 다르다. 동일 런타임 비교에는 Node 22.16.0 별도 설치가 필요하다(신규 의존성 아님, 런타임 도구).
