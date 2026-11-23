# Stage A 결과 — 4파일 예제 T1–T4 (P13 재측정)

도구마다 독립 실행 3회, 회차마다 도구 순서를 회전했다. **12회 실행 모두 끝났고(exit 0), 3회의 분류와 조작 수가 모두 같았다.** 예제 소스는 실행 전후 SHA256이 같았다. 원자료: [data/stage-a-summary.csv](data/stage-a-summary.csv), [data/stage-a-per-run.json](data/stage-a-per-run.json)

## 1. 분류
| 과제 | VS Code 기본 | Trace Function Flow 1.1.1 | Context Graph 0.10.9 | Cogic (main `cef96eb`) |
|---|---|---|---|---|
| T1 호출 관계 | SUPPORTED_AND_VERIFIED | PARTIALLY_SUPPORTED | ENVIRONMENT_BLOCKED | SUPPORTED_AND_VERIFIED |
| T2 인자 전달 | PARTIALLY_SUPPORTED | PARTIALLY_SUPPORTED | ENVIRONMENT_BLOCKED | SUPPORTED_AND_VERIFIED |
| T3 소스 이동·복귀 | SUPPORTED_AND_VERIFIED | SUPPORTED_AND_VERIFIED | ENVIRONMENT_BLOCKED | SUPPORTED_AND_VERIFIED |
| T4 디버그 프레임↔뷰 | UNSUPPORTED_BY_DESIGN | UNSUPPORTED_BY_DESIGN | ENVIRONMENT_BLOCKED | SUPPORTED_AND_VERIFIED |

## 2. 조작 수와 상태 유지 (스크립트 경로 기준, 3회 동일)
| 도구 | 과제 | 조작 | 파일 전환 | 복귀 조작 | 뷰 유지 | 시작점 유지 | 선택 유지 |
|---|---|---:|---:|---:|---|---|---|
| VS Code | T1 | 4 | 0 | | | | |
| VS Code | T2 | 6 | 2 | | | | |
| VS Code | T3 | 2 | 2 | 1 | 예(트리 동일) | 예 | 예 |
| VS Code | T4 | 5 | 1 | | 아니요(사이드바가 Run and Debug로 바뀜) | | |
| TFF | T1 | 6 | 1 | | | | |
| TFF | T2 | 1 | 0 | | | | |
| TFF | T3 | 5 | 2 | 4 | 예 | 아니요(runDemo가 그래프에 없음) | |
| TFF | T4 | 5 | 1 | | 예(패널 유지, 프레임 표시 없음) | | |
| Context Graph | T1–T3 | 2(패널+Generate) | 0 | | | | |
| Context Graph | T4 | 5 | 1 | | 그래프 없음 | | |
| Cogic | T1 | 6 | 0 | | | | |
| Cogic | T2 | 2 | 0 | | | | |
| Cogic | T3 | 2 | 2 | 1 | 예(노드 집합 동일) | 예(Root file 유지) | 예 |
| Cogic | T4 | 5 | 1 | | 예 | 예 | |

조작 수는 사전 등록 규칙(클릭·단축키·명령 실행·select 변경 각 1, Fit Graph 제외)으로 셌다. 사람의 탐색 비용이 아니라 스크립트에 정해진 경로의 비용이다.

## 3. 도구별 관찰 (UI 증거)
- **VS Code 기본**:
  - Call Hierarchy(outgoing) 4단계 트리에서 `runDemo > process > formatReceipt > formatMoney`를 확인했다.
  - 인자 전달은 Go to Definition으로 세 정의에 도달한 뒤 코드를 읽어야 한다. 기본 설정에서는 매핑을 보여 주지 않는다(inlay hint 꺼짐).
  - 디버거 Call Stack은 동적 호출 사슬을 정확히 보여 주지만, 정적 Call Hierarchy 뷰와 연결되지 않는다.
- **Trace Function Flow**:
  - `runDemo`에서 추적하면 "No outgoing calls found"가 나온다(클래스 정적 메서드 호출을 따라가지 않음). `formatReceipt`에서 별도로 추적해야 `formatMoney`가 보인다.
  - 상세 패널은 호출식 `formatMoney(total)`만 보여 준다.
  - 소스로 이동한 뒤 시작점 `runDemo`가 그래프에 없어서 Go Back 4회로 돌아왔다.
  - 디버거 연동 기능은 없다.
- **Context Graph**: 그래프를 만들지 못했다(worker 없음, [tools-and-versions.md](tools-and-versions.md)). 기능이 없다는 뜻이 아니라 **평가할 수 없었다**는 뜻이다.
- **Cogic**:
  - Depth 2와 파일 그룹 2개 펼침으로 세 호출 엣지가 보인다.
  - `dataflow` 엣지 `total <- 120`, `total <- total`, `amount <- total`과 Inspector PARAM FLOW로 인자 전달이 보인다.
  - 노드 더블클릭으로 이동하고 시작 노드 더블클릭으로 돌아와도 File Root·노드 집합·선택이 유지된다.
  - 디버깅 중 `receipt.ts:5:18` 프레임이 그래프 노드 `formatReceipt`에 "Matched by exact range"로 대응됐다.

## 4. P3(이전 비교)와 달라진 점
| 항목 | P3 (Cogic 0.0.5, VS Code 1.146.0, 다른 PC) | P13 (main `cef96eb`, 1.147.0) |
|---|---|---|
| Cogic T4 | 조건부 통과: 기본 File Root에서는 `outside-root`, Clear root 후에야 매핑됨. 조작 6 | **File Root를 유지한 채 매핑됨**(P4 수정 반영). 조작 5 |
| 나머지 | — | VS Code·TFF·Context Graph와 Cogic T1–T3의 분류와 조작 수는 P3 보고값과 같았다 |

P3 결과를 P13 측정값으로 간주하지 않으며, 위 비교는 두 측정을 나란히 놓은 것이다.
