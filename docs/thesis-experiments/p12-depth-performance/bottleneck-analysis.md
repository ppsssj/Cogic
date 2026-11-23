# 병목 분석

## 1. 가장 큰 병목: frontier 파일마다 새 `ts.Program`을 만든다 (VERIFIED)

```text
analyzeWorkspaceWithDepth()                       Vite D2 r1 = 69.2 s
  ├─ analyzeWorkspaceActive(active)               5.7 s  (createProgram 4.6 s)
  └─ frontier 34개
       └─ analyzeWorkspaceActive(file i)          63.4 s 합
            ├─ ts.createProgram(같은 1,654 roots)  57.5 s 합  ← 90.7%(총시간 대비 83%)
            │    ├─ 모듈 해석 I/O 콜백            32.6 s
            │    ├─ getSourceFile                 15.3 s
            │    └─ TS 내부                        9.6 s
            └─ checker 생성 + 분석                  5.8 s 합
```

근거:
- 35번의 Program은 **rootNames와 compilerOptions가 모두 같다**(`roots = 1,654`, `sourceFiles = 2,296`이 35번 모두 같음). 달라지는 것은 "활성 파일" 하나의 SourceFile뿐이다. 그런데도 매번 모듈 해석을 처음부터 한다. 기본 컴파일러 호스트에는 Program 사이에 공유되는 `ModuleResolutionCache`가 없기 때문이다.
- Program 생성을 없앤 실험(공유 checker, `old-sf`)에서 총시간이 9.2–12.6 s로 떨어졌다. 따라서 남은 시간의 대부분이 Program 생성이었음이 독립적으로 확인된다.
- merge(0.024 s), 직렬화(0.017 s)는 무시할 수 있다. 그래프 merge 최적화(후보 3)의 기대 이익은 측정상 거의 0이다.

## 2. Program 생성 비용의 내부 구성 (VERIFIED, 확장 34회 합)

| 구성 | 시간 | 비중 | 해석 |
|---|---:|---:|---|
| 모듈 해석 I/O | 32.6 s | 57% | `directoryExists` 27,273회/Program, `fileExists` 14,311회/Program. 같은 질의를 Program마다 반복 |
| `getSourceFile` | 15.3 s | 27% | 적중해도 `fs.statSync` 1회. 캐시 용량 2,020 < 2,296이라 확장마다 약 370개 재파싱(skipFull 9,625) |
| TS 내부 | 9.6 s | 17% | 해석 알고리즘, `processRootFile`, 파일 그래프 구성 |

**P11 Adaptive 캐시와의 관계**: P11은 Adaptive 용량이 rootNames 기준이라 Program보다 작다는 점을 이미 지적했다(hit 64–87%). 이번 측정은 그 결과를 하나 더 보여 준다. 용량 부족으로 SourceFile 객체가 바뀌면, `oldProgram`을 넘겨도 TS가 패키지 파일 변경으로 판단해 구조 재사용을 포기한다(`structureIsReused = Not`, §4).

## 3. Depth 1 → Depth 2 비용 모델

```text
T(D1) ≈ P0 + A0
T(D2) ≈ P0 + A0 + Σ_{i=1..N} (P_i + C_i + A_i) + Σ merge_i
  P = createProgram, C = checker 생성(≈0.1 s), A = 파일 분석, N = frontier 크기
```

| | N | P0 | 확장 P_i 중앙값 | 확장 (C_i + A_i) 중앙값 | T(D1) | T(D2) |
|---|---:|---:|---:|---:|---:|---:|
| hono | 2 | 3.4 s | 1.47 s | 0.42 s | 4.6 s | 7.8 s |
| vite | 34 | 4.6 s | 1.60 s | 0.14 s | 5.7 s | 69.2 s |

- D2의 추가 비용은 **N × P_i**가 지배한다. P_i는 활성 파일이 아니라 **프로젝트 크기**(roots·Program 파일 수·node_modules 깊이)에 비례한다. 그래서 큰 프로젝트에서는 frontier가 커지고, 파일당 비용도 함께 커진다.
- frontier 크기 N은 활성 파일의 외부 호출 대상 파일 수다(Vite `server/index.ts`는 34개). Depth 3은 N이 다시 곱해지므로 현재 구조로는 더 빠르게 나빠진다(INFERRED, 측정 안 함).
- Program 재사용 후(`old-sf`) Vite 확장 1회는 중앙값 0.12 s다. D2 ≈ 7.0 + 34 × 0.15 ≈ 12.2 s로, 측정값 12.2–12.6 s와 맞는다.

## 4. 왜 TypeChecker는 공유하면 안 되는가 (VERIFIED)

