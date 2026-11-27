# P14-D — Semantic Contract 감사와 근거 기반 GT 검증 설계

- **기준:** `main` `9f4e867`(PR #60 병합). 브랜치 `research/p14d-semantic-contract`.
- **변경하지 않은 것:** 제품 코드, GT v1, 기존 연구 결과와 AI 검토 원본, scorer·runner 정책.
- **변경한 것:** P14-C 패킷 생성기에 Corpus 선택과 추가 템플릿 옵션을 넣었다. 기본 출력은 그대로이며, 기본 패킷 해시가 `b44d15c…`로 같은지 확인했다.
- **공식 정확도 판정:** 여전히 **BLOCKED**다(P14-C 게이트 3·4·5). 이 단계에서 정확도를 측정하지 않았다.

| 문서 | 내용 |
|---|---|
| [semantic-contract-audit.md](semantic-contract-audit.md) | 1. 관계 6종의 의미, 쟁점 10개, 모호 항목 SC-1–SC-9 |
| [evidence-matrix.md](evidence-matrix.md) · `gt-profile.json` | 2. 근거 9종의 범위·한계, 관계 범주별 근거와 GT 수 |
| [s037-review.md](s037-review.md) · [evidence/s037-gemini/](evidence/s037-gemini/README.md) | 3. S037 세 모델 비교, Gemini 원문 보존 절차 |
| [decorator-tools.md](decorator-tools.md) · `decorator-probe/` | 4. 데코레이터 도구 비교(직접 실행과 문서 조사 구분) |
| [ai-review/](ai-review/README.md) · `tools/ai-review.mjs` | 5. Corpus B AI 교차 검토 패킷과 원문 보존·불일치 추출 도구 |
| [human-review-options.md](human-review-options.md) | 6. 사람 검토 방식 A/B/C 비교 |
| [decorates-design.md](decorates-design.md) | 7. `decorates` 관계 설계 검토(구현 안 함) |
| §1 아래 | 8. P14-C 프로토콜 변경 권고 |
| §2 아래 | 9. 테스트와 재현 |
| §3 아래 | 10. 미해결 승인 항목 |

## 핵심 발견

1. **S037은 GT 오류가 아니라 계약 미명시다.**
   - 데코레이터 호출에서는 lexical 위치, 평가 위치, 적용 대상의 세 개념이 갈라진다.
   - 평가 위치는 **컴파일 설정에 따라 다르다**(VERIFIED):
     - `experimentalDecorators`: 모듈 최상위의 `__decorate`. 함수 안 클래스면 그 함수 안
     - 표준 데코레이터: 클래스 static block 안
   - GT v1은 카탈로그의 `owner = file` 계약을 따른다. 지침 문장은 이 계약과 전제를 다 담지 못한다.
2. **도구 사이에, 그리고 한 도구 안에서도 데코레이터 계약이 다르다**(VERIFIED, 직접 실행).
   - **TypeScript Call Hierarchy(LS API와 VS Code UI가 같은 결과):**
     - 메서드 데코레이터의 caller는 메서드 자신이다.
     - 그러나 그 메서드의 outgoing에는 없고, 클래스의 outgoing에 나온다.
   - **Cogic:**
     - 클래스·프로퍼티·생성자 파라미터 데코레이터 팩토리는 `file`의 호출로 표현한다.
     - 메서드·메서드 파라미터 데코레이터는 표현하지 않는다.
     - 일반 데코레이터는 꾸며진 선언의 `references`로 표현한다.
   - **Trace Function Flow 1.1.1:** 이 fixture에서 클래스 메서드를 추적 시작점으로 제시하지 않았다.
   - **Context Graph, CodeQL:** ENVIRONMENT_BLOCKED. CodeQL은 문서상 `Decorator.getElement()`로 적용 대상을 별도로 둔다.
3. **근거마다 독립성이 다르다.** TypeScript Compiler API 기반 근거(Symbol, Type, LS)는 Cogic과 공통 원인 오류를 공유한다. AI 간 일치는 정답의 증명이 아니다.

## 1. P14-C 프로토콜 변경 권고 (채택은 승인 대상)

| ID | 권고 | 이유 |
|---|---|---|
| R-1 | 평가 프로토콜에 **Semantic Contract 버전** 축을 추가한다. GT 정정(v1→v2)과 계약 변경(C1→C2)을 구분해 기록하고, 계약을 바꾸면 두 계약으로 모두 채점한다 | S037: 정답이 아니라 표현 정책의 문제 |
| R-2 | 계약 C1을 v1 자료(지침 + 카탈로그 + D10)에서 **명시적으로 추출**해 고정한다. 데코레이터는 모델 A(평가 위치, `experimentalDecorators` 전제)로 명시한다. 사람 검토 패킷에 이 계약을 넣는다 | 검토 전에 쟁점을 정하지 않으면 검토자 불일치가 계약 모호성과 섞인다 |
| R-3 | SC-1–SC-9를 검토자 질문 목록과 `REVIEW_CRITERIA.md` 보강 후보로 둔다. 보강하면 P14-C 패킷을 다시 만들고 해시를 갱신한다 | 일관된 검토 |
| R-4 | 관계마다 **근거 유형 주석**(AST·Symbol·emit·runtime)을 GT와 별도 파일로 만든다. 보고 시 근거 유형별로 결과를 나눌 수 있게 한다 | evidence-matrix |
| R-5 | 사람 검토는 Corpus B 전체 작성(A), Corpus A는 근거 기반 + 표본(C+B)을 권한다. 표본만 검토하면 "전체 GT 사람 검증"을 주장하지 않는다 | human-review-options |
| R-6 | AI 교차 검토는 선별 도구로만 쓴다. 같은 입력, 서로 비공개, 원문 보존(`ai-review.mjs`)을 지킨다 | S037의 입력 불일치 |
| R-7 | `decorates`는 평가 범위 밖이다. 제품에 도입하면 scorer 1.2가 그 사례를 `SCORING_BLOCKED`로 만든다. 그러므로 프로토콜 고정 전에 제외 규칙을 정한다 | decorates-design §6 |

## 2. 테스트와 재현

**이번에 실행한 검사(VERIFIED):**

| 검사 | 결과 |
|---|---|
| PR #60 | 병합됨(`9f4e867`). CI는 GitGuardian SUCCESS. main 트리 = PR #60 HEAD `8f38bea` 트리 |
| `npm test` | 183 passing |
| `build:all`, `lint:all`, `git diff --check` | 통과 |
| Corpus A manifest | gt 214파일 OK, 평가 r2 227파일 OK |
| EXP-01 scorer·runner 테스트 | 94/94 |
| P14-C 연구 도구 테스트 | 16/16(생성기 옵션 추가 후 재실행. 아래 표) |
| P14-D 테스트 `tools/test/p14d.test.mjs` | 6/6 |
| 데코레이터 probe(TS emit·LS·Cogic) | `decorator-probe/probe-result.json` |
| VS Code UI Call Hierarchy | `ui-evidence/` |
| TFF UI | `ui-evidence/` |

**재현:**

```powershell
npm run compile
node --test docs/thesis-experiments/p14c-protocol/tools/test/*.test.mjs docs/thesis-experiments/p14d-semantic-contract/tools/test/*.test.mjs
node docs/thesis-experiments/p14d-semantic-contract/decorator-probe/probe.cjs --out <file>
node docs/thesis-experiments/p14d-semantic-contract/tools/gt-profile.mjs
node docs/thesis-experiments/p14d-semantic-contract/tools/ai-review.mjs build --out <저장소 밖 새 폴더>
```

UI 단계는 [decorator-tools.md §3](decorator-tools.md#3-재현)을 따른다.

## 3. 미해결 승인 항목

| ID | 결정 |
|---|---|
| A-1 | S037·데코레이터 계약: A 유지(권장) / B로 v2 / C(새 관계, 제품 결정) |
| A-2 | 계약 버전 축 도입(R-1)과 C1 명시 문서 고정(R-2) |
| A-3 | SC-1–SC-9 중 검토 전에 정할 항목과 검토자에게 쟁점으로 알릴 항목 |
| A-4 | 사람 검토 방식(R-5)과 검토자 확보(P14-C D-5) |
| A-5 | AI 교차 검토에 쓸 모델 목록, 인터페이스, 비용 |
| A-6 | Gemini 원문 제공과 공개 범위(개인 정보 확인) |
| A-7 | `decorates` 도입 여부와 시점(권장: 논문 범위 밖) |
| (계속) | P14-C D-1–D-5(lenient 정책, Corpus B의 main 통합, runner 1.3, 분류 대응, 검토자) |

## 4. VERIFIED / INFERRED / UNVERIFIED

- **VERIFIED:**
  - PR #60 상태와 모든 검사 결과
  - 데코레이터 emit 위치
  - TS LS 결과와 VS Code UI Call Hierarchy 결과의 일치와 incoming/outgoing 비대칭
  - Cogic의 데코레이터 출력
  - Cogic `walk`가 메서드 본문만 순회한다는 점(코드 읽기)
  - TFF 1.1.1의 시작점 목록에 메서드가 없음(이 fixture)
  - Context Graph 패키지에 Windows worker가 없음
  - scorer 1.2의 `unknown-edge-kind` blocking
  - AI 패킷의 누출 0건과 사람 패킷과의 중립 ID 대응
  - GT 범주별 개수
- **INFERRED:**
  - 감사의 판정(CLEAR/AMBIGUOUS/GAP/CONFLICT)
  - 세 모델 비교와 권고
  - 근거 범주 분류(휴리스틱)
  - 사람 검토 방식의 부담 추정
  - `decorates`의 가치
- **UNVERIFIED:**
  - Gemini 원문(미수령. 요약만 있음)
  - GPT-6가 카탈로그를 읽었는지
  - CodeQL의 실제 동작(쿼리 미실행, CLI 미설치)
  - Context Graph의 macOS 동작
  - TFF의 다른 시작점에서의 데코레이터 처리
  - 실제 AI 교차 검토(미수행)
  - 사람 검토(미시작)
