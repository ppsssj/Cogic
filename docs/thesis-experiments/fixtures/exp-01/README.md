# EXP-01 Corpus A — Micro Fixtures and Ground Truth

EXP-01(관계 분석 정확도)의 확증 분석용 마이크로 fixture와 Ground Truth다. 작성 경위와 독립성 상태는 [../../p1a-ground-truth.md](../../p1a-ground-truth.md)에 있다.

## 구성

```text
fixtures/exp-01/
├── ANNOTATION_GUIDE.md      # 정답 정의(관계, owner, framework 의미, 결정성)
├── catalog.csv              # 패턴 ID, 범주, 지원 분류, 코드 근거
├── COVERAGE.md, coverage.json   # 범주별 표본 수(도구 생성)
├── GT_CHANGELOG.md          # 사전 등록 이후 GT 변경 기록
├── gt-manifest.json         # 사전 등록 시점 파일 해시(도구 생성)
├── validation-report.json   # validator 결과(도구 생성)
├── review/                  # 독립 검토 표본·양식(결과 칸은 비어 있음)
└── <category>/<case-id>/
    ├── case.json            # 메타데이터, 작성 방법, 검토 상태
    ├── expected.json        # Ground Truth v1
    ├── main.ts(x)           # 활성 파일(평가 대상)
    ├── 의존 파일(.ts)
    ├── tsconfig.json        # types: [], lib: ES2022, strict, paths -> shims
    └── shims/*.d.ts         # 최소 선언 shim(react, vue, express, nest, jsx)
```

범주 폴더는 calls, constructs, references, dataflow, updates, react, vue, express, nest의 9개다. 사례는 44개다. 한 사례 안에는 여러 범주의 관계가 함께 들어 있다. 예를 들어 calls 사례에도 dataflow 관계가 있다. 관계의 범주는 폴더가 아니라 관계 종류와 출발 노드로 정한다(`tools/exp01/lib.mjs` `categoryFor`).

## 명령

```powershell
node docs/thesis-experiments/tools/exp01/validate-gt.mjs          # 타입 검사, 스키마, 참조 무결성, 호출 지점 커버리지
node docs/thesis-experiments/tools/exp01/coverage.mjs             # COVERAGE.md / coverage.json 재생성
node docs/thesis-experiments/tools/exp01/review-sample.mjs        # review/ 표본 재생성(같은 seed면 같은 결과)
node docs/thesis-experiments/tools/exp01/manifest.mjs --check     # 사전 등록 이후 변경 여부 확인
node --test docs/thesis-experiments/tools/exp01/test/score.test.mjs
```

fixture는 저장소 루트 빌드와 분리되어 있다. 루트 `tsconfig.json`은 `src`만 포함하고, ESLint는 `src`만 검사하며, `.vscodeignore`는 `docs/**`를 제외한다. 각 fixture tsconfig는 `types: []`로 상위 `node_modules/@types` 자동 포함을 막는다.
