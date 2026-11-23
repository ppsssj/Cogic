# Corpus A — 현재 main 실행

## VERIFIED: 입력과 실행

GT v1 manifest 214파일, scorer/평가 manifest r2 227파일이 일치한다. validator는 44개 사례, 오류 0건, 경고 5건이며 TypeScript 진단은 0건이다. 기존 coverage는 determinate 651개(supported 565, unsupported-by-design 68, determinate ambiguous 18), indeterminate 8개, negative 49개다. 해시와 형식 확인은 정답의 의미가 맞는다는 증거는 아니다.

`fdaecd4`에서 기존 runner 1.2와 scorer 1.2를 사용해 캐시 OFF 2회 및 ON cold/warm을 각각 실행했다. 44/44 사례가 실행·채점됐고 44/44에서 결정성, OFF/ON 일치, warm hit 경로가 확인됐다. scorer는 `COMPLETE`지만 runner는 과거 baseline `43ace0f`와 analyzer 및 빌드가 달라 `ANALYZER_NOT_IDENTICAL_TO_BASELINE`으로 기술 게이트를 거부했다. 결과는 GT v1·사후 개정 scorer의 **현재 버전 진단**이며 과거 baseline 결과가 아니다.

보존된 `matches.csv`의 GT·예측 행을 strict와 lenient별로 다시 세어 micro summary의 TP·FP·제외·GT 분모와 대조한 결과는 일치했다. 행 수 일치는 GT의 정당성이나 게이트 통과를 보장하지 않는다.

## BLOCKED: 정확도 수치 보고

runner가 명시적으로 숫자를 보고하지 말라고 했으므로 이 보고서는 해당 실행의 P/R/F1·구간을 결과로 게시하지 않는다. 새로운 analyzer를 대상으로 한 평가 프로토콜을 별도로 고정하고, 도구의 정확도 게이트·아래 완화 채점 문제와 사람 GT 검토를 해결한 뒤 산출해야 한다. 이 제한은 analyzer를 원래 baseline이라고 주장하지 않고 실행할 수 있다는 사실과 별개다.

## DIAGNOSTIC: 우선 검토 항목

- `c05-optional-generic-overload`에서 `CALL-OVERLOAD-LOCAL` calls 및 `DF-POSITIONAL` dataflow가 supported GT에 대해 FN으로 채점됐다. 오버로드 선언 선택과 정규화 키·허용 대상 목록을 확인해야 한다. 채점 결과만으로 분석기 결함으로 확정하지 않는다.
- strict에서 `c06-jsx-dynamic-import` references, `e01-inline-handlers`의 Express owner에 귀속된 calls, `v02-namespace-unsupported` calls가 FP로 나타났다. GT 경계·owner·대상 선언을 소스와 별도 검토해야 한다.
- supported 밖 GT의 누락은 overall과 in-scope에서 다르게 계산되며, TS lib 매핑 D11의 구조적 제한도 있다. indeterminate는 별도 제외된다.
- `d01-parameter-binding`에서 lenient의 FP가 strict보다 늘어나는 현상을 독립 합성 테스트로 재현했다([GT 감사](ground-truth-audit.md)). 채점 정책 검토 전 strict/lenient 수치를 단순 비교하지 않는다.

새 원시 run은 개인 경로가 포함돼 저장소 밖에 보존했다. `p14a-main-fdaecd4-20261123.zip`(186파일)의 SHA256은 `de229b6b78a8b98d5d9921c46e6c5336710e6ab9cba563a15adb1abce029b2b9`이다. 외부 보존 위치와 재실행 조건은 [재현](reproduction.md)에 정리했다.
