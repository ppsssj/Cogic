# Corpus B 평가 프로토콜 (P1-L, 실행 전 고정)

- 작성일: 2026-10-29(P1-K1). **Corpus B에 Cogic을 한 번도 실행하지 않은 상태에서** 정했다.
- 결과 분류: P1-L 결과는 **독립 검증 코퍼스의 사전 고정 평가(holdout)**로 보고한다.
  - EXP-01의 사전 등록 확증 결과로 소급해 주장하지 않는다.
  - EXP-01 P1-I–J3 결과도 바꾸지 않는다.
- 이 프로토콜은 P1-L 실행 전에 사람이 GT를 검토하고 승인한 뒤 적용한다. 검토에서 GT가 바뀌면 다음을 다시 고정한 뒤 실행한다.
  - `expected.json`
  - `MANIFEST.json`(새 파일)
  - 이 문서의 해시

## 1. 비교 대상

| 이름 | analyzer | 확인 방법 |
|---|---|---|
| ORIGINAL | `43ace0fdfdf442d7871c3ef4a92d73b28f1b5e77` | `src/analyzer`·`src/shared` tree, package 파일, 빌드 산출물 해시가 runner 1.2의 `ANALYZER_BASELINE`과 같아야 한다 |
| IMPROVED | `bbe4cbf5b1f784d9223ca3d46d96058617687b12`(P1-J1–J3 병합 후 `main`) | 그 커밋의 tree SHA와 빌드 해시를 기록한다 |

- 두 버전에 쓰는 것:
  - 같은 Corpus B 입력(이 커밋의 `corpus-b/fixtures`, `MANIFEST.json` 검사 통과)
  - 같은 TypeScript 5.9.3(`npm ci`)
  - 같은 Node
  - 같은 scorer `exp01-scorer/1.2`
  - 같은 매칭 규칙
- 각 analyzer는 그 커밋의 깨끗한 worktree에서 `npm ci`와 `npm run compile`을 실행한 뒤 쓴다.

## 2. 실행 도구

- runner 1.2(`tools/exp01-run.mjs`)는 EXP-01 코퍼스와 기준 analyzer에 고정되어 있다. **수정하지 않고, 기준 동일성 게이트도 해제하지 않는다.**
- P1-L에서 별도 도구(예: `tools/corpus-b/run.mjs`)를 만든다. 요구 사항은 다음과 같다.
  1. `MANIFEST.json` 검사가 통과해야 시작한다. 실패하면 analyzer를 부르지 않는다.
  2. analyzer 버전(ORIGINAL/IMPROVED)과 그 동일성 정보를 run 기록에 남긴다.
  3. 사례마다 runner 1.2와 같은 입력 구성을 쓴다(`analyzeWorkspaceActive`).
     - workspace = 사례 폴더
     - 파일 = `.ts`/`.tsx` 전체
     - `cacheEnabled: false`
  4. 변형 4개를 실행한다: off#1, off#2(결정성), on-cold, on-warm(캐시 정합성과 hit 경로). off#1을 채점한다.
  5. 원시 결과는 `exp01-raw/1` 형식으로 저장한다. 결과 폴더는 덮어쓰지 않는다.
  6. 채점: `score.mjs --corpus docs/thesis-experiments/corpus-b/fixtures --predictions <dir> --out <dir> --bootstrap 10000`
- 실행 전에 도구 자체를 합성 입력으로 테스트하고 커밋한다.

## 3. 지표

| 구분 | 내용 |
|---|---|
| 주 지표 | strict micro Precision, In-scope Recall, In-scope F1 |
| 보조 지표 | Overall Recall·F1, lenient, macro F1 |
| 분해 | 관계 종류별·framework별·패턴별 TP/FP/FN, 지원 분류(supported/unsupported-by-design/ambiguous)별 |
| 불확실성 | 사례 단위 cluster bootstrap 95% CI(10,000회, seed `20261026`, scorer 1.2 기본값) |
| 버전 비교(paired) | 같은 사례 표본에 두 버전을 함께 다시 뽑는 paired cluster bootstrap으로 ΔF1(IMPROVED − ORIGINAL)의 95% CI를 구한다(10,000회, seed `20261101`) |
| 전이 표 | 관계 키 단위 TP→FN, FN→TP, 새 FP, 사라진 FP |
| 부정 관계 | strict·lenient 위반 수 |
| indeterminate | 확증 지표에서 제외. 제외된 예측 수와 "전부 FP" 민감도 Precision을 함께 보고 |
| 차단 사례 | `SCORING_BLOCKED` 사례 수와 사유. 차단 규칙을 바꿔 다시 채점하지 않는다 |
| 환경 | 사례별 TypeScript 진단 수(validation-report.json), 결정성, 캐시 OFF/ON 결과 |

## 4. 결과를 본 뒤 하지 않는 일

- 결과가 나빠도 다음을 하지 않는다.
  - 데이터셋(파일 선정, 사례 구성, tsconfig, shim)을 바꾸기
  - 정답을 고치기
  - 채점 규칙을 바꾸기
- GT 오류가 의심되면 v1은 그대로 두고 다음 절차를 따른다.
  1. `expected.v2.json`과 변경 기록을 따로 만든다.
  2. 원인 코드를 붙인다(`GT-ERROR`/`GUIDE-AMBIGUOUS`/`REVIEWER-DIFF`).
  3. v1과 v2 결과를 둘 다 보고한다. v1이 사전 고정 결과다.
- analyzer 수정은 Corpus B 결과를 보고 하지 않는다. 하더라도 별도 단계로 하고, 그 결과는 Corpus B의 사전 고정 결과로 보고하지 않는다.

## 5. 공개 범위

- **공개:** 집계 지표, 관계별·패턴별 표, 전이 표, run 기록 요약(해시 포함)
- **비공개 보관:** 원시 예측(절대 경로 포함). 저장소 밖에 ZIP으로 보관하고 SHA-256만 공개한다.

## 6. 해석의 한계 (실행 전 명시)

- **GT 작성:** 생성형 AI가 작성했고 사람 검토 전이다.
- **환경:** 외부 의존성을 설치하지 않았고 외부 패키지를 untyped로 선언했다. 그래서 다음 관계는 평가하지 못한다.
  - framework API 호출
  - 외부 패키지 타입을 통해 해석되는 관계
  - 타입이 있는 React 상태(P1-J1 개선 대상)
- **표본:** 프레임워크별 저장소 1개, 파일 5개, 총 20개다. 코드 줄 수 10–120의 파일만 대상으로 했다(주석 작업량 때문).
- **분포:** determinate 관계 196개 중 supported는 78개이고, 대부분 cross-file·lib 참조 등 지원 범위 밖이다. In-scope 지표는 표본이 작다.
- **부정 관계:** 2개뿐이다. 부정 위반은 참고 지표로만 쓴다.
