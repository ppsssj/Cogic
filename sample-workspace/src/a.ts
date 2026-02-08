export function add(a: number, b: number) {
  return a + b;
}

export class A {
  inc(x: number) {
    return add(x, 1);
  }
}
