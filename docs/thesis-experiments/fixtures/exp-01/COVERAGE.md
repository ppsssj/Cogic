# EXP-01 Ground Truth Coverage

이 파일은 `tools/exp01/coverage.mjs`가 `expected.json`에서 생성한다. 손으로 고치지 않는다.

- GT 버전: v1
- 사례(fixture) 수: 44
- 확증 평가 대상(determinate) 관계: **651** (supported 565, unsupported-by-design 68, ambiguous·determinate 18)
- 별도 보고(indeterminate): 8
- 부정 사례(negative): 49

## 1. 범주별 분포

| 범주 | supported (in-scope) | unsupported-by-design | ambiguous·determinate | determinate 합계 (overall 분모) | indeterminate | negative |
|---|---:|---:|---:|---:|---:|---:|
| calls | 126 | 15 | 2 | 143 | 6 | 7 |
| constructs | 33 | 5 | 1 | 39 | 0 | 5 |
| references | 137 | 19 | 0 | 156 | 0 | 5 |
| dataflow | 149 | 17 | 15 | 181 | 2 | 5 |
| updates | 35 | 1 | 0 | 36 | 0 | 7 |
| react-hook-owner | 22 | 0 | 0 | 22 | 0 | 5 |
| vue-hook-owner | 25 | 3 | 0 | 28 | 0 | 5 |
| express-route-owner | 18 | 8 | 0 | 26 | 0 | 5 |
| nest-route-owner | 20 | 0 | 0 | 20 | 0 | 5 |
| **합계** | 565 | 68 | 18 | 651 | 8 | 49 |

## 2. P0 최소 표본 기준 점검

