# 방법

## 1. 무엇을 재현하는가

`src/panel/CodeGraphPanel.ts`의 `analyzeWorkspaceWithDepth()`를 Node에서 그대로 따라 한다.

```text
Depth 0 : analyzeWorkspaceActive(active) → 활성 파일 노드만 남김(pruneGraphToFile)
Depth 1 : analyzeWorkspaceActive(active) 결과 그대로
Depth 2 : 위 결과에서 frontier = external 노드 중 워크스페이스 파일(.d.ts 제외)
          frontier 각 파일 f 마다 analyzeWorkspaceActive(f) → mergeGraphPayload
```

`analyzeWorkspaceActive` 1회 = `buildWorkspaceRoots` → `ts.createProgram(rootNames, options, host)` → `getTypeChecker()` → `extractCallsResolved` → `collectDiagnostics` → `buildActiveFileGraph` (`src/analyzer/analyze.ts:242-408`).

도구의 frontier 필터(`external` + 워크스페이스 목록 포함 + `.d.ts` 아님 + 미분석)와 merge(Map 재구성)는 패널 코드와 같은 알고리즘이다. 워크스페이스 파일 목록은 P11 `list-files.cjs`(VS Code `findFiles` 모사)를 재사용했다.

**패널과 다른 점**
- 확장 파일 내용: 패널은 `vscode.workspace.fs.readFile`, 도구는 `fs.readFileSync`로 읽는다. 둘 다 디스크 내용이다.
- 패널의 결과 캐시(`analysisResultCache`, JSON 깊은 복사)와 `pushPanelDebugEvent`(80개 링 버퍼)는 재현하지 않는다. 도구는 디버그 이벤트 수만 센다.
- trace 병합은 Generate(traceMode off) 경로가 아니므로 제외했다.
- 프로세스 cwd가 Cogic 저장소라 TS 자동 `@types` 해석이 Extension Host와 다를 수 있다([README.md](README.md) 별도 발견).

## 2. 계측 도구

| 도구 | 작성 | 용도 |
|---|---|---|
| `tools/profile-depth.cjs` (v1) | Codex | pilot 3건 생성. **변경하지 않음** |
| `tools/monitor.ps1` | Codex | 1초 간격 프로세스 Working Set, 가용 메모리, page-in |
| `tools/profile-depth-v2.cjs` | 이번 단계 | v1 확장: 호스트 콜백 분해, RSS 표본, `--share-program`, `--max-expand`, `--dump-graph`, `cogicRevision` 기록 |
| `tools/graph-diff.cjs` | 이번 단계 | 그래프 덤프 비교(절대 경로 → `<projects>/`, `<cogic>/`) |
| `tools/summarize.cjs` | 이번 단계 | `data/summary-runs.csv`, `data/summary.json` 생성 |

### 2.1 계측 방식
`--instrument 1`이면 컴파일된 `out/analyzer/analyze.js`를 **메모리 안에서만** 문자열 치환해 로드한다(디스크 파일 불변). 치환 앵커 개수가 다르면 즉시 중단한다.
- `ts.createProgram(...)` → 시간·Program 크기 기록. v2는 호스트 객체의 **복사본**에 `getSourceFile`·`fileExists`·`readFile`·`directoryExists`·`realpath`·`getDirectories` 타이머를 씌워 `createProgram` 안에서만 쓴다.
- `program.getTypeChecker()` → `checkerAcquisition` 시간, checker API 5종 호출 수·시간.
- `extractCalls`, `diagnostics`, `graphExtraction` 구간 시간.

### 2.2 측정 경계와 중첩 (합산 금지)
- `analyses[].ms` = `analyzeWorkspaceActive` 1회 전체. Program 생성, checker, 추출, 진단을 모두 포함한다.
- `createProgramMs` ⊂ `analyses[].ms`. `hostCallbackMs` ⊂ `createProgramMs`. `tsInternalMs = createProgramMs − hostCallbackMs`.
- `checker.*` 시간은 `extractCalls`·`graphExtraction` **안에** 포함된다. 이 둘과 더하면 이중 계산이 된다.
- `checkerAcquisition`은 `getTypeChecker()` 호출 시간이다. 두 번째 호출부터는 캐시된 checker를 반환해 거의 0이다(파일당 1회 호출이 2번 앵커로 잡힌다).
- `totalMs` = Depth 실행 전체 = Σ `analyses[].ms` + merge + 직렬화 + frontier 계산. 실측에서 Σ analyses가 `totalMs`의 99.8% 이상이다.
- `peakRSSMB` = `process.resourceUsage().maxRSS`(프로세스 수명 최대값). `rssSampleMaxMB`, `heapSampleMaxMB`는 각 분석 직후 표본의 최대값이라 실제 최고점보다 낮을 수 있다.

