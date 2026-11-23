# P11 실험 설계

## 1. 비교 조건
분석기 벤치마크(Node, 패널과 같은 호출 경로):

| 조건 | 분석기 코드 | 캐시 |
|---|---|---|
| **OFF** | v0.0.6 | `cacheEnabled: false` |
| **Fixed 800** | v0.0.6에서 `src/analyzer/analyze.ts`·`index.ts`만 P9 이전 버전(`396923c`, 연구 기록 `9126f35`)으로 교체 | ON |
| **Adaptive** | v0.0.6 그대로 | ON |

- `git diff 396923c v0.0.6 -- src/analyzer`의 차이는 SourceFile 캐시 정책뿐이다. 분석 로직과 입력은 같다.
- Fixed 800 빌드에는 **계측만** 추가했다. 캐시 상태 조회 `getAnalyzerCacheStats()`(측정 구간 밖에서 호출)와 제거 시 `evict` 진단 이벤트이며, 정책은 그대로다 → [tools/variants/fixed800-instrumentation.diff](tools/variants/fixed800-instrumentation.diff)

실제 VS Code UI:

| 조건 | VSIX | 설정 |
|---|---|---|
| OFF | v0.0.6 (`bdd0cab6…`, Marketplace 배포본과 바이트 동일) | `cogic.analysisCache.enabled=false` |
| Fixed 800 | P4 VSIX (`2748b83d…`; v0.0.6과 차이는 분석기 캐시 정책뿐, 웹뷰 번들 동일) | 캐시 ON |
| Adaptive | v0.0.6 (`bdd0cab6…`) | 캐시 ON |

## 2. 분석 범위 (제품과 동일)
- 파일 목록은 패널 `getWorkspaceFilePaths`와 같다: `**/*.{ts,tsx,js,jsx}`, 제외 `**/{node_modules,dist,build,out,.next}/**`, 최대 4,000개.
  - 가정: 명시적 exclude를 주면 `files.exclude`가 적용되지 않으므로 dot 폴더도 포함했다(`.git` 제외).
- `rootNames`, 컴파일러 옵션, Depth 1(분석 1회 결과를 그대로 전송)은 v0.0.6 코드 그대로다.
- **Program SourceFile 수** = 캐시 ON 분석 1회의 SourceFile 캐시 hit + miss 수.

## 3. 분석기 시나리오
| 시나리오 | 내용 | 반복 |
|---|---|---|
| A. Cold Start | 새 Node 프로세스의 첫 분석 | 조건당 독립 프로세스 5회, 조건 순서 순환 |
| B. Warm (cleared) | 같은 프로세스에서 매번 `clearAnalyzerCaches()`와 결과 캐시를 비우고 분석 | warm-up 1 + 측정 5, 2블록 |
| C. Repeated | 코드 변경 없이 같은 그래프 재생성(결과 캐시 경로) | warm-up 3 + 측정 15, 2블록 |
| D. Active-file Edit | 활성 파일 끝에 유효한 TS 함수 추가(반복마다 다른 이름) 후 재분석 | warm-up 3 + 측정 15, 2블록 |
| E. Cross-file Edit | 활성 파일이 import하는 파일을 디스크에서 수정(함수 추가) 후 활성 파일 재분석 | warm-up 3 + 측정 15, 2블록 |
| F. File Switch | 매번 처음 여는 프로젝트 파일 18개를 차례로 분석 | warm-up 3 + 측정 15, 2블록 |

- 무효화도 패널과 같다. 문서 변경·저장 시 `invalidateCachesForFiles`처럼 결과 캐시를 비우고 해당 파일의 SourceFile 항목을 무효화한다. 무효화 시간은 측정 구간 밖에서 따로 기록했다.
- 측정 구간(P9 `extensionSideMs`와 동일): 결과 캐시 조회 + `analyzeWorkspaceActive` + 결과 직렬화.
- 블록마다 조건 순서를 회전했다(P9와 같은 방식, 시나리오 목록 기준 고정).
- E의 수정은 블록이 끝나면 원래 바이트로 복원했다(중단 시 복원 기록: [data/raw/p11-excalidraw.restores.jsonl](data/raw/p11-excalidraw.restores.jsonl)).

## 4. 활성 파일 선택 규칙 (사전 정의, 결정적)
- 후보: 주 소스 폴더의 `.ts/.tsx`. `.d.ts`, 테스트·벤치마크·fixture, `index.*` 배럴 파일은 제외한다.
- 활성 파일: 후보 파일로 해석되는 상대 import가 가장 많은 파일(동률이면 경로순).
- Cross-file 대상: 활성 파일이 import하는 후보 중 경로순 첫 파일.
- File Switch 목록: 활성 파일을 뺀 후보를 시드 11(mulberry32)로 섞은 뒤 앞의 18개.

