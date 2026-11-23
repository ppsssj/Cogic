# P11 — 실제 오픈소스 프로젝트 검증 (Real-world Validation)

**실험 기준 버전: Cogic v0.0.6** (`v0.0.6` 태그 = `3e343d4`, Marketplace 배포본과 바이트 동일 VSIX `bdd0cab6…`). 제품 코드는 수정하지 않았다.

P9에서 합성 워크스페이스로 확인한 SourceFile 캐시 정책 개선(고정 800-entry LRU → Adaptive)이 **실제 오픈소스 TypeScript/JavaScript 프로젝트**에서도 재현되는지, 그리고 결과 일관성·메모리·실제 VS Code 응답 시간이 어떤지 검증했다.

## 대상 프로젝트 (5개, 커밋 고정)
| 그룹 | 프로젝트 | 유형 | 패널 파일 목록 | rootNames | **Program SourceFile** |
|---|---|---|---:|---:|---:|
| S | hono | 웹 프레임워크 라이브러리 | 426 | 426 | **1,169** |
| M | excalidraw | React 웹 앱(yarn 모노레포) | 727 | 691 | **1,506** |
| L | vite | 개발자 도구(pnpm 모노레포) | 1,654 | 1,654 | **2,315** |
| XL | typeorm | ORM 라이브러리(pnpm 모노레포) | 3,622 | 3,622 | **4,141** |
| 대조 | TanStack Query | 라이브러리 모노레포 | 2,312 | 4 | **246** |

상세: [project-selection.md](project-selection.md)

## 핵심 결과
| 프로젝트 | Program 파일 | Fixed 800 편집 분석 | Adaptive 편집 분석 | 변화 [95% bootstrap 구간] | 유지 힙 Fixed→Adaptive | 결과 일치(Fixed vs Adaptive) |
|---|---:|---:|---:|---:|---:|---|
| hono | 1,169 | 2,823.7 ms | 1,220.1 ms | −56.8% [−57.5, −56.1] | 144 → 255 MB | 동일 |
| excalidraw | 1,506 | 5,786.2 ms | 3,304.7 ms | −42.9% [−44.4, −41.8] | 470 → 479 MB | 동일 |
| vite | 2,315 | 5,209.3 ms | 2,147.5 ms | −58.8% [−59.1, −58.4] | 77 → 349 MB | 동일 |
| typeorm | 4,141 | 6,394.0 ms | 1,236.1 ms | −80.7% [−80.8, −80.4] | 69 → 496 MB | 동일 |
| query(대조) | 246 | 155.5 ms | 164.9 ms | +6.0% [+1.0, +8.3] | 115 → 111 MB | 동일 |

Node 분석기, 활성 파일 편집 후 재분석, 조건당 30표본(2블록×15) 중앙값. 같은 PC(i5-9400F / 8 GB / GT 710).

1. **RQ1 (캐시 정책)**: Program이 800 파일을 넘는 4개 프로젝트 모두에서 고정 800 LRU는 **매 분석마다 전부 미적중·전부 제거(hit 0%)** 되었다. 오히려 캐시 OFF보다 2–7% 느렸다. Adaptive는 편집·cross-file·파일 전환 분석을 43–83% 줄였다. Program이 작은 대조 프로젝트에서는 두 정책이 같다.
2. **새 발견 — Adaptive 용량 산정의 한계**: Adaptive 용량은 `rootNames` 수로 정하지만, 실제 Program은 `node_modules`의 `.d.ts`와 lib 파일 때문에 1.1–2.7배 크다. 그래서 hono·excalidraw·vite에서는 용량이 차서 hit 비율이 **64–87%**에 그쳤다. 모든 파일이 적중한 것은 typeorm(100%)뿐이다.
3. **RQ2 (일관성)**: Fixed 800과 Adaptive의 분석 결과는 **비교한 1,425개 표본 모두 엄격히 동일**하다(정책 변경이 결과를 바꾸지 않음). 다만 excalidraw에서 **캐시 ON/OFF 사이에 타입 문자열 차이**가 발견됐다. 원인은 기존 SourceFile 캐시가 `.json` 파일을 TypeScript로 파싱하는 **기존 버그**이며(두 정책 공통), 진단 빌드로 확인했다 → [correctness-results.md](correctness-results.md)
4. **RQ3 (메모리)**: Adaptive의 유지 힙은 최대 **496 MB**(typeorm)다. typeorm은 캐시 텍스트가 2,190만 자로 2,400만 자 예산의 91%에 이르렀다. 문자 예산은 바이트 상한이 아니다 → [memory-results.md](memory-results.md)
5. **RQ4 (실제 VS Code)**: hono·vite에서 편집 후 그래프 갱신(입력 → 프레임 콜백)은 Fixed 800 대비 각각 **−42.7%, −31.4%**, 파일 전환 후 분석은 **−50.8%, −47.9%**였다. 조건별 3회 실행 중앙값이 모두 분리되었다. 편집은 30/30 그래프 데이터에 반영됐고, 화면에 보인 것은 21/30이었다(조건 간 동일) → [ui-results.md](ui-results.md)

## 문서
| 문서 | 내용 |
|---|---|
| [project-selection.md](project-selection.md) | 대상 선정 근거, 고정 SHA, 분석 범위 |
| [methodology.md](methodology.md) | 비교 조건, 시나리오, 측정값, 판정 규칙, 실행 정책 |
| [analysis-results.md](analysis-results.md) | 분석기 벤치마크(RQ1) |
| [memory-results.md](memory-results.md) | 메모리·캐시 상태(RQ3) |
| [correctness-results.md](correctness-results.md) | 결과 일관성과 발견한 버그(RQ2) |
| [ui-results.md](ui-results.md) | 실제 VS Code UI(RQ4) |
| [limitations.md](limitations.md) | 한계와 미완료 항목 |
| [reproduction.md](reproduction.md) | 환경과 재현 명령 |

`data/`(원시 블록 `jsonl.gz`, 요약 CSV, UI 표본), `figures/`, `tools/`를 함께 둔다. 큰 스냅숏(전체 분석 결과 JSON, 최대 95 MB/프로젝트)은 로컬 연구 폴더에 보존하고 저장소에는 넣지 않았다.

## 읽기 전 주의
- **합성(P9)과 실제(P11) 수치는 조건이 달라 직접 비교하지 않는다.**
- 통계적 유의성 검정은 하지 않았다. 구간은 bootstrap 서술 통계이고, UI는 조건별 3회 실행이다.
- 측정 PC는 1대다. 실행 중 메모리 정책이 한 번 바뀌었다([data/run-policy-changes.md](data/run-policy-changes.md)).
- 사용자 연구는 수행하지 않았다.
