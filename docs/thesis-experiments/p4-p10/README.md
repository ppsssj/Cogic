# Cogic Thesis Experiments — P4–P10: 회귀 검증, UI 성능, 캐시 개선

이 폴더는 P4(디버깅 중 탐색 상태 유지 수정) 이후 P5–P10에서 수행한 검증·측정·개선 실험의 공개 정리본이다. 원본 보고서와 원시 데이터는 연구용 로컬 저장소에 보존되어 있고, 여기에는 재현과 검토에 필요한 요약 데이터·도구·그림만 담았다(큰 Chromium 추적 파일, 로컬 경로, 스크린샷은 제외).

## 이 브랜치에 포함된 코드와 실험 버전의 관계

| 버전 | 커밋 | 상태 | 이 폴더에서의 역할 |
|---|---|---|---|
| Baseline | `a9d95aa` | 기존 main(Marketplace 0.0.5 게시 이후 커밋을 포함할 수 있어 게시본과 동일하다고 확인하지 않음) | 비교 기준 |
| P4 | `9126f35` Preserve graph exploration during runtime debugging | **이 PR에 포함** | Root·Runtime Debug 회귀 기준 |
| **안정 버전(채택)** | `e753f5e` Avoid SourceFile cache thrash on large workspaces | **이 PR에 포함** | P10 최종 채택안 |
| Fit 가시성 개선 | `c951ccb` | 불채택(실험 증거로 보존) | [07](07-rejected-optimizations.md) |
| Fit v2 | `e7abe4e` | 불채택 | [07](07-rejected-optimizations.md) |
| 전체 요소 렌더링 | `56c317e` | 불채택 | [06](06-graph-interaction.md), [07](07-rejected-optimizations.md) |
| 미변경 노드 재사용 / 이동 중 전체 렌더 | `f2a60fc` / `f65ea4f` | 불채택 | [07](07-rejected-optimizations.md) |

불채택 커밋은 이 PR의 코드에 들어 있지 않다. 이 폴더의 표에서 각 수치가 어느 버전의 것인지 항상 함께 적었다.

**커밋 ID 대응**: 이 폴더와 원본 실험 기록의 커밋 ID는 연구 당시 로컬 ID다. 공개 브랜치에서는 작성자 이메일을 비공개 주소로 바꾸기 위해 두 커밋을 다시 작성했다. 파일 내용(git tree)은 같다.

| 연구 당시 ID | 공개 브랜치 ID | 내용 |
|---|---|---|
| `9126f35` | `396923c` | Preserve graph exploration during runtime debugging |
| `e753f5e` | `58105e2` | Avoid SourceFile cache thrash on large workspaces |

불채택 실험 커밋(`c951ccb`, `e7abe4e`, `56c317e`, `f2a60fc`, `f65ea4f`)은 공개 저장소에 올리지 않았다.

**채택 버전에 적용되는 측정**
- 분석기(`src/analyzer`) 코드는 채택 버전과 P9 최종 실험 빌드(`56c317e`)가 동일하므로, P9의 Node 캐시 측정(최종 코드 검증)이 채택 버전에 그대로 적용된다.
- 웹뷰 코드는 채택 버전과 P4(`9126f35`)가 동일하므로, P8의 그래프 조작 측정(Baseline = 9126f35)이 채택 버전의 조작 성능이다.
- 실제 UI 응답 시간은 P10에서 채택 버전 자체를 Baseline과 직접 비교했다.

## 문서

| # | 문서 | 내용 |
|---|---|---|
| 01 | [01-goals-and-problem.md](01-goals-and-problem.md) | 연구 목표, Cogic의 핵심 문제 정의, P4–P10 단계 요약 |
| 02 | [02-tool-comparison.md](02-tool-comparison.md) | VS Code·비교 도구와의 기능·탐색 방식 비교, P4 수정 전후 회귀 |
| 03 | [03-static-analysis-cache.md](03-static-analysis-cache.md) | 정적 분석 성능, SourceFile 캐시 문제와 개선 전후 |
| 04 | [04-ui-response-time.md](04-ui-response-time.md) | 실제 VS Code에서 그래프 생성·갱신 응답 시간 |
| 05 | [05-rendering-trace-method.md](05-rendering-trace-method.md) | Chromium Paint·presentation feedback 측정 방법과 결과 |
| 06 | [06-graph-interaction.md](06-graph-interaction.md) | Pan·Zoom·그룹 펼침·접기·선택 성능과 병목 분석 |
| 07 | [07-rejected-optimizations.md](07-rejected-optimizations.md) | P9/P10에서 채택하지 않은 최적화와 성능 상충관계 |
| 08 | [08-environment-and-reproduction.md](08-environment-and-reproduction.md) | 실험 환경, 반복 횟수, 재현 명령 |
| 09 | [09-limitations.md](09-limitations.md) | 측정 한계와 미완료 검증 항목 |

`data/`(단계별 요약 CSV·JSON), `figures/`(SVG·PNG), `tools/`(측정·분석 스크립트, 경로는 자리표시자로 치환)를 함께 둔다.

## 읽기 전 주의
- 모든 측정은 **한 대의 Windows PC**(i5-9400F, RAM 8 GB, NVIDIA GT 710)에서 수행했다. 절대값은 하드웨어에 따라 달라진다.
- 반복은 대부분 조건당 **독립 실행 3회**이다. 사전에 정한 "3 대 3 완전 분리" 규칙으로 방향만 판정했으며, **통계적 유의성을 검정하거나 입증한 것이 아니다.**
- UI 시간은 별도 표시가 없으면 **프레임 콜백 기준**(그래프 DOM 반영 후 두 번째 `requestAnimationFrame`)이며, 실제 화면 표시 시각이 아니다.
- **사용자 연구와 독립적인 Corpus B 정답 검토는 수행하지 않았다.** 자동화 결과를 사람의 코드 이해도 향상으로 해석하지 않는다.
- 이 PR의 코드는 **아직 출시되지 않았다.** Marketplace의 0.0.5와 이 브랜치의 코드는 다를 수 있다.
