# Graph-to-Code MVP 명세

Last updated: 2026-03-23

이 문서는 graph-to-code 아이디어를 현재 CodeGraph 코드베이스에 맞는 구체적인 MVP 계획으로 정리한 문서다.
대상은 범용 노코드 플랫폼이 아니라 `VS Code Extension + React Webview` 기반의 개발자 도구다.

## 1. 제품 정의

### 한 줄 정의

CodeGraph는 개발자가 그래프 UI에서 구조를 설계하고, 그 구조를 안전한 코드 스캐폴드 패치로 미리보기한 뒤 적용할 수 있게 해주는 도구다.

### 이 기능이 의미하는 것

- 구조 우선 스캐폴딩
- IDE 안에서 동작하는 개발자 도구
- 리뷰 가능한 패치 생성
- 기존 코드 문맥을 반영한 코드 삽입

### 이 기능이 의미하지 않는 것

- 완전한 노코드 앱 빌더
- 비즈니스 로직 자동 생성 엔진
- UML round-trip 동기화 플랫폼
- 에디터를 대체하는 작업 방식

## 2. MVP 목표

첫 번째로 유의미한 버전은 아래 질문에 답할 수 있어야 한다.

`개발자가 그래프에서 몇 개의 심볼과 관계를 만들고, 그 결과 코드를 패치 미리보기로 확인한 뒤, 신뢰를 잃지 않고 적용할 수 있는가?`

이 질문에 `예`라고 답할 수 있으면 기능은 성립한다.

## 3. MVP 사용자 시나리오

### 핵심 시나리오 A: 새 모듈 스캐폴드 생성

1. 사용자가 CodeGraph를 연다.
2. `UserService`라는 `Class` 노드를 만든다.
3. `UserRepository`라는 `Interface` 노드를 만든다.
4. `UserService -> UserRepository` 의존 edge를 연결한다.
5. `Generate`를 누른다.
6. CodeGraph가 다음 파일들에 대한 패치 미리보기를 보여준다.
   - `user-service.ts`
   - `user-repository.ts`
   - 필요하다면 export 업데이트
7. 사용자가 패치를 적용한다.

### 핵심 시나리오 B: 기존 파일에 구조 추가

1. 사용자가 기존 파일 또는 모듈을 연다.
2. 해당 파일 아래에 `Function` 노드를 만든다.
3. 필요하면 파라미터/결과용 `Type` 노드를 추가한다.
4. `Generate`를 누른다.
5. CodeGraph가 선택한 파일에 새 선언을 삽입하는 패치를 미리보기로 보여준다.

### 핵심 시나리오 C: implements / extends 연결 생성

1. 사용자가 클래스 노드를 만든다.
2. 인터페이스와 `implements` 관계를 연결한다.
3. 베이스 클래스와 `extends` 관계를 연결한다.
4. CodeGraph가 선언 헤더와 필요한 import를 생성한다.

## 4. MVP 비범위

MVP에서는 아래를 하지 않는다.

- 단순 placeholder를 넘는 함수 본문 생성
- 임의의 graph edge를 완전한 런타임 로직으로 바꾸기
- 프레임워크별 DI/container wiring 자동화
- 기존 코드 자동 리팩터링
- 코드와 그래프의 양방향 동기화
- TS/JS 외 언어까지 광범위하게 지원

## 5. 이 범위가 현재 코드베이스와 맞는 이유

현재 구조에는 이미 필요한 주요 경계가 있다.

- [`src/shared/protocol.ts`](c:/Users/SCH/Documents/CodeGraph/CodeGraph/src/shared/protocol.ts): webview와 extension 사이 메시지 계약
- [`src/panel/CodeGraphPanel.ts`](c:/Users/SCH/Documents/CodeGraph/CodeGraph/src/panel/CodeGraphPanel.ts): extension 쪽 orchestration 및 파일 IO
- [`src/analyzer/analyze.ts`](c:/Users/SCH/Documents/CodeGraph/CodeGraph/src/analyzer/analyze.ts): TypeScript compiler 기반 구조 분석
- [`webview-ui/src/App.tsx`](c:/Users/SCH/Documents/CodeGraph/CodeGraph/webview-ui/src/App.tsx): 그래프 UI 상태 및 상호작용 흐름