기준 출처: [exp-01-accuracy.md §5.1](../../experiments/exp-01-accuracy.md#51-코퍼스-a--마이크로-fixture-확증-분석의-주-대상).

| 범주 | 기준 | 값 | 결과 |
|---|---|---:|---|
| calls | in-scope(supported) >= 30 | 126 | PASS |
| calls | negatives >= 5 | 7 | PASS |
| constructs | in-scope(supported) >= 30 | 33 | PASS |
| constructs | negatives >= 5 | 5 | PASS |
| references | in-scope(supported) >= 30 | 137 | PASS |
| references | negatives >= 5 | 5 | PASS |
| dataflow | in-scope(supported) >= 30 | 149 | PASS |
| dataflow | negatives >= 5 | 5 | PASS |
| updates | in-scope(supported) >= 30 | 35 | PASS |
| updates | negatives >= 5 | 7 | PASS |
| react-hook-owner | in-scope(supported) >= 15 | 22 | PASS |
| react-hook-owner | negatives >= 5 | 5 | PASS |
| vue-hook-owner | in-scope(supported) >= 15 | 25 | PASS |
| vue-hook-owner | negatives >= 5 | 5 | PASS |
| express-route-owner | in-scope(supported) >= 15 | 18 | PASS |
| express-route-owner | negatives >= 5 | 5 | PASS |
| nest-route-owner | in-scope(supported) >= 15 | 20 | PASS |
| nest-route-owner | negatives >= 5 | 5 | PASS |
| total | determinate >= 250 | 651 | PASS |

## 3. 패턴별 분포

| 패턴 | 범주 | 지원 분류 | determinate | indeterminate | negative |
|---|---|---|---:|---:|---:|
| CALL-BARREL | calls | supported | 2 | 0 | 0 |
| CALL-CTOR-BODY | calls | unsupported-by-design | 1 | 0 | 0 |
| CALL-DECORATOR-CLASS | calls | supported | 5 | 0 | 0 |
| CALL-DECORATOR-METHOD | calls | unsupported-by-design | 8 | 0 | 0 |
| CALL-DYNAMIC-IMPORT | calls | supported | 1 | 0 | 0 |
| CALL-DYNAMIC-MODULE-MEMBER | calls | supported | 1 | 0 | 0 |
| CALL-ELEMENT-DYNAMIC | calls | ambiguous | 0 | 1 | 0 |
| CALL-ELEMENT-LITERAL | calls | ambiguous | 1 | 0 | 0 |
| CALL-FN-CALL-APPLY-BIND | calls | ambiguous | 1 | 0 | 0 |
| CALL-FW-API | calls | supported | 47 | 0 | 0 |
| CALL-GENERIC | calls | supported | 1 | 0 | 0 |
| CALL-IMPORT-DEFAULT | calls | supported | 1 | 0 | 0 |
| CALL-IMPORT-NAMED | calls | supported | 5 | 0 | 0 |
| CALL-IMPORT-NAMESPACE | calls | supported | 4 | 0 | 0 |
| CALL-IN-ANON-CALLBACK | calls | supported | 3 | 0 | 0 |
| CALL-INTERFACE-DISPATCH | calls | ambiguous | 0 | 2 | 0 |
| CALL-JSX-IMPORT | calls | supported | 1 | 0 | 0 |
| CALL-JSX-LOCAL | calls | supported | 1 | 0 | 0 |
| CALL-LIB | calls | unsupported-by-design | 6 | 0 | 0 |
| CALL-LOCAL-FN | calls | supported | 23 | 0 | 0 |
| CALL-METHOD-EXTERNAL | calls | supported | 1 | 0 | 0 |
| CALL-METHOD-INSTANCE | calls | supported | 8 | 0 | 0 |
| CALL-METHOD-STATIC | calls | supported | 2 | 0 | 0 |
| CALL-METHOD-THIS | calls | supported | 5 | 0 | 0 |
| CALL-NESTED-LOCAL-FN | calls | supported | 1 | 0 | 0 |
| CALL-OBJ-LITERAL-METHOD | calls | supported | 2 | 0 | 0 |
| CALL-OPTIONAL | calls | supported | 2 | 0 | 0 |
| CALL-OVERLOAD-LOCAL | calls | supported | 1 | 0 | 0 |
| CALL-PARAM-CALLBACK | calls | ambiguous | 0 | 1 | 0 |
| CALL-PATH-ALIAS | calls | supported | 1 | 0 | 0 |
| CALL-RECURSIVE | calls | supported | 1 | 0 | 0 |
| CALL-SUPER-METHOD | calls | supported | 1 | 0 | 0 |
| CALL-TOPLEVEL | calls | supported | 6 | 0 | 0 |
| CALL-VARIABLE-ALIAS | calls | ambiguous | 0 | 2 | 0 |
| NEG-CALLBACK-PASS | calls | negative | 0 | 0 | 2 |
| NEG-COMMENT-STRING | calls | negative | 0 | 0 | 1 |
| NEG-JSX-INTRINSIC | calls | negative | 0 | 0 | 2 |
| NEG-SHADOW | calls | negative | 0 | 0 | 1 |
| NEG-TYPEOF | calls | negative | 0 | 0 | 1 |
| CONS-CTOR-BODY | constructs | unsupported-by-design | 1 | 0 | 0 |
| CONS-FIELD-INIT | constructs | unsupported-by-design | 3 | 0 | 0 |
| CONS-GENERIC | constructs | supported | 1 | 0 | 0 |
| CONS-IMPORTED-EXPLICIT-CTOR | constructs | supported | 4 | 0 | 0 |
| CONS-IMPORTED-IMPLICIT-CTOR | constructs | supported | 1 | 0 | 0 |
| CONS-INHERITED-CTOR | constructs | supported | 1 | 0 | 0 |
| CONS-LIB | constructs | unsupported-by-design | 1 | 0 | 0 |
| CONS-LOCAL-EXPLICIT-CTOR | constructs | supported | 16 | 0 | 0 |
| CONS-LOCAL-IMPLICIT-CTOR | constructs | supported | 9 | 0 | 0 |
| CONS-TOPLEVEL | constructs | supported | 1 | 0 | 0 |
| CONS-VIA-VARIABLE | constructs | ambiguous | 1 | 0 | 0 |
| NEG-CLASS-VALUE | constructs | negative | 0 | 0 | 1 |
| NEG-INSTANCEOF | constructs | negative | 0 | 0 | 1 |
| NEG-SPREAD-COPY | constructs | negative | 0 | 0 | 1 |
| NEG-STATIC-FACTORY | constructs | negative | 0 | 0 | 1 |
| NEG-TYPE-ONLY | constructs | negative | 0 | 0 | 1 |
| DF-CONSTRUCTOR | dataflow | supported | 33 | 0 | 0 |
| DF-CTOR-BODY | dataflow | unsupported-by-design | 2 | 0 | 0 |
| DF-DECORATOR-METHOD | dataflow | unsupported-by-design | 7 | 0 | 0 |
| DF-DESTRUCTURED-PARAM | dataflow | supported | 1 | 0 | 0 |
| DF-EXTERNAL | dataflow | supported | 71 | 0 | 0 |
| DF-FIELD-INIT | dataflow | unsupported-by-design | 1 | 0 | 0 |
| DF-INDIRECT | dataflow | ambiguous | 2 | 2 | 0 |
| DF-INHERITED-CTOR | dataflow | supported | 1 | 0 | 0 |
| DF-LIB | dataflow | unsupported-by-design | 7 | 0 | 0 |
| DF-OPTIONAL-PARAM | dataflow | supported | 2 | 0 | 0 |
| DF-POSITIONAL | dataflow | supported | 41 | 0 | 0 |
| DF-REST-PARAM | dataflow | ambiguous | 10 | 0 | 0 |
| DF-SPREAD-REST | dataflow | ambiguous | 1 | 0 | 0 |
| DF-SPREAD-TUPLE | dataflow | ambiguous | 2 | 0 | 0 |
| NEG-CALLBACK-PASS | dataflow | negative | 0 | 0 | 1 |
| NEG-DEFAULT-OMITTED | dataflow | negative | 0 | 0 | 2 |
| NEG-JSX-PROPS | dataflow | negative | 0 | 0 | 1 |
| NEG-ZERO-ARGS | dataflow | negative | 0 | 0 | 1 |
| CALL-LOCAL-FN | express-route-owner | supported | 2 | 0 | 0 |
| CALL-METHOD-EXTERNAL | express-route-owner | supported | 2 | 0 | 0 |
| DF-EXTERNAL | express-route-owner | supported | 2 | 0 | 0 |
| DF-POSITIONAL | express-route-owner | supported | 1 | 0 | 0 |
| FW-EXPRESS-EXTRA-HANDLER | express-route-owner | unsupported-by-design | 2 | 0 | 0 |
| FW-EXPRESS-HANDLER-CALL | express-route-owner | supported | 4 | 0 | 0 |
| FW-EXPRESS-IMPORTED-APP | express-route-owner | unsupported-by-design | 1 | 0 | 0 |
| FW-EXPRESS-INLINE | express-route-owner | supported | 1 | 0 | 0 |
| FW-EXPRESS-MIDDLEWARE | express-route-owner | supported | 1 | 0 | 0 |
| FW-EXPRESS-MOUNT | express-route-owner | supported | 1 | 0 | 0 |
| FW-EXPRESS-NAMED | express-route-owner | supported | 3 | 0 | 0 |
| FW-EXPRESS-ROUTE-CHAIN | express-route-owner | unsupported-by-design | 1 | 0 | 0 |
| FW-EXPRESS-ROUTER | express-route-owner | supported | 1 | 0 | 0 |
| FW-EXPRESS-TOPLEVEL | express-route-owner | unsupported-by-design | 1 | 0 | 0 |
| FW-UNSUPPORTED-OWNER-EDGE | express-route-owner | unsupported-by-design | 3 | 0 | 0 |
| NEG-EXPRESS-NONROUTE | express-route-owner | negative | 0 | 0 | 4 |
| NEG-NOT-EXPRESS | express-route-owner | negative | 0 | 0 | 1 |
| FW-NEST-HANDLER-CALL | nest-route-owner | supported | 10 | 0 | 0 |
| FW-NEST-NAMESPACE | nest-route-owner | supported | 1 | 0 | 0 |
| FW-NEST-ROUTE | nest-route-owner | supported | 9 | 0 | 0 |
| NEG-NEST-LOCAL-DECORATOR | nest-route-owner | negative | 0 | 0 | 2 |
| NEG-NEST-NO-ROUTE-DECORATOR | nest-route-owner | negative | 0 | 0 | 1 |
| NEG-NEST-NOT-CONTROLLER | nest-route-owner | negative | 0 | 0 | 2 |
| CALL-LOCAL-FN | react-hook-owner | supported | 1 | 0 | 0 |
| DF-POSITIONAL | react-hook-owner | supported | 1 | 0 | 0 |
| FW-REACT-ALIAS-IMPORT | react-hook-owner | supported | 1 | 0 | 0 |
| FW-REACT-CALLBACK-INLINE | react-hook-owner | supported | 3 | 0 | 0 |
| FW-REACT-CALLBACK-NAMED | react-hook-owner | supported | 1 | 0 | 0 |
| FW-REACT-NAMED-CALLBACK-CALL | react-hook-owner | supported | 1 | 0 | 0 |
| FW-REACT-NAMESPACE-IMPORT | react-hook-owner | supported | 2 | 0 | 0 |
| FW-REACT-REDUCER-BINDING | react-hook-owner | supported | 1 | 0 | 0 |
| FW-REACT-STATE-SOURCE | react-hook-owner | supported | 9 | 0 | 0 |
| NEG-CREATECONTEXT | react-hook-owner | negative | 0 | 0 | 1 |
| NEG-CUSTOM-HOOK | react-hook-owner | negative | 0 | 0 | 1 |
| NEG-NON-FRAMEWORK-MODULE | react-hook-owner | negative | 0 | 0 | 1 |
| NEG-USECONTEXT | react-hook-owner | negative | 0 | 0 | 1 |
| NEG-USEREF | react-hook-owner | negative | 0 | 0 | 1 |
| REF-STATE-READ | react-hook-owner | supported | 2 | 0 | 0 |
| NEG-COMMENT-STRING | references | negative | 0 | 0 | 1 |
| NEG-PROPERTY-NAME | references | negative | 0 | 0 | 1 |
| NEG-SHADOW | references | negative | 0 | 0 | 3 |
| REF-CLASS-VALUE | references | supported | 2 | 0 | 0 |
| REF-CROSS-FILE | references | unsupported-by-design | 10 | 0 | 0 |
| REF-ENUM-MEMBER | references | supported | 1 | 0 | 0 |
| REF-FIELD-INIT | references | supported | 1 | 0 | 0 |
| REF-HERITAGE | references | supported | 7 | 0 | 0 |
| REF-IN-ANON-CALLBACK | references | unsupported-by-design | 1 | 0 | 0 |
| REF-LIB | references | unsupported-by-design | 3 | 0 | 0 |
| REF-METHOD-VALUE | references | supported | 1 | 0 | 0 |
| REF-RECEIVER | references | supported | 2 | 0 | 0 |
| REF-SHORTHAND-PROPERTY | references | supported | 39 | 0 | 0 |
| REF-STATE-READ | references | supported | 12 | 0 | 0 |
| REF-STATE-SETTER-VALUE | references | supported | 1 | 0 | 0 |
| REF-STATE-WRITE | references | supported | 15 | 0 | 0 |
| REF-TOPLEVEL | references | unsupported-by-design | 3 | 0 | 0 |
| REF-TYPE-ANNOTATION | references | supported | 32 | 0 | 0 |
| REF-TYPE-MEMBER | references | supported | 6 | 0 | 0 |
| REF-TYPEOF-QUERY | references | supported | 1 | 0 | 0 |
| REF-UNSUPPORTED-STATE | references | unsupported-by-design | 2 | 0 | 0 |
| REF-VALUE-FN | references | supported | 17 | 0 | 0 |
| NEG-COPY-MUTATION | updates | negative | 0 | 0 | 1 |
| NEG-NOT-SETTER | updates | negative | 0 | 0 | 1 |
| NEG-READ-ONLY | updates | negative | 0 | 0 | 2 |
| NEG-SETTER-AS-VALUE | updates | negative | 0 | 0 | 1 |
| NEG-SHADOW-STATE | updates | negative | 0 | 0 | 2 |
| UPD-REACT-DISPATCH | updates | supported | 2 | 0 | 0 |
| UPD-REACT-SETTER | updates | supported | 15 | 0 | 0 |
| UPD-REACT-SETTER-FN | updates | supported | 2 | 0 | 0 |
| UPD-UNSUPPORTED-STATE | updates | unsupported-by-design | 1 | 0 | 0 |
| UPD-VUE-REACTIVE-PROP | updates | supported | 6 | 0 | 0 |
| UPD-VUE-REF | updates | supported | 10 | 0 | 0 |
| CALL-LOCAL-FN | vue-hook-owner | supported | 2 | 0 | 0 |
| DF-POSITIONAL | vue-hook-owner | supported | 2 | 0 | 0 |
| FW-UNSUPPORTED-OWNER-EDGE | vue-hook-owner | unsupported-by-design | 1 | 0 | 0 |
| FW-VUE-CALLBACK | vue-hook-owner | supported | 3 | 0 | 0 |
| FW-VUE-LIFECYCLE | vue-hook-owner | unsupported-by-design | 1 | 0 | 0 |
| FW-VUE-NAMESPACE-IMPORT | vue-hook-owner | supported | 2 | 0 | 0 |
| FW-VUE-STATE-SOURCE | vue-hook-owner | supported | 12 | 0 | 0 |
| FW-VUE-STATE-UNSUPPORTED | vue-hook-owner | unsupported-by-design | 1 | 0 | 0 |
| NEG-NON-FRAMEWORK-MODULE | vue-hook-owner | negative | 0 | 0 | 3 |
| NEG-VUE-NOT-STATE | vue-hook-owner | negative | 0 | 0 | 2 |
| REF-STATE-READ | vue-hook-owner | supported | 3 | 0 | 0 |
| REF-STATE-WRITE | vue-hook-owner | supported | 1 | 0 | 0 |

## 4. 사례별 분포

| 사례 | 폴더 범주 | determinate | indeterminate | negative |
|---|---|---:|---:|---:|
| c01-local-direct | calls | 11 | 0 | 0 |
| c02-methods | calls | 8 | 0 | 0 |
| c03-imports | calls | 10 | 0 | 0 |
| c04-barrel-alias | calls | 8 | 0 | 0 |
| c05-optional-generic-overload | calls | 8 | 0 | 0 |
| c06-jsx-dynamic-import | calls | 4 | 0 | 3 |
| c07-lib-callback | calls | 5 | 0 | 2 |
| c08-dynamic-access | calls | 10 | 1 | 0 |
| c09-recursion-callback-param | calls | 9 | 1 | 1 |
| c10-negatives | calls | 4 | 0 | 6 |
| k01-local-classes | constructs | 15 | 0 | 0 |
| k02-imported-ctor-body | constructs | 13 | 0 | 0 |
| k03-factories | constructs | 20 | 1 | 0 |
| k04-indirect-builtin | constructs | 11 | 0 | 1 |
| k05-field-initializers | constructs | 16 | 0 | 0 |
| k06-imported-scene | constructs | 23 | 0 | 0 |
| k07-events | constructs | 15 | 0 | 0 |
| k08-negatives | constructs | 7 | 0 | 4 |
| d01-parameter-binding | dataflow | 19 | 2 | 2 |
| d02-methods-constructors | dataflow | 16 | 0 | 1 |
| e01-inline-handlers | express | 20 | 0 | 0 |
| e02-named-middleware | express | 24 | 0 | 0 |
| e03-unsupported-negatives | express | 34 | 0 | 5 |
| n01-controller | nest | 18 | 0 | 0 |
| n02-namespace-negatives | nest | 9 | 0 | 3 |
| n03-paths | nest | 21 | 0 | 0 |
| n04-local-decorators | nest | 6 | 0 | 2 |
| h01-reducer-effect | react | 21 | 0 | 0 |
| h02-alias-namespace-memo | react | 30 | 0 | 0 |
| h03-unsupported-negatives | react | 18 | 0 | 5 |
| r01-type-references | references | 8 | 0 | 0 |
| r02-value-references | references | 7 | 2 | 0 |
| r03-heritage-members | references | 10 | 1 | 0 |
| r04-anonymous-callback | references | 14 | 0 | 0 |
| r05-cross-file | references | 6 | 0 | 0 |
| u01-react-usestate | updates | 14 | 0 | 0 |
| u02-react-todo | updates | 17 | 0 | 0 |
| u03-vue-ref-reactive | updates | 27 | 0 | 0 |
| u04-vue-form | updates | 25 | 0 | 0 |
| u05-react-negatives | updates | 11 | 0 | 5 |
| u06-vue-negatives | updates | 12 | 0 | 4 |
| v01-computed-watch | vue | 27 | 0 | 0 |
| v02-namespace-unsupported | vue | 27 | 0 | 0 |
| v03-negatives | vue | 13 | 0 | 5 |

## 5. 정량 평가에서 제외한 형식

- `VUE-SFC`: .vue Single File Component. 정량 평가에서 제외. 파일 형식 지원 범위 한계로만 기록(fixture 없음)
