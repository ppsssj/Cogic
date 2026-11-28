# P14-E 파일럿 AI 교차 검토 — 수령 자료 재검증 결과

- **상태:**
  - AI 응답 12건을 받아 보존했다(4 사례 × 3 모델).
  - 사람 검토는 수행하지 않았다.
  - 공식 정확도 판정: **BLOCKED**
- **이 문서가 하지 않는 것:**
  - AI 간 일치율을 Cogic의 정확도로 해석하지 않는다.
  - AI 다수결로 GT를 정하지 않는다.
  - GT v1, C1, 프로토콜, scorer를 바꾸지 않는다.
- **검증한 세션의 독립성:** 이 재검증은 GT와 analyzer를 읽은 Claude Code 세션이 했다. 그래서 아래 판단은 독립 검토가 아니다. 형식 검증과 대조 기록으로만 쓴다.

## 1. 수령 자료와 무결성

| 항목 | 결과 |
|---|---|
| 번들 `Cogic_P14E_AI_review_bundle.zip` | SHA-256 `8b89f75240de225bd41f4afa6da2272e8fb4f5285fb89185f98c800f5aeb694b`, 95 655 bytes |
| 번들 안 `SHA256SUMS.txt` | 82파일 모두 OK. 목록 밖 파일 없음(SHA256SUMS 자신 제외 82 + 1 = 83) |
| `ai-review.mjs intake` 12건 | 보존한 원문 SHA-256이 번들 manifest·`provenance.csv`와 모두 같다 |
| 번들의 `compare_preliminary.py` | 실행하지 않았다. 결과는 아래 저장소 도구로 따로 다시 계산했다 |

원문의 출처는 번들 `provenance.csv`가 밝힌 그대로 기록했다(VERIFIED는 "번들 안 사본의 바이트"까지만이다).

| 원문 | 출처 | 원본 바이트와 같은가 |
|---|---|---|
| B18 3건 | 첨부 TXT 원본 | 번들 기준으로는 원본. 그러나 대화·CLI 원본과는 대조하지 못했다 |
| B02·B04·B06 9건 | 대화 텍스트를 옮겨 적은 전사본. Codex B02는 대화 요약에서 옮겼다 | 확인되지 않음 |

## 2. 검토 절차 준수 여부 (RESEARCHER_STEPS §1, AI_REVIEW_PROMPT)