따라서 MVP는 기존 읽기 흐름 옆에 생성 흐름을 추가하는 형태가 자연스럽다.

- `analyzer`는 읽기 중심 유지
- 새 `codegen` 레이어는 쓰기 중심 역할
- `protocol`은 generation 요청과 patch preview 전달
- `panel`은 workspace edit 적용
- `webview`는 intent editor와 preview surface 역할

## 6. 제안하는 MVP 기능 범위

### 지원할 노드 종류

- `file`
- `function`
- `class`
- `interface`
- `type`

### 지원할 edge 종류

- `contains`
- `dependsOn`
- `extends`
- `implements`

### 지원할 코드 생성

- 새 파일 생성
- 기존 파일 끝에 선언 추가
- import 삽입
- class 선언 skeleton 생성
- interface 선언 skeleton 생성
- type alias skeleton 생성
- function 선언 skeleton 생성
- `extends` / `implements` 구문 생성
- 간단한 constructor parameter property 또는 dependency placeholder field 생성

### 출력 스타일

- preview-first
- patch 기반
- placeholder body만 생성
- 가능한 범위에서 convention-aware naming 반영

## 7. 생성 전용 그래프 모델 제안

현재 분석 그래프는 이미 존재하는 코드를 표현하는 데 최적화되어 있다.
생성 기능은 runtime analysis node를 그대로 재사용하기보다 별도의 intent model을 두는 편이 낫다.

### 제안하는 intent node

```ts
type DesignNodeKind = "file" | "function" | "class" | "interface" | "type";

type DesignNode = {
  id: string;
  kind: DesignNodeKind;
  name: string;
  filePath?: string;
  parentId?: string;
  exported?: boolean;
  signature?: {
    params?: Array<{ name: string; type?: string; optional?: boolean }>;
    returnType?: string;
    typeParams?: string[];
  };
  members?: Array<
    | { kind: "method"; name: string; returnType?: string }
    | { kind: "field"; name: string; type?: string; readonly?: boolean }
  >;
  source?: "graph" | "imported-from-analysis";
};
```

### 제안하는 intent edge

```ts
type DesignEdgeKind = "contains" | "dependsOn" | "extends" | "implements";

type DesignEdge = {
  id: string;
  kind: DesignEdgeKind;
  source: string;
  target: string;
  label?: string;
};
```

### 중요한 원칙

`analysis graph`와 `design graph`는 분리해서 다뤄야 한다.

- analysis graph = 관측된 코드 사실
- design graph = 사용자의 생성 의도

분석 그래프에서 생성 그래프로 가져오는 건 가능하지만, 둘을 같은 모델로 취급하면 UX와 구현이 모두 꼬일 가능성이 크다.

## 8. Protocol 확장안

### Webview -> Extension

```ts
type RequestPatchPreviewMessage = {
  type: "requestPatchPreview";
  payload: {
    design: {
      nodes: DesignNode[];
      edges: DesignEdge[];
    };
    options?: {
      createMissingFiles?: boolean;
      updateBarrels?: boolean;
    };
  };
};

type ApplyPatchPreviewMessage = {
  type: "applyPatchPreview";
  payload: {
    requestId: string;
    selectedPatchIds?: string[];
  };
};
```

### Extension -> Webview

```ts
type PatchPreview = {
  id: string;
  filePath: string;
  kind: "create" | "update";
  summary: string;
  diffText: string;
  warnings?: string[];
};

type PatchPreviewResultMessage = {
  type: "patchPreviewResult";
  payload: {
    requestId: string;
    ok: boolean;
    patches?: PatchPreview[];
    warnings?: string[];
    error?: string;
  };
};

type PatchApplyResultMessage = {
  type: "patchApplyResult";
  payload: {
    requestId: string;
    ok: boolean;
    appliedFiles?: string[];
    error?: string;
  };
};
```

