# P13 Stage B — 사전 등록 보완 (스모크 실행 후, 본 측정 전)

Stage B 스펙을 검증하는 스모크 실행(`p13smoke*`, 통계 제외)에서 **조작 경로 정의와 판독 코드**에 문제가 발견되었다. 그래서 본 측정 전에 아래와 같이 보완한다. 과제, 정답(answer key), 성공 기준, 분류 규칙은 바꾸지 않는다. 스모크 결과는 원자료와 함께 보존한다([data/stage-b-smoke/](data/stage-b-smoke/)).

| # | 보완 | 근거(스모크 관찰) | 영향 |
|---|---|---|---|
| A1 | **Cogic**: 경로 파일이 접힌 **폴더 그룹** 안에 있으면 그 폴더 그룹을 펼친다(클릭 1회 = 조작 1). 그다음 파일 그룹을 펼친다 | hono H1에서 `src/utils`(3 files hidden) 폴더 그룹이 접혀 있었다. `utils/cookie.ts`로 가는 호출 엣지는 DOM에 있었지만 대상 노드는 그려지지 않았다. 사전 등록은 파일 그룹 펼침만 정의했다 | Cogic 조작 수가 폴더 펼침만큼 늘어난다 |
| A2 | **Cogic**: 제품 기본값인 `cogic.analysisCache.enabled = true`로 실행한다. 실행마다 새 프로필이라 실행 사이에 캐시가 이어지지 않는다 | P3 하네스는 캐시를 끄도록 설정했다. 이 설정에서 vite V1의 Depth 2 Generate가 5분 안에 끝나지 않았다(노드 0개). 이 관찰은 별도 결과로 보고한다 | 다른 도구에는 해당 설정이 없다 |
| A3 | **Cogic**: 캔버스 진단 알림("TypeScript reported N errors")은 닫기 컨트롤이 없고 노드나 그룹 헤더를 가릴 수 있다. 클릭 대상이 hit-test에 실패하면 캔버스를 드래그한다(드래그 1회 = 조작 1, 최대 3회) | hono H2에서 폴더 그룹 펼침 클릭이 알림에 가려 30초 시간 초과가 났다 | 사용성 한계로 보고한다 |
| A4 | **Cogic 판독**: 엣지 끝점 id(`kind:file:offset`)의 offset을 소스 줄 번호로 바꾼다. 그 줄을 렌더링된 노드 제목(최상위 노드, id 일치) 또는 클래스 멤버 행의 `name() … file:line` 텍스트와 대응시킨다 | 클래스 멤버는 자기 id 속성이 없는 행(`.cgChildNode`)으로 그려진다. 원래 판독 코드는 모든 멤버에 클래스 id를 붙여 어떤 쌍도 판정하지 못했다 | 판독 정확성 수정. 내부 API는 쓰지 않는다 |
| A6 | **Cogic R2 판독**: 사전 등록 R2 절차에 적힌 "Inspector PARAM FLOW에서 구간별 인자→매개변수 표시 확인"을 구현에 반영한다. 렌더링된 `dataflow` 엣지 또는 PARAM FLOW 행(`from -> to` + `param <- arg`) 중 하나로 표시되면 그 구간을 확인한 것으로 보고, 근거가 엣지인지 행인지 기록한다 | 원래 판독 코드는 그래프 엣지만 봤다. vite V1에서 노드는 그려지지 않았지만 PARAM FLOW에 `createServer -> _createServer inlineConfig <- inlineConfig`가 표시됐다 | 사전 등록 절차와 구현을 일치시킨다 |
| A5 | **Trace Function Flow 판독**: 노드 텍스트가 `ƒFunction<name>()`처럼 종류 라벨과 이름이 붙어 있다. 이름 뒤에 `(`가 오는 것으로 일치시킨다 | hono H1에서 TFF 그래프에 경로 함수 4개가 모두 있었으나, 원래 단어 경계 정규식이 하나도 찾지 못했다 | 판독 정확성 수정 |

VS Code 기본 기능과 Context Graph의 절차·판독은 바꾸지 않았다.

## 바꾸지 않은 것 (스모크에서 관찰했지만 결과로 보고)
- **vite 대형 그래프 가시성**: V1에서 Depth 2 Generate는 캐시 ON에서도 약 371초 걸렸다. `server/index.ts` 그룹에 노드가 31개 있었지만 Fit 상태(최소 배율)에서 경로 함수와 `config.ts` 그룹이 DOM에 그려지지 않았다(React Flow 가상화, P8에서 확인한 문제와 같음). 검색창은 일치 노드를 강조만 하고 뷰를 옮기지 않는다. 사전 등록대로 Fit 후에 판독하며, 사람이 직접 찾아 이동하는 탐색은 측정하지 않는다.
- **hono H2**: `request`, `fetch`, `#dispatch`, `compose`는 노드·멤버 행으로 보였지만, 클래스 속성 화살표 함수와 private 메서드에서 나가는 호출 엣지는 없었다(`route→compose`만 있음).

