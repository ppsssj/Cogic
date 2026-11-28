# S037 Gemini 검토 원문 보존 위치

**현재 상태:** 원문 미수령(2026-11-27). 이 저장소에 있는 Gemini 판단 서술은 모두 연구자가 작업 지시에 적은 **요약**이다.

## 수령 절차

1. 연구자가 Gemini 대화의 원문(내보내기 파일 또는 전체 복사본)을 **수정하지 않은 파일**로 제공한다. 일부 발췌나 다시 쓴 요약은 원문으로 받지 않는다.
2. 파일을 `raw/` 아래에 받은 이름 그대로 둔다. 이후 수정하지 않는다.
3. 같은 폴더에 `meta.json`을 만든다.

```json
{
  "schema": "p14d-external-review/1",
  "reviewer": "Gemini",
  "modelVersion": "<화면에 표시된 모델명·버전>",
  "interface": "<web | app | api>",
  "conversationDate": "<YYYY-MM-DD>",
  "receivedAt": "<ISO 시각>",
  "rawFiles": [{ "path": "raw/<이름>", "sha256": "<64자>", "bytes": 0 }],
  "inputsGiven": {
    "source": "n04 main.ts",
    "annotationGuide": "<제공 여부·범위>",
    "catalogOwnerFile": false,
    "gtV1": "<제공 여부>",
    "otherModelsAnswers": "<제공 여부>"
  },
  "providedBy": "researcher",
  "notes": "catalog.csv의 owner = file 정의는 제공되지 않음(연구자 진술)"
}
```

4. SHA-256은 `node -e "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync(process.argv[1])).digest('hex'))" raw/<이름>`으로 계산한다.
5. 요약이 필요하면 `summary.md`에 "연구자/Claude 요약"이라고 표시하고 원문 파일 경로와 해시를 인용한다.
6. 개인 정보(계정명, 이메일)가 원문에 있으면 공개 저장소에 올리기 전에 연구자에게 확인한다. 가린 사본을 올리더라도 가리지 않은 원본의 해시는 기록한다.
