# 응답 형식

다섯 개의 CSV 블록으로 답한다. 열은 `forms/`의 같은 이름 파일과 같다(`reviewer` 열에는 모델 이름을 적는다). 각 블록은 다음처럼 시작한다.

````
```csv relations
reviewer,blindId,relNo,kind,sourceFile,sourceLine,sourceName,targetFile,targetLine,targetName,argIndex,paramName,determinacy,candidates,evidence,confidence,note
...
```
````

블록 이름과 순서: `relations`, `negatives`, `sites`, `ambiguities`, `outside-definitions`. 해당 항목이 없으면 머리글만 둔다.

표기는 `REVIEWER_GUIDE.md` §3과 같다. 요약하면:
- 파일이 owner면 `sourceName`에 `<file>`
- framework 노드는 `<callback-owner>`, `<state-source>`, `<route-owner>`(줄은 기준 줄)
- TypeScript 기본 라이브러리 대상은 `targetFile`에 `lib`, `targetName`에 `인터페이스.멤버` 또는 전역 이름
- dynamic `import()` 대상 모듈은 `targetName`에 `<module>`
