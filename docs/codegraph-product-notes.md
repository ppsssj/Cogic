# Cogic Product Notes

Last updated: 2026-03-23

이 문서는 Cogic의 제품 방향, 차별화 포인트, 확장 기능 아이디어를 누적 기록하는 작업 메모다.
대화 중 나온 평가와 가설을 빠르게 정리하고, 이후 MVP/v1/검증 계획으로 이어지는 베이스 문서로 사용한다.

## 1. Current Product Assessment

### 핵심 전제

- LLM 코딩 도구들은 이미 코드 파일 읽기, 구조 요약, 코드베이스 질의응답, 아키텍처 설명을 상당 부분 수행한다.
- 따라서 Cogic가 `코드를 설명해주는 또 하나의 AI 도구`로 포지셔닝되면 설득력이 약하다.
- Cogic의 의미는 `결정적인 구조 정보`, `탐색 가능한 관계`, `변경 영향도`, `경로 추적` 쪽에서 더 커진다.

### 냉정한 판단

- Cogic는 여전히 가치가 있다.
- 다만 그 가치는 `LLM 대체`가 아니라 `LLM이 애매하게 처리하는 구조/경로/영향도 문제를 보완`하는 데 있다.
- 중심이 `전체 그래프 시각화`에 머물면 gimmick이 될 가능성이 높다.

### 그래프 기반 접근이 특히 유리한 상황

- 특정 함수/클래스/모듈 변경 시 영향 범위를 빠르게 파악해야 할 때
- 에러 또는 실행 흐름이 어떤 호출 경로를 통해 도달했는지 추적할 때
- 어떤 값이 어디서 생성되고 어디로 흘러가는지 좁은 범위에서 보고 싶을 때
- 신규 기여자가 특정 도메인 흐름만 빠르게 이해해야 할 때
- LLM에게 던질 컨텍스트를 구조적으로 잘라서 전달해야 할 때

### gimmick으로 무너지기 쉬운 조건

- 전체 코드베이스를 거대한 node-link 그래프로 항상 보여주려는 경우
- 사용자가 그래프를 본 뒤 실제 액션으로 이어지지 않는 경우
- 엣지 정확도나 분석 신뢰도보다 시각적 풍부함을 우선하는 경우
- JS/TS의 동적 특성을 과소평가해 잘못된 call/dataflow를 확신 있게 보여주는 경우
- 결과적으로 사용자가 다시 검색과 수동 코드 읽기로 돌아가게 되는 경우

### 현재 기준 추천 포지셔닝

- 1순위: 구조 분석 / 영향도 분석 도구
- 2순위: 디버깅 / trace navigation 도구
- 3순위: LLM 보완재
- 비추천: LLM 대체재

### 기능별 차별화 가능성 메모

- impact analysis: 가장 강한 painkiller 후보
- trace/debug navigation: 실사용성이 높고 즉시 가치 전달 가능
- dataflow visualization: 잠재력은 크지만 정확도 요구가 높음
- LLM context packaging: 좋은 확장 기능이지만 단독 wedge는 아님
- call graph: 필요하지만 단독 차별화는 약함
- type graph: TS에서는 유용하지만 주력 wedge로는 상대적으로 약함

### 초기 wedge 가설

- `이 코드를 바꾸면 어디가 영향을 받는가?`
- `이 에러/흐름은 어디서 시작되어 여기까지 왔는가?`

즉, 가장 현실적인 초기 wedge는 `impact analysis + trace/debug navigation` 조합이다.

## 2. Graph-to-Code Scaffolding Idea

### 아이디어 정의

사용자가 그래프 상에서 구조를 설계하면, 그 구조를 기반으로 실제 코드 스캐폴드를 생성하는 기능.

예시:

- Function node 생성 -> 함수 선언 코드 생성
- Class node 생성 -> 클래스 및 메서드 뼈대 생성
- Interface/Type node 생성 -> 타입 선언 생성
- edge 연결 -> import, extends, implements, 기본 wiring 생성

### 이 아이디어가 매력적인 이유

- Cogic를 `읽는 도구`에서 `설계하고 시작 코드를 만드는 도구`로 확장할 수 있다.
- 반복적인 보일러플레이트 작성 비용을 줄일 수 있다.
- 구조를 먼저 정하고 코드로 내리는 workflow를 지원할 수 있다.
- 신규 모듈 설계, 리팩터링 목표 구조 초안 작성, 아키텍처 합의 초안 생성에 도움이 된다.

### 냉정한 평가

- 가능하다.
- 하지만 `graph from structure -> scaffold generation` 수준은 현실적이고,
- `graph from intent -> meaningful business logic generation` 수준은 빠르게 위험해진다.

