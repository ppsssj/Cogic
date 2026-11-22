# 08. 실험 환경, 반복 횟수, 재현

## 1. 환경
| 항목 | 값 |
|---|---|
| OS | Windows 11 Pro 10.0.26100, 전원 "균형 조정" |
| 하드웨어 | Intel Core i5-9400F(6C/6T), RAM 8 GB, NVIDIA GeForce GT 710 |
| 런타임 | Node.js v24.12.0, npm 11.6.2 |
| VS Code | 1.147.0 win32-x64 archive(격리 실행: 별도 user-data·extensions 폴더), Electron 43.8.9 / Chrome 150 |
| 자동화 | Playwright 1.65.1(Electron), @vscode/test-electron 3.1.0 |
| 세션 | P5와 P6 예비 측정은 Windows 잠금 상태, P6 반복 측정(r3)·P8·P9·P10은 잠금 해제 상태. 모든 UI 표본에서 웹뷰 `visibility=visible`, rAF 실행 확인 |
| 메모리 보호 | 실행 전 가용 메모리 1,500 MB 이상일 때만 실행(미달 시 SKIP 기록). VS Code 인스턴스 1개씩, UI 자동화와 벤치마크 동시 실행 금지 |

VSIX는 표시 버전이 모두 0.0.5이므로 SHA256으로 구분했다(P4 `cogic-p4-final.vsix` 2748b83d…, 채택 버전 `e753f5e` 빌드 dec801c7…).

## 2. 반복 횟수
| 실험 | 단위 | 반복 |
|---|---|---|
| P5 UI 회귀 | 스펙 실행 | 각 1회(P10 채택 버전 재검증 1회) |
| P6/P9 Node 분석 | 표본 | 모드당 30(2블록 × 15), Cold Start 10(P9 변형 비교 2) |
| P6 r3, P8-C, P10 UI 응답 | VS Code 실행 | 조건당 3회(실행 내 반복 Generate 5, 편집 5) |
| P8-B 추적 | 추적 | 규모당 1세션 × 3 |
| P8-F, P10 조작 | VS Code 실행 | 조건당 3회(P9 진단 빌드는 2회) |

## 3. 판정 규칙
- 사전 규칙: 같은 조건의 실행별 중앙값 3개가 모두 반대편 3개보다 좋을 때만 개선/악화로 판정한다. 그 외에는 "차이 불분명"이다.
- Node 측정의 감소율 신뢰구간: OFF·ON 표본을 따로 재표본한 bootstrap 10,000회(seed 20261122).
- 이것은 **기술적 판정이며 통계적 유의성 검정이 아니다.**

## 4. 재현
UI 측정 하네스(P0–P4 하네스와 `lib/`)는 이 저장소에 포함되지 않은 별도 작업 폴더에 있다. `tools/harness-specs/`의 스펙은 그 하네스의 `e2e/`에 넣어 실행하는 참조 사본이다.

```powershell
# 1) 빌드와 단위 테스트
npm ci; Push-Location webview-ui; npm ci; Pop-Location
npm run build:all
npm test                                  # 채택 버전: 46 passing

# 2) 비교할 VSIX를 각각 격리 확장 폴더에 설치 (표시 버전 0.0.5 → SHA256으로 구분)
npx @vscode/vsce package -o cogic-<commit>.vsix
& "<VSCODE>\bin\code.cmd" --user-data-dir <tmp-user-data> --extensions-dir <ext-dir-for-version> --install-extension cogic-<commit>.vsix

# 3) UI 측정 1회 (하네스 폴더에서; 메모리 게이트 포함 래퍼 사용)
#    tools/summaries/run-one-ui-measurement.ps1 의 <HARNESS_WORKDIR>, <RESULTS> 를 로컬 경로로 바꾼 뒤
.\run-one-ui-measurement.ps1 -Spec e2e/p8c-large.spec.ts -Workspace <synthetic-1000> -Prefix p8c-s1000-slot0-on `
  -Env @{ P6_ACTIVE='entry.ts'; P6_CACHE='on'; P6_LAUNCHES='1'; P6_REPEATS='5'; P6_EDITS='5'; P6_DEPTH='1'; P6_LABEL='s1000'; P4_EXTENSIONS_DIR='<ext-dir-for-version>' }
.\run-one-ui-measurement.ps1 -Spec e2e/p8f-interaction.spec.ts -Workspace <synthetic-1000> -Prefix p8f-s1000-r1 `
  -Env @{ P8_LABEL='s1000'; P8_TRACE='0'; P8_MAX_EXPAND='10'; P4_EXTENSIONS_DIR='<ext-dir-for-version>' }
.\run-one-ui-measurement.ps1 -Spec e2e/p8b-trace.spec.ts -Workspace <synthetic-500> -Prefix p8b-s500 `
  -Env @{ P8_LABEL='s500'; P8_DEPTH='1'; P8_REPEATS='3'; P8_CACHE='off' }

# 4) Node 분석·캐시 벤치마크 (분석기 빌드 폴더를 COGIC_REPO로 지정)
node tools/cache-benchmark/run-p9.cjs <RUN_ID> 1000 active-edit,repeated,cold-start
node tools/cache-benchmark/summarize-p9.cjs <data-dir>

# 5) 추적 분석
node tools/trace-analysis/trace-analyze.cjs trace-0.json trace-1.json trace-2.json > analysis.json
node tools/trace-analysis/trace-threads.cjs <trace.json> p8f:op-start p8f:op-end
```

- 합성 워크스페이스는 `tools/cache-benchmark/p6-run.cjs`의 `generateSynthetic`(결정적)로 만든다.
- 스크립트 안의 `<RESULTS>`, `<COGIC_REPO>`, `<HARNESS_WORKDIR>`, `<P4_BACKUP_DIR>`은 공개를 위해 로컬 경로를 치환한 자리표시자다.
- 실행 순서는 버전을 교차해 배치한다(예: B,V,V,B,B,V). 다른 PC에서 측정하면 이 문서의 값과 합치지 말고 모든 규모를 다시 측정한다.
