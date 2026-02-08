import { add, A } from "./a";

export function compute(n: number) {
  const a = new A();
  return add(n, 10) + a.inc(n);
}
