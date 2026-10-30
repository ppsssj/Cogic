# Corpus B 블라인드 검토 절차

## 1. 단계

| 단계 | 상태 | 하는 사람 | 산출물 |
|---|---|---|---|
| 0. 준비 | `REVIEW_PENDING` | 연구자 | 블라인드 패킷(`build-blind-packet.mjs`), 패킷 SHA-256 기록 |
| 1. 블라인드 판정 | `REVIEW_IN_PROGRESS` | 독립 검토자 | 사례별 양식 3종, 체크리스트, 질문 기록, 독립성 선언 |
| 2. 제출 | `REVIEW_SUBMITTED` | 독립 검토자 → 연구자 | 제출물 SHA-256 기록. 이후 제출물은 고치지 않는다 |
| 3. 대조 | `RECONCILIATION_PENDING` | 연구자 + 판정자 | `reconcile.mjs` 출력(일치·불일치 표), 불일치마다 원인·수정 제안·최종 판단 |
| 4. 확정 | `REVIEW_ACCEPTED` | 판정자(사람) | 승인 기록. GT를 바꾸면 v2 절차(`expected.v2.json`, 새 manifest) |
| — | `REVIEW_BLOCKED` | 누구나 | 진행할 수 없는 사유(검토자 미확보, 패킷 결함 등) |

- `REVIEW_ACCEPTED`의 조건
  - 사람 검토자의 제출물
  - 사람 판정자의 reconciliation 기록
  - 위 두 가지의 검토자·날짜·대상 SHA·범위·판정 근거
- 도구 출력이나 AI의 자체 검토만으로는 `REVIEW_ACCEPTED`가 되지 않는다(`review-status.mjs`가 거부한다).

## 2. 사례 하나를 검토하는 순서

1. `worksheet.md` §1의 줄 번호 붙은 active file을 처음부터 끝까지 읽는다.
2. §2 import 해석표로 각 이름이 어느 파일(또는 untyped 외부 모듈)에서 오는지 확인한다.
3. §3 선언 목록에서 지침 §2의 노드가 무엇인지 정한다. 노드가 아닌 것(일반 변수, 객체 속성, 본문 없는 시그니처 등)을 구분한다.
4. 각 관계의 owner를 지침 §3으로 정한다. 다음에 주의한다.
   - 익명 콜백(§3.3)
   - 데코레이터(§3.4)
   - 생성자 본문·필드 초기값(§3.2)
   - framework 콜백(§5)
5. 지침 §4 순서로 관계를 적는다.
   - calls → constructs → references → dataflow → owner → updates
   - 다른 파일의 대상은 그 파일을 열어 선언 줄을 확인한다.
6. §4 호출 지점 목록의 모든 지점에 처분을 적는다. 목록에 없는 관계(references, dataflow, owner, updates)도 빠뜨리지 않는다.
7. 결정성(§6.2)과 패턴(catalog)을 정한다. 정할 수 없으면 `note`에 이유를 적고 가장 가까운 판정을 고른다.
8. 부정 사례(§7)를 확인한다.
9. 해당 체크리스트 항목에 답한다.

## 3. 검토 범위

| 대상 | 범위 |
|---|---|
| 관계 | owner(source)가 active file 안에 있는 관계. target은 어느 파일이어도 된다 |
| 호출 지점 | active file의 모든 호출·new·JSX·데코레이터·tagged template(worksheet §4) |
| 선언 | active file의 선언. target이 다른 파일이면 그 선언만 확인한다 |
| 의존 파일 | 대상 선언을 확인하는 용도로만 본다. 의존 파일 안의 관계는 검토 대상이 아니다 |

## 4. 시간과 분량 (참고)

- 사례 20개
  - active file 합계: 725줄
  - 호출 지점: 184개
  - 선언 목록: 79개
- 사례당 20–60분을 예상한다. 큰 사례(bn02 111줄)는 더 걸린다.
- 한 번에 끝내지 않아도 된다. 나눠 할 때는 사례 단위로 끊는다.
