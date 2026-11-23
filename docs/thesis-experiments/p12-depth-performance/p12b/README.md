# P12-B — Depth Program Session 구현과 검증

- 브랜치 `perf/p12b-program-session`, 제품 코드 커밋 `3f03334`, 기준 `7469baf`(P12-A main)
- 설계 근거: [../architecture-proposal.md](../architecture-proposal.md) 후보 1b, [../optimization-roadmap.md](../optimization-roadmap.md) 1순위

## 요약

| | 결과 |
|---|---|
| 구현 | Depth ≥ 2 실행마다 `AnalysisSession` 1개. 파일마다 새 Program·새 TypeChecker를 만들되 직전 Program을 `oldProgram`으로 넘기고, 바뀌지 않은 디스크 SourceFile을 돌려준다. **TypeChecker 공유 없음** |
| 정합성 | hono·vite Depth 0/1/2 모두 기준(`7469baf`)·세션 OFF·세션 ON의 그래프가 **바이트 단위로 동일**(실행 25건) |
| 성능 (Node, 제품 함수) | **Vite D2 65.6 s → 11.1 s (5.9배, −83%)**, Hono D2 6.8 s → 3.9 s (1.8배, −43%). D0/D1 변화 없음 |
| Program 비용 | Vite 확장 Program 1.55 s → 0.086 s, TS 구조 재사용 `completely` 34/34. createProgram 합 58.8 s → 7.5–7.8 s |
| 메모리 | 최고 RSS Vite D2 882 → 801–804 MB, Hono D2 617–719 → 534 MB |
| 테스트 | `npm test` 76 passing / 0 failing (신규 24) |
| 미검증 | VS Code UI 응답 시간, Depth 3, `createProgram` 예외 대체 경로의 실제 유도 |

## 문서
| 문서 | 내용 |
|---|---|
| [implementation.md](implementation.md) | 변경 파일, 동작, 무효화 규칙과 테스트 대응 |
| [results.md](results.md) | 정합성, 시간, Program 비용, 메모리, 남은 위험, P12-C 후보 |
| [reproduction.md](reproduction.md) | 환경, 명령, 조건 정의, 해시 정규화 |
| `data/runs/` | 실행별 원자료(`<project>-d<depth>-<base|off|on>-r<n>.json`) |
| `data/summary-runs.csv`, `data/summary.json` | `tools/summarize-p12b.cjs` 출력 |
| `data/verification/npm-test-summary.txt` | `npm test` 결과 |
| `tools/` | `profile-depth-product.cjs`(문자열 치환 없이 제품 경로 측정), `run-matrix.sh`, `summarize-p12b.cjs` |

P12-A 원자료(`../data/`)와 도구(`../tools/`)는 변경하지 않았다. P12-A v2 도구의 후보 모드(`--share-program`) 결과는 P12-B 제품 성능으로 쓰지 않았다.
