import { formatMoney } from "./money";

// At Depth 2, this file's own call to formatMoney can be discovered.
export function formatReceipt(sku: string, total: number): string {
  const amount = formatMoney(total);
  return `${sku} | Total: ${amount}`;
}
