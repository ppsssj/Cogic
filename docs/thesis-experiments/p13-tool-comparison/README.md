# P13 — 경쟁 도구 비교와 실제 코드 탐색 시나리오 검증

Cogic(main `cef96eb`)을 VS Code 기본 기능, Trace Function Flow 1.1.1, Context Graph 0.10.9와 실제 VS Code UI에서 같은 과제로 비교했다. 과제·정답·기준은 측정 전에 커밋했다. **사용자 연구는 하지 않았다.** 조작 수는 스크립트 경로 기준이다.

## 도구별 기능 지원 비교 (대표 분류, 3회 모두 동일)
| 과제 | VS Code 기본 | Trace Function Flow | Context Graph | Cogic |
|---|---|---|---|---|
| A-T1 호출 관계(예제) | 검증 | 부분 | 환경 차단 | 검증 |
| A-T2 인자 전달(예제) | 부분 | 부분 | 환경 차단 | **검증** |
| A-T3 이동·복귀(예제) | 검증 | 검증 | 환경 차단 | 검증 |
| A-T4 디버그 프레임↔뷰(예제) | 설계상 미지원 | 설계상 미지원 | 환경 차단 | **검증** |
| B-R1 호출 경로(H1/H2/V1/V2) | 검증/실패/검증/검증 | 검증/실패/검증/검증 | 환경 차단 | 검증/부분/**실패**/부분 |
| B-R2 인자 전달 | 부분 ×4 | 부분/실패/실패/실패 | 환경 차단 | **검증**/실패/**검증**/**검증** |
| B-R3 이동·복귀 | 검증/실패/검증/검증 | 검증/실패/실패/실패 | 환경 차단 | 검증/검증/**실패**/**실패** |

상세: [results-synthetic.md](results-synthetic.md) (Stage A), [results-real-world.md](results-real-world.md) (Stage B)

## 핵심 결과
1. **인자→매개변수 전달을 구간별로 보여 준 도구는 Cogic뿐이었다**: 예제 3/3 구간, 실제 과제 4개 중 3개(H1, V1, V2)에서 모든 구간을 확인했다. VS Code는 정의 이동 후 코드 읽기, TFF는 호출식 표시까지만 가능했다.
2. **디버그 프레임과 정적 그래프 연결은 Cogic만 제공했다**(예제 T4, File Root 유지 상태에서 "Matched by exact range"). VS Code Call Stack은 정확하지만 구조 뷰와 연결되지 않는다.
3. **대형 그래프에서는 Cogic이 VS Code·TFF보다 약했다**: vite V1·V2에서 Depth 2 Generate에 약 4–6.5분이 걸렸다. Fit 상태에서 경로 노드가 그려지지 않아 호출 경로 표시와 노드 이동에 실패하거나 일부만 성공했다. VS Code Call Hierarchy와 TFF는 같은 경로를 보여 줬다.
4. **클래스 속성 화살표 함수와 private 메서드 경로(H2)는 세 도구 모두 끝까지 잇지 못했다.** Cogic은 함수를 표시했지만 호출 엣지가 없었다.
5. **Context Graph는 Windows x64용 worker가 패키지에 없어 평가하지 못했다(ENVIRONMENT_BLOCKED).**

## 논문에 쓸 수 있는 주장 / 쓸 수 없는 주장
| 쓸 수 있음 (근거 있음) | 쓸 수 없음 |
|---|---|
| 비교한 도구 중 인자 전달을 구간별 매핑으로 표시한 것은 Cogic뿐이었다(예제 + 실제 3개 과제, UI 증거) | Cogic이 개발자의 이해를 빠르게 하거나 생산성을 높인다(사용자 연구 없음) |
| 디버그 중 현재 프레임을 정적 그래프 노드로 식별하는 기능은 비교 도구 중 Cogic만 제공했다(예제) | 실제 프로젝트에서의 디버그 연계(측정 안 함) |
| 소스 이동 후 그래프·Root·선택이 유지된다(예제, hono) | Cogic이 모든 탐색 과제에서 우수하다 — vite 대형 그래프와 H2에서 실패·부분 |
| 정해진 경로 기준 조작 수와 상태 유지 비교 | 조작 수 차이가 사람의 탐색 비용 차이와 같다 |
| Context Graph는 이 Windows 환경에서 실행되지 않았다 | Context Graph에 해당 기능이 없다 |

## 문서
[research-questions.md](research-questions.md) · [tools-and-versions.md](tools-and-versions.md) · [task-definitions.md](task-definitions.md) · [methodology.md](methodology.md) · [results-synthetic.md](results-synthetic.md) · [results-real-world.md](results-real-world.md) · [limitations.md](limitations.md) · [reproduction.md](reproduction.md) · 사전 등록: [A](preregistration-stage-a.md), [B](preregistration-stage-b.md), [B 보완](preregistration-stage-b-addendum.md)
