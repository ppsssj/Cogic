# 회귀 검사와 남은 한계

## 확인한 범위

- `npm run compile`, `npm run lint`, `npm test` 통과. VS Code 테스트는 기존 48개와 신규 4개를 포함해 52개다.
- 새 테스트는 일반 호출·메서드, 명시적 함수 타입 property, optional 호출, 두 클래스의 같은 private 이름, static private method, 함수 참조·호출 불가 property 부정 사례, 상속·super, import, overload가 있는 코드, 위치·선택 인자, rest, 고정 및 불확정 spread, 노드 중복, cache OFF/cold/warm을 다룬다. 기존 React/Vue/Express/Nest 테스트도 통과했다.
- EXP-01 GT manifest 214파일, 평가 manifest r2 227파일 일치. 기존 GT와 P13/P14-A 자료는 변경하지 않았다.
- P14-A baseline과 수정 후의 Corpus A strict 행을 비교했다. 기존 GT TP 586개가 모두 유지되고 FN 1개(`DF-SPREAD-TUPLE`의 두 번째 원소)가 TP가 됐다. 기존 FP 3개는 그대로이고 새 FP는 없었다. 44개 사례의 반복 결정성과 cache OFF/ON 일치, warm hit는 모두 확인됐다.

Corpus A 비교는 **회귀 진단**이다. GT 사람 검토 전, scorer 1.2의 사후 개정 규칙이고, 수정 후 run은 dirty 작업 트리와 bootstrap 0을 사용했으며 과거 analyzer 동일성 게이트에도 실패했다. P/R/F1이나 확증 정확도 수치로 보고하지 않는다. 비교 전 baseline `fdaecd4`와 `48e7058`의 analyzer·shared·lock·tsconfig는 같다. 수정 후 analyzer 빌드 해시는 `9bc80d3f57035274f58c81b15989c37b48425163a8e8fa76a1d56450d01ea57f`다. 원시 run은 개인 경로가 포함돼 저장소 밖에 보존한다.

## 한계

- Hono 그래프의 새 엣지 전체를 독립적인 사람 GT로 확인하지 않았다. Corpus A의 새 FP 0은 이 fixture의 scorer 판정 범위에서만 유효하다.
- 함수 타입 property가 다른 파일에 선언된 경우 기존 external 해석을 유지한다. 동적 디스패치, getter/setter, 선택적·가변 tuple spread와 rest의 모든 원소 추적은 이번에 일반적으로 해결하지 않았다.
- P14-A의 `hono-h2-minimal.test.cjs`는 **수정 전 결함이 존재한다는 역사적 characterization**이다. 기본 실행에서는 명시적으로 skip하며 `COGIC_P14A_HISTORICAL=1`은 수정 전 analyzer에서만 사용한다. 원래 파일의 바이트 사본은 [evidence/hono-h2-minimal.original.txt](ui-smoke/evidence/hono-h2-minimal.original.txt)에 보존했다(SHA256 `270d1b091623a3cc4134ffb89d6e19a1c6d7a8409482eb10c043595d5d1b1fcd`). 원본 테스트는 수정 전 `48e7058`의 별도 checkout에서 통과했다. 수정 후 성공 기준은 `src/test/p14CallOwnership.test.ts`다.
- 실제 VS Code 1.147.0에서 현재 개발 확장을 격리 프로필로 실행한 [UI smoke](ui-smoke/README.md)가 통과했다. P13 경쟁 도구 실험은 재실행하지 않았다.
