# 프로파일링 결과

원자료: [data/summary-runs.csv](data/summary-runs.csv)(pilot 3건 + v2 23건, 중단 2건 포함), [data/summary.json](data/summary.json)(조건별 요약). 시간은 Node 진단 경로의 측정값이며 VS Code UI 시간이 아니다. 조건: cold SourceFile 캐시, `--max-old-space-size=768`, 계측 ON(따로 표시한 경우 제외).

## 1. Codex pilot (v1 도구, 이어받은 결과)

| 실행 | 상태 | 총시간 | Program | createProgram 합 | 비고 |
|---|---|---:|---:|---:|---|
| `pilot-h1-d2-cold` | completed | 11.2 s | 3 | 9.6 s | 그래프 85/207 |
| `pilot-v1-d2-cold` | **aborted** `ABORT_LOW_MEMORY:683MB` | (36.2 s에서 중단) | 9 | — | 분석 9회 후 중단. 레코드 없음, totals만 남음 |
| `pilot-v1-d2-cold-heap768` | completed | 100.3 s | 35 | 92.4 s | 1,078/3,755, 최고 RSS 875 MB |
| `pilot-v1-memory.jsonl` | 모니터 | 29표본(약 57 s) | — | — | Working Set 최대 829 MB, 가용 최소 828 MB, page-in 최대 409/s |

pilot은 오늘 측정보다 느리다(Hono 11.2 vs 7.8 s, Vite 100.3 vs 66.8–80.0 s). 당시 가용 메모리가 약 830–900 MB로 낮았고 page-in이 관찰됐다(INFERRED: 메모리 압박에 따른 지연). pilot의 Cogic 빌드 리비전은 알 수 없다([README.md](README.md)).

## 2. Depth별 기준 동작 (VERIFIED)

| 프로젝트 | Depth | 총시간 | `analyzeWorkspaceActive` 호출 | Program 생성 | createProgram 합 | frontier / 확장 | merge 횟수 | 노드 / 엣지 | 최고 RSS |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| hono (426 roots, Program 1,169 파일) | 0 | 4.73 s | 1 | 1 | 3.92 s | 2 / 0 | 0 | 10 / 14 | 510 MB |
| | 1 | 4.62 s | 1 | 1 | 3.81 s | 2 / 0 | 0 | 16 / 46 | 509 MB |
| | 2 (n=3) | **7.74 / 7.78 / 7.80 s** | 3 | 3 | 6.28–6.49 s | 2 / 2 | 2 (합 0.4 ms) | 85 / 207 | 617–715 MB |
| | 2 계측 OFF | 7.57 s | 3 | (3) | — | 2 / 2 | 2 | 85 / 207 | 728 MB |
| vite (1,654 roots, Program 2,296 파일) | 0 | 8.31 s | 1 | 1 | 7.20 s | 34 / 0 | 0 | 46 / 73 | 644 MB |
| | 1 | 5.69 s | 1 | 1 | 4.63 s | 34 / 0 | 0 | 153 / 412 | 633 MB |
| | 2 (n=2) | **69.2 / 80.0 s** | 35 | 35 | 62.1 / 71.9 s | 34 / 34 | 34 (합 24 / 26 ms) | 1,078 / 3,755 | 859–881 MB |
| | 2 계측 OFF | 66.8 s | 35 | (35) | — | 34 / 34 | 34 | 1,078 / 3,755 | 882 MB |

- Depth 0과 1은 분석 작업이 같다(Program 1개, 그래프 필터만 다름). Vite D0이 D1보다 느린 것은 실행 순서 효과다(D0을 먼저 실행해 OS 파일 캐시가 차가웠다; INFERRED).
- Program 크기는 rootNames보다 크다(hono 1,169 / 426, vite 2,296 / 1,654). lib와 `node_modules`의 `.d.ts` 때문이다(P11과 같은 현상).

## 3. Vite D2 기준 실행 분해 (r1, 69.2 s, VERIFIED)

| 구간 | 시간 | 비고 |
|---|---:|---|
| 활성 파일 분석 1회 | 5.69 s | 그중 createProgram 4.60 s |
| 확장 분석 34회 합 | 63.39 s | 중앙값 1.77 s/파일 |
| └ 확장 createProgram 34회 합 | 57.55 s | 중앙값 1.60 s |
| &nbsp;&nbsp;└ 모듈 해석 I/O 콜백 | 32.58 s | `directoryExists` 927,282회 16.7 s, `fileExists` 486,574회 10.3 s, `readFile` 21,080회 3.3 s, `realpath` 16,048회 2.3 s |
| &nbsp;&nbsp;└ `getSourceFile` | 15.33 s | 78,064회 = 2,296 × 34. 적중 시 `fs.statSync`, 실패 시 읽기+파싱 |
| &nbsp;&nbsp;└ TS 내부 CPU | 9.64 s | 해석 로직, Program 구조 구성 |
| └ 확장 분석 중 Program 외 34회 합 | 5.84 s | checker 생성 약 0.1 s/회, 호출 해석, 진단, 그래프 추출 |
| merge 34회 | 0.024 s | |
| JSON 직렬화 | 0.017 s | |

SourceFile 캐시(r1): hit 67,501 / miss 12,824 / skipFull 9,625 / evict 1,179. 캐시 용량은 rootNames 기준 `min(4400, max(800, 1.1×1654+200)) = 2,020`이라 Program 2,296 파일을 다 담지 못한다. 그래서 확장마다 약 370개 파일이 캐시에 들어가지 못하고(skipFull) 매번 다시 파싱된다.

