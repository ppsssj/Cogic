# P12-B 아키텍처 제안

전제: Structure Graph, Dataflow, Inspector, Runtime Debug 기능과 그래프 페이로드 형식은 그대로 둔다. 이번 문서는 설계만 다루며 P12-A에서 제품 코드는 바꾸지 않았다.

## 후보 비교

| 후보 | 실측 근거 | 기대 효과 (Vite D2) | 정확성 | 위험 | 판단 |
|---|---|---|---|---|---|
| **1a. Program + TypeChecker 공유** | 하네스 `--share-program 1` | 67–80 s → 9.2–9.6 s | **기준과 다름**(노드 11, 엣지 7–8) | 결과가 분석 순서에 의존 | **기각** |
| **1b. Program 구조 재사용 + 파일별 새 checker** | 하네스 `--share-program old-sf` | 67–80 s → **12.2–12.6 s** | **기준과 동일**(해시 일치, Hono·Vite) | SourceFile 저장소 메모리, 무효화 | **채택(1순위)** |
| 1c. `oldProgram`만 전달 | 하네스 `--share-program old` | 오히려 느려짐(90.5 s) | 동일 | 캐시 용량 부족 시 TS가 재사용 거부 | 1b 없이는 금지 |
| 2. 파일별 증분 그래프 분석 | 측정 없음 | 반복 Generate·편집 후 재분석에 효과 | 의존 파일 무효화를 잘못하면 오래된 결과 | 의존성 추적 복잡 | 2순위(1b 이후) |
| 3. Graph merge 최적화 | merge 34회 합 24–26 ms | 총시간의 0.04% 미만 | 영향 없음 | — | **불필요** |
| 4. 함수 중심 Call Flow | 측정 없음 | frontier 축소로 N 자체를 줄임 | 별도 뷰, 기존 그래프와 공존 | UX·범위 설계 필요 | 3순위(별도 기능) |

## 권장안: Depth 실행 범위 Program 세션 (후보 1b)

```text
analyzeWorkspaceWithDepth()
  session = createAnalysisSession(workspaceRoot, filePaths)        // 이번 Depth 실행 동안만 유지
  ├─ session.analyze(active, unsavedBuffer)
  │     program₀ = ts.createProgram(roots, opts, host₀)             // 기존과 같음
  └─ for f in frontier
        session.analyze(f, diskText)
           programᵢ = ts.createProgram(roots, opts, hostᵢ, programᵢ₋₁)  // oldProgram 전달
           hostᵢ.getSourceFile(x) = x == f ? 새 SourceFile(f)
                                  : programᵢ₋₁.getSourceFile(x) (버전 일치 시)
           checkerᵢ = programᵢ.getTypeChecker()                     // 항상 새 checker
  session.dispose()                                                 // Program 참조 해제
```

### 설계 요점
1. **checker는 공유하지 않는다.** 정확성 기준(파일 단독 분석 결과와 동일)을 지키는 핵심이다.
2. **SourceFile 공급원은 직전 Program**으로 한다. 기존 디스크 SourceFile 캐시(용량 2,020)는 Program(2,296)보다 작아 구조 재사용을 막는다. 세션 안에서는 직전 Program이 전체 SourceFile 집합을 갖고 있으므로 추가 저장소가 필요 없다.
3. **활성 파일 교체 규칙**: 확장 대상 파일만 새 SourceFile로 만든다. 직전 활성 파일의 SourceFile(미저장 버퍼로 만든 것)은 다음 Program에서 디스크 버전으로 바꿔야 한다. 그래야 현재 동작과 같다(현재 확장 Program은 원래 활성 파일을 디스크 내용으로 읽는다). 이 파일은 `fileChanged`로 처리되고 TS는 `SafeModules` 수준으로 재사용한다.
4. **TS 구조 재사용 조건 유지**: rootNames 배열(순서 포함)과 모듈 해석 관련 옵션이 같아야 한다. `buildWorkspaceRoots`가 Depth 실행 동안 같은 값을 반환하도록 세션 시작 시 한 번만 계산한다.
5. **수명**: 세션은 한 번의 Depth 실행 안에서만 유지하고 끝나면 Program 참조를 놓는다. 장기 보관을 하지 않으므로 파일·tsconfig 변경 무효화 문제가 실행 중 변경으로 한정된다.

