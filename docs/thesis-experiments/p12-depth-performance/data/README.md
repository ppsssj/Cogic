# 데이터

| 파일 | 생성 | 내용 |
|---|---|---|
| `pilot-h1-d2-cold.json` | Codex, v1 도구 | Hono D2 pilot(11.2 s). Cogic 빌드 리비전 미기록 |
| `pilot-v1-d2-cold.json` | Codex, v1 도구 | Vite D2 pilot **중단**(`ABORT_LOW_MEMORY:683MB`, 36.2 s, 분석 9회 후) |
| `pilot-v1-d2-cold-heap768.json` | Codex, v1 도구 | Vite D2 pilot 재시도 완료(100.3 s) |
| `pilot-v1-memory.jsonl` | Codex, `monitor.ps1` | 위 재시도의 1초 간격 메모리(29표본, 마지막 약 57 s 구간) |
| `v2/*.json` | 이번 단계, v2 도구 | 실행 23건(중단 1건 포함). 파일명 `<h1|v1>-d<depth>-<cache>-<mode>-r<n>.json`. mode: `instr`(기준 계측), `uninstr`(계측 OFF), `shared`(Program+checker 공유), `oldprogram`(oldProgram만), `oldsf`(구조 재사용) |
| `v2/graph-diff/*.json` | `tools/graph-diff.cjs` | 기준 대비 그래프 차이(경로는 `<projects>/`, `<cogic>/`로 치환) |
| `summary-runs.csv` | `tools/summarize.cjs` | 실행별 한 행(pilot 포함) |
| `summary.json` | `tools/summarize.cjs` | 조건별 요약(완료된 v2 실행만) |
| `verification/npm-test-summary.txt` | 이번 단계 | `npm test` 결과 요약 |

각 실행 JSON의 `records[0]` 필드: `analyses[]`(파일별 `analyzeWorkspaceActive` 시간·그래프 크기·캐시 상태·메모리), `programs[]`(Program별 생성 시간, 호스트 콜백 분해, 구조 재사용 여부), `merges[]`, `cacheEvents`, `graphHash`, `peakRSSMB`. 최상위 `totals`는 중첩 구간이라 합산하면 안 된다([methodology.md §2.2](../methodology.md)).

그래프 덤프 원본은 크기와 로컬 절대 경로 때문에 저장소에 넣지 않았다(재현 절차로 다시 만들 수 있다).