### 2.3 도구 검증 결과 (VERIFIED)

| 항목 | 방법 | 결과 |
|---|---|---|
| 분석 동작 불변 | 같은 조건 계측 ON/OFF 그래프 SHA-256 | Hono D2 `45ea10…` = `45ea10…`, Vite D2 `3f9848…` = `3f9848…` |
| v1↔v2 일치 | 같은 날 v1으로 Hono D2 재실행 | v1 `45ea10…` = v2 `45ea10…` |
| 반복 결정성 | 같은 조건 반복 | Hono D2 3회 동일, Vite D2 2회 동일(기준·공유 checker·구조 재사용 모두) |
| SourceFile 캐시 정합성 | Hono D2 cache off / cold / warm | 세 조건 모두 `45ea10…` |
| 호출 횟수 | Program 수 = 분석 수, frontier 수 = merge 수 | Hono 3/2, Vite 35/34 일치 |
| 계측 오버헤드 | 계측 ON/OFF 총시간 | Hono 7.74–7.80 s vs 7.57 s(약 2–3%). Vite 69.2/80.0 s vs 66.8 s. 반복 간 편차(±7%) 안에 있다 |
| 민감 정보 | `data/` 전체에서 사용자 이름·절대 경로 검색 | 없음(메타는 프로젝트 기준 상대 경로, 그래프 diff는 placeholder) |

**v1에서 발견·보완한 점**
1. 중단 시 `programs = calls.slice(-analyses.length)`는 중단된 분석이 만든 Program을 잘못 배정할 수 있다. v2는 완료된 분석 기준으로만 기록하고 전체 생성 수를 따로 남긴다.
2. `totals`는 warm 모드에서 warmup과 measured를 합산한다. 이번 분석에서는 warm 시간 분해를 쓰지 않았다.
3. 공유 Program에서는 같은 checker를 두 번 감싸 횟수가 이중 집계된다. v2는 `WeakSet`으로 한 번만 감싼다.
4. `heapSampleMax`는 표본 최대값이다. 실제 최고점은 `peakRSSMB`로 본다.
5. pilot 당시 Cogic 빌드 리비전이 기록되지 않았다. v2는 `meta.cogicRevision`을 남긴다.

## 3. 실험 조건

| 변수 | 값 |
|---|---|
| Depth | 0, 1, 2 |
| SourceFile 캐시 | cold(기본: 프로세스 시작 시 비움), off, warm(같은 프로세스에서 한 번 더) |
| 공유 모드(`--share-program`) | `0` 기준(제품 동작) / `1` Program+checker 공유 / `old` `oldProgram`만 전달 / `old-sf` `oldProgram` + 직전 Program SourceFile 제공 |
| 반복 | 프로세스마다 1회 측정, 조건마다 1–3회(메모리 한도) |

공유 모드는 **P12-B 후보를 측정하려고 하네스 안에서만 흉내 낸 것이다**. 제품 코드에는 없다. `old-sf`는 측정 중 파일이 바뀌지 않는다는 하네스 조건에서만 유효하다. 제품에서는 버전·mtime 검사가 필요하다.

## 4. 메모리 안전 규칙
- 실행 전 `os.freemem()`을 기록한다. 분석마다 가용 메모리를 확인하고 `--min-free-mb` 아래면 `ABORT_LOW_MEMORY`로 멈추며, 중단 기록도 남긴다.
- 기준값은 v1 기본 500 MB였다. 사용자 앱(브라우저, Notion 등)이 메모리를 쓰고 있어 이번에는 **400 MB**로 낮췄다(commit 여유 13.7 GB라 OOM 위험은 없고, 위험은 paging이다). 500 MB 기준 첫 Hono D2 시도는 469 MB에서 중단됐고 `data/v2/h1-d2-cold-instr-aborted-lowmem.json`에 남겼다.
- 동시 실행 없음. 모든 실행은 순차로 했다.
- Vite 기준 D2는 최고 RSS 860–880 MB라 가용 1.2 GB 이상일 때만 실행했다.

## 5. 수행하지 않은 것
- VS Code UI 구간 분리(UNVERIFIED): 이유와 계획은 [bottleneck-analysis.md §5](bottleneck-analysis.md).
- P13 경쟁 도구 비교 재실행: 범위 밖이라 하지 않았다.
- CPU 프로파일(`--cpu-prof`): 호스트 콜백 분해로 `createProgram` 내부 비중을 충분히 구분해 생략했다. TS 내부 9.6 s의 세부 분해는 미검증이다.
