# P12-B 구현 — Depth 실행 범위 Program Session

커밋 `3f03334` (`perf/p12b-program-session`, 기준 `7469baf`).

## 변경 파일

| 파일 | 변경 |
|---|---|
| `src/analyzer/analyze.ts` | `AnalysisSession` 클래스, `createAnalysisSession()`. `analyzeWithWorkspace`에 선택 인자 `session` 추가. `getCachedDiskSourceFile`에 `onServed` 콜백 추가. `analyzer.program.created` 디버그 이벤트 추가. 캐시 무효화 함수가 살아 있는 세션에 알림 |
| `src/analyzer/depth.ts` (신규) | `CodeGraphPanel.analyzeWorkspaceWithDepth`에서 VS Code API와 무관한 Depth 순회를 그대로 옮긴 `analyzeWorkspaceDepth()`. Depth ≥ 2 실행 하나에 세션 하나를 만들고 `finally`에서 해제 |
| `src/analyzer/index.ts` | 위 함수·타입 export. `analyzeWorkspaceActive`에 선택 인자 `session`(기존 호출자 영향 없음) |
| `src/panel/CodeGraphPanel.ts` | Depth 순회 본문을 `analyzeWorkspaceDepth` 호출로 교체. 결과 캐시, 디버그, `vscode.workspace.fs.readFile`은 패널에 그대로 남김. 옮긴 헬퍼(`mergeGraphPayload`, `pruneGraphToFile` 등)는 `depth.ts`에서 import |
| `src/test/p12bProgramSession.test.ts` (신규) | 12개 시나리오 × tsconfig 유무 = 24개 테스트 |

`GraphPayload` 형식, `analyzeWorkspaceActive`의 반환 형식, Structure Graph·Dataflow·Inspector·Runtime Debug 코드는 바꾸지 않았다.

## 동작

```text
analyzeWorkspaceDepth(depth=2)
  session = createAnalysisSession()               // Depth ≥ 2 && 캐시 설정 ON 일 때만
  ├─ analyzeWithWorkspace(active, session)
  │     key₀ = {workspaceRoot, rootNames, options}
  │     program₀ = createProgram(roots, opts, host)            // 기존과 같음(디스크 캐시 사용)
  │     session.commit(program₀, key₀, served₀)               // 디스크에서 준 SourceFile과 (mtime,size) 기록
  └─ for f in frontier
        analyzeWithWorkspace(f, session)
          old = session.oldProgramFor(keyᵢ)                   // 구조 키가 같을 때만
          host.getSourceFile(x):
             x == f           → 새 SourceFile(f의 내용)        // 기존과 같음
             재사용 가능       → servedᵢ₋₁[x].sourceFile        // 무효화 없음 + mtime/size/scriptKind/언어버전 일치
             그 외            → 기존 getCachedDiskSourceFile
          programᵢ = createProgram(roots, opts, host, old)
          checkerᵢ = programᵢ.getTypeChecker()                // 항상 새 checker
          session.commit(programᵢ, …)
  finally session.dispose()
```

- **TypeChecker는 공유하지 않는다.** P12-A에서 checker 공유가 그래프를 바꾸는 것을 확인했다.
- 버퍼로 만든 SourceFile(각 분석의 활성 파일)은 재사용 대상에 넣지 않는다. 그래서 직전 활성 파일은 다음 Program에서 디스크 경로로 다시 읽는다. 현재 동작(확장 분석은 원래 활성 파일을 디스크 버전으로 본다)과 같다.
- 세션은 Program을 최대 1개만 잡는다. 다음 Program을 만드는 동안에는 잠시 2개가 공존한다.

## 무효화와 안전 경로

| 상황 | 처리 | 테스트 |
|---|---|---|
| 최초 활성 파일의 미저장 버퍼 | 버퍼로 SourceFile 생성(기존과 동일), 재사용 대상 아님 | unsaved buffer |
| frontier 파일 | 매 분석의 활성 파일이므로 새 SourceFile | Depth 2 equality |
| 분석 중 파일 내용 변경(크기 변경) | `stat` 크기/mtime 불일치 → 재사용 안 함 | size change |
| **같은 크기, mtime 유지 수정** | `invalidateAnalyzerFileCaches`(패널의 save·change·watcher 이벤트) → 해당 경로 재사용 금지 + 디스크 캐시 항목 삭제 | same-size edit |
| 파일 추가·삭제·이름 변경 | 세션이 준 적 없는 `.ts/.js/.json` 경로가 무효화되면 세션 중단(poison) → 이후 기존 경로. 삭제된 파일은 `stat` 실패로 재사용 불가 | created source file |
| tsconfig 변경 | 분석마다 `buildWorkspaceRoots`로 다시 계산한 구조 키가 다르면 `oldProgram`을 넘기지 않음. tsconfig 무효화 이벤트도 세션을 중단 | changed root names / options |
| rootNames·compilerOptions 변경 | 구조 키 불일치 → 재사용 안 함 | 같음 |
| 프로젝트 전환 | 키에 `workspaceRoot` 포함 → 재사용 안 함 | another project |
| `clearAnalyzerCaches` | 세션 중단 | clearAnalyzerCaches |
| 분석 실패(확장 대상 읽기 실패) | 기존처럼 그 대상만 건너뜀. 세션은 `finally`에서 해제 | unreadable target |
| `createProgram(…, oldProgram)` 예외 | 세션 중단 후 `oldProgram` 없이 다시 생성(`analyzer.session.fallback`) | 코드 검토만(아래 참고) |
| 해제된 세션으로 분석 | 재사용 없이 기존 경로 | dispose |
| 분석 캐시 설정 OFF | 세션 무시 | cache setting off |

**mtime/size 정책 검토**: 기존 디스크 SourceFile 캐시도 mtime/size로 변경을 판단한다. 같은 크기에 mtime이 같은 수정(거친 mtime 해상도의 파일 시스템, mtime을 보존하는 도구)은 `stat`만으로는 놓친다. 세션은 이 위험을 새로 만들지 않는다. 오히려 (1) 수명이 Depth 실행 한 번(초 단위)으로 짧고 (2) 패널의 변경·저장·watcher 이벤트를 받아 해당 경로를 제외한다. 콘텐츠 해시는 재사용할 때마다 파일 전체를 읽어야 해서 P12-A에서 줄인 디스크 I/O를 되살리므로 쓰지 않았다. 남은 위험은 [results.md §6](results.md)에 적었다.

**구조 재사용 상태**: `program.structureIsReused`는 TypeScript 내부 필드라 진단 이벤트에만 쓴다. 동작은 이 값에 의존하지 않는다.

## 테스트로 확인한 실패 감지력 (mutation check)
컴파일된 `out/`만 임시로 바꿔 확인했다(이후 재컴파일).
- 무효화 검사(`invalidated.has`)를 끄면 → same-size edit 테스트 2건 실패
- 구조 키 비교를 끄면 → root names / project switch 테스트 4건 실패