## 5. 측정값
- 시간: `performance.now()` ms.
- 캐시: SourceFile hit/miss/evict/skipFull/stale/store, 결과 캐시 적중 여부, 항목 수·용량·캐시 텍스트 문자 수.
- 메모리:
  - 매 측정 후 `process.memoryUsage()`(heapUsed, heapTotal, RSS, external)
  - 블록 끝 **유지 힙**: 강제 GC 두 번 후 캐시가 찬 힙과, 캐시를 비우고 다시 GC한 힙의 차이
- 결과 일관성: 결과 전체(`imports, exports, calls, diagnostics, graph, trace, meta`)의 정규화 JSON SHA-1(키 정렬, 배열 순서 유지 = strict). 그래프 집합 해시와 id 해시도 함께 기록했다. 기준은 같은 시나리오·같은 반복 번호의 OFF 결과다.
  - v0.0.6 결과에는 시각·소요 시간 같은 비결정적 필드가 없으므로 제외 필드도 없다.
  - 결과 캐시 적중 결과는 JSON으로 복제되어 `undefined` 속성이 빠진다. 그래서 별도 검증 실행에서 **JSON 의미론 해시**를 추가해 비교했다([correctness-results.md](correctness-results.md)).

## 6. UI 측정 (P10과 같은 정의)
- 격리 VS Code 1.147.0, 창 1600×960, 조건별 독립 확장 폴더, 매 실행 새 프로필(캐시 비어 있음), Depth 1.
- 실행 1회 순서:
  1. 첫 Generate + 반복 Generate 5
  2. 활성 파일 편집 5(타이핑, 350 ms debounce 포함)
  3. 노드 더블클릭 소스 이동
  4. Root 해제 후 파일 전환 3(Quick Open)
- 시간 = 입력(pointerdown / 마지막 keydown) → 마지막 그래프 DOM 변경 후 두 번째 rAF(**프레임 콜백, 화면 표시 시각 아님**).
- 편집: "데이터 반영"(결과 payload에 새 함수 포함)과 "화면 가시성"(DOM 존재 / 뷰포트 안 / hit-test)을 따로 판정했다. 편집 전 활성 파일 그룹이 화면 밖이면 측정 구간 밖에서 실제 드래그로 이동한다(P8-C와 동일).
- 결과마다 그래프 식별 해시(노드 id·kind·file·range, 엣지 id·kind·source·target, FNV-1a)를 기록했다.
- 프로젝트당 조건 3 × 독립 실행 3, 실행 순서는 Latin square(F,A,O / A,O,F / O,F,A).
- 스펙 [tools/ui/p11-real.spec.ts](tools/ui/p11-real.spec.ts)는 hono 스모크 실행 6회로 검증했다(통계 제외). 수정 내역:
  - 소스 이동이 뷰포트를 바꾸므로 편집 뒤로 옮겼다.
  - Generate가 파일 Root를 설정하므로(P4 정책) 파일 전환 전에 Root를 해제했다.
  - 진단 팝업이 가린 버튼 대신 hit-test를 통과하는 Root 해제 버튼을 누른다.
  - 파일 전환은 해당 파일의 결과가 도착해야 완료로 판정한다.

## 7. 판정과 통계
- 조건별 중앙값, 블록 중앙값, 사분위 범위를 보고한다.
- 변화율 95% 구간: 두 조건 표본을 따로 재표본한 bootstrap(10,000회, 시드 20261122). 서술 통계이며 가설 검정이 아니다.
- 방향성 보조 지표: 두 블록 모두 한쪽이 작음(분석기), 조건별 실행 중앙값 3개가 완전히 분리(UI).
- 실패·SKIP·제외를 지우지 않는다. 분석기: [data/summary/p11-failures.json](data/summary/p11-failures.json)(0건), UI: [data/ui/p11-ui-excluded-runs.json](data/ui/p11-ui-excluded-runs.json).

## 8. 실행 정책 (변경 이력 포함)
- 한 번에 실행 하나만 돌렸다. 벤치마크와 UI 측정은 동시에 하지 않았다.
- 블록은 끝나는 즉시 디스크에 기록하고, 중단 시 저장된 블록은 건너뛰고 재개한다(resume). 중단된 블록은 완료로 세지 않는다.
- 첫 전체 실행(`p11-main`)은 Claude Code의 메모리 보호로 중단됐다. 결과를 종료 시에만 쓰는 버그로 원시 데이터를 잃었으며, 블록 중앙값 로그만 참고 자료로 남기고 **최종 통계에 쓰지 않았다**([data/raw/p11-main-LOST-reference.run.log](data/raw/p11-main-LOST-reference.run.log)).
- 메모리 게이트와 UI 메모리 감시 규칙은 실행 중 바뀌었다. 바뀐 시점과 대상은 [data/run-policy-changes.md](data/run-policy-changes.md)에 기록했다.
  - 분석기 225블록: 게이트 1,500 MB
  - UI: 게이트 1,000 MB, 실행 중 메모리·페이징 감시
  - UI 제외 규칙: 시간 측정 단계에서 가용 메모리가 500 MB 미만이면 제외하고 1회 재측정했다.
  - Pages Input/sec > 500은 파일 읽기와 구분되지 않아 표시만 하고, 민감도 분석으로 따로 보고했다.
