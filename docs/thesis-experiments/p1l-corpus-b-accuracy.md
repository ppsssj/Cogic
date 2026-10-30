# P1-L: Corpus B 정확도 평가 (ORIGINAL vs IMPROVED)

- 작성일: 2026-10-30
- 연구 상태: **`PROVISIONAL_HOLDOUT_DIAGNOSTIC`**
  - Corpus B GT v1은 독립 사람 검토 전이다(`REVIEW_PENDING`, `humanReviewed: false`).
  - 이 결과는 사람 검토가 끝나기 전의 진단 결과다. 확정 수치로 쓰지 않는다.
- 판정: **`PROVISIONAL_ACCURACY_EVALUATION_COMPLETE`**(20/20 사례, 두 버전 모두 완료, 차단 사례 0)
- 기준
  - Corpus B: PR #15 브랜치(`b4a5ff5`, PR #16–#18 병합 후)
  - 평가 절차: v1 프로토콜(`corpus-b/EVALUATION_PROTOCOL.md`)이 주 지표, v2(`review-preparation/EVALUATION_PROTOCOL.v2.md`, 2026-10-30 ppssj 승인)가 보조 민감도 분석
  - scorer `exp01-scorer/1.2`, TypeScript 5.9.3
- 공개 자료: [corpus-b/results/p1l/](corpus-b/results/p1l/)
  - `pair-summary.json`: 집계, 관계·framework별 표, 전이, bootstrap
  - `run-summary.json`: run 기록 요약
  - 원시 예측은 저장소 밖 ZIP에만 있다(§9).

## 1. 주 결과 (strict, micro, 20개 사례)

| 지표 | ORIGINAL | IMPROVED | 차이 |
|---|---|---|---|
| TP | 74 | 78 | +4 |
| FP | 33 | 31 | −2 |
| FN (In-scope) | 6 | 2 | −4 |
| Precision v1 | 0.692 | 0.716 | +0.024 |
| Recall In-scope | 0.923 (72/78) | 0.974 (76/78) | +0.051 |
| F1 In-scope v1 | 0.791 | 0.825 | +0.034 |
| F1 Overall v1 | 0.488 | 0.511 | +0.023 |
| Precision v2 (보조) | 0.892 | 0.918 | +0.026 |
| F1 In-scope v2 (보조) | 0.907 | 0.945 | +0.038 |

- Recall Overall: ORIGINAL 0.378(74/196), IMPROVED 0.398(78/196). FN(Overall)은 122 → 118이다.
- indeterminate와 맞아 제외된 예측(EXCL)은 두 버전 모두 6개다. bn05·bv02·bv05의 파라미터 함수·추상 메서드 호출과 그 dataflow다.
- 부정 사례 위반: 두 버전 모두 0(br01 `NEG-CUSTOM-HOOK`, be02 `NEG-EXPRESS-NONROUTE`)
- TS lib 대상 예측: 두 버전 모두 0이다. 그래서 lib 대상 GT 52개(모두 unsupported-by-design)는 전부 FN이다. Overall Recall이 낮은 주된 이유다.

## 2. 불확실성 (사례 단위 cluster bootstrap)

| 지표 | ORIGINAL 95% CI | IMPROVED 95% CI |
|---|---|---|
| F1 In-scope v1 | 0.702 – 0.868 | 0.727 – 0.896 |
| F1 Overall v1 | 0.379 – 0.605 | 0.386 – 0.643 |
| F1 In-scope v2 | 0.828 – 0.990 | 0.866 – 1.000 |
| F1 Overall v2 | 0.417 – 0.651 | 0.424 – 0.692 |

- 조건: 10,000회, seed 20261026, scorer 1.2의 `bootstrapMicroF1`

**Paired ΔF1 (IMPROVED − ORIGINAL)**
- 조건: 사례 단위 paired bootstrap 10,000회, seed 20261101, v1·v2 같은 재표본

