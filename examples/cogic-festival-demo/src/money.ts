// A second-hop target. Its implementation only needs analyzing at Depth 3.
export function formatMoney(amount: number): string {
  return `${amount.toFixed(2)} USD`;
}
