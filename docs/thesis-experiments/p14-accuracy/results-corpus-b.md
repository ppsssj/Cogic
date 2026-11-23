# Corpus B — 과거 P1-L 검증

## VERIFIED: 무결성과 점수 재계산

P1-L 브랜치 `4c5a3e2`의 601파일 manifest가 일치했다. 20개 사례의 구조·라이선스 및 포함된 upstream 파일과 기록된 SHA256 대조에 문제 0건이었다. 이는 저장된 파일과 저장된 upstream 해시의 대조이며 외부 저장소를 새로 다운로드해 대조한 것은 아니다. validator는 GT 구조 오류 0건, 경고 15건, 외부 untyped shim 등과 관련된 환경 진단 1,421건이다. 이 환경 진단을 실제 타입 안정성 보장으로 해석하지 않는다.

연구실에 남은 원본 ZIP 193파일의 SHA256은 `836c761171b0e673706c6abddb21c02cfd669ad2c20ca26299def21e479eb006`이고 기록값과 같다. 압축 안 193파일은 보존된 실행 폴더와 바이트 단위로 같았다. 기존 scorer 1.2 및 P1-L pair 도구로 원시 예측을 재채점한 결과 JSON 전체가 공개된 pair summary와 구조적으로 일치했다. 공개 summary와 ZIP 안 summary의 바이트는 다르지만 JSON 내용은 같다. 원시 예측의 절대 경로 때문에 ZIP은 공개하지 않았다.

## PROVISIONAL: 기존 두 버전의 strict micro 값

아래는 `PROVISIONAL_HOLDOUT_DIAGNOSTIC`으로 표시된 과거 P1-L 결과이며 **현재 main의 결과가 아니다**. GT는 독립 사람 검토 전이다.

| 값 | ORIGINAL `43ace0f` | IMPROVED `bbe4cbf` |
|---|---:|---:|
| TP / FP / 제외 예측 | 74 / 33 / 6 | 78 / 31 / 6 |
| in-scope TP / GT / FN | 72 / 78 / 6 | 76 / 78 / 2 |
| overall TP / GT / FN | 74 / 196 / 122 | 78 / 196 / 118 |
| Precision v1 | 0.692 | 0.716 |
| Recall in-scope / overall | 0.923 / 0.378 | 0.974 / 0.398 |
| F1 in-scope / overall v1 | 0.791 / 0.488 | 0.825 / 0.511 |
| 보조 Precision v2 (외부 범위 제외) | 0.892 | 0.918 |

Wilson 95% 근사구간은 Precision v1 0.599–0.771 / 0.625–0.792, in-scope Recall 0.842–0.964 / 0.911–0.993, overall Recall 0.313–0.447 / 0.332–0.468이다. 사례 단위 bootstrap 10,000회(seed 20261026)의 in-scope F1 v1 구간은 0.702–0.868 / 0.727–0.896이다. 같은 사례를 함께 재표본화한 paired ΔF1은 +0.034, 95% 구간 0.000–0.071(seed 20261101)이다. 개선은 Vue 사례 2개에 집중되며 구간 하한이 0이라 일반적인 개선을 확증하지 않는다.

기존 scorer의 strict macro F1 in-scope은 0.830→0.873, overall은 0.693→0.722다. 이는 정의된 8개 관계 범주(calls, constructs, references, dataflow, updates, React·Vue·Nest owner)의 평균이며 Express owner는 정의되지 않아 제외됐다. Micro와 분모가 다르므로 나란히 해석해야 한다.

## 관계·framework별 주의점

| 범주 | supported GT | ORIGINAL TP_in / FP | IMPROVED TP_in / FP |
|---|---:|---:|---:|
| calls | 35 | 35 / 27 | 35 / 27 |
| constructs | 3 | 2 / 5 | 3 / 4 |
| dataflow | 20 | 19 / 1 | 20 / 0 |
| references | 13 | 10 / 0 | 12 / 0 |
| owner | 5 | 4 / 0 | 4 / 0 |
| updates | 2 | 2 / 0 | 2 / 0 |

각 framework 5개 사례의 F1 in-scope v1은 React 0.811→0.811, Vue 0.822→0.907, Express 0.720→0.720, NestJS 0.769→0.769다. owner는 통합 범주이므로 위 수치를 각 framework owner의 충분한 표본으로 해석하지 않는다. 기존 summary의 관계·패턴·framework 표와 bootstrap을 그대로 재현했으며, 독립 사람 판정과 외부 대상 범위 결정을 거치기 전 최종 논문의 확정 수치로 쓸 수 없다.

v1 FP 상당수는 GT가 범위를 정의하지 않은 외부 shim 대상이며, v2는 그 예측을 따로 제외한다. 나머지 FP 중 JSX primitive와 익명 default export에 대한 GT 판단은 사람 검토 대상이다. IMPROVED의 supported FN 두 건은 Vue 상태 읽기와 callback owner다. overall FN에는 cross-file references 및 TS lib 대상 등 의도적으로 지원하지 않는 관계가 포함된다. 두 분석기와 현재 main의 차이는 [출처](baseline-and-provenance.md)에 있다.