## 9. 생성 파이프라인

### 1단계: design intent 수집

webview가 사용자가 만든 노드와 edge를 작은 design graph로 구성한다.

### 2단계: 정규화 및 검증

extension이 아래를 검사한다.

- 같은 scope 안의 중복 심볼 이름
- 잘못된 edge 조합
- target file 또는 container 누락
- 순환 parent 관계

### 3단계: workspace 문맥 보강

extension이 기존 코드에서 아래 정보를 추정한다.

- 파일 naming 패턴
- export 스타일
- import 스타일
- quote 스타일
- relative path 규칙

MVP에서는 이 단계가 heuristic 기반이어도 괜찮지만, 보수적으로 동작해야 한다.

### 4단계: symbol plan 생성

그래프 의도를 중간 계획으로 변환한다.

```ts
type SymbolPlan = {
  files: Array<{
    filePath: string;
    operations: Array<
      | { kind: "createDeclaration"; nodeId: string }
      | { kind: "insertImport"; from: string; specifier: string }
      | { kind: "updateClassHeader"; nodeId: string }
    >;
  }>;
};
```

### 5단계: 코드 emit

TypeScript AST factory 또는 좁은 범위의 템플릿 emitter로 아래를 생성한다.

- 선언문
- import
- header clause
- placeholder body

MVP에서는 범위가 좁고 결정적이라면 템플릿 기반 생성도 충분히 현실적이다.

### 6단계: patch preview 생성

extension이 파일 단위 diff를 계산해서 webview로 돌려준다.

### 7단계: 승인된 패치 적용

extension이 `WorkspaceEdit`로 패치를 적용하고, 필요하면 수정된 파일을 열어준다.

## 10. 파일 배치 전략

MVP에서는 파일 배치 규칙이 명확해야 한다. 여기서 애매하면 생성 기능 전반이 예측 불가능해진다.

### 추천 규칙

- 노드가 `file` 노드 아래에 있으면 그 파일에 쓴다
- 노드에 `filePath`가 명시되어 있으면 거기에 쓴다
- 둘 다 없으면 심볼 이름 기반으로 새 파일을 만든다

### 기본 예시

- `UserService` -> `user-service.ts`
- `UserRepository` -> `user-repository.ts`
- `CreateUserInput` -> `create-user-input.ts`

MVP에서 이 부분을 지나치게 똑똑하게 만들 필요는 없다.
영리하지만 놀라운 동작보다, 단순하지만 예측 가능한 동작이 낫다.

## 11. 코드 형태 규칙

### Function

```ts
export function createUser(input: CreateUserInput): CreateUserResult {
  throw new Error("Not implemented");
}
```

### Interface

```ts
export interface UserRepository {
  findById(id: string): Promise<User | null>;
}
```

### Type alias

```ts
export type CreateUserInput = {
  id: string;
};
```

### Class

```ts
export class UserService implements UserRepository {
  constructor(private readonly userRepository: UserRepository) {}

  async findById(id: string): Promise<User | null> {
    throw new Error("Not implemented");
  }
}
```

이 예시들은 의도적으로 평범하다.
v1에서는 영리함보다 예측 가능성이 더 중요하다.

## 12. MVP UI 흐름

### 최소 UI 흐름

1. design mode 진입
2. 노드 추가
3. edge 연결
4. 심볼 기본 속성 편집
5. `Preview Code` 클릭
6. 파일 단위 diff 리뷰
7. 선택한 패치 적용

### 필요한 UI 요소

- design mode toggle
- add-node 진입점
- relation picker
- 간단한 속성 inspector
- patch preview panel
- apply / cancel 버튼

### 중요한 UX 가드레일

