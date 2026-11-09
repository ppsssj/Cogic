# Cogic 학술제 미니멀 데모 — 인터페이스 연결 수정본

**`src/demo.ts`만 활성화**하고 Cogic의 `All / Depth 1`에서 Generate합니다.

변경점: 기존 v4의 `CheckoutDemo.status(): string`을 `CheckoutDemo.status(): OrderPreview`로 변경했습니다. 이제 인터페이스를 실제로 참조하므로 `status → OrderPreview` references 관계가 분석 대상입니다. 클래스 카드의 **status()** 메서드에서 **OrderPreview** 쪽으로 흰색 선이 생기는지 확인하세요.

주요 관계:
- 흰색: `runDemo → CheckoutDemo.process` 호출
- 흰색: `CheckoutDemo.process → formatReceipt` 호출 (외부 파일)
- 흰색: `CheckoutDemo.status → OrderPreview` 타입 참조
- 파란색: `runDemo → process`의 `total ← 120`
- 파란색 2개: `process → formatReceipt`의 `sku ← "BOOK-01"`, `total ← total`

추가로 `runDemo`의 클래스 수신자 참조선이 생길 수 있습니다. 따라서 그래프의 흰색 선 수를 정확히 3개로 보장하지는 않습니다.

**Depth 0**은 현재 파일만, **Depth 1**은 직접 외부 함수까지, **Depth 2**는 `receipt.ts → money.ts` 추가 분석을 시연합니다.

`tsconfig.json`을 포함합니다. 타입 검사: `tsc --noEmit -p .`.

주의: 기존 파일의 `OrderPreview`라는 이름을 그대로 사용한 **v4 수정본**입니다. 이전에 드린 v5는 `OrderInput`이므로 혼동하지 마세요.
