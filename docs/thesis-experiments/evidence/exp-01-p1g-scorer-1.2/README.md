# P1-G 증거: run 보존 기록과 scorer 1.1/1.2 비교

해석은 [p1g-scorer-amendment.md](../../p1g-scorer-amendment.md)에 있다.

**이 폴더의 scorer 1.2 결과는 사후 개정 진단이다. 사전 등록된 EXP-01 결과가 아니다.**

| 파일 | 내용 |
|---|---|
| `run-preservation.json` | 두 run(0651 baseline, 0636 replication)의 보존 기록에서 파생한 공개용 요약. 포함 항목은 다음과 같다. 절대 경로와 사용자 이름은 넣지 않았고, 보존 위치는 `<evidenceRoot>`로 적었다 |
| `compare-scorers.mjs` | 기존 run의 원시 예측을 읽기만 한다. scorer 1.1(git 기준 커밋의 `lib.mjs`)과 scorer 1.2(현재 `lib.mjs`)로 사례마다 행 단위 채점하고 비교한다 |
| `compare-scorers.exp01-20261029-0651-43ace0f-50587.json` | 위 스크립트를 baseline run에 실행한 출력 |
| `rescore-scorer-1.2-diagnostic.summary.json` | scorer 1.2로 baseline 원시 예측을 다시 채점한 `summary.json` 사본. 다른 출력 파일은 저장소 밖에만 두고 해시만 기록했다. `diagnostics.json`에 절대 경로가 들어 있기 때문이다 |

`run-preservation.json`에 담긴 항목:

- run ID, Git SHA, Node·V8·TypeScript 버전, analyzer 빌드 해시, scorer·runner 버전, 실행 상태, 차단 사례
- 파일 수, ZIP SHA-256
- 원시 파일별 상대 경로와 SHA-256
- 44개 사례의 `semanticHash` 비교

## 공개하지 않는 것

다음은 GitHub에 올리지 않았다. 원시 파일의 노드 ID에는 실행한 컴퓨터의 절대 경로(사용자 이름 포함)가 들어 있다.

- 원시 run 폴더
- run ZIP 두 개
- 진단 재채점의 `diagnostics.json`
- 로컬 보존 기록(`preservation-record.json`)

## 재현

```bash
node docs/thesis-experiments/evidence/exp-01-p1g-scorer-1.2/compare-scorers.mjs --run <run 폴더>
# 기대: unchangedCases 39, unchangedRowsIdentical 39, resolvedCases 5, problems 0
node docs/thesis-experiments/tools/exp01/score.mjs --predictions <run 폴더>/predictions --out <저장소 밖 새 폴더> --bootstrap 10000
```
