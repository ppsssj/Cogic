# 02. 비교 도구와의 기능·탐색 방식 비교, P4 회귀

## 1. 도구 비교 (이전 실험 결과 인용 — P4–P10 기간에 재실행하지 않음)
출처: P3/P4 단계의 UI 자동화 하네스 비교 결과(별도 PC, VS Code 1.146.0, 3회 반복, 3회 모두 같은 상태·조작 수). 같은 실험 프로젝트(`src/demo.ts`의 `runDemo` → `CheckoutDemo.process` → `formatReceipt` → `formatMoney`)에서 과제 T1–T4를 도구별로 수행했다.

| 과제 | VS Code 기본 | Trace Function Flow 1.1.1 | Context Graph 0.10.9 | Cogic |
|---|---|---|---|---|
| T1 호출 관계 | 지원(Call Hierarchy 4단계) | 부분(진입 함수에서 호출 0개) | 미확인(Windows 실행 파일 없음) | 지원(Depth 2) |
| T2 인자 전달 경로 `120 → total → amount` | 부분(정의 이동 후 코드 읽기) | 부분(호출 지점 식만) | 미확인 | 지원(dataflow 엣지 3/3 + PARAM FLOW) |
| T3 소스 이동·복귀 | 지원(복귀 1조작) | 지원(복귀 4조작, 시작점이 그래프에 없음) | 미확인 | 지원(복귀 1조작, Root·노드·선택 유지) |
| T4 디버그 프레임 ↔ 그래프 | 미지원(별도 Call Stack 뷰) | 미지원 | 미확인 | 지원(P4 수정 후 Root 조건 모두) |

- 비교는 **기능 제공 여부와 자동화 조작 수**만 확인한 것이다. 사람의 이해 시간·정확도는 측정하지 않았다.
- Context Graph는 Marketplace 패키지에 Windows x64 실행 파일이 없어 그래프를 만들 수 없었다.

## 2. P4 수정 전후 회귀 (실제 VS Code UI)
Root 조건 A(없음), B(File Root `demo.ts`), C(Folder Root `src`)에서 중단점·Step Over·디버깅 종료를 실행하고 렌더링된 DOM으로 판정했다(단언 19개).

| 조건 | 항목 | 수정 전 `a9d95aa` | P4 `9126f35` | 재복원 PC 1회(P5) | 채택 버전 `e753f5e`(P10) |
|---|---|---|---|---|---|
| A | 시작점 유지 / 선택 유지 / 종료 후 복원 | 실패 / 실패 / 부분 | 통과 | 통과 | 통과 |
| B | 프레임→노드 매핑 | 실패(root 밖) | 통과 | 통과 | 통과 |
| C0 | Folder Root 직접 설정 | 실패(root 해제) | 통과 | 통과 | 통과 |
| C | 시작점 / 선택 / 복원 | 실패 / 실패 / 부분 | 통과 | 통과 | 통과 |
| 합계 | 단언 19개 | 통과 10 | 통과 19 | 통과 19 | 통과 19 |

P5 전체(각 스펙 1회): 판정 48개 중 46 pass, 0 fail, 2 observed. observed 2개는 "디버깅 중 편집 후 상단 Refresh 버튼은 그래프를 다시 분석하지 않음(스냅샷만 갱신)"과 "종료 후 그래프 상태"이며 판정 대상이 아닌 관찰이다. 원자료: [data/p5/p5-run1-checks.csv](data/p5/p5-run1-checks.csv).

P10에서 채택 버전 VSIX로 같은 UI 회귀 스펙 6종을 다시 실행해 결과가 같음을 확인했다([data/p10/regression-cacheonly.csv](data/p10/regression-cacheonly.csv)).