중첩 구간(이중 계산 주의) — 35회 합: `checkerAcquisition` 3.34 s, `extractCalls` 2.16 s, `graphExtraction` 0.69 s, `diagnostics` 0.56 s. `checker.getResolvedSignature` 1.63 s(5,788회)는 앞의 두 구간 안에 포함된다.

Hono D2(r1) 확장 2회: createProgram 2.99 s 중 `getSourceFile` 1.76 s, 해석 I/O 0.76 s, TS 내부 0.46 s. Hono는 Program 1,169 파일에 캐시 용량 800이라 SourceFile 비중이 더 크다.

## 4. P12-B 후보 실측 (하네스 실험, VERIFIED)

| 프로젝트 D2 | 모드 | 총시간 | Program 생성 | 확장 createProgram 중앙값 | TS 구조 재사용 | 그래프 해시 | 기준과 같은가 | 최고 RSS |
|---|---|---:|---:|---:|---|---|---|---:|
| hono | 기준 | 7.74–7.80 s | 3 | 1.47 s | — | `45ea10…` | — | 617–715 MB |
| hono | `1` Program+checker 공유 | 4.43 s | 1 (+2 재사용) | — | — | `45c635…` | **아니오**(노드 1개 시그니처) | 513 MB |
| hono | `old` oldProgram만 | 9.76 s | 3 | 2.38 s | `Not` | `45ea10…` | 예 | 808 MB |
| hono | `old-sf` 구조 재사용 | **4.47 / 3.74 s** | 3 | **0.03–0.04 s** | `Completely` | `45ea10…` | **예** | 532–534 MB |
| vite | 기준 | 69.2 / 80.0 s (OFF 66.8 s) | 35 | 1.60 / 1.92 s | — | `3f9848…` | — | 859–882 MB |
| vite | `1` Program+checker 공유 | 9.56 / 9.16 s | 1 (+34 재사용) | — | — | `e2c949…` | **아니오** | 696 MB |
| vite | `old` oldProgram만 | 90.5 s | 35 | 2.17 s | `Not` | `3f9848…` | 예 | 873 MB |
| vite | `old-sf` 구조 재사용 | **12.60 / 12.20 s** | 35 | **0.06 s** | `Completely` | `3f9848…` | **예** | 803–804 MB |

`old-sf` Vite r1 분해: 활성 파일 분석 7.02 s, 확장 34회 합 5.46 s(중앙값 0.12 s/파일), 그중 createProgram 합 2.36 s, 나머지(checker 생성 + 분석) 3.10 s.

## 5. 공유 checker의 그래프 차이 (VERIFIED)

[data/v2/graph-diff/vite-d2-baseline-vs-shared-checker.json](data/v2/graph-diff/vite-d2-baseline-vs-shared-checker.json)

| 종류 | 개수 | 예 |
|---|---:|---|
| 노드 텍스트 변경 | 11 | 유니언 멤버 순서 `{ encoding…} \| BufferEncoding` ↔ `BufferEncoding \| {…}`(시그니처 10), 수신자 타입 이름 `Buffer.toString` → `string \| NonSharedBuffer.toString`(1) |
| 기준에만 있는 노드 | 1 | `console.d.ts:14401` |
| 엣지 대상 변경 | 7 ↔ 8 | `console.*` 호출이 다른 선언(`console.d.ts:10117` ↔ `:14606`)으로 해석됨. `windowsSafeRealPathSync` 안 `safeRealpathSync(input)` 호출이 `windowsNativeRealpathSync`가 아니라 **자기 자신**으로 해석됨. 공유 쪽에만 `openBrowser → Buffer.toString` 엣지 |

Hono는 노드 1개(`resolveCallback` 시그니처 `phase: 2 | 1 | 3` ↔ `1 | 2 | 3`)만 다르다. 두 모드 모두 반복 실행 결과가 같아 무작위 잡음이 아니다. 같은 checker가 앞 파일을 검사하며 만든 타입 ID·시그니처 캐시·흐름 분석 캐시가 뒤 파일의 결과를 바꾼 것이다(INFERRED 메커니즘, VERIFIED 결과).

## 6. 캐시 정합성 (VERIFIED)

| Hono D2 | 총시간 | 캐시 이벤트 | 해시 |
|---|---:|---|---|
| cache off | 9.42 s | disabled 3,504 | `45ea10…` |
| cold | 7.74–7.80 s | hit 1,598 / miss 1,906 / skipFull 1,104 | `45ea10…` |
| warm(같은 프로세스 2회째) | 4.03 s | hit 2,350 / miss 1,154 | `45ea10…` |

## 7. 메모리

| 조건 | 최고 RSS | 비고 |
|---|---:|---|
| Vite D1 | 633 MB | Program 1개 |
| Vite D2 기준 | 859–882 MB | Program을 35번 만들고 버림(GC) |
| Vite D2 `old-sf` | 803–804 MB | 직전 Program 1개를 더 붙잡지만 기준보다 낮음 |
| Vite D2 공유 checker | 696 MB | Program 1개 |

시스템 가용 메모리는 측정 중 0.47–2.2 GB였다. 500 MB 기준 중단 1건(Hono), Codex pilot 중단 1건(Vite, 683 MB).
