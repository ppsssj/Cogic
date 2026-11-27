# `decorates` 관계 도입 타당성 (설계 검토만, 구현하지 않음)

## 1. 정의 제안

| 항목 | 제안 |
|---|---|
| kind | `decorates` (`GraphEdgeKind`에 추가) |
| source | 적용되는 **데코레이터 함수 노드**. 팩토리 `@Get("a")`이면 팩토리 `Get`(반환된 익명 데코레이터는 노드가 아니다. §2) / 일반 데코레이터 `@Plain`이면 `Plain` |
| target | 꾸며지는 선언 노드. 클래스, 메서드, 프로퍼티(노드가 아니면 그 클래스 + `label`에 멤버 이름), 파라미터(노드가 아님 → 그 함수·메서드 + `label`에 파라미터 위치) |
| label | 데코레이터 식 문자열(예: `@Get("a")`)과 대상 종류(`class`/`method`/`property`/`parameter`), 순서(복수 데코레이터일 때 적용 순서) |
| 방향 | 데코레이터 → 대상. 의미는 "이 데코레이터가 이 선언에 적용된다" |
| 실행 여부 | 구조적 관계다. 실행 위치나 시점을 주장하지 않는다 |

## 2. 팩토리와 반환된 데코레이터의 구분

- `@Get("a")`는 두 단계다.
  1. 팩토리 `Get`의 **호출**(인자 `"a"`의 dataflow)
  2. 반환된 함수의 **적용**
- 반환된 함수는 대개 이름 없는 화살표 함수라 노드가 아니다.
- 따라서 다음처럼 나눈다.
  - `decorates`의 source는 사용자가 소스에서 보는 이름인 팩토리 `Get`이다.
  - 팩토리 호출 자체는 기존 `calls`/`dataflow`로 표현한다.
- 같은 쌍을 두 번 세지 않으려면 `calls`의 owner를 계약으로 정해야 한다(s037-review의 A 또는 B).

## 3. calls / dataflow와의 중복 방지

| 구문 | `calls` | `dataflow` | `decorates` |
|---|---|---|---|
| `@Get("a") a()` | owner → `Get` (owner는 계약 A: file / B: class) | owner → `Get` arg 0 | `Get` → `a` |
| `@Plain a()` | 없음(소스에 호출식 없음) | 없음 | `Plain` → `a` |
| `@Plain`의 현재 Cogic `references a → Plain` | — | — | `decorates`로 대체(중복 제거). 또는 `references`를 유지하고 `decorates`를 추가할지 결정 필요 |

## 4. 기존 NestJS adapter와의 관계

- Nest route owner(synthetic 노드)는 `@Get` 등 `@nestjs/common` 데코레이터로 판정한다(지침 §5.4).
- `decorates`는 framework와 무관한 일반 관계다. adapter는 지금처럼 synthetic 노드를 만들고, 필요하면 `decorates` edge를 그 근거로 참조할 수 있다.
- 중복 표시를 피하려면 UI에서 route owner와 `decorates`를 함께 접는 규칙이 필요하다.

## 5. 변경 범위 (영향 분석)

| 영역 | 변경 |
|---|---|
| `GraphPayload` / `protocol.ts` | `GraphEdgeKind`에 `decorates` 추가 |
| analyzer | 데코레이터를 순회해 대상을 결정한다. 메서드는 지금 본문만 순회하므로 수정이 필요하다 |
| 캐시 | 분석 캐시 스키마 버전 증가 |
| Inspector | 새 관계 종류 표시. "Decorated by / Decorates" 섹션 |
| Trace | trace 이벤트는 호출 기반이라 `decorates`를 만들지 않는다. 표시 규칙만 필요 |
| Aggregate | 집계 키에 새 kind. 같은 쌍 집계 규칙 |
| Focus + Context | 이웃 계산에 포함할지 결정 |
| Export | 스타일 정의(색, 선 모양) |
| LowDetailEdges·dataflow motion | 영향 없음. 정적 스타일만 추가 |
| 테스트·E2E | 새 kind 스냅샷. 기존 E2E 기대값 일부 변경 |

## 6. 기존 GT와 scorer 호환성

- GT v1과 scorer 1.2는 `decorates`를 모른다.
  - **확인한 사실(코드 읽기, VERIFIED):** scorer 1.2의 `normalizeCogicGraph`는 `EDGE_KINDS` 밖의 kind를 `unknown-edge-kind` malformed로 기록한다. 이 코드는 `BLOCKING_CODES`에 있다.
  - 따라서 `decorates`를 출력하는 analyzer를 그대로 채점하면 데코레이터가 있는 사례가 전부 `SCORING_BLOCKED`가 되어 확증 집계에서 빠진다.
  - 평가에 넣으려면 새 범주, 패턴, GT v2(또는 별도 GT 부록)와 scorer 버전 증가가 필요하다.
- **평가 영향을 피하는 길:** 평가 runner에서 `decorates`를 제외 범주로 두고 별도 표로 보고한다. 이는 프로토콜 고정 **전에** 정해야 한다.

## 7. 실용적 가치 (INFERRED)

- NestJS·Angular·TypeORM 코드에서 "이 메서드에 어떤 데코레이터가 붙었나"와 "이 데코레이터를 쓰는 곳"은 자주 찾는 정보다.
- TS Call Hierarchy는 이를 incoming call로 보여 주지만, outgoing과 모순된다(decorator-tools.md).
- CodeQL은 문서상 `Decorator.getElement()`로 이를 별도 관계로 둔다.
- 다만 제품 변경 범위가 넓다. 정확도 평가 계약을 정하는 데는 필요하지 않다(계약 A를 유지하면 된다).
- **권고:** 논문 제출 전 범위에서는 구현하지 않는다. 향후 작업으로 기록한다.
