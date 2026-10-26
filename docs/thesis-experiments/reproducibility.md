# Reproducibility

## 1. 실행 환경 비교

| 항목 | HIST-0829 (기존 벤치마크) | P0 현재 환경 (2026-10-26) | 차이 |
|---|---|---|---|
| 출처 | `raw/analysis-cache-results.json` `environment` | 명령 실행 결과 ([baseline-audit.md §6](baseline-audit.md#6-task-d--실행-환경과-baseline-검증)) | |
| OS | Windows_NT 10.0.19045 x64 (Windows 10) | Windows 11 Pro 10.0.26100 x64 | 다름 |
| CPU | Intel Core i5-4690 @ 3.50GHz, 4 logical | Intel Core i5-9400F @ 2.90GHz, 6 logical | 다름 |
| Memory | 15.9 GB | 8.0 GB (가용 1.1 GiB, 측정 시점) | 다름 |
| Node.js | v22.16.0 | v24.12.0 | 메이저 버전 다름 |
| TypeScript | 기록 없음 (lockfile `^5.9.3`) | 5.9.3 | 기록 보완 필요 |
| Cogic 기록 SHA | `d9faa02…` (dirty 미기록, 스크립트 미커밋 상태) | `fed34a0…` | `src` 동일 (diff 0줄) |
| Zod SHA | `e6b6ab347675cd2bd54b1bdbed16f98c59be82a9` | — | checkout으로 고정 가능 |
| 전원 구성 | 기록 없음 | 균형 조정 | 기록 필요 |

결론: 현재 장비로는 **방법 재현만 가능**하다. same-environment 재현에는 i5-4690 장비 또는 동등 사양과 Node 22.16.0이 필요하다.

## 2. 소프트웨어 버전과 명령

| 구성 | 버전/명령 | 비고 |
|---|---|---|
| Node.js | v24.12.0 (현재). EXP-02 주 조건은 v22.16.0 권장 | nvm-windows 또는 공식 zip(저장소 의존성 추가 없음) |
| npm | 11.6.2 | `npm ci`로 lockfile 고정 설치 |
| TypeScript | 5.9.3 (root·webview 동일) | analyzer 런타임 의존성(`dependencies.typescript`) |
| VS Code (테스트) | 1.143.1 (`stable` 자동) | 재현 시 `VSCODE_TEST_VERSION=1.143.1` 고정 |
| Extension engine | `^1.108.1` | |
| 빌드 | `npm run compile` | `out/` 생성 |
| 린트 | `npm run lint`, `npm run lint:webview` | |
| 테스트 | `npm test` | pretest = compile + lint:all |
| 웹뷰 타입검사 | `cd webview-ui; npx tsc -b --noEmit` | |

P0 baseline 재현:

```powershell
git checkout fed34a0950f1dc7b4b9e922a8c0b3b331c8aaa19
npm ci; cd webview-ui; npm ci; cd ..
npm run compile; npm run lint; npm run lint:webview
$env:VSCODE_TEST_VERSION = "1.143.1"; npm test          # 기대: 25 passing
node docs/thesis-experiments/tools/audit-existing-benchmark.mjs .    # 기대: ISSUES: none
node docs/thesis-experiments/tools/probe-sourcefile-requests.cjs .   # 기대: requests 172, sameRequestOrderAcrossAnalyses true
```

P0 도구는 이 문서가 포함된 브랜치에 있으므로 위 checkout 뒤에 해당 브랜치의 `docs/thesis-experiments/tools/`를 사용한다.

probe 출력의 `git.dirty: true`는 실행 당시 이 P0 문서 폴더가 아직 커밋되지 않았기 때문이다(`git status`: `?? docs/thesis-experiments/`만 존재). `src/`와 `out/`은 기준 커밋 그대로였다.

## 3. 과거 산출물 무결성

신규 실험 도구는 실행 전후에 아래 해시를 대조하고, 하나라도 다르면 실패해야 한다. 해시는 `git show fed34a0:<path> | sha256sum`(LF 정규화된 저장소 내용)으로 계산했다. Windows에서 `core.autocrlf=true`이면 작업 트리 파일은 CRLF이므로 대조할 때는 `git show` 또는 `git diff --exit-code -- docs/benchmarks/analysis-cache`를 사용한다.

| SHA-256 | 파일 |
|---|---|
| `c4985f69e37f45f871d0b180c6a0b5be87ccbc5c5dafda2205121be5f660057b` | `docs/benchmarks/analysis-cache/README.md` |
| `7a1de248f5a45260b0265f176f12db4aee0f00678ab7029bd8edd6c3a44dcec6` | `docs/benchmarks/analysis-cache/future-work.md` |
| `ef3ba5e7d322c62853e64ed05c3a0e0b4ecbf55c1651acbc040486c3acee6f9a` | `docs/benchmarks/analysis-cache/limitations.md` |
| `5d334de85a68cd9ad3a99772d955178c2da938371925f44c734c09884d3c5004` | `docs/benchmarks/analysis-cache/methodology.md` |
| `ad9a6b61e74c7030822a644cc1c03d04c830e9270c5e4da37ca7e9283f39ddc8` | `docs/benchmarks/analysis-cache/raw/analysis-cache-results.csv` |
| `15b6b4a54999348fc09b4b956e09e6743fb27d1dd64b2b0076ad39b160cf6d37` | `docs/benchmarks/analysis-cache/raw/analysis-cache-results.json` |
| `dd0c5e4a9941743e044a88609e6a070521ff96570f0a4a4f64142d226ee42281` | `docs/benchmarks/analysis-cache/results.md` |
| `4495a5964ef8a824d72b07c9095ba0a4aadb1228f1ca050a925286475ab87c5e` | `scripts/benchmark-analysis-cache.mjs` |

간단한 대조 명령:

```powershell
git diff --exit-code fed34a0 -- docs/benchmarks/analysis-cache scripts/benchmark-analysis-cache.mjs
```

## 4. 신규 실험 run 기록 규칙 요약

상세 규칙은 [experimental-design.md §3](experimental-design.md#3-데이터-분리와-디렉터리-규칙)에 있다.

- `run.json`: run-id, 커밋, dirty, 도구 SHA-256, 사전 등록 커밋, 인자, seed, status
- `env.json`: OS, CPU, 메모리(총·가용, 시작·종료), 전원 구성, Node/npm/TS/V8 버전, Node 플래그
- `workloads.json`: 대상 SHA, 파일 목록 SHA-256, Program root 수, SF 요청 수·구성, `node_modules/@types` 목록
- 원시 표본(`samples.csv`)이 source of truth다. `summary.*`는 표본에서 생성한다.

## 5. 깨끗한 workload 만들기

Cogic 저장소 자체를 workload로 쓸 때 untracked 산출물(`media/webview`, `.vscode-test` 등)이 파일 목록을 바꾼다(과거 84개, 현재 61개). 측정용 작업 트리는 별도 worktree로 만든다.

```powershell
git worktree add ..\cogic-bench <commit>
cd ..\cogic-bench; npm ci; npm run compile
```

`npm ci`는 `node_modules`를 만들고, 이것이 SF 요청 구성(L)을 정한다. `node_modules/@types` 목록을 `workloads.json`에 기록한다.

## 6. 알려진 재현 장애

| 장애 | 영향 | 대응 |
|---|---|---|
| 기존 스크립트가 `docs/benchmarks/analysis-cache`를 덮어씀 | 원본 손실 | 기존 스크립트 실행 금지, 신규 도구 사용, §3 대조 |
| 과거 원시 데이터가 집계값뿐 | 분포 비교·동등성 검정 불가 | 방법·효과 방향·크기 호환성 세 차원 판정. 크기는 제한적 판단만([EXP-02 §9](experiments/exp-02-cache-performance.md#9-statistical-analysis)) |
| 과거 실행의 스크립트 미커밋 | 실행 코드 동일성 증명 불가 | 현재 커밋본을 "추정 동일"로 사용, 한계 명시 |
| VS Code 테스트 버전 자동 갱신 | 테스트 환경 drift | `VSCODE_TEST_VERSION` 고정 |
| Zod 최신 HEAD clone | workload drift | SHA checkout |
