# P12-B 결과

원자료: [data/runs/](data/runs/)(실행 25건, 모두 completed, 건너뜀·중단 0건), [data/summary-runs.csv](data/summary-runs.csv), [data/summary.json](data/summary.json). 측정은 **Node에서 제품 함수(`analyzeWorkspaceDepth`)를 직접 호출**한 값이며 VS Code UI 응답 시간이 아니다. 조건 정의는 [reproduction.md](reproduction.md).

## 1. 그래프 정합성 (VERIFIED)

| 프로젝트 · Depth | 노드 / 엣지 | 정규화 해시(앞 16자) | base | off | on | 세 조건 동일 |
|---|---|---|---:|---:|---:|---|
| hono D0 | 10 / 14 | `448c6c7ce49f6b64` | 1 | 1 | 1 | 예 |
| hono D1 | 16 / 46 | `eb89223a0c404744` | 1 | 1 | 1 | 예 |
| hono D2 | 85 / 207 | `77d23f3c13cd5e9c` | 3 | 3 | 3 | 예 |
| vite D0 | 46 / 73 | `fac9c6342acbd154` | 1 | — | 1 | 예 |
| vite D1 | 153 / 412 | `e92ad4debbcb0f31` | 1 | — | 1 | 예 |
| vite D2 | 1,078 / 3,755 | `1772aaa81b3bd363` | 2 | 1 | 3 | 예 |

(표의 숫자는 실행 수)

- base는 P12-A main(`7469baf`) 빌드, off/on은 P12-B 빌드(`3f03334`)다. 정규화 전 원시 해시도 모든 조건에서 같았다(hono D2 `45ea10193f03…`, vite D2 `3f9848fc3404…`). 이 두 값은 **P12-A 기준 실행의 원시 해시와도 같다**. P12-A 증거와 연속된다는 뜻이다.
- 노드·엣지 수만이 아니라 직렬화한 그래프 전체(노드 이름, 시그니처, 범위, 엣지 대상, dataflow 라벨, 순서)가 바이트 단위로 같다.

## 2. 실행 시간 (VERIFIED)

| 프로젝트 · Depth | base | off | on | on / base |
|---|---|---|---|---|
| hono D0 | 3.63 s | 4.06 s | 3.72 s | 변화 없음(세션 미사용, n=1) |
| hono D1 | 3.51 s | 3.96 s | 3.57 s | 변화 없음(세션 미사용, n=1) |
| **hono D2** | 7.08 / 6.37 / 6.84 s (중앙값 6.84) | 6.64 / 6.41 / 6.59 s | **3.87 / 4.28 / 3.87 s (중앙값 3.87)** | **1.77배, −43%** |
| vite D0 | 6.40 s | — | 6.57 s | 변화 없음(n=1) |
| vite D1 | 5.59 s | — | 5.59 s | 변화 없음(n=1) |
| **vite D2** | 65.64 / 65.58 s (중앙값 65.61) | 65.42 s | **11.06 / 11.24 / 10.98 s (중앙값 11.06)** | **5.93배, −83%** |

- D0·D1은 분석이 1회라 세션을 만들지 않는다(설계대로). 차이는 실행 간 잡음 범위다(n=1).
- off ≈ base: 세션을 끈 P12-B 경로가 기준과 같은 비용이다. 리팩터링(`depth.ts`)으로 생긴 오버헤드는 관찰되지 않았다.
- Vite D2 on(11.0–11.2 s)은 P12-A 하네스 후보 `old-sf`(12.2–12.6 s, 다른 시점 측정)와 비슷하다. 제품 구현은 재사용할 때마다 `stat` 검사를 하는데도 이 범위에 들어온다.

## 3. Program 생성 (VERIFIED, 제품 이벤트 `analyzer.program.created`)

| | Program 수 | createProgram 합 | 첫 Program | 확장 Program 중앙값 | TS 구조 재사용 | 재사용 SourceFile |
|---|---:|---:|---:|---:|---|---:|
| hono D2 off (r1) | 3 | 5.51 s | 3.16 s | 1.19 s | 없음 | 0 |
| hono D2 on (r1–r3) | 3 | 3.00–3.41 s | 2.89 s | 0.05–0.06 s | `completely` 2/2 | 2,334 (= 1,167 × 2) |
| vite D2 off | 35 | 58.77 s | 4.55 s | 1.55 s | 없음 | 0 |
| vite D2 on (r1–r3) | 35 | **7.54–7.78 s** | 4.50–4.70 s | **0.085–0.087 s** | `completely` 34/34 | 77,996 (= 2,294 × 34) |

