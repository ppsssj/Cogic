# 도구와 버전, 실행 환경

## 실행 환경 (P13 측정, 2026-11-23)
| 항목 | 값 |
|---|---|
| OS | Windows 11 Pro 10.0.26100 |
| 하드웨어 | Intel Core i5-9400F, RAM 8 GB, NVIDIA GeForce GT 710 |
| VS Code | 1.147.0 win32-x64 archive (commit `8a14f0cc1b`, 2026-11-17), Electron 43.8.9 |
| 자동화 | Playwright 1.65.1 (Electron), @vscode/test-electron 3.1.0, Node.js v24.12.0 |
| 격리 | 실행마다 새 `--user-data-dir`와 `--extensions-dir`, 해당 도구의 확장만 복사. 창 1600×960 |
| TypeScript 언어 서버 | VS Code 1.147.0 내장 TypeScript(도구 공통). 시작 상태에서 TS 서버 준비 완료를 기다린 뒤 측정 |

## 도구
| 도구 | 버전 | 설치 파일 SHA256 | 출처 | 실행 가능 여부 |
|---|---|---|---|---|
| VS Code 기본 기능 (Call Hierarchy, Go to Definition/References, Debug Call Stack) | VS Code 1.147.0 내장 | — | — | 실행 가능 |
| Trace Function Flow (`sudopanda.trace-function-flow`) | 1.1.1 | `f780cdf78b4b2b60754a5c93bb6816a95f5204d6063feb1648f9924c4682cc33` | Marketplace (2026-06-21 게시본) | 실행 가능 |
| Context Graph (`context-graph.context-graph`) | 0.10.9 | `dc70762a4497edbabdf32a8a7fa14858885d9dd79c26bb7949dea5dbaf9d932c` | Marketplace (2026-11-10 게시본, 범용 패키지 하나) | **ENVIRONMENT_BLOCKED (Windows x64)** |
| Cogic (`ppsssj.cogic`) | main `cef96eb` 테스트 VSIX(표시 버전 0.0.6, PR #26 포함, 배포하지 않음) | `9fe50227018165e7f63c5451a056edbdb5229c8a6fb4a105e14f5805e4102916` | 이 저장소 main | 실행 가능 |

## 이전 비교(P3)와의 차이
| 항목 | P3 (2026-11-22, 다른 PC) | P13 |
|---|---|---|
| OS / VS Code | Windows 10 Home 19045 / 1.146.0 (Electron 43.8.6) | Windows 11 Pro 26100 / 1.147.0 (Electron 43.8.9) |
| Cogic | 0.0.5 (P4 수정 전) | main `cef96eb` (0.0.6 + ScriptKind 수정) |
| Trace Function Flow / Context Graph | 1.1.1 / 0.10.9 | 같은 버전(Context Graph는 2026-11-10 재게시본) |

P3 결과는 [p4-p10/02-tool-comparison.md](../p4-p10/02-tool-comparison.md)에 인용되어 있다. P13 수치와 섞지 않는다.

## Context Graph가 Windows에서 실행되지 않는 원인 (확인한 사실)
- Marketplace 패키지의 `extension/bin/`에는 `darwin-arm64/context-graph-worker`만 있다(Windows·Linux·Intel macOS용 worker 없음). 대상 플랫폼별 패키지도 게시되지 않았다(범용 0.10.9 하나).
- 확장 코드(`dist/extension.js`의 `resolveWorkerRuntimes`)는 `bin/<platform>-<arch>/context-graph-worker(.exe)`를 찾는다. Python 스크립트 fallback은 개발 모드에서 `../worker/main.py`가 있을 때만 쓰며, 이 파일은 패키지에 없다.
- 실제 UI에서 Generate를 실행하면 패널에 `No usable worker runtime found for win32-x64. Worker bundle is missing at …\bin\win32-x64\context-graph-worker.exe … The installed extension must include a worker compiled for this platform.`가 표시된다(Stage A 3회, Stage B 매 실행).
- README는 Windows 지원을 명시한다. 따라서 이 결과는 **도구 기능의 실패가 아니라 배포 패키지와 실행 환경의 문제(`ENVIRONMENT_BLOCKED`)** 로 분류한다. macOS arm64에서는 평가하지 않았다(장비 없음).
