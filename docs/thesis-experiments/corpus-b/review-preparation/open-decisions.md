# Corpus B 미결정 사항 (P1-K3 기준)

모두 **OPEN**이다. 이 PR은 어느 것도 결정하지 않는다.

| ID | 결정 사항 | 선택지 | 결정 주체 | 막는 단계 | 출처 |
|---|---|---|---|---|---|
| D-1 | 채점 범위: 외부 API 예측을 Precision 분모에 넣는 v1 정책만 쓸지, v2 민감도 지표를 미리 추가할지 | (a) v1만 보고하고 해석 한계를 명시 / (b) v2 초안(scope-restricted Precision 등)을 채택하고 P1-L 전에 고정 / (c) 다른 정의 | 연구자 | P1-L 실행 | [scoring-scope-audit.md](scoring-scope-audit.md) |
| D-2 | 독립 사람 검토자 확보 | 검토자 이름·자격·Cogic 구현 열람 여부. 검토자가 없으면 P1-C 방식 B(single-annotator 명시)로 보고할지 | 연구자 | 블라인드 검토 시작 | [review-status.json](review-status.json) `independentReviewerSecured: false` |
| D-3 | 판정자(adjudicator) | 검토자와 다른 사람인가. 연구자 본인이면 그 사실을 기록 | 연구자 | reconciliation | [blind-review-guide.md](blind-review-guide.md) §1 |
| D-4 | R-ENV-8(br01 `useCallback` 반환 함수), R-ENV-9(bn03 `includes`) | 현행 유지(대상 없음) / GT v2에서 관계 추가 | 사람 검토자 → 판정자 | GT 확정 | P1-K2 decision.md §4 |
| D-5 | 블라인드 보충 규칙의 [검토 대상] 규칙(A3 수신 객체, A4, A5, A6, A7 앵커) | 검토자가 동의하지 않으면 reconciliation에서 규칙 자체를 판정 | 판정자 | GT 확정 | [blind-addendum.md](blind-addendum.md) |
| D-6 | Corpus C 착수 여부와 React 상태 층의 분석 환경 | 착수 / 보류. 착수하면 환경(untyped / 고정 의존성) | 연구자 | Corpus C 설계 고정 | [corpus-c-proposal.md](corpus-c-proposal.md) |
| D-7 | P1-K2 U-2: upstream 의존성 환경 민감도 분석을 P1-L에 추가할지 | 추가(사전 고정) / 안 함 | 연구자 | P1-L 실행 | P1-K2 decision.md §5 |
| D-8 | P1-K2 U-4: `react/jsx-runtime` shim 추가(새 Corpus B 버전에서만) | 추가 / 안 함 | 연구자 | Corpus B v2를 만들 때 | P1-K2 decision.md §5 |
| D-9 | 검토 범위: 20개 전수 / 표본 | P1-K3 기본값은 전수(285개 항목, 지점 184개) | 연구자 | 블라인드 검토 시작 | [README.md](README.md) |

## 결정 기록 방법

- 결정마다 다음을 이 문서 아래에 추가한다.
  - 결정일
  - 결정자
  - 선택지
  - 근거
  - 영향받는 파일
- 결정 때문에 GT·manifest·프로토콜이 바뀌면 v1은 두고 새 버전 파일을 만든다(P1-K2 decision.md Q6).
