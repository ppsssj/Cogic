# P1-K1: 독립 검증 코퍼스(Corpus B) 준비

- 작성일: 2026-10-29
- 기준: `main` `bbe4cbf5b1f784d9223ca3d46d96058617687b12`(P1-J1–J3 병합 후)
- 상태: **입력과 GT를 고정했다. 사람 검토 전(`REVIEW_PENDING`). Cogic은 Corpus B에 실행하지 않았다.**
- 판정: **`HOLDOUT_CORPUS_READY_FOR_REVIEW`**
- 상세 자료: [corpus-b/README.md](corpus-b/README.md)

---

## 1. 목적과 결과 분류

- 목적: EXP-01의 결과가 합성 fixture 밖에서도 성립하는지 평가할 코퍼스를 만든다.
  - EXP-01 코퍼스 A는 fixture 44개이고, analyzer 개선(P1-J1–J3) 과정에서 반복해서 봤다. 그래서 그 결과만으로는 일반화를 주장하기 어렵다.
- 원칙: 실제 오픈소스 코드에서 고른 파일로 입력과 GT를 **Cogic 실행 전에** 고정한다.
- 결과 분류: P1-L에서 이 코퍼스로 얻는 결과는 "독립 검증 코퍼스의 사전 고정 평가(holdout)"다.
  - EXP-01의 사전 등록 확증 결과로 주장하지 않는다.
  - P1-I–J3 결과를 다시 분류하지 않는다.

## 2. 산출물

| 경로 | 내용 |
|---|---|
| `corpus-b/fixtures/<framework>/<caseId>/` | 사례 20개: upstream 원본 파일, untyped shim, 파생 tsconfig, LICENSE, `upstream.json`, `case.json`, `expected.json` |
| `corpus-b/fixtures/catalog.csv` | EXP-01 패턴 카탈로그 원본 복사 |
| `corpus-b/review/*.mjs` | 사례별 검토 결정(초안 대비 변경 기록) |
| `corpus-b/selection.json` | 파일 선정 결과 |
| `corpus-b/MANIFEST.json` | 601개 파일의 SHA-256 |
| `corpus-b/{README,ANNOTATION_ADDENDUM,EVALUATION_PROTOCOL,REVIEW}.md` | 설계, 보충 주석 규칙, P1-L 평가 절차, 사람 검토 항목 |
| `corpus-b/{validation,audit}-report.json` | 검증·감사 결과(상대 경로만) |
| `tools/corpus-b/*.mjs` | 선정·사례 구성·초안·GT 생성·검증·감사·manifest 도구 9개 |

## 3. 저장소와 commit

| 프레임워크 | 저장소 | 라이선스 | commit |
|---|---|---|---|
| TS+React | alan2207/bulletproof-react(`apps/react-vite`) | MIT | `9506629ed003a561c6627735480cce4994244bb4` |
| TS+Vue | mutoe/vue3-realworld-example-app | MIT | `741c215ef0f674f90fcb03c5493a1b3a3a7f1b03` |
| TS+Express | edwinhern/express-typescript | MIT | `983fa0413659cd921c5754b00f7817903eb91364` |
| TS+NestJS | brocoders/nestjs-boilerplate | MIT | `9620f159eefe38f47747d02ab162852367c5472c` |

