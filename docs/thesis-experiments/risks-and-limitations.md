# Risks and Limitations

심각도: **H** = 결론을 뒤집거나 데이터를 잃을 수 있음, **M** = 해석 범위를 제한함, **L** = 기록·보완으로 충분함.

## 1. 데이터·절차 위험

| ID | 위험 | 근거 | 심각도 | 대응 | 단계 |
|---|---|---|---|---|---|
| R-01 | `npm run benchmark:cache`가 `docs/benchmarks/analysis-cache/` 7개 파일을 무조건 덮어쓴다 | `benchmark-analysis-cache.mjs:210-240` | **H** | 기존 스크립트 실행 금지. 신규 도구는 출력 경로를 강제하고 원본 해시를 대조한다([reproducibility.md §3](reproducibility.md#3-과거-산출물-무결성)) | P2 전 |
| R-02 | 결과 문서의 해석 문장이 하드코딩되어 재실행 시 표와 모순될 수 있다 | `:866`, `:870`, `:985`, `:1034` | M | 신규 도구의 `summary.md`는 데이터에서만 생성한다 | P2 |
| R-03 | 과거 원시 데이터가 집계값뿐(반복별 표본 없음) | JSON `rows[].stats` | M | 신규 실험은 표본 저장. 과거와는 점추정 기준 비교 | P2 |
| R-04 | 과거 correctness 검증이 캐시 hit 경로를 거치지 않는다 | `:677-690` (clear 직후 1회 실행) | **H** | EXP-02 Phase D로 hit 경로를 검증한다. 그 전에는 "cold 경로 동일"로만 서술 | P2 |
| R-05 | 과거 실행 SHA(`d9faa02`)에 스크립트가 없었다(미커밋 실행, dirty 미기록) | `git show --stat fed34a0` | M | 신규 도구는 dirty 거부와 도구 SHA-256 기록 | P2 |
| R-06 | 과거와 현재 하드웨어·OS·Node가 모두 다르다 | [reproducibility.md §1](reproducibility.md#1-실행-환경-비교) | M | 상대 지표로 판정, Node 22 조건 추가. 원래 장비를 쓸 수 있으면 추가 실행 | P2 |
| R-07 | Cogic workload 파일 목록이 untracked 산출물에 좌우된다(84 → 61) | 순회 규칙 재실행 | L | 깨끗한 worktree 사용, 목록 해시 기록 | P2 |
| R-08 | VS Code 테스트 버전이 `stable`로 자동 갱신된다(이번에 1.143.1 다운로드) | `run-vscode-tests.mjs:16` | L | `VSCODE_TEST_VERSION` 고정 | 전 단계 |

## 2. 측정 타당성 위험

| ID | 위험 | 근거 | 심각도 | 대응 |
|---|---|---|---|---|
| R-11 | Full result 측정이 production 메서드가 아닌 등가 harness다 | `PanelEquivalentResultCache` vs `CodeGraphPanel.ts:1274-1353` | M | 논문에 명시. 키 정규화 차이(경로 처리)를 기록 |
| R-12 | production은 문서 변경 이벤트마다 result cache 전체를 비운다 | `CodeGraphPanel.ts:581`, `:820` | M | repeated Full hit(99.5%)는 실제 편집 흐름에서 일어나지 않는 상한임을 명시 |
| R-13 | SF cache 이득의 대부분이 lib/@types 선언 재파싱 회피다(cogic 90.1%) | P0 probe | M | 해석 문장에 반영. 대상별 요청 구성 표 제시 |
| R-14 | 합성 workspace가 상위 `node_modules/@types`를 자동 포함한다(L ≈ 159) | 요청 수 = N + 159 | M | L 실측·기록, EXP-03 H3-4로 분리 |
| R-15 | 측정은 analyzer 실행 시간이다. UI·debounce·`findFiles`는 제외된다 | harness 측정 구간 | M | "분석 실행 시간"으로 한정 서술. UX 개선 주장 금지 |
| R-16 | production 기본 depth는 0, 벤치마크는 depth 1, depth ≥2는 미측정 | `CodeGraphPanel.ts:282`, `App.tsx:683` | L | depth 0은 사후 prune만 추가되어 analyzer 비용이 같다(코드 근거). depth ≥2는 범위 밖으로 명시 |
| R-17 | production `findFiles`가 명시적 exclude로 `files.exclude` 기본값을 끄고 `.vscode-test` JS 7,828개를 포함할 수 있다 | `CodeGraphPanel.ts:1027-1031`, VS Code API 문서(INFERRED) | M | harness 목록과 production 목록의 차이를 기록. 검증은 VS Code 안에서 해야 하며 현재 범위 밖 |
| R-18 | 실행 순서 고정, 단일 프로세스, OS 파일 캐시 미초기화 | 기존 harness | M | P-robust(무작위·격리). 파일 캐시는 통제 불가로 명시 |
| R-19 | 8 GB 장비, P0 시점 가용 메모리 1.1 GiB | `os.freemem` | M | 측정 전 가용 ≥ 3 GB 확인, rss 기록 |
| R-20 | 전원 구성 "균형 조정" | `powercfg` | L | 고성능으로 측정 후 원복, 기록 |

## 3. 정확도 실험 위험

| ID | 위험 | 심각도 | 대응 |
|---|---|---|---|
| R-21 | GT 작성자가 개발자 본인이다(확증 편향) | **H** | blind 작성, 사전 등록 커밋, 2인 검토 ≥20% 또는 single-annotator 명시 |
| R-22 | fixture가 지원 패턴에 치우칠 위험 | M | 카탈로그에 unsupported·ambiguous·부정 사례 의무 포함, 실제 코드 표본 병행 |
| R-23 | 노드 매칭 규칙(줄 기반)이 결과를 좌우 | M | 규칙 사전 고정, strict/lenient 병기 |
| R-24 | `calls` 목록이 상위 60개로 잘린다 | L | 정확도와 정합성은 graph edges로 평가 |
| R-25 | 다른 파일 reference가 설계상 없다 | M | in-scope/overall 재현율 병기 |
| R-26 | shim 선언과 실제 패키지 타입이 다르다 | L | shim 고정, exploratory 비교 |

## 4. 구현 제약 (실험 결과에 직접 영향)

| ID | 제약 | 위치 | 영향 |
|---|---|---|---|
| R-31 | SF cache 용량이 상수라 주입할 수 없다 | `analyze.ts:37` | EXP-03 용량 실험 차단. 결정 필요([experimental-design.md §5](experimental-design.md#5-production-코드-변경-정책)) |
| R-32 | 근사 LRU: ms 해상도, hit 시 Map 순서 미갱신 | `analyze.ts:646`, `:715` | 순수 LRU 예측과 어긋날 수 있다. 재사용 거리로 대조 |
| R-33 | 용량 초과 상태에서 저장할 때마다 전체 엔트리를 정렬한다 | `analyze.ts:710-722` | zero-hit 조건에서 ON 지연의 후보 원인(INFERRED). EXP-03 RQ3-4 |
| R-34 | eviction 전용 이벤트가 없다 | `pruneDiskSourceFileCache` | `store.entries` 시퀀스로 유도 |
| R-35 | `ts.createProgram`에 `oldProgram`을 넘기지 않는다(증분 분석 없음) | `analyze.ts:307` | 캐시 효과를 "증분 분석"이라 부르면 안 된다 |

## 5. P0 자체의 한계

- 성능 벤치마크를 실행하지 않았다. 과거 수치는 재현되지 않은 상태다.
- probe는 cogic 대상 2회 분석의 count만 기록했다. 합성·zod 대상의 요청 구성(L의 내역)은 과거 count로부터의 추론이다.
- `npm run build:webview`/`build:all`은 실행하지 않았다(타입 검사·린트로 대체).
- R-17(`findFiles` 동작)은 VS Code API 문서에 근거한 추론이며, VS Code 안에서 검증하지 않았다.
- 원래 측정 장비(i5-4690)를 쓸 수 있는지는 확인하지 못했다.
