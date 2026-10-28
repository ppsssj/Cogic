export function computed<T>(getter: () => T): T {
  return getter();
}

export function ref<T>(value: T): { value: T } {
  return { value };
}

export function watch(source: unknown, callback: () => void): void {
  void source;
  callback();
}

export function reactive<T>(value: T): T {
  return value;
}
