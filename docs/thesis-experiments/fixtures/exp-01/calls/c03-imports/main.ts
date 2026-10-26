import negate, { add, square } from "./math";
import * as fmt from "./format";

export function total(values: number[]): number {
  let sum = 0;
  for (const v of values) {
    sum = add(sum, square(v));
  }
  return negate(sum);
}

export function render(n: number): string {
  return fmt.pad(`${n}`, 8);
}