즉, 아래는 현실적이다:

- 함수/클래스/인터페이스/type 선언 생성
- import 추가
- extends / implements 반영
- 간단한 생성자 의존성 또는 필드 선언 반영
- 파일 생성 / 기존 파일에 심볼 추가

반면 아래는 초기부터 욕심내면 실패 가능성이 높다:

- edge만 연결해서 함수 본문 로직까지 의미 있게 생성
- dataflow edge를 실제 처리 로직으로 완성
- 프레임워크별 런타임 wiring을 일반화해서 자동 생성
- 기존 복잡한 코드베이스의 의도를 정확히 추론해 다중 파일 로직을 완성

### 이 기능이 gimmick이 되는 조건

- 시각적으로 그럴듯하지만 생성 코드를 거의 바로 버리게 되는 경우
- 프로젝트 스타일, 파일 구조, naming convention을 반영하지 못하는 경우
- 기존 코드와 merge되지 않고 새 파일만 양산하는 경우
- diff/preview 없이 곧바로 코드에 반영하는 경우
- 양방향 동기화 기대를 만들지만 실제로는 금방 깨지는 경우

### 추천 포지셔닝

이 기능은 `노코드`가 아니라 `developer-facing structure-first scaffolding`으로 설명해야 한다.

좋은 메시지:

- 구조를 먼저 설계하고 코드 뼈대를 생성한다
- 기존 코드베이스 문맥에 맞는 scaffold를 만든다
- 타입/상속/import 수준의 구조적 연결을 빠르게 반영한다
- 사용자가 직접 수정할 수 있는 안전한 초안을 diff로 제시한다

피해야 할 메시지:

- 그래프만 그리면 앱이 완성된다
- edge 연결만으로 비즈니스 로직이 자동 완성된다
- 비개발자도 개발 없이 기능을 만들 수 있다

## 3. Recommended Scope

### 현실적인 MVP

- symbol node 생성
- function/class/interface/type scaffold 생성
- extends / implements / import edge 기반 코드 생성
- 새 파일 생성 또는 기존 파일에 append
- 생성 전 preview diff 제공
- 생성 시점의 naming / folder / export convention 반영

### 설득력 있는 v1

- framework-aware template 지원
- React component / props type scaffold
- service / repository / interface 세트 생성
- route / handler / DTO / test skeleton 생성
- 기존 심볼과 충돌 탐지 및 merge 전략 제시
- 그래프와 코드 간 최소 수준의 동기화 보조

### 보류가 좋은 영역

- 복잡한 dataflow 로직 자동 생성
- 대규모 기존 시스템 리팩터링을 자동 패치로 해결
- 양방향 완전 동기화 UML round-trip 비전
- 프레임워크별 마법 같은 wiring 전부 자동화

## 4. Product Principle Draft

이 확장 기능을 넣는다면 다음 원칙이 중요하다.

- 그래프는 `source of truth`가 아니라 `generation intent editor`에 가깝다.
- 생성 결과는 항상 `patch preview`로 보여주고 사용자가 승인한다.
- 생성 품질의 핵심은 `문맥 적합성`이지 `코드 양`이 아니다.
- 전체 그래프보다 `task-scoped subgraph`에서 생성이 일어나야 한다.
- 구조 생성 기능은 기존 강점 후보인 `impact analysis / trace navigation`을 약화시키지 않아야 한다.

## 5. Open Questions

- 이 기능의 첫 대상은 greenfield scaffold인가, 기존 코드베이스 내 증분 생성인가?
- 관계 edge 중 어디까지를 codegen-safe relation으로 볼 것인가?
- 생성 결과를 어떤 granularity로 preview할 것인가? 파일 단위 / 심볼 단위 / patch 단위
- 템플릿 기반 생성과 LLM 보조 생성을 어떻게 섞을 것인가?
- 기존 프로젝트 규칙을 어떻게 학습하거나 감지할 것인가?
- 이 기능이 주력 wedge인지, v1 이후 확장인지 제품 전략상 어디에 둘 것인가?

## 6. Next Candidates

다음 대화에서 구체화할 수 있는 주제:

- 그래프 기반 코드 생성 기능의 MVP 명세
- node / edge schema 설계
- VS Code Extension + React Webview 기준 구현 아키텍처
- code generation pipeline 설계
- preview / apply UX 설계
- 실사용 검증 시나리오와 성공 지표

## 7. Related Docs

- 상세 설계 문서: [graph-to-code-mvp.md](c:/Users/SCH/Documents/CodeGraph/CodeGraph/docs/graph-to-code-mvp.md)
