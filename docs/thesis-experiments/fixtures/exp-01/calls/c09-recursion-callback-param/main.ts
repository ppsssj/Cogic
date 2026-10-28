function step(n: number): number {
  return n - 1;
}

function countdown(n: number): number {
  if (n <= 0) {
    return 0;
  }
  return countdown(step(n));
}

export function schedule(task: () => void): void {
  task();
}

function tick(): void {}

export function start(): void {
  schedule(tick);
  const later = tick;
  void later;
}

export const first = countdown(3);
