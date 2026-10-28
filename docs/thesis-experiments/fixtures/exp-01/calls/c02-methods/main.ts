class Counter {
  private value = 0;

  static create(): Counter {
    return new Counter();
  }

  increment(): void {
    this.value += 1;
    this.log();
  }

  log(): void {}

  reset(): void {
    this.value = 0;
    this.log();
  }
}

export function useCounter(): void {
  const c = Counter.create();
  c.increment();
  c.reset();
}