공유 checker는 가장 빠르다(Vite 9.2–9.6 s). 그러나 그래프가 기준과 다르다([profiling-results.md §5](profiling-results.md)).
- **타입 문자열**: 유니언 멤버 출력 순서는 checker가 타입을 만든 순서(type id)를 따른다. 앞 파일을 먼저 검사하면 순서가 바뀐다 → 노드 `signature`/`name` 변경.
- **호출 대상**: 오버로드 선택(`console.*`)이나 재할당되는 함수 변수(`safeRealpathSync`)처럼 흐름 분석·시그니처 해석 캐시에 의존하는 결과가 앞 파일의 검사 이력에 따라 달라졌다 → 엣지 대상 변경, 자기 호출 엣지 생성.
- 결과가 **어느 파일을 먼저 분석했는가**에 따라 달라지므로, 같은 파일이라도 Depth 0 결과와 Depth 2 안의 결과가 다를 수 있다. P14에서 쌓은 정확성 기준(파일 단독 분석과의 일치)을 깨므로 받아들일 수 없다.

반면 `old-sf`(Program 구조만 재사용, checker는 Program마다 새로 생성)는 Vite·Hono 모두 기준과 **바이트 단위로 같은** 그래프를 냈다. 현재 제품도 이미 SourceFile 객체(파싱·바인딩 결과)를 Program 사이에 공유하므로, 추가로 공유되는 것은 모듈 해석 결과와 Program 구조뿐이다.

## 5. Node 분석과 VS Code UI 구간 (UNVERIFIED)

| 측정 | 값 | 출처 |
|---|---:|---|
| Node 분석, Vite V1 D2 | 66.8–80.0 s (오늘), 100.3 s (pilot, 메모리 압박) | 이번 단계 |
| VS Code Generate → 화면, Vite V1 D2 | 385.3 / 391.0 / 387.1 s | P13 `results-real-world.md`, 캐시 ON, 새 프로필 |

P13은 Generate 클릭부터 결과 화면까지 한 구간만 측정했다. 이번에 확인한 Node 분석 시간으로는 약 **300 s가 설명되지 않는다**. 후보(모두 INFERRED, 미검증):
1. **Extension Host 환경**: 같은 VS Code 안 TS 서버가 같은 프로젝트를 로드해 메모리·CPU를 나눠 쓴다. P13 실행 당시의 메모리 압박도 있다(pilot에서 메모리 압박만으로 67→100 s 수준의 차이를 보였다).
2. **`@types` 해석 차이**: cwd 의존 `typeRoots` 때문에 Extension Host의 Program 구성이 하네스와 다를 수 있다([README.md](README.md) 별도 발견).
3. **웹뷰**: 노드 1,078·엣지 3,755 그래프의 데이터 처리, `CanvasPane.tsx` 자체 레이아웃, React Flow 렌더링. P13에서는 DOM에 엣지 833개만 그려졌다(가상화).
4. **패널 결과 캐시**: `cloneAnalysisResult` JSON 깊은 복사(그래프 크기상 작을 것으로 추정).
5. 제외한 것: `pushPanelDebugEvent`는 80개 링 버퍼라 이벤트 약 9.3만 건에도 0.2 s 미만이다(코드 확인).

**미수행 사유**: VS Code(약 1 GB 이상) + Extension Host의 Vite D2(약 0.9 GB)를 가용 0.8–2.0 GB에서 6분 넘게, 반복해서 돌리면 paging이 측정을 오염시키고 사용자 작업에도 영향을 준다.

**P12-B에서 할 측정 계획**: 패널에는 이미 `analysis.active.begin` / `analysis.active.post` 디버그 이벤트(ISO 시각)가 있다. 여기에 (1) `analyzeWorkspaceWithDepth` 시작·끝, (2) frontier 파일별 시작·끝, (3) 웹뷰 `analysisResult` 수신, (4) 그래프 변환 끝, (5) 레이아웃 끝, (6) 첫 `requestAnimationFrame` 시각을 추가한다. 이후 P13 하네스(Generate 단계)로 한 번만 수집하면 7개 구간을 분리할 수 있다. 메모리 16 GB 이상 환경을 권장한다.

## 6. 측정 한계
- 프로젝트 2개, 활성 파일 각 1개. frontier가 큰 다른 파일에서의 일반화는 INFERRED다.
- 반복 수가 작다(Vite D2 기준 n=2 + 계측 OFF 1, `old-sf` n=2). 기준 실행 간 편차가 15%(69.2 vs 80.0 s)지만 `old-sf`와의 차이(5배 이상)가 훨씬 크다.
- 측정 중 사용자 앱이 함께 실행돼 가용 메모리가 실행마다 달랐다(`meta.freeMBAtStart` 기록).
- `old-sf`는 파일이 바뀌지 않는다는 하네스 가정 위의 상한 추정치다. 제품 구현에서는 버전 검사 비용이 더해진다.
