# 실험 방법

## 1. 원칙
- **실제 VS Code UI**에서 사람이 쓰는 입력(클릭, 단축키, 명령 팔레트, CodeLens, 더블클릭)으로 각 도구의 정상 사용 경로를 실행했다(Playwright + Electron).
- **판정은 렌더링된 UI에서만 했다**: 사이드바 트리 행, React Flow 노드·엣지 DOM, Inspector 패널 텍스트, 편집기 활성 탭과 줄, 알림·패널 메시지. 도구의 내부 API 응답만으로 성공을 판정하지 않았다.
- 과제, 정답, 성공 기준, 분류, 조작 수 규칙, 실행 순서는 측정 전에 커밋했다([task-definitions.md](task-definitions.md)). 스모크 실행에서 발견된 절차 보완은 본 측정 전에 별도 문서로 커밋했다(A1–A6).
- 실패와 차단도 같은 기준으로 기록했다. Cogic이 실패한 과제도 교체하지 않았다.

## 2. 하네스
- P3/P4 하네스(`e2e/lib/vscode.ts`, `lib/cogic.ts`, `lib/recorder.ts`)를 재사용했다.
  - Stage A: P3의 `p1-cogic.spec.ts`, `p2-compare.spec.ts`를 **수정 없이** 실행했다.
  - Stage B: 새 스펙 [tools/harness/p13-real.spec.ts](tools/harness/p13-real.spec.ts)를 추가했다(기존 스펙은 변경하지 않음).
  - 연구실 PC에 남은 공통 라이브러리와 Stage A 스펙·설정을 [tools/harness/](tools/harness/)에 복사했다. 측정 당시의 하네스 해시는 남지 않아 사본의 시점 일치 여부는 입증할 수 없다. 보존 자료의 오프라인 검증과 UI 재실행 조건은 [reproduction.md](reproduction.md)를 참조한다.
- 격리:
  - 실행마다 새 user-data와 확장 폴더를 쓰고, 해당 도구 확장만 복사했다.
  - VS Code 1.147.0 archive, 창 1600×960.
  - 한 번에 VS Code 하나만 실행했고, 시작 전 가용 메모리 1,000 MB 이상을 확인했다.
  - 실행이 끝나면 결과를 즉시 기록했다. 중단된 실행은 다시 쓰지 않고 표시한 뒤 재실행했다.
- 작업 복사본:
  - Stage A 예제는 실행 전후 SHA256으로 확인했다.
  - Stage B의 hono·vite는 P11 `git worktree`이고, 실행 전후 `git status`가 깨끗한지 확인했다.

## 3. 측정 지표
| 지표 | 정의 |
|---|---|
| 분류 | `SUPPORTED_AND_VERIFIED` / `PARTIALLY_SUPPORTED` / `UNSUPPORTED_BY_DESIGN` / `EXECUTION_FAILED` / `ENVIRONMENT_BLOCKED` / `NOT_TESTED` (사전 등록 정의) |
| 대표 분류 | 3회 중 2회 이상 나온 분류. 그렇지 않으면 3회를 모두 표기 |
| 조작 수 | 클릭·단축키·명령 팔레트 실행·select 변경·캔버스 드래그 각 1. Fit Graph와 시작 상태 준비는 제외. 스크립트 경로 기준 |
| 파일 전환 | 활성 편집기 탭이 다른 파일로 바뀐 횟수 |
| 복귀 조작 | 시작 맥락으로 돌아오기 위한 명시적 조작 수 |
| 유지 | 소스 이동 전후의 뷰(트리 행·노드 집합), 시작점, 선택 |
| 디버그 연계 | 멈춘 프레임이 도구의 구조 뷰 노드로 식별되는지 |
| 실행 시간 | 자동화 대기를 포함한 기록(보조). 이해 시간으로 해석하지 않음 |

## 4. 판독 규칙 (요약)
- **호출 관계**:
  - VS Code: Call Hierarchy 트리의 부모-자식 행
  - TFF: 그래프 엣지가 두 함수 노드를 잇는지
  - Cogic: `calls` 엣지 끝점을 DOM의 노드 제목 또는 멤버 행(`name() … file:line`)과 대응(보완 A4)
- **인자 전달**: 도구가 `param ← arg` 형태로 표시한 경우만 인정한다.
  - Cogic: `dataflow` 엣지 라벨 또는 Inspector PARAM FLOW 행(보완 A6)
  - TFF: 상세 패널
  - VS Code: 매핑 표시가 없으므로 정의 이동 도달까지만 인정(부분)
- **소스 이동**: 편집기 활성 탭이 목표 파일로 바뀌었는지. **복귀**: 시작 파일로 돌아왔는지.
- **가시성**: React Flow는 화면 밖 노드를 DOM에서 뺀다. 판독 전에 Fit Graph를 누르고(조작 수 제외), 그래도 그려지지 않은 노드는 "보이지 않음"으로 판정한다.