| 차이 | 점추정 | 95% CI | Δ>0 비율 | Δ<0 비율 |
|---|---|---|---|---|
| ΔF1 In-scope v1 | +0.034 | 0.000 – 0.071 | 0.878 | 0.000 |
| ΔF1 Overall v1 | +0.023 | 0.000 – 0.052 | 0.878 | 0.000 |
| ΔPrecision v1 | +0.024 | 0.000 – 0.056 | 0.878 | 0.000 |
| ΔRecall In-scope | +0.051 | 0.000 – 0.099 | 0.878 | 0.000 |
| ΔF1 In-scope v2 | +0.038 | 0.000 – 0.079 | 0.878 | 0.000 |
| (ΔF1_in,v2 − ΔF1_in,v1) | +0.004 | 0.000 – 0.010 | 0.878 | 0.000 |

- 어떤 재표본에서도 Δ가 음수가 아니었다.
- 95% CI의 하한은 0이다.
  - 변화가 Vue 사례 2개(bv03, bv04)에만 있어서, 재표본의 12.2%는 두 사례를 모두 뽑지 않는다(Δ = 0).
  - 따라서 "개선 효과가 0보다 크다"는 CI 기준으로 확인되지 않는다.

## 3. 관계 종류별 (v1)

| 종류 | GT(in-scope) | ORIGINAL TP_in / FP | IMPROVED TP_in / FP | 변화 |
|---|---|---|---|---|
| calls | 52 (35) | 35 / 27 | 35 / 27 | 없음 |
| constructs | 6 (3) | 2 / 5 | 3 / 4 | +1 TP, −1 FP |
| dataflow | 37 (20) | 19 / 1 | 20 / 0 | +1 TP, −1 FP |
| references | 82 (13) | 10 / 0 | 12 / 0 | +2 TP |
| owner | 17 (5) | 4 / 0 | 4 / 0 | 없음 |
| updates | 2 (2) | 2 / 0 | 2 / 0 | 없음 |

- calls FP 27 중 20개는 shim 대상(외부 API)이고 7개는 로컬 대상이다(§7).
- Overall Recall이 낮은 종류는 references(0.12 → 0.15)와 owner(0.24)다. GT의 cross-file·lib 참조와 지원 범위 밖 framework owner가 많기 때문이다.

## 4. framework별 (v1, v2)

| framework | 사례 | F1_in v1 O → I | P v1 O → I | P v2 O → I | F1_in v2 O → I |
|---|---|---|---|---|---|
| React | 5 | 0.811 → 0.811 | 0.682 → 0.682 | 0.714 → 0.714 | 0.833 → 0.833 |
| Vue | 5 | 0.822 → **0.907** | 0.811 → 0.872 | 0.938 → 1.000 | 0.882 → 0.971 |
| Express | 5 | 0.720 → 0.720 | 0.563 → 0.563 | 0.900 → 0.900 | 0.947 → 0.947 |
| NestJS | 5 | 0.769 → 0.769 | 0.625 → 0.625 | 1.000 → 1.000 | 1.000 → 1.000 |

- 두 버전의 차이는 Vue에만 있다. 나머지 세 framework는 TP·FP·FN이 같다.
- framework별 supported 관계가 적다(React 13, Vue 36, Express 9, NestJS 20). 그래서 framework별 값은 기술 통계다.

## 5. 관계 단위 전이 (v1)

| 전이 | 수 | 내용 |
|---|---|---|
| TP → TP | 74 | |
| **TP → FN(기존 관계 손실)** | **0** | |
| **FN → TP(복구)** | **4** | bv03 R01 `constructs` CONS-TOPLEVEL(`new Storage(...)`), bv03 R02 `dataflow` DF-CONSTRUCTOR, bv04 R15·R16 `references` REF-SHORTHAND-PROPERTY |
| FN → FN | 118 | |
| **신규 FP** | **0** | |
| 사라진 FP | 2 | bv03 `constructs`·`dataflow`가 `storage.ts:7`(생성자 줄)을 가리키던 예측. IMPROVED는 클래스 선언 `storage.ts:3`을 가리켜 위 R01·R02와 매칭된다 |

