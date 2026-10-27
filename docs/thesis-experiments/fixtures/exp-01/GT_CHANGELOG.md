# EXP-01 Ground Truth Changelog

사전 등록 이후의 GT·지침·카탈로그 변경을 모두 여기에 기록한다. 규칙은 [ANNOTATION_GUIDE.md §10](ANNOTATION_GUIDE.md#10-수정과-버전-관리)을 따른다.

| GT 버전 | 날짜 | 사례 | 항목 | 변경 | 사유 | 발견 경위 | 측정 전/후 |
|---|---|---|---|---|---|---|---|
| v1 | 2026-10-26 | 전체 | 전체 | 최초 작성(44 사례) | — | — | 측정 전 |
| v1 (지침 명확화) | 2026-10-27 | h03 외 framework 부정 사례 | `ANNOTATION_GUIDE.md` §5.1, §7 | framework 부정 사례가 synthetic owner/state-source의 존재만 부정하고 같은 위치의 `calls`·`references`·`dataflow`는 부정하지 않는다는 문장을 추가했다. `expected.json`·fixture 소스·`catalog.csv`는 바꾸지 않았다. GT 데이터는 v1 그대로다 | 부정 사례가 일반 관계까지 부정하는 것으로 읽힐 수 있음 | PR #2 검토(P1-A-R1) | 측정 전 |

사전 등록 전 작성 과정에서 고친 내용(예: validator가 찾은 줄 번호 오류)은 [p1a-ground-truth.md §3.3](../../p1a-ground-truth.md#33-사전-등록-전-수정-내역)에 기록했다. v1에는 이미 반영되어 있다.

P1-A-R1의 채점 도구 수정(1:1 매칭, fail-closed 진단)은 GT 변경이 아니다. 기록은 [p1a-ground-truth.md §12](../../p1a-ground-truth.md#12-p1-a-r1-채점-도구-수정)에 있다.
