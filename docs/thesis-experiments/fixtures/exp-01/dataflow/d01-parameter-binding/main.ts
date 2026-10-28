function connect(host: string, port: number, secure = false): string {
  return `${host}:${port}:${secure}`;
}

function sum(...values: number[]): number {
  let total = 0;
  for (const v of values) {
    total += v;
  }
  return total;
}

function point({ x, y }: { x: number; y: number }): number {
  return x + y;
}

function pair(a: number, b: number): number {
  return a * b;
}

export function callDefaults(): string {
  return connect("localhost", 80);
}

export function callAll(): string {
  return connect("example", 443, true);
}

export function callRest(): number {
  return sum(1, 2, 3);
}

export function callRestEmpty(): number {
  return sum();
}

export function callDestructure(): number {
  return point({ x: 1, y: 2 });
}

export function spreadTuple(tuple: [number, number]): number {
  return pair(...tuple);
}

export function spreadRest(args: number[]): number {
  return sum(...args);
}

function scale(a: number, b: number): number {
  return a + b;
}

export function choose(flag: boolean): number {
  const op = flag ? pair : scale;
  return op(2, 3);
}
