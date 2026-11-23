# 결과 일관성 (RQ2)

원자료: [data/summary/p11-correctness.csv](data/summary/p11-correctness.csv)(본 실행), [p11-correctness-pass.csv](data/summary/p11-correctness-pass.csv)(검증 실행), [data/raw/p11-corr.blocks.jsonl.gz](data/raw/p11-corr.blocks.jsonl.gz)

## 1. 정책 변경(Fixed 800 → Adaptive)은 결과를 바꾸지 않는다
같은 프로젝트·시나리오·반복 번호끼리 Fixed 800과 Adaptive 결과를 비교했다. 비교 대상은 결과 **전체**다:
- 노드: 종류, 이름, 파일, 범위, 시그니처
- 엣지: 종류, source/target, label
- imports, exports, calls, diagnostics, trace(데이터 흐름·심볼 연결), meta

→ **1,425 / 1,425 표본이 엄격히 동일**(5개 프로젝트 × 6개 시나리오).

## 2. 캐시 ON vs OFF
| 프로젝트 | 새 분석(cold, warm, 편집, cross-file, 파일 전환) | 결과 캐시 적중(repeated) |
|---|---|---|
| hono, vite, typeorm, query | strict 동일(cold 14/14, warm 25/25, 각 75/75) | strict 해시는 다름. **JSON 의미론 해시는 15/15 동일** |
| excalidraw | **strict 불일치**(id 해시는 모두 동일) | 불일치 |

### 2.1 결과 캐시 적중의 strict 차이 — 정상 차이
결과 캐시는 결과를 `JSON.parse(JSON.stringify())`로 복제한다. 이때 값이 `undefined`인 속성(예: 엣지 `label`)이 사라진다. 새 분석 결과에는 그 속성이 `undefined`로 남아 strict 해시가 달라진다.
- 검증 실행에서 JSON 의미론 해시(`undefined` 속성 = 없음)로 비교하자, 4개 프로젝트 모두 두 정책에서 15/15 동일했다.
- 웹뷰 메시지도 직렬화되므로 사용자가 보는 데이터는 같다.

### 2.2 excalidraw의 캐시 ON/OFF 차이 — **기존 제품 버그**
- **현상**:
  - 677개 노드 중 4개의 타입 시그니처가 다르다. 엣지 3,325개와 모든 id는 같다.
  - 1개는 의미가 다르다. `i18n.ts`의 `t(path: …)` 매개변수 타입이 캐시 OFF에서는 `NestedKeyOf<{ labels: …; … }>`, 캐시 ON에서는 **`any`**다.
  - 나머지 3개는 유니언 멤버 순서만 다르다(예: `"mermaid" | "text-to-diagram"` ↔ `"text-to-diagram" | "mermaid"`).
- **재현성**: OFF끼리, ON끼리는 항상 같다(결정적). Fixed 800과 Adaptive도 같다. 즉 **P9 정책과 무관한 SourceFile 캐시 경로의 문제**다(P9 이전 정책 빌드 `396923c`에도 같은 코드가 있다).
- **원인**:
  - 캐시 경로(`getCachedDiskSourceFile`)는 `ts.createSourceFile(…, pickScriptKind(requested, ""))`로 파싱한다. `pickScriptKind`는 `.tsx/.jsx/.js`가 아니면 전부 `ScriptKind.TS`를 돌려준다.
  - 캐시 OFF의 기본 컴파일러 호스트는 확장자로 종류를 정한다(`.json` → JSON).
  - excalidraw는 `resolveJsonModule: true`이고 `i18n.ts`가 `./locales/en.json`을 import한다. 캐시 ON에서는 이 JSON이 TypeScript 코드로 파싱되어 모듈 타입을 얻지 못하고 `any`가 된다. 타입 생성 순서가 달라져 다른 유니언의 출력 순서도 바뀐다.
- **검증(진단 빌드)**: 캐시 경로에서 스크립트 종류만 확장자로 추론하도록 바꾼 진단 사본(`adaptive-sk`, [tools/variants/adaptive-sk-diagnostic.diff](tools/variants/adaptive-sk-diagnostic.diff), 제품 코드 아님)으로 비교했다.

  | 비교 | 결과 |
  |---|---|
  | 진단 빌드: 캐시 ON vs OFF | strict **5/5 동일** |
  | v0.0.6 Adaptive: 캐시 ON vs OFF | 0/5 동일 |

  가설이 확인됐다.
- **영향 범위(추정)**: `.json`을 import하고 `resolveJsonModule`을 쓰는 프로젝트. 확장자 규칙상 `.mjs/.cjs/.mts/.cts`도 같은 경로를 탄다(이번 대상에서는 관찰되지 않음).
- **조치**: 연구 단계에서는 제품 코드를 고치지 않았다. **별도 수정 PR을 권장한다**: 캐시 경로에서 디스크 파일의 `ScriptKind`를 확장자 기반으로 정하고, 회귀 테스트로 JSON import 타입 비교를 추가한다.
- **후속 (P11 이후)**: PR #26에서 수정했다(`.json`, `.mjs`/`.cjs` 포함). 수정 전후 검증은 [../p11-scriptkind-fix/README.md](../p11-scriptkind-fix/README.md)에 있다. 이 문서의 P11 측정값은 수정 전 v0.0.6 기준이며 그대로 둔다.

## 3. Cross-file 편집 후 무효화
의존 파일을 디스크에서 바꾼 뒤의 결과는 4개 프로젝트에서 OFF와 75/75 동일했다(excalidraw는 2.2의 버그 영향만 있음). 캐시 무효화 후 관계 분석이 정상임을 확인했다.

## 4. UI에서의 그래프 동일성
UI 결과마다 노드 id·kind·file·range와 엣지 id·kind·source·target의 해시를 기록했다.
- 28개 단계 중 26개는 3개 조건에서 같은 해시였다.
- 나머지 2개(hono 편집 0, hono 파일 전환 2)는 **같은 조건 안에서 실행마다** 해시가 달랐다(OFF·Adaptive 모두). 노드·엣지 수는 같았다. 캐시 조건과 무관한 실행 간 변동이며, UI 하네스가 해시만 저장해서 원인은 특정하지 못했다([limitations.md](limitations.md)).