- 복구 4개는 P1-J3(생성자 관계) 2개, P1-J2(shorthand references) 2개에 해당한다.
- P1-J1(React 상태 updates) 대상 관계는 Corpus B에 없다(P1-K2·K3). 그래서 이 표본으로 평가할 수 없다.
- 남은 In-scope FN(IMPROVED): bv03 R06 `references` REF-STATE-READ, bv03 R18 `owner` FW-VUE-CALLBACK

## 6. v1과 v2의 차이와 해석

| | ORIGINAL | IMPROVED |
|---|---|---|
| 채점 대상 예측(고유 키) | 113 | 115 |
| v2에서 제외(E) | 24(모두 OUT_SHIM_DECLARATION: calls 20, constructs 4) | 24(같음) |
| v2 FP | 9 | 7 |
| 위험 지표(제외 예측과 owner·종류가 같은 FN) | 2 | 2(같은 2건) |

- v1 FP 33개 중 24개(73%)는 대상이 shim 선언(untyped 외부 패키지)인 예측이다.
  - GT는 이 범위를 정의하지 않으므로(A2) v1에서는 모두 FP다.
  - 이 24개가 Precision 차이(v1 0.69 대 v2 0.89)의 전부다.
- 두 버전의 E는 크기와 클래스가 같다. 그래서 버전 간 차이는 v1과 v2에서 거의 같다(ΔF1_in +0.034 대 +0.038).
- **P-5 해석 규칙 적용**
  - 두 Δ는 부호가 같다(모든 재표본에서 0 이상).
  - 두 CI는 모두 하한이 0이다.
  - v1·v2 결론은 충돌하지 않는다. 그래서 결론은 외부 대상 처리 방식에 강건하다.
- **결론(잠정)**
  - IMPROVED는 Corpus B에서 기존 TP를 잃지 않았고 새 FP를 만들지 않았다(회귀 없음).
  - 개선 대상 관계 4개를 복구했다.
  - 다만 변화가 2개 사례에 몰려 있어 paired CI 하한이 0이다. "독립 코퍼스에서 개선이 통계적으로 확인되었다"고는 쓸 수 없다.
- **위험 지표 2건(연구자 최종 판정 대기, P-4)**
  - 사실관계 정리(판정 아님)

| 사례 | 제외된 예측 | 대상 shim 줄 | 같은 owner의 FN |
|---|---|---|---|
| bn02 | `deleteByUserIdWithExclude` → shim 12행 | `declare module "typeorm"` | R50 `Number(...)`(CALL-LIB) |
| br03 | `file` → shim 26행 | `declare module "react-dom/client"` | R01 `document.getElementById`, R05 `.then`(둘 다 CALL-LIB) |

  - 두 건 모두 제외된 예측은 실제 외부 모듈 호출(`softDelete`/`Not`, `createRoot`)로 보인다.
  - FN은 analyzer가 내지 않는 TS lib 호출이다. 잘못 연결된 로컬 관계로 보이지 않는다.
  - 최종 판정은 연구자가 한다.

## 7. 남은 로컬 FP (v2에도 남는 7개, 두 버전 같음)

| 사례 | 예측 | 비고 |
|---|---|---|
| br01 | `FormDrawer` → `drawer.tsx` 8·10·12·55·104행, `button.tsx` 46행 calls(JSX 컴포넌트) | GT는 이 컴포넌트들을 "외부 primitive 값이나 `React.forwardRef` 값이라 §2 노드가 아님"으로 판단했다(excluded sites, REVIEW R-14) |
| be02 | `file` → `errorHandler.ts:13` calls | GT는 `errorHandler`의 default export가 이름 없는 화살표 함수라 §2 노드가 아니라고 판단했다(REVIEW R-01 노트) |

