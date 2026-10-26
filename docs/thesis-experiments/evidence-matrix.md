# Evidence Matrix

**논문의 주장 → 근거 소스코드 → 테스트 또는 실험 → 현재 검증 상태 → 추가 필요 작업**

- 기준 커밋 `fed34a0`, 작성 2026-10-26
- 라벨 정의: [README.md](README.md#증거-라벨-evidence-labels). 실행 식별자: `TESTED[P0-1026]` = 2026-10-26 `npm test` 25 passing, `MEASURED[HIST-0829]` = 2026-08-29 기존 벤치마크, `MEASURED[P0-PROBE]` = 2026-10-26 계측 probe(counts only)
- "논문 사용 가능 문구"는 현재 상태에서 방어 가능한 최대 표현이다.

## A. 시스템 설계·구현

| ID | 논문의 주장 | 근거 소스코드 | 테스트·실험 | 현재 상태 | 논문 사용 가능 문구 / 추가 작업 |
|---|---|---|---|---|---|
| A01 | TypeScript Compiler API의 `Program`과 `TypeChecker`로 TS/JS 코드를 분석한다 | `analyze.ts:199` `analyzeWithWorkspace`, `:307-308` | analyzer suite 21개 | IMPLEMENTED, TESTED[P0-1026] | 그대로 사용 가능 |
| A02 | tsconfig(paths, project references), barrel re-export, dynamic import를 따라 파일 간 선언을 해석한다 | `analyze.ts:473` `buildWorkspaceRoots`, `:2022`, `:771` `createModuleLocationResolver` | 테스트: path alias, barrel, dynamic import, sibling | IMPLEMENTED, TESTED (존재 단언) | 정량 정확도는 EXP-01 |
| A03 | 그래프는 노드 6종과 관계 5종으로 구성된다 | `protocol.ts:125`, `:151` | — | IMPLEMENTED | type/enum은 `interface`+`subkind`임을 명시 (baseline D1) |
| A04 | 활성 파일 중심 그래프이며, 다른 파일 대상은 external 노드로 표현된다 | `analyze.ts:969` `buildActiveFileGraph`, `:1578` `ensureExternalNode` | 테스트: sibling external | IMPLEMENTED, TESTED | 그대로 사용 가능 |
| A05 | 미저장 편집 내용을 즉시 분석에 반영한다 | `analyze.ts:270-305` | 테스트: `caches disk SourceFiles without mixing active unsaved text` | IMPLEMENTED, TESTED | 그대로 사용 가능 |
| A06 | React/Vue/Express/NestJS 의미를 adapter 구조로 확장한다 | `adapters/types.ts` `FrameworkSemanticAdapter`, `adapters/index.ts` | 테스트 React 3, Vue 3, Express 2, Nest 1 | IMPLEMENTED, TESTED (존재 단언) | 지원 범위 한정 서술(Vue는 TS 내 Composition API, `.vue` 제외). 정확도는 EXP-01 |
| A07 | Graph depth 0–3으로 탐색 범위를 확장한다 | `CodeGraphPanel.ts:68`, `:1384-1541` | 없음 | IMPLEMENTED | depth ≥2가 파일마다 Program을 재생성함을 명시. 성능은 측정되지 않음 |
| A08 | VS Code Extension과 React(ReactFlow) Webview로 시각화한다 | `extension.ts:44-50`, `webview/html.ts`, `webview-ui/src/*` | Extension sample test 1개(기능 무관) | IMPLEMENTED | UI는 자동 테스트가 없다. 화면 캡처·시연은 정성 근거로만 사용 |
| A09 | Trace mode로 그래프 구성 과정을 재생한다 | `CodeGraphPanel.ts:126`, `:142`, analyzer `trace` 배열 | 없음 | IMPLEMENTED | 정성 서술만 |
| A10 | Runtime Debug에서 정지 프레임을 그래프 노드에 매핑한다 | `runtimeDebug.ts:146` `RuntimeDebugBridge`, DAP `:372`, `:433`, `:498` | 없음 | IMPLEMENTED | 정성 서술만. 정량 평가 대상 아님 |
| A11 | JSON/JPG/SVG export | `CanvasPane.tsx:3010-3019`, `CodeGraphPanel.ts:1543` | 없음 | IMPLEMENTED | 정성 서술만 |
| A12 | Scaffold Lab이 그래프 설계로 코드 패치를 생성한다 | `codegen/index.ts:46` `buildPatchPreview` | codegen 3개 | IMPLEMENTED, TESTED | 그대로 사용 가능(범위 한정) |

## B. 캐시 설계

| ID | 논문의 주장 | 근거 소스코드 | 테스트·실험 | 현재 상태 | 논문 사용 가능 문구 / 추가 작업 |
|---|---|---|---|---|---|
| B01 | 3계층 캐시: full result(40, LRU), disk SourceFile(800, LRU, mtime/size/scriptKind/languageVersion 검증), 파일 목록(10 s TTL, 4000 상한) | `CodeGraphPanel.ts:35`, `:1020-1035`, `:1274-1353`; `analyze.ts:37`, `:579-722` | SourceFile cache 테스트 1개 | IMPLEMENTED, TESTED(SF 재사용만) | "근사 LRU(ms 타임스탬프)"로 정확히 기술 |
| B02 | 활성 파일은 disk cache를 거치지 않는다 | `analyze.ts:286-294` | 동일 테스트 | IMPLEMENTED, TESTED | 그대로 사용 가능 |
| B03 | 파일·설정·tsconfig 변경 시 캐시를 무효화한다 | `CodeGraphPanel.ts:581`, `:607`, `:637-685`, `:813` | 없음 | IMPLEMENTED | 문서 변경마다 result cache 전체 clear 사실을 함께 서술 |
| B04 | 단일 설정으로 두 캐시를 켜고 끈다 | `package.json` `cogic.analysisCache.enabled`, `CodeGraphPanel.ts:1394-1429` | 없음 | IMPLEMENTED | 그대로 사용 가능 |

## C. 성능·확장성

| ID | 논문의 주장 | 근거 소스코드 | 테스트·실험 | 현재 상태 | 논문 사용 가능 문구 / 추가 작업 |
|---|---|---|---|---|---|
| C01 | Cogic active-edit에서 SF cache가 p50 분석 시간을 1088.25 → 366.03 ms(−66.4%)로 줄였다 | 측정: `benchmark-analysis-cache.mjs:509-612` | 기존 벤치마크 | **MEASURED[HIST-0829]**, 미재현. 원시 표본 없음, 단일 환경 1회 | "과거 단일 환경 1회 측정에서 …"로만 사용. **EXP-02 재현 필요**: 방법·효과 방향·크기 호환성을 따로 판정한다. 과거 표본이 없어 동일 성능 재현은 확정할 수 없다([EXP-02 §9](experiments/exp-02-cache-performance.md#9-statistical-analysis)) |
| C02 | Full result 모드 active-edit 378.67 ms(−65.2%) | 동일 | 동일 | MEASURED[HIST-0829] | result cache 효과가 아님(hit 0). 그렇게 서술하면 안 된다 |
| C03 | Repeated Full result에서 99.5% 감소 | 동일 | 동일 | MEASURED[HIST-0829], best-case | 상한값으로만. 실제 편집에서는 일어나지 않음(B03) |
| C04 | 캐시 ON/OFF 분석 결과가 동일하다 | `benchmark-analysis-cache.mjs:677-737` | 기존 correctness 12건 | MEASURED[HIST-0829], **cold 경로만** | "캐시 활성 cold 경로에서 동일". hit 경로는 **EXP-02 Phase D** |
| C05 | cold 분석에서 캐시는 2–12% 오버헤드를 만든다 | 동일 | 동일 | MEASURED[HIST-0829] | 순서 편향·잡음 크기와 비슷하다. EXP-02 P-robust 필요 |
| C06 | 합성 1000/2000에서 SF hit 0, ON이 7–14% 느리다 | 동일 | 동일 | MEASURED[HIST-0829] | 관찰 사실로 사용 가능. 원인은 C08 |
| C07 | 분석 1회당 SF 요청 수 = N + 159 (synthetic), cogic 172 | 원시 hit+miss / 30 | 기존 데이터 + P0 probe | MEASURED[HIST-0829] + MEASURED[P0-PROBE](cogic 172 일치) | 사용 가능 |
| C08 | 대규모 hit 0의 원인은 W > C에서의 순환 접근 LRU 스래싱이다 | `analyze.ts:710-722` | — | **INFERRED** (요청 순서 동일성은 P0-PROBE로 확인) | **EXP-03** 기준 1–5 충족 시 주장 |
| C09 | cogic 분석 1회의 SF 요청 172건 중 90.1%(건수 기준)가 lib/@types 선언 파일이다 | probe | `data/p0/sourcefile-request-probe-20261026.json` | MEASURED[P0-PROBE] (count만) | "요청 건수 비중"으로만 사용 가능(cogic 대상 한정). 시간 기여도로 읽으면 안 된다 |
| C09a | SF cache 시간 단축의 대부분은 선언 파일 재파싱 회피에서 온다 | `analyze.ts:579-722` | — | **INFERRED** (요청 비중 C09에서 추론, 파일별 시간 미측정) | "가능성이 있다"로만 서술. 확정하려면 요청별 파싱 시간 측정 필요([existing-benchmark-audit.md §8](existing-benchmark-audit.md#8-추가-측정이-필요한-항목) 8번, 미배정) |
| C10 | zero-hit 조건의 ON 지연은 stat·정렬·GC 비용 때문이다 | `analyze.ts:613-623`, `:710-722` | — | INFERRED | EXP-03 RQ3-4 |
| C11 | 용량을 늘리면 대규모 workspace에서 hit가 회복된다 | — | — | INFERRED (LRU 이론) | EXP-03 H3-2 (용량 주입 필요) |
| C12 | 캐시는 메모리를 X MB 사용한다 | — | — | PLANNED | EXP-03 H3-6 |
| C13 | 사용자 체감(end-to-end) 지연이 개선된다 | — | — | **근거 없음** | 주장 금지. 필요하면 별도 실험(범위 밖) |

## D. 분석 정확도

| ID | 논문의 주장 | 근거 소스코드 | 테스트·실험 | 현재 상태 | 추가 작업 |
|---|---|---|---|---|---|
| D01 | calls/constructs 정확도 P/R/F1 | `analyze.ts:2020-2125`, `:2232-2260` | — | PLANNED | EXP-01 |
| D02 | references 정확도 (같은 파일 한정) | `analyze.ts:1912-1972` | 테스트 2개(존재 단언) | PLANNED | EXP-01, in-scope/overall 병기 |
| D03 | dataflow 정확도 | `analyze.ts:1999-2017` | 없음 | PLANNED | EXP-01 |
| D04 | updates(React/Vue 상태) 정확도 | `analyze.ts:2053`, `:2263-2310` | 테스트 2개 | PLANNED | EXP-01 |
| D05 | 프레임워크 route/hook owner 정확도 | `adapters/*.ts` | 테스트 9개 | PLANNED | EXP-01 |
| D06 | 지원하지 않는 패턴 목록 | 코드 근거(baseline §1.3, K3, K4) | — | IMPLEMENTED(코드 근거 목록) | EXP-01에서 정량화 |

## E. 사용 금지·주의 자료

| 자료 | 상태 | 처리 |
|---|---|---|
| 2026-04 중간보고서의 구현·성능 서술 | HISTORICAL | 구현 근거로 사용하지 않는다. 인용하려면 현재 코드·데이터로 재확인한다 |
| README 성능 문장 "1.09 s to 0.38 s" | MEASURED[HIST-0829] 기반 문장, 모드 혼동 | 논문에는 원시 데이터 값과 모드를 직접 인용한다 |
| `docs/benchmarks/analysis-cache/*` 해석 문장 | 스크립트 하드코딩 | 표 값만 인용하고 해석은 이 문서 기준으로 다시 쓴다 |