- Program 생성 **횟수는 그대로**(파일마다 새 Program → 새 TypeChecker)이고, Program 하나를 만드는 **비용**이 줄었다. Vite 확장 Program은 1.55 s → 0.086 s(약 18배)다.
- 확장마다 재사용하지 않는 SourceFile 2개는 이번 분석의 활성 파일(버퍼)과 직전 활성 파일이다. 버퍼 SourceFile은 재사용하지 않는다는 규칙 때문이다.
- `sessionFallbacks` 0건, 세션 중단 0건.
- SourceFile 캐시 이벤트(Vite D2): off hit 67,501 / miss 12,824 / skipFull 9,625 → on hit 33 / miss 2,296 / skipFull 275. 세션 안에서는 디스크 캐시를 거치지 않아 확장마다 반복되던 재파싱(skipFull)이 사라졌다.

## 4. 메모리 (VERIFIED)

| 조건 | 최고 RSS | 실행 전 / 실행 중 최소 가용 메모리 |
|---|---:|---|
| vite D2 base | 882 / 882 MB | 2,026–2,229 / 1,231–1,335 MB |
| vite D2 off | 879 MB | 2,041 / 1,169 MB |
| **vite D2 on** | **801 / 803 / 804 MB** | 2,035–2,175 / 1,309–1,510 MB |
| hono D2 base | 617–719 MB | |
| **hono D2 on** | **534 MB** (3회) | |
| vite D0 / D1 (base, on) | 644–653 MB | |

- 세션은 직전 Program 하나를 더 붙잡지만 최고 RSS는 오히려 낮아졌다(Vite −79 MB, Hono −83–185 MB). 매번 새로 파싱하던 SourceFile과 모듈 해석 객체가 줄었기 때문으로 추정한다(INFERRED).
- 모든 실행: `--max-old-space-size=768`(old space 상한), V8 `heap_size_limit` 960 MiB(전체 힙 한도, 별개 개념). RAM 8 GB, 가용 1.2 GB 미만으로 내려간 실행 없음.

## 5. 정확성 테스트 (VERIFIED)

`npm test`: **76 passing, 0 failing**(기존 52 + 신규 24). pretest의 `compile`, `lint:all`(웹뷰 포함)도 통과했다. 신규 테스트 목록과 무효화 시나리오는 [implementation.md](implementation.md). 기존 `sourceFileCache`, `p14CallOwnership`, `analyzer`, `codegen`, `extension` 테스트는 수정하지 않았고 모두 통과했다.

## 6. 측정과 추정의 구분, 남은 위험

| 구분 | 내용 |
|---|---|
| VERIFIED | 위 §1–§5. 고정 커밋 hono·vite, Depth 0/1/2, Node 직접 호출 |
| INFERRED | RSS 감소 원인. VS Code에서 같은 비율로 빨라질 것이라는 기대(아래) |
| UNVERIFIED | VS Code UI 응답 시간(P13의 약 387 s 중 비분석 구간 약 300 s 미규명). Depth 3. 다른 활성 파일·프로젝트에서의 일반화 |
| UNVERIFIED | `createProgram(…, oldProgram)` 예외 시 대체 경로. TypeScript 모듈이 함수 교체를 허용하지 않아 테스트로 유도하지 못했다(코드 검토만) |

**남은 위험**
1. **mtime 해상도가 거친 파일 시스템에서 같은 크기·같은 초 안의 외부 수정**이 watcher 이벤트보다 먼저 일어나면 세션이 옛 SourceFile을 재사용할 수 있다. 기존 디스크 캐시와 같은 조건의 위험이며, 세션 수명(Depth 실행 한 번) 안에서만 해당한다.
2. **세션 중 새로 생긴 파일이 바뀌지 않은 파일의 모듈 해석을 바꾸는 경우**: TypeScript는 `Completely` 재사용 시 실패했던 해석 위치를 다시 확인하지 않는다. 생성 이벤트가 오면 세션을 중단하지만, 이벤트가 다음 분석 뒤에 도착하면 그 분석 한 번은 이전 해석을 쓸 수 있다.
3. 확장 분석은 여전히 원래 활성 파일의 **저장된** 내용을 본다(기존 동작 유지). 미저장 버퍼를 확장 분석에도 반영하는 것은 별도 과제다.
4. `structureIsReused`는 TypeScript 내부 필드다. 진단 이벤트에만 쓰므로 TS 업그레이드로 사라져도 동작에는 영향이 없다(값이 `unknown`으로 보일 뿐).

## 7. P12-C 후보
1. VS Code Extension Host·웹뷰 구간 계측(`analyzer.program.created` 이벤트를 활용). P13 V1 D2 1회 재측정으로 P12-B의 실제 체감 효과와 약 300 s 미규명 구간 확인(메모리 16 GB 환경 권장)
2. 첫 Program(Vite 4.5 s)이 이제 D2 시간의 약 40%: 패널 수명 동안 이어지는 구조 재사용(편집·파일 전환), 단 무효화 범위를 더 엄격하게
3. `@types` cwd 의존성 수정(P12-A 별도 발견, 정확성 트랙)
4. 확장 분석에서 미저장 버퍼 반영
5. Depth 3 측정
