# 2분 시연

1. `src/demo.ts`, Depth 1, All → Generate. 먼저 `OrderPreview`의 흰색 연결을 확인
2. `Functions → Classes → Interfaces → All` 순서로 필터 전환
3. `runDemo → process` 파라미터 `total ← 120` 선택
4. `process → formatReceipt`의 `sku ← "BOOK-01"`, `total ← total` 선택
5. Depth 0 → 1 → 2 → 1을 비교하며 추가 외부 파일 연결을 설명

`OrderPreview`가 연결되지 않으면 **현재 열어둔 demo.ts의 `status(): OrderPreview` 여부**, Root 및 필터, 재분석 상태부터 확인하세요.
