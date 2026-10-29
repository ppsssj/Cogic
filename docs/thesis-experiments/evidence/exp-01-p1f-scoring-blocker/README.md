# P1-F 채점 차단 원인 진단 증거

EXP-01 첫 실측에서 React 5개 사례가 `SCORING_BLOCKED`된 원인을 조사한 독립 진단 자료다. 해석은 [p1f-scoring-blocker-audit.md](../../p1f-scoring-blocker-audit.md)에 있다.

**이 폴더의 수치는 사전 등록 평가가 아니다.** 아래 결과는 다음 용도로만 쓴다.

- EXP-01 정확도로 보고하지 않는다.
- run 결과(`data/exp-01/…`)에 섞지 않는다.

| 파일 | 내용 |
|---|---|
| `collision-audit.mjs` | run 폴더의 원시 예측을 읽어(읽기 전용) scorer 1.1과 같은 `lib.mjs` 함수로 충돌을 재현한다. 충돌 노드의 원시 ID·이름·범위·정규화 키를 적고, 차단 사례를 두 방식으로 행 단위 채점한다. 하나는 scorer 1.1 키 그대로이고, 다른 하나는 진단용 재키잉이다 |
| `collision-audit.exp01-20261029-0651-43ace0f-50587.json` | 위 스크립트를 run `exp01-20261029-0651-43ace0f-50587`에 실행한 출력. 원시 ID 안의 절대 경로는 `<fixtureRoot>`로 바꿨다 |
| `react-setter-probe.mjs` | 컴파일된 analyzer(`out/analyzer`)를 임시 폴더의 합성 입력 3종에 실행한다. 저장소 밖에 쓰고, 끝나면 지운다 |
| `react-setter-probe.json` | 위 스크립트의 출력 |

## 재현

```bash
npm run compile
node docs/thesis-experiments/evidence/exp-01-p1f-scoring-blocker/collision-audit.mjs --run <run 폴더>
node docs/thesis-experiments/evidence/exp-01-p1f-scoring-blocker/react-setter-probe.mjs
```

- 두 스크립트 모두 `src/`, `tools/`, GT, manifest, run 폴더를 바꾸지 않는다.
- `collision-audit.mjs`의 재키잉은 메모리 안에서만 한다. 충돌한 external 노드 가운데 다른 노드를 모두 감싸는 선언 노드만 `X|파일|줄`을 유지하고, 나머지 노드의 파일 이름에 `#c<열>`을 붙인다. 감싸는 노드가 하나로 정해지지 않으면 충돌을 그대로 둔다.
- 기준 run 이전에 같은 커밋에서 실행한 run `exp01-20261029-0636-43ace0f`(로컬 브랜치 `research/thesis-p1e-exp01-run`)에도 실행했다. 원시 파일 해시만 달랐다. 실행 경로가 다르기 때문이다. 감사 내용은 같았다.
