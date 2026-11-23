# 대상 프로젝트 선정

## 선정 조건과 절차
- 공개 GitHub 저장소이고 최근까지 커밋이 있는 프로젝트, TS/JS 중심, 정상적인 import 구조, MIT 라이선스.
- 후보 6개(hono, excalidraw, TanStack Query, date-fns, typeorm, vite)를 `--depth 1`로 받아 커밋을 고정했다. **v0.0.6 패널과 같은 규칙**으로 파일을 세고 `rootNames`가 어떻게 결정되는지 확인한 뒤 최종 대상을 정했다.
  - 파일 규칙: `**/*.{ts,tsx,js,jsx}`, `node_modules/dist/build/out/.next` 제외, 최대 4,000개
  - `rootNames`: 루트 `tsconfig.json`의 `fileNames`가 있으면 그것, 없으면 파일 목록(`buildWorkspaceRoots`)
- date-fns(1,776 파일, 라이브러리)는 vite와 규모가 겹쳐 제외했다. 구조가 다른 프로젝트(React 앱, 개발자 도구, ORM 모노레포)를 우선했다.
- 실제 사용 환경과 같도록 각 저장소의 lockfile로 의존성을 설치했다(`--frozen-lockfile --ignore-scripts`; excalidraw는 yarn 1, typeorm은 저장소가 지정한 pnpm 10).
- 원본 체크아웃은 수정하지 않았고, 모든 실험은 `git worktree` 작업 복사본(의존성은 junction 연결)에서 했다. 매 블록 전후로 `git status`가 깨끗한지 확인했다.

## 대상
| 그룹 | 프로젝트 | 저장소 | 고정 커밋 | 커밋 날짜 | 라이선스 |
|---|---|---|---|---|---|
| S | hono | https://github.com/honojs/hono | `cd50668335738d170ecd03e783f2f2d5317b95d6` | 2026-11-22 | MIT |
| M | excalidraw | https://github.com/excalidraw/excalidraw | `9c2e462ec23e54c4cf0493328840d6a27191c674` | 2026-11-21 | MIT |
| L | vite | https://github.com/vitejs/vite | `3567471998e3da315675086f44368e266c9c0e33` | 2026-11-20 | MIT |
| XL | typeorm | https://github.com/typeorm/typeorm | `d5b143dd7ed659e2a1cbac044a2c78d90c0f6f8f` | 2026-11-16 | MIT |
| 대조 | TanStack Query | https://github.com/TanStack/query | `0827cf2cb22e2c81ef210271c25fc50e9f1e7328` | 2026-11-21 | MIT |

## 분석 범위
| 프로젝트 | 유형·구조 | tsconfig 처리 | 패널 파일 목록 | rootNames | Program SourceFile | 그래프(노드/엣지) |
|---|---|---|---:|---:|---:|---|
| hono | 웹 프레임워크 라이브러리, pnpm | 루트 tsconfig가 references만 가짐 → 파일 목록 + 루트 옵션 | 426 | 426 | 1,169 | 22/78 |
| excalidraw | React 앱, yarn workspaces 모노레포 | 루트 tsconfig `fileNames` 사용 | 727 | 691 | 1,506 | 677/3,325 |
| vite | 개발자 도구, pnpm 모노레포 | 루트 tsconfig 없음 → 파일 목록 + 기본 옵션 | 1,654 | 1,654 | 2,315 | 156/646 |
| typeorm | ORM, pnpm 모노레포 | 루트 tsconfig 없음 → 파일 목록 + 기본 옵션 | 3,622 | 3,622 | 4,141 | 180/726 |
| TanStack Query | 라이브러리 모노레포, pnpm | 루트 tsconfig `files` 3개 → rootNames 4(활성 파일 추가) | 2,312 | 4 | 246 | 80/149 |

- **Program SourceFile** = 캐시 ON 분석 1회에서 컴파일러 호스트가 디스크에서 요청한 파일 수(SourceFile 캐시 hit + miss). `node_modules`의 `.d.ts`와 TypeScript lib 파일이 포함되어 rootNames보다 많다.
- TanStack Query는 처음에 XL(2,312 파일)로 고려했다. 그러나 루트 tsconfig가 3개 파일만 지정해서 Cogic이 분석하는 Program이 246 파일에 불과했다. 따라서 **캐시 용량을 넘지 않는 대조군**으로 썼다. XL 스트레스는 typeorm이 대신한다. 이 결과는 "실제 Program 범위는 저장소 크기가 아니라 루트 tsconfig에 의해 정해진다"는 관찰이기도 하다.

## 활성 파일 (사전 정의 규칙으로 결정, [methodology.md](methodology.md) 4절)
| 프로젝트 | 소스 폴더 | 후보 | 활성 파일(상대 import 수) | Cross-file 대상 |
|---|---|---:|---|---|
| hono | `src` | 189 | `src/jsx/components.ts` (9) | `src/helper/html/index.ts` |
| excalidraw | `packages/excalidraw` | 371 | `packages/excalidraw/components/App.tsx` (84) | `packages/excalidraw/actions/actionBoundText.tsx` |
| vite | `packages/vite/src` | 139 | `packages/vite/src/node/config.ts` (33) | `packages/vite/src/module-runner/importMetaResolver.ts` |
| typeorm | `packages/typeorm/src` | 496 | `packages/typeorm/src/query-builder/SelectQueryBuilder.ts` (46) | `packages/typeorm/src/cache/QueryResultCacheOptions.ts` |
| TanStack Query | `packages/query-core/src` | 23 | `packages/query-core/src/query.ts` (9) | `packages/query-core/src/infiniteQueryBehavior.ts` |

전체 표: [data/summary/p11-projects.csv](data/summary/p11-projects.csv)
