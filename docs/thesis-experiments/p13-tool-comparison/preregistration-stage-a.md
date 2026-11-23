# P13 Stage A — 사전 등록 (측정 전 고정)

이 파일은 Stage A 측정 전에 커밋한다. 이후 측정 결과를 보고 기준을 바꾸지 않는다. 기준을 바꿔야 하면 이 파일은 그대로 두고, 변경과 사유를 별도 항목으로 기록한다.

## 대상과 고정 조건
- 실험 프로젝트: P3에서 사용한 4파일 예제(`src/demo.ts`, `receipt.ts`, `money.ts`, `runner.ts`)를 변경 없이 사용.
- 실행 흐름: `runDemo → CheckoutDemo.process → formatReceipt → formatMoney`.
- VS Code 1.147.0 win32-x64 archive. 도구마다 새 user-data와 확장 폴더를 쓰고, 해당 확장만 설치한다. 창 크기는 1600×960.
- 도구와 설치 파일(SHA256):
  - VS Code 기본: 확장 0개
  - Trace Function Flow 1.1.1: `f780cdf78b4b2b60754a5c93bb6816a95f5204d6063feb1648f9924c4682cc33`
  - Context Graph 0.10.9: `dc70762a4497edbabdf32a8a7fa14858885d9dd79c26bb7949dea5dbaf9d932c`
  - Cogic: main `cef96eb` 테스트 VSIX, 표시 버전 0.0.6, `9fe50227018165e7f63c5451a056edbdb5229c8a6fb4a105e14f5805e4102916`
- 시작 상태(조작 수 미포함): `src/demo.ts` 열림, TS 서버 준비 완료, 커서 `runDemo`(26:17).
- 자동화: P3에서 쓴 스펙(`p1-cogic.spec.ts`, `p2-compare.spec.ts`)을 **수정 없이** 재사용한다.

## 과제와 성공 기준 (P3 프로토콜과 동일)
| 과제 | 성공 기준(UI에서 관찰) |
|---|---|
| T1 다중 파일 호출 관계 | 도구의 UI에 `runDemo→process`, `process→formatReceipt`, `formatReceipt→formatMoney` 세 관계가 모두 보인다. 셋 다 보이면 성공, 일부만 보이면 부분 |
| T2 인자 전달 `120 → total → amount` | 세 구간(`total←120`, `total←total`, `amount←total`)이 **도구가 표시한 매개변수 대응**으로 보인다. 정의로 이동해 코드를 읽어야 하거나 호출식만 보이면 부분 |
| T3 그래프/뷰 → 소스 이동 → 복귀 | 도구 뷰에서 `formatReceipt` 소스로 이동하고, 원래 시작 맥락(시작점이 포함된 뷰)으로 돌아올 수 있다. 복귀 조작 수, 뷰 유지, 시작점 유지, 선택 유지를 기록 |
| T4 디버그 프레임 ↔ 뷰 | `receipt.ts` 5행 중단점에서 멈췄을 때, 현재 프레임이 도구의 구조 뷰(그래프/트리)의 노드로 식별된다. 디버깅 전후 탐색 상태 유지를 기록 |

## 분류 (P13 공통)
| 분류 | 의미 |
|---|---|
| `SUPPORTED_AND_VERIFIED` | 성공 기준을 UI 증거로 확인 |
| `PARTIALLY_SUPPORTED` | 기준의 일부만 충족 |
| `UNSUPPORTED_BY_DESIGN` | 도구가 해당 기능을 제공하지 않음(문서·UI 기준). 결함으로 보지 않음 |
| `EXECUTION_FAILED` | 기능은 있으나 이 과제에서 수행에 실패 |
| `ENVIRONMENT_BLOCKED` | 설치·실행 환경 문제로 평가 불가 |
| `NOT_TESTED` | 평가하지 않음 |

기존 스펙의 상태값은 다음과 같이 옮긴다: pass → SUPPORTED_AND_VERIFIED, partial → PARTIALLY_SUPPORTED, unsupported → UNSUPPORTED_BY_DESIGN, fail → EXECUTION_FAILED, `No usable worker runtime` 등 실행 환경으로 그래프 생성 불가 → ENVIRONMENT_BLOCKED.

## 조작 수 규칙 (P3와 동일)
- 단축키, 클릭, 명령 팔레트 실행, select 변경을 각 1로 센다. 명령 팔레트에 명령 이름을 입력하고 Enter를 누르는 것은 1로 센다.
- `Fit Graph`(판독용 뷰포트 맞춤)와 시작 상태 준비는 세지 않는다.
- 파일 전환: 활성 편집기 탭이 다른 파일로 바뀐 횟수. 복귀 조작: 시작 맥락으로 돌아오기 위한 명시적 조작 수.
- 조작 수는 스크립트에 정해진 경로 기준이다(사람의 시행착오를 포함하지 않음). 자동화 실행 시간은 보조 기록일 뿐 이해 시간이 아니다.

## 반복과 순서
- 도구별 독립 실행 3회. 실행 회차마다 도구 순서를 회전한다:
  - r0: VS Code, TFF, Context Graph, Cogic
  - r1: TFF, Context Graph, Cogic, VS Code
  - r2: Context Graph, Cogic, VS Code, TFF
- 한 번에 VS Code 하나만 실행한다. 실행 전 가용 메모리가 1,000 MB 이상이어야 시작한다.
- 결과는 실행마다 즉시 디스크에 기록한다.
- 3회의 분류가 다르면 3회 결과를 모두 보고하고, 대표값은 2회 이상 나온 분류로 정한다.
