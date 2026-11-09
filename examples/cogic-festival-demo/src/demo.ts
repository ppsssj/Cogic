// COGIC FESTIVAL — MINIMAL DEMO
// Keep this file open. Recommended: All + Depth 1.
// 2 calls + 1 interface reference (+ possible class receiver reference)
// 3 parameter mappings: 1 local, 2 cross-file.

import { formatReceipt } from "./receipt";

// Referenced by CheckoutDemo.status() to show one interface edge.
export interface OrderPreview {
  sku: string;
  total: number;
}

export class CheckoutDemo {
  static process(total: number): string {
    // Cross-file flow: sku <- "BOOK-01", total <- total
    return formatReceipt("BOOK-01", total);
  }

  // Referencing OrderPreview creates a visible type-reference edge.
  static status(): OrderPreview {
    return { sku: "BOOK-01", total: 120 };
  }
}

export function runDemo(): string {
  // Same-file flow: total <- 120
  return CheckoutDemo.process(120);
}