- 어떤 파일이 바뀌는지 항상 보여줘야 한다
- 적용 전 충돌/경고를 항상 보여줘야 한다
- edge를 만들었다고 바로 파일을 수정하면 안 된다
- 생성된 placeholder를 감추면 안 된다

## 13. 제안하는 모듈 구조

추가 후보 파일:

- `src/codegen/index.ts`
- `src/codegen/designGraph.ts`
- `src/codegen/validateDesign.ts`
- `src/codegen/buildSymbolPlan.ts`
- `src/codegen/emitTsScaffold.ts`
- `src/codegen/buildPatchPreview.ts`
- `src/codegen/applyPatchPreview.ts`

업데이트 가능성이 높은 파일:

- [`src/shared/protocol.ts`](c:/Users/SCH/Documents/CodeGraph/CodeGraph/src/shared/protocol.ts)
- [`src/panel/CodeGraphPanel.ts`](c:/Users/SCH/Documents/CodeGraph/CodeGraph/src/panel/CodeGraphPanel.ts)
- [`webview-ui/src/App.tsx`](c:/Users/SCH/Documents/CodeGraph/CodeGraph/webview-ui/src/App.tsx)

## 14. 구현 순서

### Phase 0: 보이지 않는 백엔드 프로토타입

- 테스트에서 작은 design graph를 하드코딩
- preview patch 생성
- 파일 배치와 코드 형태 검증

### Phase 1: 기본 UI 연결

- webview에서 design graph 전송
- patch preview 렌더링
- 패치 적용

### Phase 2: 품질 보강

- import ordering 개선
- naming heuristic 개선
- conflict detection 추가
- warning 품질 개선

## 15. MVP 성공 기준

아래를 만족하면 MVP는 충분히 의미 있다.

- 개발자가 3~5개의 심볼과 2~4개의 관계를 만들 수 있다
- patch preview가 AST 출력처럼 보이지 않고 사람이 읽을 수 있다
- 생성 코드가 컴파일되거나, 아주 적은 수동 수정만으로 컴파일에 가까워진다
- 파일 배치가 사용자를 놀라게 하지 않는다
- apply 흐름이 신뢰 가능하고, 일반 editor undo나 git으로 되돌릴 수 있다

## 16. 주요 리스크

### 리스크: 추상화 수준이 너무 높아짐

그래프가 너무 많은 의미를 담으려 하면 사용자가 도구와 싸우게 된다.

대응:

- intent를 얕게 유지
- 동작이 아니라 scaffold를 생성

### 리스크: 기존 파일과 merge가 어려움

삽입 위치가 불안정하면 신뢰가 무너진다.

대응:

- 초기에는 append-to-file 또는 create-new-file만 지원
- 나중에 insertion intelligence를 확장

### 리스크: 모델 혼동

사용자가 지금 보고 있는 게 분석된 코드인지, 설계 중인 그래프인지 헷갈리면 UX가 빠르게 복잡해진다.

대응:

- mode를 명확히 분리
- 색상 / 패널 / 모델을 분리

### 리스크: wedge가 약함

이 기능은 매력적이지만, CodeGraph를 처음 도입하게 만드는 1순위 이유는 아닐 가능성이 크다.

대응:

- read-oriented core workflow 이후의 v1 확장 기능으로 취급
- 여전히 `impact analysis / trace navigation`을 주력 스토리로 유지

## 17. 권장 결론

이 기능은 만들 가치가 있다. 다만 범위를 좁게 잡아야 한다.

- scaffold 생성은 한다
- relation-aware declaration generation은 한다
- preview / apply workflow는 반드시 넣는다
- 전체 로직 자동 생성은 하지 않는다
- no-code 포지셔닝은 피한다

이 기능의 좋은 버전은 `박스를 그리면 앱이 나온다`가 아니다.
좋은 버전은 `작은 구조를 설계하고, 안전한 코드 skeleton을 생성한 뒤, 다시 개발자 방식으로 작업을 이어간다`이다.
