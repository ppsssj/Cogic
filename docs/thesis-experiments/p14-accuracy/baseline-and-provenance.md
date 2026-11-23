# 기준과 연구 자산

## VERIFIED: 소스와 도구

`github/main`의 P13 병합 커밋 `fdaecd4fd03b0b91cf4c83ea7f4e9ad00db58640`에서 별도 연구 브랜치를 시작했다. P14 실행 당시 HEAD는 이 커밋이고 작업 트리는 clean이었다. Node v24.12.0, TypeScript 5.9.3이다. `npm run compile` 이후 runner가 계산한 analyzer 빌드 해시는 `f42456872d96481f4356450a0daad2d5b3d7a9a16fcbad56f41a3a0952e8705c`이다.

| 자산 | 위치와 상태 |
|---|---|
| EXP-01 GT v1, 44개 fixture, runner 1.2, scorer 1.2 | 현재 main에 포함. GT 214파일 및 평가 manifest r2 227파일 일치. |
| EXP-01 표본 146개, AI 교차 검토 | 현재 main에 포함. 사람 검토 결과가 아니며 blind 한계가 있다. |
| Corpus B 20개, 블라인드 패킷 생성기, 사전 고정 평가 절차 | [P1-K 독립 검증 브랜치](https://github.com/ppsssj/Cogic/tree/b4a5ff5a27918425b79e6d7857f9f604a71702e4/docs/thesis-experiments/corpus-b)에만 존재한다. 별도 detached worktree에서 검사했다. |
| Corpus B v2 범위 민감도 초안 | [P1-K 채점 프로토콜](https://github.com/ppsssj/Cogic/tree/f91f8502ae2b7d98e3545e2027b99483e1046035/docs/thesis-experiments/corpus-b/review-preparation)에 존재. 이 커밋은 승인 전 초안이다. |
| Corpus B ORIGINAL/IMPROVED 결과 | [P1-L](https://github.com/ppsssj/Cogic/tree/4c5a3e234f930057b15e3f0a608939839c0dc62a/docs/thesis-experiments/corpus-b/results/p1l)에 존재. P1-L에서 v2 절차를 승인·동결한 뒤 실행했다. main에는 병합되지 않았다. |

P1-L의 ORIGINAL은 `43ace0fdfdf442d7871c3ef4a92d73b28f1b5e77`, IMPROVED는 `bbe4cbf5b1f784d9223ca3d46d96058617687b12`다. 각 빌드 해시는 각각 `958dbf677b6085ddf478265b3cc2b64c5fb1452bf28cfb4c255ed5ef00566270`, `2423b0d471b6e622a40b33695e2608503264ac0d06695c50284d0ed5e466ac36`이다. P1-L 원시 run 및 기존 보고서가 출처다. IMPROVED 이후 main의 `src/analyzer` tree는 `a2202f4a32a7515be37bdfe2334cde7b2a7f1fea`에서 `5e8966587aa203cb9fb10c91ffc7122ecd803943`으로 바뀌었다. 현재 main을 IMPROVED와 동일하다고 가정하지 않는다.

## VERIFIED: 과거 측정과 게이트

EXP-01 v1.1은 baseline 실행에서 external shim의 같은 줄 노드 키 충돌로 일부 사례의 채점이 막혔다. scorer 1.2는 출력을 본 **후** 충돌을 한정적으로 분리하도록 개정됐고, runner 1.2는 `POST_HOC_AMENDED`와 `preregisteredConfirmatory: false`를 기록한다. 원래 규칙의 사전 등록 확증 결과와 개정 결과는 다르다. 실행기술 게이트 통과도 GT의 사람 검증을 뜻하지 않는다.

현재 main으로 실행한 run은 44/44 정상 실행·결정성 일치·캐시 hit 경로 확인, scorer `COMPLETE`였으나 baseline `43ace0f` 대비 analyzer tree, package 및 lock blob, 빌드 해시가 달라 기술 게이트 실패다. runner의 고정 `analyzerIdentity.note`는 동일하다고 서술하지만 실제 `identical: false` 및 `mismatches`가 우선한다. 이 작업에서는 게이트를 수정하거나 무시해 확증 결과로 만들지 않았다.