- 이 7개는 GT 판단(사람 검토 대상)에 따라 FP가 아닐 수 있다.
- **결과를 보고 GT를 바꾸지 않았다.** 사람 검토에서 이 판단이 바뀌면 v1 프로토콜 §4의 v2 GT 절차로 다시 채점하고, 이 결과와 함께 보고한다.

## 8. 실행 무결성

| 항목 | 결과 |
|---|---|
| 사례 | 20/20 완료(두 버전) |
| ORIGINAL | worktree `43ace0fdfdf442d7871c3ef4a92d73b28f1b5e77`, 빌드 해시 `958dbf67…6270`. EXP-01 `ANALYZER_BASELINE`과 모든 항목이 같다 |
| IMPROVED | worktree `bbe4cbf5b1f784d9223ca3d46d96058617687b12`, 빌드 해시 `2423b0d4…ac36`. baseline과 다른 항목은 `srcAnalyzerTree`·`analyzerBuildHash`뿐이다(개선 내용) |
| runner | `corpus-b-runner/1`, commit `4529a41`. 합성 테스트 7개 통과 후 commit한 뒤 실행했다 |
| 결정성 | off#1 = off#2: 20/20(두 버전). 순서까지 같다 |
| 캐시 정합성 | on-cold = on-warm = off#1: 20/20. warm hit 경로 실행 20/20 |
| SCORING_BLOCKED | 0 |
| 코퍼스 파일 | 실행 전후 해시 동일 |
| 사전 확인 | Corpus B MANIFEST 601, GT validator 0, EXP-01 manifest 214·227, P1-K2 baseline(scorer·runner·GT·analyzer), v2 protocol freeze 9개, runner 저장소 clean |
| 결과 확인 후 변경 | 채점 규칙·GT·manifest·analyzer·scorer 변경 없음 |

## 9. 원시 결과

- 위치: 연구자 로컬 장비의 저장소 밖 결과 폴더(`cogic-results/p1l/`). 개인 경로는 공개하지 않는다.
- 묶음: `p1l-corpusb-20261030.zip`, SHA-256 `836c761171b0e673706c6abddb21c02cfd669ad2c20ca26299def21e479eb006`
- 내용: 파일 193개
  - 두 run 폴더: `predictions/`, `repeats/`, `run.json`
  - 채점 폴더: 버전별 v1·v2 scorer 출력, `scope-comparison.json`, `pair-summary.json`
- 원시 예측에는 절대 경로가 있어 GitHub에 올리지 않았다.

## 10. 한계

1. **GT 사람 검토 전**
   - GT는 생성형 AI가 작성했고, 작성자는 analyzer 구현을 알고 있다.
   - §7의 FP 7개, 남은 FN 2개, 위험 지표 2건은 검토 결과에 따라 바뀔 수 있다.
2. **개선 대상 표본이 작다**
   - P1-J1–J3 대상 관계는 6개 안팎이고, 그중 4개가 복구되었다.
   - React 상태 관계는 0개다.
   - paired CI 하한 0은 이 표본 크기의 한계를 반영한다(P1-K3 Q4).
3. **Precision 해석**
   - v1 Precision은 GT가 정의하지 않은 외부 대상 예측(24개)을 FP로 센다.
   - v2는 그것을 뺀 민감도 분석이다. 어느 쪽도 외부 API 추출이 맞는지는 평가하지 않는다.
4. **환경:** 외부 패키지가 untyped이다(P1-K2). framework API 관계와 타입 의존 기능은 평가하지 않았다.
5. **TS lib 대상**
   - analyzer는 lib 대상 관계를 내지 않는다(이번 실행에서 확인: tsLib 관계 0).
   - 그래서 Overall Recall에는 상한(0.735)이 있다.
6. **표본:** 프레임워크마다 저장소 1개, 파일 5개다. 저장소 간 일반화는 주장하지 않는다.
7. **결과 분류:** 이 결과는 EXP-01 사전 등록 확증 결과가 아니라 독립 코퍼스의 사전 고정 평가다. 그것도 사람 검토 전이라 잠정적이다.
