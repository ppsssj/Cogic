# 05. Chromium Paint·presentation feedback 측정

측정 빌드: P4 `9126f35`(채택 버전과 웹뷰 코드 동일). 캐시 OFF, 반복 Generate.

## 1. 방법
- **추적**: Electron 메인 프로세스의 `contentTracing.startRecording/stopRecording`으로 브라우저·렌더러·GPU 프로세스를 한 추적에 기록했다. Generate 한 번만 짧게 추적했다(파일당 약 11–13 MB, 공개하지 않음).
- **카테고리**: blink.user_timing, devtools.timeline, disabled-by-default-devtools.timeline(.frame), toplevel, benchmark, cc, viz, gpu, disabled-by-default-viz.gpu_composite_time
- **대상 확인**: CDP `Target.getTargets` 결과 웹뷰는 별도 렌더러 프로세스의 `iframe` 대상이다(`vscode-webview://…`).
- **시계 정렬**: 웹뷰 안 관찰 코드가 `performance.mark("p8:T0|T2|T3#k|T4#k")`를 남긴다. User Timing 마크가 Paint·Commit·합성 이벤트와 같은 추적 시계(µs)에 기록되므로, 프로세스 간 시계를 빼서 구하지 않는다.
- **관련성**: Paint 이벤트의 `nodeName`·`frame`으로 그래프 컨테이너(`react-flow`, `react-flow__nodes/edges/viewport`)를 칠한 Paint만 T5로 사용한다.
- **분석기**: [tools/trace-analysis/trace-analyze.cjs](tools/trace-analysis/trace-analyze.cjs)

| 시점 | 정의 | 상태 |
|---|---|---|
| T0 | Generate 버튼 pointerdown | 측정 |
| T1 | 확장 호스트에서 분석 시작 | **측정하지 않음**(Chromium 추적 밖) |
| T2 | 최종 그래프를 만든 `analysisResult` 수신 | 측정 |
| T3 | 마지막 그래프 DOM 변경 | 측정 |
| T4 | T3 후 두 번째 rAF(다른 문서의 "프레임 콜백") | 측정 |
| T5 | T3 후 첫 그래프 Paint | 측정 |
| T6a | 해당 프레임(DrawFrame N)의 합성 프레임 제출 | 측정 |
| T6b | 프레임 N의 Chromium presentation feedback | 측정(**물리적 화면 표시가 아님**) |

## 2. 결과 (규모별 1세션 × 추적 3회, 중앙값 [최소–최대] ms, T3 기준)

| 파일 | T2→T3 | T3→T4 | T3→T5 | T3→T6a | **T3→T6b** | T6b − T4 |
|---:|---|---|---|---|---|---|
| 500 | 31.9 [27.2–44.8] | 25.4 [20.9–26.0] | 10.5 [8.6–12.0] | 28.0 [25.7–36.7] | **93.9 [91.8–102.8]** | 73.0 [65.8–77.3] |
| 1,000 | 39.2 [36.9–48.3] | 20.0 [17.0–29.7] | 11.0 [10.9–11.0] | 19.2 [17.7–29.3] | **99.5 [94.8–128.8]** | 82.5 [74.8–99.1] |
| 2,000 | 73.7 [73.2–74.7] | 30.6 [24.7–30.9] | 15.1 [13.7–18.8] | 37.1 [23.7–37.6] | **219.8 [173.7–220.4]** | 188.9 [149.0–189.8] |

- 그래프 Paint는 DOM 변경 후 10–19 ms 안에 시작한다. 메인 스레드 Layout·PrePaint·Paint·Layerize 합은 약 6–10 ms다.
- Chromium presentation feedback은 프레임 콜백(T4)보다 500–1,000파일에서 약 70–100 ms, 2,000파일에서 약 150–190 ms 늦었다. 따라서 [04](04-ui-response-time.md)의 시간은 표시 시각의 하한 근사로 읽어야 한다.
- 1,000·2,000파일 추적 3개는 클릭 직전 자동 분석 결과가 섞였다(결과 2개). 이 추적은 T0→T2 통계에서 빼고 T2 이후 구간만 사용했다.
- 원자료: [data/p8/](data/p8/) `p8b-trace-s*-analysis.json`, 그림: [figures/p8b-s500-timeline-trace0.svg](figures/p8b-s500-timeline-trace0.svg), [figures/p8b-s2000-timeline-trace1.svg](figures/p8b-s2000-timeline-trace1.svg)

## 3. 구분해야 할 개념
| 개념 | 이 연구에서 |
|---|---|
| DOM 업데이트 시간 | T3(MutationObserver 콜백) |
| 프레임 콜백 시간 | T4(두 번째 rAF) — UI 응답 시간 표의 기준 |
| 브라우저 Paint | T5(그래프 컨테이너 Paint 시작) |
| 합성 관련 | Commit → DrawFrame → T6a 제출 |
| presentation feedback | T6b(Chromium이 보고한 표시 시각) |
| 물리적 화면 표시 | **측정하지 않음**(고속 카메라 등 외부 장비 필요) |
