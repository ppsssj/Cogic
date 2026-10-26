function helper(n: number): number {
  return n + 1;
}

const double = (n: number): number => n * 2;

function compute(n: number): number {
  const a = helper(n);
  const b = double(a);
  return helper(b);
}

export function run(): number {
  return compute(1) + double(2);
}

const initial = compute(0);

run();

export { initial as start };