| 항목 | 결과 | 근거 |
|---|---|---|
| 사례마다 새 대화, 한 대화에 한 사례 | UNVERIFIED | 응답의 자기 진술뿐이다 |
| 모델 구성 | **계획과 다르다** | A-5와 RESEARCHER_STEPS는 Claude·GPT-6·Gemini를 정했다. 실제로는 Claude·**Codex**·Gemini다. Codex의 모델과 버전은 응답에 `unknown`으로만 적혀 있다 |
| 모델 이름·버전 | 자기 진술 | Claude는 4건 모두 `Claude Opus 5.5 (claude-opus-5-5)`이다. Gemini는 사례마다 표기가 다르다(`Gemini 4 Hydrogen`, `… (High)`, `Gemini 4`) |
| 지시문 본문을 수정 없이 사용 | **지켜지지 않음(일부)** | 번들 README에 따르면 뒤쪽 Gemini 사례의 지시문에 결과 파일 쓰기 허용 문구가 추가됐다 |
| 규칙 5: 압축 해제·열람 외 도구 금지 | **일부 벗어남** | Gemini는 B04·B06·B18에서 `run_command`로 레지스트리를 조회해 바탕화면 경로를 찾았다. 결과 TXT도 `write_file`로 썼다. 응답에 그 사실을 적었으므로 규칙 5의 "썼다면 적는다"는 지켰다 |
| 다른 사례 열람 금지 | UNVERIFIED | Claude B04·B06·B18과 Codex B06·B18은 "이미 풀린 폴더를 재사용"했다고 적었다. 같은 작업 폴더에서 다른 사례 폴더를 열었는지는 감사하지 않았다 |
| 사용한 패킷 ZIP의 SHA-256 | 기록 없음 | 전달 ZIP `468c016e…`를 썼는지 확인할 수 없다. Gemini 응답의 폴더 이름(`p14e-pilot-ai`)은 이 패킷의 ZIP 접두어와 같다(INFERRED) |
| 응답 형식(```` ```csv <form> ```` 블록) | **8/12 위반** | Claude 4건과 Codex 4건에 fence가 없다. Claude B18은 첨부 원본인데도 fence가 없다. 그래서 복사 과정이 아니라 응답 자체의 문제일 수 있다(INFERRED) |
| 언어 | 확인 필요 | Claude B04만 영어다. 나머지 Claude 응답은 한국어다. 전사 과정에서 번역됐는지 원본으로 확인해야 한다 |

## 3. 저장소 도구로 수행한 처리

모든 산출물은 저장소 밖 `C:\dev\p13\p14e-data\ai-review-v1\`에 있다. 원문을 고치지 않았다.

| 단계 | 결과 |
|---|---|
| `intake` → `evidence-raw/` | 12건. 원문 바이트와 SHA-256, 출처(전사본·첨부 원본), 자기 진술 버전을 기록했다 |
| `extract`(원문) → `forms-raw-*` | Gemini 4/4 파싱. Claude 0/4, Codex 0/4는 `unparsed`(fence 없음) |
| 형식 파생본 `tools/ai-results/fence-derive.mjs` → `derived/` | 표마다 fence 두 줄만 **삽입**했다(응답마다 10줄). 삽입 줄을 빼면 원문과 같은지 확인했다. 원문 SHA-256은 파생본 메타에 남겼다 |
| `intake` → `evidence-derived/`, `extract` → `forms-*` | 12/12 파싱. 추출 행은 번들의 `extracted_as_reported`와 형식·모델별로 같은 행 집합이다 |
| `compare` 세 쌍 → `compare/` | §4 |
| `reconcile.mjs` → `gt-reconcile/` | §6 |

## 4. 형식 오류, 이름 표기 차이와 의미 차이의 구분

### 4.1 CSV 형식 오류 (의미 차이 아님)

`tools/ai-results/csv-check.mjs`로 RFC 4180을 엄격하게 적용했다.

| 응답 | 표 | 행 | 원인 |
|---|---|---|---|
| Claude B04 | negatives | 1, 2, 3, 5, 6 | 마지막 열 `rationale`의 따옴표 없는 쉼표(열 14/13) |
| Claude B04 | sites | 줄 10·11의 두 행 | 마지막 열 `reason`의 쉼표(열 9/8) |
| Claude B04 | ambiguities | 1, 3, 4 | `optionsConsidered`의 쉼표(열 13/11). `ruleCited`·`confidence` 열이 밀린다 |
| Claude B04 | ambiguities | 2 | 따옴표 없는 칸 안의 `"`(열 수는 맞다) |
| Claude B04 | outside-definitions | 4 | 마지막 열의 쉼표(열 9/8) |
| Claude B06 | negatives | 3 | 따옴표 칸 안의 `\"`(RFC 4180은 `""`) |

- 엄격 기준으로 13행이다. 번들은 12행으로 셌다. B04 ambiguities 2는 관대한 파서(Python `csv`)가 통과시키는 행이다.
- Codex·Gemini는 0행이다. **relations 189행(3 × 63)은 모두 정상이다.**
- 오류 행의 키 열(kind, source, target, argIndex, 지점 결정)은 밀리지 않았다. 그래서 `compare`의 관계·부정 사례 비교에는 영향이 없다. 다만 Claude B04 ambiguities의 `ruleCited`는 이 상태로는 읽을 수 없다.

### 4.2 심볼 이름 표기 차이 (의미 차이 아님)

| 필드 | 차이 | 내용 |
|---|---|---|
| `sourceName` | 48관계 | Claude·Gemini는 `SessionRelationalRepository.findById`, Codex는 `findById` |
| `targetName` | 13관계 | Claude·Gemini는 `UserService.findAll`, Codex는 `findAll` |

- 공식 비교 키(`reconcile.mjs`의 `reviewerNodeKey`)는 파일 안 노드를 **파일 + 선언 줄**로 맞추고 이름은 쓰지 않는다. lib 노드만 이름을 쓴다. 이 기준으로는 세 모델의 63개 키가 모두 같다.
- lib 이름(`Number.parseInt`, `Number`, `Error` 등)의 차이는 0이다.
- 번들이 보고한 "정규화 없는 정확 일치 12/63"은 이름까지 비교한 번들 자체 키의 결과다.

### 4.3 의미 비교 (`ai-review.mjs compare`, 세 쌍)

| 쌍 | 긍정 관계 AGREE | KIND/ARG/DETERMINACY/CANDIDATES_DIFF | A_ONLY/B_ONLY | POLARITY_CONFLICT | 부정 사례 일치 / A만 / B만 |
|---|---|---|---|---|---|
| Claude–Codex | 63/63 | 0 | 0 | 0 | 5 / 21 / 11 |
| Claude–Gemini | 63/63 | 0 | 0 | 0 | 7 / 19 / 15 |
| Codex–Gemini | 63/63 | 0 | 0 | 0 | 8 / 8 / 14 |

- 세 모델의 긍정 관계 집합이 같다. 결정성(63개 모두 determinate), 인자 위치, `paramName`도 같다.
  - 종류별: references 28, calls 17, dataflow 16, constructs 2. updates·owner는 0이다.
  - 사례별: B02 7, B04 3, B06 2, B18 51.
- **확신도:** Claude만 B18의 8관계에 `medium`을 적었다.
  - lib 인자 dataflow 7개
  - 줄 13의 `SessionEntity` references
- **부정 사례:** 모델마다 고른 범위가 다르다. 부정 사례는 "검토했지만 관계가 아니라고 본 것"의 목록이어서, 겹치지 않는 것을 불일치로 보지 않는다. 한쪽이 관계라고 하고 다른 쪽이 부정 사례로 적은 충돌(POLARITY_CONFLICT)은 0건이다.
- **사실 오류 1건(VERIFIED):** Codex B04 부정 사례 1의 `router` 선언 줄은 85다. 패킷 소스 `src/router.ts`의 선언 줄은 83이다. Claude·Gemini는 83으로 적었다.

## 5. 지점(site) 분류와 연결 기록

정렬 기준은 (사례, 파일, 줄, 같은 줄 안의 순서)다. 50개 지점이 세 모델에 모두 있다. `siteText` 표기 차이 15건(`<>` 대 `<>…</>`, 인자 생략 등)은 정렬에 쓰지 않았다.

### 5.1 JSX Fragment (B06 줄 12, 결정이 다른 유일한 지점)

| 모델 | 결정 | 이유 |
|---|---|---|
| Claude | `no-node-target` | `React.Fragment`가 untyped `react` 모듈에서 오므로 대상 노드가 없다. ambiguities에 `medium`으로 적었다 |
| Gemini | `no-node-target` | 대상 노드가 없다(환경 §2, 정의 §4.1) |
| Codex | `excluded` | 정의된 관계가 없다 |

- 셋 모두 관계는 적지 않았다. 그래서 관계 집합에는 영향이 없다.
- 정의 문서는 intrinsic JSX(`<div>`)만 명시한다(정의 §4.1 부정 사례, 환경 §2 → `no-node-target`). Fragment는 C1, 정의, 환경 어디에도 없다. 두 해석 모두 문서로 반박되지 않는다.
- 이 차이는 모델 오류가 아니라 **계약 공백**이다. C2 후보로 남긴다. C1은 고치지 않았다.
- 번들의 "세 모델 간 분류 불일치"라는 표현은 정확하지 않다. 실제로는 2 대 1 차이다.

### 5.2 지점과 관계의 연결(`relNos`) 차이 (B18, 7개 지점)

결정은 같고 관계 집합도 같다. 어느 관계 번호를 그 지점에 연결했는지만 다르다.

| 지점 | Claude | Codex | Gemini |
|---|---|---|---|
| 줄 16 `@InjectRepository(SessionEntity)`(`no-node-target`) | 인자 `SessionEntity`의 references를 연결 | 연결 없음 | 연결 없음 |
| 줄 27·31·53·54·60·82 `SessionMapper.toX(...)` | calls + dataflow + 수신 객체 `SessionMapper` references | Claude와 같다 | calls + dataflow만 |

- REVIEWER_GUIDE §3은 "`relNos`에는 해당 관계 번호"라고만 쓴다. 지점의 하위 식(수신 객체, 인자 안 이름)에서 생긴 references를 그 지점에 연결할지 정하지 않았다.
- 이 차이는 **기록 규칙의 공백**이다. 관계 판정과는 무관하다. C2 또는 응답 형식 보강 후보로 남긴다.

## 6. GT v1 대조 (`reconcile.mjs`, GT 변경 없음)

| 모델 | AGREE(determinate 포함) | GT_ONLY | REVIEWER_ONLY | 부정 사례 |
|---|---|---|---|---|
| Claude | 63/63 | 0 | 0 | GT에는 이 4 사례의 부정 사례가 없어, 모델의 부정 사례는 모두 REVIEWER_ONLY다 |
| Codex | 63/63 | 0 | 0 | 위와 같다 |
| Gemini | 63/63 | 0 | 0 | 위와 같다 |

이 결과로 GT가 옳다고 말할 수 없다. 이유는 다음과 같다.

- **같은 출처에 따른 공통 오류 가능성:**
  - GT v1은 AI가 작성했다.
  - C1과 정의 문서는 GT를 읽은 세션이 썼다.
  - 세 모델이 그 문서로 판정했으므로 같은 출처의 오류를 함께 낼 수 있다.
- **쉬운 관계 위주의 표본:**
  - 4 사례의 외부 API는 대부분 shim의 shorthand 모듈이다. 그래서 대부분의 지점이 `no-node-target`이고, 관계 63개 중 51개가 B18 한 사례에서 나왔다.
  - updates, owner, framework 노드, indeterminate 관계가 없어, 이 표본으로는 어려운 종류를 판단할 수 없다.

## 7. 사람 검토가 필요한 항목

사람 검토자는 자기 제출을 고정한 **뒤에** 아래 항목을 함께 본다(RESEARCHER_STEPS §2-6).

| # | 항목 | 성격 |
|---|---|---|
| H-1 | B06 줄 12 Fragment의 지점 결정(`no-node-target` 대 `excluded`) | 계약 공백(C2 후보) |
| H-2 | B18 7개 지점의 `relNos` 연결 규칙 | 기록 규칙 공백 |
| H-3 | Claude가 `medium`을 준 B18 8관계: lib 인자 dataflow 7개, 줄 13 `SessionEntity` references | 일치 항목이지만 확신도가 갈림 |
| H-4 | lib 파라미터 이름(`Number.parseInt`의 `string`·`radix` 등) | 패킷에 TS lib 선언이 없어 모델 지식에 기댄 값이다. 비교 키에는 들어가지 않는다 |
| H-5 | OPEN-2를 인용한 항목: B06 `react/jsx-runtime` 헬퍼, B18 `__decorate`·`__param`·`__metadata` | 세 모델 모두 관계로 적지 않았다. 계약 미결 항목이다 |
| H-6 | Codex B04 `router` 줄 번호 85(소스는 83) | 모델 사실 오류. 관계 집합에는 영향 없음 |
| H-7 | 일치한 긍정 관계 63개 | 표본이 작으므로 무작위 표본 대신 전수 확인을 권한다 |
| H-8 | outside-definitions의 `decorates`·`injects`·plugin 설치 | A-7에 따라 보류. 기록만 한다 |

## 8. 남은 작업

1. **원본 대조(연구자):** 전사본 9건을 대화·CLI 원본과 대조한다. 특히 Claude B04가 영어인 이유와 Codex B02(요약에서 옮김)를 확인한다. 원본을 얻으면 `intake`로 따로 보존한다. 기존 보존본은 덮어쓰지 않는다.
2. **메타데이터 보강(연구자):**
   - Codex의 실제 모델과 버전, 인터페이스(CLI/웹)
   - 각 세션의 기억·웹 설정
   - 사용한 ZIP의 SHA-256
   - Gemini 지시문에 더한 문구 원문
   - 모르면 `unknown`으로 남긴다
3. **모델 구성 결정(연구자):** A-5가 정한 GPT-6 대신 Codex를 쓴 것을 승인할지, GPT-6 응답을 따로 받을지 정한다.
4. **사람 검토(연구자와 검토자):**
   - `p14e-pilot-human.zip`으로 진행한다. AI 결과와 이 문서는 보여 주지 않는다.
   - 이 문서는 공개 저장소에 있다. 검토자에게 저장소를 주지 않는다는 기존 조건이 그대로 필요하다.
   - 제출을 받으면 바로 SHA-256으로 고정한다. 그 뒤 §7을 조정한다.
5. **파일럿 결과로 정할 것(D-5):**
   - 검토 인원과 범위
   - C2 후보: Fragment, `relNos` 연결 규칙, 응답 fence 강제 방식, lib 파라미터 이름의 근거
   - 이것들은 사람 검토 결과를 본 뒤 연구자 승인으로만 반영한다.
6. **공식 정확도는 BLOCKED를 유지한다.** 게이트 4(독립 사람 검토)가 열려 있다.

## 9. VERIFIED / INFERRED / UNVERIFIED

- **VERIFIED:**
  - 번들과 원문 12건의 SHA-256
  - intake·extract·compare·reconcile 실행 결과
  - CSV 오류 13행(엄격 기준)
  - 이름 표기 차이 61관계(sourceName 48 + targetName 13)
  - 지점 차이 1 + 7
  - Codex B04 줄 번호 오류
  - GT v1 63/63 일치
  - Gemini의 `run_command`·`write_file` 사용(응답의 자기 기록)
- **INFERRED:**
  - fence 누락이 응답 자체의 문제라는 판단(Claude B18 첨부 원본 근거)
  - Gemini가 이 패킷 ZIP을 썼다는 판단(폴더 이름 근거)
  - Fragment와 `relNos` 차이가 계약 공백이라는 분류
- **UNVERIFIED:**
  - 전사본 9건의 원본 동일성
  - 세션 독립성과 설정
  - Codex·Gemini의 정확한 모델과 버전
  - 사용한 ZIP
  - 다른 사례 폴더 열람 여부
  - 사람 검토(수행하지 않음)
