export function useMemo<T>(factory: () => T): T {
  return factory();
}