- 저장소 선정 기준과 제외한 저장소 6개는 [corpus-b/README.md §2](corpus-b/README.md#2-저장소)에 있다.

## 4. 선정 파일

| 프레임워크 | 후보 → eligible | seed | 선정 파일(사례) |
|---|---|---|---|
| React | 130 → 18 | 20261030 | form-drawer.tsx, textarea.tsx, main.tsx, content-layout.tsx, input.tsx (br01–br05) |
| Vue | 73 → 7 | 20261031 | main.ts, use-follow-profile.ts, store/user.ts, use-async.ts, use-favorite-article.ts (bv01–bv05) |
| Express | 24 → 9 | 20261032 | userRouter.ts, server.ts, rateLimiter.ts, errorHandler.ts, userController.ts (be01–be05) |
| NestJS | 188 → 80 | 20261033 | auth-google.controller.ts, session.repository.ts, main.ts, file.schema.ts, files.service.ts (bn01–bn05) |

- 선정 규칙(`corpus-b-selection/2`)
  - 다음 파일을 제외한다: 테스트·fixture·생성 파일, 그 프레임워크를 import하지 않는 파일, re-export만 있는 파일, 코드 줄 10–120 밖의 파일.
  - 남은 파일을 경로순으로 정렬한다.
  - EXP-01과 같은 `seededShuffle`로 섞고 앞의 5개를 고른다.
- 사례 구성
  - 선정 파일과 로컬 import closure를 upstream 바이트 그대로 넣었다.
  - 외부 패키지는 untyped(`declare module "x";`)로 선언했다.

## 5. Ground Truth 요약

| 항목 | 값 |
|---|---|
| 사례 | 20 |
| determinate | 196 |
| └ supported | 78 (calls 35, dataflow 20, references 13, owner 5, constructs 3, updates 2) |
| └ unsupported-by-design | 116 |
| └ ambiguous | 2 (br02·br05 rest 파라미터 dataflow) |
| indeterminate | 14 (unbounded 10, 후보 열거 4) |
| 부정 관계 | 2 (br01 `NEG-CUSTOM-HOOK`, be02 `NEG-EXPRESS-NONROUTE`) |
| excludedSites | 73 |

| 프레임워크 | determinate | supported | unsupported-by-design | ambiguous | indeterminate | 부정 |
|---|---|---|---|---|---|---|
| React | 31 | 13 | 16 | 2 | 0 | 1 |
| Vue | 56 | 36 | 20 | 0 | 10 | 0 |
| Express | 34 | 9 | 25 | 0 | 2 | 1 |
| NestJS | 75 | 20 | 55 | 0 | 2 | 0 |

- 각 관계에 기록한 항목: caseId, source/target(§2 노드), kind, evidence(파일:줄), pattern(카탈로그), 지원 분류, `gtStatus`. indeterminate에는 사유(`reason`)도 적었다.
- 정답 기준: EXP-01 주석 지침 v1과 관계 종류를 그대로 쓴다. 실제 코드에 적용하면서 생긴 경우는 [ANNOTATION_ADDENDUM.md](corpus-b/ANNOTATION_ADDENDUM.md) A1–A10으로 정했다.

## 6. 독립성 조치

| 요구 | 조치 |
|---|---|
| Cogic 예측을 보지 않는다 | Corpus B에 analyzer를 실행하지 않았다. 초안 도구는 TypeScript checker만 쓰고 analyzer 코드를 import하지 않는다. `case.json` `cogicOutputUsed: false` |
| analyzer 구현에 맞춰 정답을 만들지 않는다 | 관계는 지침 정의로만 정했다. 지원 범위 밖 관계도 그대로 적었다(unsupported-by-design 116개) |
| 애매한 관계를 지원 범위에 넣지 않는다 | 조건식 alias, 추상 메서드, 파라미터 함수 호출은 indeterminate로 두었다(14개) |
| 기존 GT 44개를 고치지 않는다 | `fixtures/exp-01`을 바꾸지 않았다. `gt-manifest.json` 검사 OK |
| 입력·GT를 먼저 고정한다 | `MANIFEST.json`(601개 파일). `make-gt.mjs`를 다시 실행해도 drift 없음 |
| 사람 검토 전임을 표시한다 | 20개 모두 `REVIEW_PENDING`, `humanReviewed: false`. audit가 이 상태를 확인한다 |

- 남은 독립성 위험
  - 작성자(Claude Code)는 analyzer 구현을 읽었다.
  - GT를 쓴 주체가 생성형 AI 하나다.
  - 그래서 [REVIEW.md](corpus-b/REVIEW.md)의 사람 검토를 P1-L 실행의 선행 조건으로 두었다.

## 7. 작성 중 수정 (고정 전)

두 가지를 고쳤다. 모두 MANIFEST 고정 전에 했고, Cogic 결과는 없는 상태였다.

1. **선정 도구 결함(selection/1 → selection/2)**
   - 결함: `REEXPORT_ONLY` 판정이 정규식으로 문장을 나눴다. 세미콜론이 없는 Vue `src/main.ts`가 re-export 파일로 잘못 제외되었다.
   - 조치: TypeScript parser로 고치고 같은 seed로 다시 추첨했다.
   - 영향
     - Vue는 eligible이 6개에서 7개로 늘었다. `use-tags.ts`가 빠지고 `main.ts`(bv01-main)가 들어왔다.
     - 다른 3개 프레임워크는 그대로이고, 다시 빌드한 사례 15개도 바이트 단위로 같았다.
   - 상세: [corpus-b/README.md §3.1](corpus-b/README.md#31-선정-도구-수정-이력-selection1--selection2)
2. **패턴 분류 정정**
   - 문제: 초안 도구가 JSX·import 함수 호출의 패턴을 owner 위치보다 먼저 정했다.
   - 조치: A4 순서로 고쳤다.
   - 영향: br02·br03·br05의 4개 관계 패턴이 바뀌었다. 모두 supported에서 supported로 바뀌어 지원 분류 집계는 그대로다.

## 8. 검증 결과

| 항목 | 결과 |
|---|---|
| 저장소·commit | 선정 도구가 checkout HEAD를 고정 SHA와 비교한다. 4개 모두 일치 |
| 파일 존재·해시 | 포함 파일이 모두 `upstream.json`의 SHA-256과 같다 |
| 라이선스 | 4개 저장소 MIT. 20개 사례에 `LICENSE.upstream` 원문 |
| GT 형식 | 기존 `validate-gt.mjs`(수정 없음): GT 오류 0. 외부 타입 부재로 생긴 TypeScript 진단은 환경 진단으로 분리했다(사례별 수는 README §6) |
| endpoint | 끊긴 endpoint 0(audit) |
| 중복·모순 | 중복 관계 0, 관계-부정 모순 0, determinate-indeterminate 후보 겹침 0, 카탈로그 밖 패턴 0 |
| 선정 결정성 | 같은 checkout에서 다시 실행하면 4개 프레임워크 모두 eligible·선정이 같다 |
| EXP-01과 중복 | 0(LF 정규화 후 같은 `.ts`/`.tsx` 없음) |
| EXP-01 manifest | `gt-manifest.json` OK(214개), `eval-manifest.r2.json` OK(227개) |
| scorer 1.2 테스트 | 53/53 통과 |
| runner 1.2 테스트 | 41/41 통과 |
| compile·lint | `npm run compile` 통과, `npm run lint:all` 통과 |
| `npm test` | 41 passing / 0 failing |
| production 코드 | `src/`, `webview-ui/src/`, `package*.json` 변경 없음 |
| 공개 자료 | 새 파일에 개인 경로·사용자 정보 없음(검색 0건) |

## 9. 기존 자료 불변

이 PR은 새 폴더 두 개(`docs/thesis-experiments/corpus-b/`, `docs/thesis-experiments/tools/corpus-b/`)와 이 보고서를 더한다. 기존 파일은 `docs/thesis-experiments/README.md`(문서 목록과 변경 이력 행 추가)만 바꾼다. 다음은 바꾸지 않았다.

- EXP-01 GT v1: `expected.json`, `case.json`, `catalog.csv`, ANNOTATION_GUIDE
- manifest: `gt-manifest.json`, `eval-manifest.r1.json`, `eval-manifest.r2.json`
- scorer 1.2(`tools/exp01/`), runner 1.2(`tools/exp01-run.mjs`)와 기준 동일성 게이트
- P1-I–J3 원시 결과, `docs/benchmarks/`
- analyzer(`src/`)와 lockfile

## 10. 사람 검토 대기 항목

- 전수 검토 대상: 20개 GT(determinate 196, indeterminate 14, 부정 2, excludedSites 73)
- 우선 검토 항목: [REVIEW.md](corpus-b/REVIEW.md)에 사례별 판단 14개(R-01–R-14)와 환경·규칙 결정 7개(R-ENV-1–7)를 정리했다. 결과에 큰 영향을 주는 항목은 다음과 같다.
  - R-ENV-1: 외부 패키지를 untyped로 둔 환경. framework API 관계를 평가하지 못한다.
  - R-01: Express 배열 handler 4개
  - R-04: 조건식 alias 후보 4개
  - R-05: 추상 메서드 dispatch
  - R-ENV-5: 선정 도구 수정 후 재추첨

## 11. 라이선스와 재현성

- 라이선스: 4개 저장소 모두 MIT다. 사례마다 LICENSE 원문을 같이 넣어 저작권 고지를 유지했다. 포함한 코드는 upstream 파일을 바꾸지 않은 사본이다.
- 재현
  1. README §10의 명령으로 같은 commit을 checkout한다.
  2. 선정 → 사례 구성 → GT 생성 → 검증 → 감사를 다시 실행한다.
  3. `manifest.mjs --check`로 고정 상태를 확인한다.
- 외부 의존: GitHub 저장소가 commit을 유지해야 한다. 저장소가 사라져도 평가에 필요한 파일은 모두 이 저장소에 있다.

## 12. P1-L 준비도

| 항목 | 상태 |
|---|---|
| 입력 고정 | 완료(`MANIFEST.json`) |
| GT 고정 | 완료. **사람 검토 전** |
| 평가 절차 | 완료([EVALUATION_PROTOCOL.md](corpus-b/EVALUATION_PROTOCOL.md)): ORIGINAL `43ace0f` 대 IMPROVED `bbe4cbf`, scorer 1.2, strict P/R/F1, in-scope/overall, 관계·패턴별 TP/FP/FN, 사례 단위 cluster bootstrap 95% CI, paired ΔF1, 부정 위반, 공개 범위 |
| 채점 호환성 | GT가 scorer 1.2의 구조 검사(`validateGtStructure`)를 통과한다. `score.mjs --corpus corpus-b/fixtures`로 채점할 수 있다 |
| 실행 도구 | **미작성.** runner 1.2는 EXP-01 전용이고 기준 동일성 게이트를 해제하지 않는다. P1-L에서 Corpus B용 도구를 따로 만들고 합성 입력으로 먼저 시험한다 |
| 선행 조건 | 사람 검토 완료 → (GT가 바뀌면 새 manifest) → 실행 도구 작성·시험 → 실행 |

## 13. 한계

- 표본: 프레임워크마다 저장소 1개, 파일 5개, 총 20개다. 저장소 간 일반화는 주장할 수 없다.
- 지원 범위 안 관계가 적다(supported 78). 특히 Express(9)와 React(13)는 프레임워크별 In-scope 지표가 불안정하다.
- 외부 패키지를 untyped로 두었으므로 framework API 관계와 typed React 상태(P1-J1 개선 대상)는 평가하지 못한다.
- 부정 관계가 2개뿐이라 부정 위반은 참고 지표로만 쓴다.
- GT 작성자는 생성형 AI 하나이고 analyzer 구현을 알고 있다. 사람 검토 전에는 결과를 확정 수치로 쓰지 않는다.

## 14. 결론

- **판정: `HOLDOUT_CORPUS_READY_FOR_REVIEW`**
- 4개 프레임워크의 실제 오픈소스 코드에서 고정 규칙과 seed로 파일 20개를 골랐다.
- Cogic 출력을 보지 않고 GT(determinate 196, indeterminate 14, 부정 2)를 작성했다.
- 입력·GT·도구를 manifest로 고정하고, P1-L 평가 절차를 실행 전에 정했다.
- 남은 일은 사람 검토와 P1-L용 실행 도구 작성이다. 그 전에는 Corpus B 정확도를 측정하지 않는다.
