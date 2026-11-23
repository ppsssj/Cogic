# P14-A — 정적 분석 정확도 감사

기준 제품 소스는 `github/main`의 `fdaecd4fd03b0b91cf4c83ea7f4e9ad00db58640`이다. P14-A는 제품 코드와 기존 GT·P13 결과를 수정하지 않는다. Hono H2는 결과를 이미 본 사후 진단 사례이며 확증 코퍼스에 포함하지 않는다.

| 상태 | 결과 |
|---|---|
| **VERIFIED** | Corpus A GT 214개와 개정 평가 도구 227개 manifest 일치; fixture 44개 검증 오류 0건. Corpus B 601개 manifest와 20개 사례 검증, P1-L 원시 예측 재채점 요약 일치. |
| **PROVISIONAL** | Corpus B의 P1-L 값은 AI 작성 GT와 미완료 사람 검토에 의존한다. 과거 두 analyzer의 결과이며 현재 main 정확도가 아니다. |
| **DIAGNOSTIC** | 현재 main의 Corpus A 44개 실행과 Hono H2 분석기 원출력을 별도로 점검했다. H2 호출 누락·owner 오귀속을 최소 예제로 재현했다. |
| **BLOCKED** | 현재 main은 기존 runner의 baseline 동일성 게이트에 실패했다. 현재 버전의 공식 P/R/F1 보고와 확증 주장에는 새 평가 프로토콜과 사람 GT 검토가 필요하다. 완화 채점의 중복 판정도 검토가 필요하다. |

[기준과 출처](baseline-and-provenance.md) · [GT 감사 및 방법](ground-truth-audit.md) · [Corpus A](results-corpus-a.md) · [Corpus B](results-corpus-b.md) · [Hono H2](hono-h2-diagnostic.md) · [재현](reproduction.md)
