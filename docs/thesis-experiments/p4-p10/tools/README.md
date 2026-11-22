# tools — 측정·분석 스크립트 (공개용 사본)

연구 중 사용한 스크립트의 사본이다. 로컬 절대 경로는 다음 자리표시자로 바꾸었다. 실행하려면 로컬 경로로 다시 지정해야 한다.

| 자리표시자 | 의미 |
|---|---|
| `<COGIC_REPO>` | 빌드된 Cogic 저장소(`out/analyzer` 포함) |
| `<RESULTS>` | 결과 저장 폴더 |
| `<HARNESS_WORKDIR>` | UI 자동화 하네스 작업 폴더(이 저장소에 없음) |
| `<P4_BACKUP_DIR>` | P4 fixture가 들어 있는 폴더 |

| 폴더 | 내용 |
|---|---|
| `harness-specs/` | Playwright 스펙(P5 편집·Refresh, P6 UI 응답, P8 가시성·추적·대규모·조작). 하네스의 `e2e/lib/`가 필요하다 |
| `trace-analysis/` | Chromium 추적 분석: T0–T6b 정렬(`trace-analyze.cjs`), 긴 작업 분해, 스레드 점유, GPU 시계열, 타임라인 SVG |
| `cache-benchmark/` | Node 분석·캐시 벤치마크(P6 `p6-*.cjs`, P9 정책 비교 `*-p9.cjs`) |
| `summaries/` | 요약·비교 스크립트, 메모리 게이트를 포함한 UI 측정 1회 실행 래퍼 |

측정 원칙(이벤트 주입 없음, 수동 관찰, 정확성 검증 후 통계, 실패 실행 보존)은 [../08-environment-and-reproduction.md](../08-environment-and-reproduction.md)를 참고한다.
