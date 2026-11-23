# P12-A — Depth 2 성능 병목 진단과 P12-B 공유 분석 아키텍처 제안

- 기준 커밋: `cdc3196` (P14-B 이후 main). **제품 코드 변경 없음** — 이번 단계 산출물은 이 디렉터리뿐이다.
- 대상: P11 고정 프로젝트 hono `cd50668` (H1: `src/helper/cookie/index.ts`), vite `3567471` (V1: `packages/vite/src/node/server/index.ts`).
- 환경: Windows 11, RAM 8 GB(측정 중 가용 0.8–2.0 GB), Node v24.12.0, TypeScript 5.9.3, `--max-old-space-size=768`.
- 이어받은 작업: Codex가 만든 계측 도구 `tools/profile-depth.cjs`(v1), `tools/monitor.ps1`, pilot 3건(`data/pilot-*`). 원본은 수정하지 않았다.

## 결론 요약

| 구분 | 내용 |
|---|---|
| **VERIFIED** | Vite Depth 2는 `analyzeWorkspaceActive`를 35번 호출하고 **`ts.createProgram`을 35번** 만든다(활성 파일 1 + frontier 34). Node 측정 66.8–80.0초 중 `createProgram`이 **약 90%**(62.1 s / 69.2 s, 71.9 s / 80.0 s)를 차지한다. |
| **VERIFIED** | 확장 Program 1개당 비용(중앙값 1.6–1.9 s)은 파싱이 아니라 **모듈 해석 I/O**(`directoryExists`·`fileExists`·`readFile`·`realpath`, 34개 합 32.6 s, 57%)와 **SourceFile 획득**(15.3 s, 27%: 적중 시 `stat`, 캐시 용량 2,020 < Program 2,296 파일이라 확장마다 약 370개 재파싱), TS 내부 CPU(9.6 s, 17%)다. |
| **VERIFIED** | Graph merge(34회 합 24–26 ms), 직렬화(11–17 ms), checker 획득(35회 합 3.3–3.9 s)은 주 병목이 아니다. |
| **VERIFIED** | **TypeChecker까지 공유**하면 Vite 9.2–9.6 s로 빨라지지만 **그래프가 달라진다**(노드 11개 이름·시그니처, 엣지 7개가 다른 대상으로 해석, 노드 1개 감소·엣지 1개 증가). 반복해도 같은 결과가 나오므로 잡음이 아니라 공유 checker의 순서 의존성이다. |
| **VERIFIED** | **Program 구조 재사용 + 파일마다 새 checker**(`oldProgram` + Program 전체를 담는 SourceFile 저장소)는 Vite D2 **12.2–12.6 s**(기준 66.8–80.0 s, 약 5.4–6.4배), Hono D2 3.7–4.5 s(기준 7.6–7.8 s)이며 **그래프 해시가 기준과 바이트 단위로 같다**. TS `structureIsReused = Completely`. |
| **VERIFIED** | `oldProgram`만 넘기고 기존 SourceFile 캐시(용량 부족)를 그대로 쓰면 TS가 재사용을 거부하고(`Not`) 오히려 느려진다(Vite 90.5 s). |
| **INFERRED** | P13 VS Code 측정(V1 385–391 s)과 Node 측정(67–80 s)의 차이 약 300 s는 이번 계측으로 설명되지 않는다. Extension Host 환경, 웹뷰 레이아웃·렌더링, 작업 디렉터리에 따른 `@types` 해석 차이가 후보다. |
| **UNVERIFIED** | VS Code UI 구간(Generate → 분석 → postMessage → 웹뷰 처리 → 레이아웃 → 화면) 분리 측정. 메모리 여유(가용 0.8–2.0 GB)로 VS Code + Vite D2를 안전하게 반복할 수 없어 수행하지 않았다. |

**P12-B 첫 작업 추천:** "Depth 실행 범위 Program 세션" — 한 번의 Depth 분석 동안 이전 Program을 `oldProgram`으로 넘기고, 활성 파일 외 SourceFile은 직전 Program에서 제공해 TS 구조 재사용을 보장한다. checker는 공유하지 않는다. 자세한 내용은 [architecture-proposal.md](architecture-proposal.md), [optimization-roadmap.md](optimization-roadmap.md).

> **P12-B 구현 결과**: [p12b/README.md](p12b/README.md) — Program Session으로 Vite D2 65.6 s → 11.1 s, 그래프 바이트 동일.

## 문서

| 문서 | 내용 |
|---|---|
| [methodology.md](methodology.md) | 측정 경계, 계측 도구 검증, 조건, 메모리 안전 규칙 |
| [profiling-results.md](profiling-results.md) | Depth 0/1/2, 반복, 실험 모드별 결과표 |
| [bottleneck-analysis.md](bottleneck-analysis.md) | 비용 분해와 근거, Depth 1→2 비용 모델, Node–UI 차이 |
| [architecture-proposal.md](architecture-proposal.md) | 후보 1–4 비교와 권장안 |
| [optimization-roadmap.md](optimization-roadmap.md) | P12-B 이후 우선순위, 검증 게이트 |
| [reproduction.md](reproduction.md) | 재현 절차 |
| [data/README.md](data/README.md) | 원시·요약 데이터 목록 |

## 별도 발견 (P12 범위 밖, 기록만)

- **작업 디렉터리 의존 `@types` 해석 (VERIFIED 현상 / INFERRED 원인)**: vite는 루트 `tsconfig.json`이 없어 fallback 옵션을 쓰고, hono 경로도 `parseJsonConfigFileContent`에 설정 파일 이름을 넘기지 않는다. 그래서 TS 자동 `@types` 포함이 프로세스 cwd 기준이 된다. 이 하네스(cwd = Cogic 저장소)에서는 Vite 그래프 노드 1,078개 중 114개, Hono 85개 중 2개가 **Cogic 저장소의** `node_modules/@types/node`를 가리켰다. Extension Host는 cwd가 다르므로 그래프가 다를 수 있다. P14 정확도 트랙에서 다룰 것을 권한다.
- **pilot 그래프 해시 출처 불명 (UNVERIFIED)**: Codex pilot의 Hono 해시(`6912d8…`)는 같은 v1 도구로 오늘 다시 실행한 해시(`45ea10…`)와 다르다(노드·엣지 수는 같다). pilot 당시 `out/`의 소스 리비전이 기록되지 않았다. 그래서 pilot은 시간·호출 횟수 참고용으로만 쓰고, 정확성 비교에는 v2 실행만 쓴다. v2는 `meta.cogicRevision`을 기록한다.