### 검토 항목별 판단

| 항목 | 판단 |
|---|---|
| 동일 프로젝트 SourceFile 접근 | 세션 내 직전 Program에서 제공. 디스크 캐시는 세션 밖(첫 Program)에서 그대로 사용 |
| 활성 파일 unsaved buffer | 첫 분석만 버퍼를 쓴다(현재와 동일). 확장 분석에서는 원래 활성 파일을 디스크 버전으로 교체(현재와 동일). *참고: 확장 분석이 미저장 버퍼를 보지 못하는 현재 동작 자체는 별도 개선 과제다.* |
| 타입 정합성 | 파일마다 새 checker → 기준과 동일(VERIFIED, 해시 일치) |
| 파일·tsconfig 변경 무효화 | 세션 중 변경은 `mtime/size` 검사(현 캐시와 같은 키)로 감지하고, 바뀐 파일은 새 SourceFile로 교체. tsconfig·파일 목록 변경은 세션을 새로 시작한다 |
| 메모리 | 직전 Program 1개를 더 붙잡는다. 실측 최고 RSS는 오히려 낮았다(803 vs 859–882 MB). 반복 Program 생성의 GC 부담이 줄었기 때문으로 추정된다 |
| 기존 캐시와 상호작용 | 첫 Program은 기존 Adaptive 디스크 캐시를 그대로 쓴다. 세션 안에서는 디스크 캐시를 거치지 않아 skipFull·evict가 사라진다. 세션이 끝난 뒤 디스크 캐시 상태는 첫 Program 이후와 같다 |
| Depth 3 | 같은 세션으로 hop을 이어 가면 된다. 효과는 hop 수에 비례해 커진다(INFERRED) |

### 기대 효과 (하네스 기준, VERIFIED 범위)
- Vite D2: 66.8–80.0 s → 12.2–12.6 s(약 5.4–6.4배). 남은 시간의 절반 이상은 첫 Program(약 5.7 s)이다.
- Hono D2: 7.6–7.8 s → 3.7–4.5 s.
- VS Code 체감 시간(P13 약 387 s)이 얼마나 줄지는 **UNVERIFIED**. 비분석 구간 약 300 s의 정체가 아직 밝혀지지 않았다.

## 보조 후보 설계 메모

### 후보 2: 증분 그래프 분석
- 키: `(파일 경로, 파일 버전, Program 구조 해시, 분석기 버전)` → 파일 단위 `GraphPayload`.
- 문제: 파일 A의 그래프는 A가 import하는 파일의 타입에도 의존한다. 무효화 범위를 정하려면 역의존 그래프가 필요하다. 패널의 기존 `analysisResultCache`(Depth 결과 전체 캐시)보다 세밀한 단위다.
- 1b 이후, VS Code 구간 측정에서 반복 Generate가 문제로 확인되면 진행한다.

### 후보 3: Graph merge
- `mergeGraphPayload`는 호출마다 Map 2개를 다시 만든다(O(누적 크기 × N)). 측정상 Vite 34회에 24 ms라 지금은 이득이 없다. Depth 3이나 수만 노드 그래프에서만 재검토한다.

### 후보 4: 함수 중심 Call Flow
- 선택한 함수의 호출 대상 선언 파일만 frontier로 삼으면 N이 줄어든다(Vite `server/index.ts` 전체 34개 → `createServer` 경로 몇 개, INFERRED).
- 기존 파일 중심 Depth 그래프와 별도 모드로 두고, 1b 세션을 그대로 재사용한다.
- P13에서 큰 그래프는 경로 노드가 화면에 그려지지 않았다. 표시 측면에서도 이점이 있다.
