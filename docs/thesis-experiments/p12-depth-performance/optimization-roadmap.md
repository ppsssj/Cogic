# 최적화 로드맵

## 우선순위

| 순위 | 작업 | 근거 | 검증 게이트 |
|---|---|---|---|
| **1 (P12-B 첫 작업)** | Depth 실행 범위 Program 세션: `oldProgram` 전달 + 직전 Program SourceFile 제공 + 파일별 새 checker | Program 생성이 Vite D2의 83–90%. 하네스에서 5배 이상 단축, 그래프 동일 | (a) Hono·Vite D0/D1/D2 그래프 해시가 P12-A 기준(`45ea10…`, `3f9848…` 등)과 동일 (b) 확장 Program의 `structureIsReused`가 `Completely` 또는 `SafeModules` (c) `npm test` 통과 (d) 최고 RSS가 기준 이하 |
| 2 | VS Code 구간 계측 추가(디버그 이벤트 6개) + P13 하네스로 V1 D2 1회 측정 | Node 67–80 s vs UI 약 387 s의 차이를 밝혀야 다음 우선순위가 정해짐 | 7개 구간 합이 Generate 총시간과 일치(±5%) |
| 3 | cwd 의존 `@types` 해석 수정 검토(`configFilePath` 설정 또는 `typeRoots` 명시) | 하네스와 Extension Host의 Program이 다를 수 있음(정확성·재현성) | Extension Host와 하네스 그래프 해시 비교 |
| 4 | (2의 결과에 따라) 웹뷰 레이아웃·렌더링 최적화 또는 결과 전송 축소 | 미정 | 구간별 측정 |
| 5 | 증분 그래프 분석(후보 2) | 반복 Generate·편집 시 이득 | 변경 파일·의존 파일 무효화 테스트 |
| 6 | 함수 중심 Call Flow(후보 4) | frontier 축소, 큰 그래프 가시성 | 별도 기능, P13 V1/V2 과제 재평가 |
| 보류 | Graph merge 최적화(후보 3) | 측정상 0.04% 미만 | — |
| 기각 | TypeChecker 공유(후보 1a) | 그래프 변경(VERIFIED) | — |

## P12-B 1순위 작업 상세

1. `src/analyzer/analyze.ts`
   - `analyzeWithWorkspace`의 Program 생성부를 세션 객체에서도 호출할 수 있게 분리한다(`rootNames/options` 계산 1회, `createProgram(..., oldProgram)`).
   - 세션 호스트 `getSourceFile`: 대상 파일이면 새 SourceFile, 아니면 직전 Program의 SourceFile(mtime/size 일치 시), 그 외에는 기존 `getCachedDiskSourceFile`.
   - `analyzeWorkspaceActive` 공개 시그니처와 반환 형식은 그대로 둔다(테스트·패널 호환).
2. `src/panel/CodeGraphPanel.ts`
   - `analyzeWorkspaceWithDepth`에서 세션을 만들고 base·frontier 분석에 사용, 끝나면 해제.
   - `postAnalysisForFile`(단일 확장)은 세션 없이 기존 경로를 유지한다.
3. 테스트
   - 단위: 세션 사용 시와 미사용 시의 그래프가 같은지(fixture 다중 파일, 미저장 버퍼 포함).
   - 단위: 세션 중 파일 mtime 변경 → 새 SourceFile 사용.
   - 회귀: 기존 `sourceFileCache`, `p14CallOwnership` 테스트.
   - 하네스: 이 디렉터리의 `profile-depth-v2.cjs`(`--share-program 0`)로 Hono·Vite D2 시간과 해시를 다시 잰다.
4. 금지: checker 공유, 그래프 페이로드 형식 변경, Marketplace 배포.

## 지금 단계에서 하지 않은 것 (명시)
- P12-B 최적화 구현, 제품 코드 수정
- VS Code UI 구간 측정(메모리 제약)
- Depth 3 측정
- P13 경쟁 도구 비교 재실행
