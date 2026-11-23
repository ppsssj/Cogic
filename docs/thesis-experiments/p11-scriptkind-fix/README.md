# SourceFile 캐시 ScriptKind 수정 (P11 후속)

P11 실제 프로젝트 검증(PR #25, `docs/thesis-experiments/p11-real-world/`)에서 발견한 **캐시 ON/OFF 결과 차이**의 수정 기록이다. 기준 코드는 v0.0.6(`3e343d4`)이다. 이 PR에는 버전 변경, 배포, Adaptive 용량·메모리 상한 변경이 포함되지 않는다.

## 1. 원인
| 경로 | 디스크 파일 ScriptKind 결정 |
|---|---|
| 캐시 OFF: TypeScript 기본 `CompilerHost.getSourceFile` | `createSourceFile`에 종류를 넘기지 않음 → TypeScript가 확장자로 추론 |
| 캐시 ON: `getCachedDiskSourceFile` (v0.0.6) | `pickScriptKind(file, "")` → `.tsx`/`.jsx`/`.js`가 아니면 전부 `TS` |

TypeScript 5.9.3이 확장자로 추론하는 종류와 v0.0.6 캐시 경로를 비교했다:

| 확장자 | TypeScript 추론 | v0.0.6 캐시 경로 |
|---|---|---|
| `.ts` `.mts` `.cts` `.d.ts` `.d.mts` `.d.cts` | TS | TS |
| `.tsx` / `.jsx` / `.js` | TSX / JSX / JS | 같음 |
| **`.json`** | **JSON** | **TS** ✗ |
| **`.mjs` `.cjs`** | **JS** | **TS** ✗ |
| 기타(`.vue`, 확장자 없음) | TS | TS |

영향:
- `resolveJsonModule`로 import한 JSON이 TypeScript 코드로 파싱되어, JSON에서 유도한 타입이 `any`가 된다.
- `.mjs`/`.cjs`가 TypeScript로 파싱되어, CommonJS의 `module.exports`가 인식되지 않는다. 그 결과 잘못된 진단(`has no default export`)이 생기고 호출 노드가 사라진다.

정의 위치용 fallback 파서(`createModuleLocationResolver`)도 같은 `pickScriptKind(file, "")`를 썼다.

## 2. 수정 (`src/analyzer/analyze.ts`)
- 디스크 파일용 `diskScriptKind(fileName)`을 추가했다. TypeScript 기본 호스트와 같이 확장자로 종류를 정한다: `.json` → JSON, `.js/.mjs/.cjs` → JS, `.jsx` → JSX, `.tsx` → TSX, 그 외 → TS.
- 캐시 경로와 fallback 파서에서 `pickScriptKind(file, "")` 대신 이 함수를 쓴다.
- 활성 편집기 파일은 VS Code `languageId`를 쓰므로 기존 `pickScriptKind`를 그대로 둔다.
- P11 진단 패치(`undefined`를 넘겨 TypeScript가 정하게 함)는 쓰지 않았다. 명시적으로 매핑하면 캐시 키의 `scriptKind`가 의미를 유지하고, 테스트가 TypeScript 추론과 직접 비교할 수 있다.

## 3. 회귀 테스트 (`src/test/sourceFileScriptKind.test.ts`)
1. **확장자 매핑**: 16개 파일 이름(대소문자 포함)에 대해 `diskScriptKind`가 TypeScript의 추론 종류와 같은지 비교한다.
2. **캐시 ON/OFF 동등성**: 최소 재현 프로젝트를 쓴다.
   - 구성: `resolveJsonModule`, `en.json`에서 유도한 `NestedKeyOf` 키 경로 타입, `.mjs` ES 모듈, `.cjs` CommonJS 모듈
   - 비교 대상: 캐시 OFF, 캐시 ON 첫 분석, 캐시 ON 캐시 적중 분석(SourceFile hit 확인)
   - 비교 항목: `t`의 시그니처, 진단, 그래프 노드·엣지, 결과 전체(JSON 의미론)
   - 추가 단언: OFF에서 JSON 유도 타입이 유지되고, `legacy.triple` 노드가 있으며, 진단이 없다.

| | 수정 전 | 수정 후 |
|---|---|---|
| `npm test` | 46 통과, **2 실패**: 매핑(`a.mjs`: JS 기대, TS 실제), 캐시 ON 첫 분석에서 `t` 시그니처 `(path: any)` | **48 통과**, 0 실패 |

수정 전 최소 재현 결과(캐시 OFF / ON):
- `t (i18n.ts)`: `(path: NestedKeyOf<{ labels: …; errors: …; }>): string` / `(path: any): string`
- `legacy.triple (legacy.cjs)`: 노드 있음 / **없음**
- 진단: 없음 / `Module '…/legacy' has no default export.`

## 4. 실제 프로젝트 확인 (P11 대상 5개, 소규모 재측정)
P11 대상에서 활성 파일 편집 1블록씩(warm-up 3 + 측정 15)을 측정했다. 조건은 수정 빌드 캐시 OFF(기준), v0.0.6 캐시 ON, 수정 빌드 캐시 ON이며, 프로젝트마다 순서를 회전했다. 원자료: [data/](data/)

| 프로젝트 | v0.0.6 ON = OFF (strict) | 수정 ON = OFF (strict) | 캐시 hit / miss / skipFull (v0.0.6 → 수정) | Program SourceFile | 유지 힙 |
|---|---|---|---|---|---|
| hono | 15/15 | 15/15 | 12,000/5,535/5,535 → 동일 | 1,169 → 1,169 | 209.6 → 209.6 MB |
| excalidraw | **0/15** | **15/15** | 14,415/8,175/8,175 → 14,415/8,205/8,205 | 1,506 → **1,508** | 479.3 → 480.5 MB |
| vite | 15/15 | 15/15 | 동일 | 2,315 → 2,315 | 348.7 → 348.8 MB |
| typeorm | 15/15 | 15/15 | 동일(100% hit) | 4,141 → 4,141 | 496.2 → 496.2 MB |
| query | 15/15 | 15/15 | 동일(100% hit) | 246 → 246 | 107.1 → 107.1 MB |

- **excalidraw `NestedKeyOf` → `any` 수정 확인**: `i18n.ts`의 `t(path: …)`가 v0.0.6 캐시 ON에서는 `(path: any, …)`, 수정 후 캐시 ON에서는 캐시 OFF와 같은 `(path: NestedKeyOf<{ labels: { signUp: string; … }>, …)`이다([data/scriptkind-excalidraw-t-signature.json](data/scriptkind-excalidraw-t-signature.json)). 결과 전체가 OFF와 엄격히 같아졌다.
- excalidraw의 Program SourceFile이 2개 늘었다(1,506 → 1,508). JSON을 JSON으로 파싱하면서 컴파일러가 디스크에서 요청하는 파일 구성이 바뀐 것으로 보인다. 결과가 캐시 OFF와 같아졌으므로 OFF 동작에 맞춰진 것으로 해석하며, 늘어난 두 파일이 무엇인지는 특정하지 않았다. 캐시 용량(961)은 같고 skipFull이 30회(15표본 합계) 늘었다.
- **남은 의미적 차이: 확인된 것 없음.** 5개 프로젝트 모두에서 캐시 ON(수정)과 OFF의 결과 전체가 엄격히 같다.

### 성능
1블록 측정에서 수정 빌드가 v0.0.6보다 1–6% 느려 보여, typeorm·hono를 ABBA 순서로 다시 쟀다(블록 중앙값, ms):

| 프로젝트 | v0.0.6 (A) | 수정 (B) | 판단 |
|---|---|---|---|
| typeorm | 1,426.9 / 1,363.3 | 1,389.6 / 1,359.3 | 범위 겹침. 1블록에서 본 +5.7%는 실행 순서 효과 |
| hono | 1,070.6 / 1,066.6 | 1,090.7 / 1,081.1 | 수정 빌드가 두 블록 모두 약 1.5%(15–20 ms) 느림 |

hono의 약 1.5% 차이는 1블록 측정(+1.1%)과도 방향이 같다. 그러나 변경은 캐시 미적중 시 확장자 비교 몇 개뿐이고, hono의 결과·캐시 이벤트·Program은 수정 전후 동일하다. 원인을 특정하지 못했으며, 같은 조건의 블록 간 변동 수준으로 본다(통계 검정 없음).

## 5. 기존 기능 회귀
| 검사 | 결과 |
|---|---|
| `npm test`(lint·컴파일 포함, VS Code 1.147.0) | 48 통과 |
| 실제 VS Code UI 회귀(로컬 테스트용 VSIX, 버전 0.0.6 그대로, 배포 안 함) | Root A/B/C·Runtime Debug 27/27, 폴더 Root 직접 지정 10/10, Root 밖 frame, 소스 이동, P1, 편집+Refresh 3/3(관찰 2) — 6개 스펙 모두 통과 |

## 6. 한계
- 성능 확인은 소규모(1블록 + 2개 프로젝트 ABBA)이며 통계 검정이 아니다.
- `.mjs`/`.cjs`/`.json` 동작은 최소 재현 프로젝트와 excalidraw(JSON)에서만 확인했다. P11 대상 중 `.mjs`/`.cjs`를 Program에 포함하는 프로젝트에서 수정 전후 결과가 달라졌는지는 따로 집계하지 않았다(hono·vite·typeorm·query는 수정 전후 결과가 동일).
