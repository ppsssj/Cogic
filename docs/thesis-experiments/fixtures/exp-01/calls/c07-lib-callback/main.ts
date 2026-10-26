function square(n: number): number {
  return n * n;
}

export function stats(values: number[]): number {
  const squares = values.map(square);
  const best = Math.max(...squares);
  return best;
}
