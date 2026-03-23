declare module "react" {
  export type DependencyList = readonly unknown[];

  export function useEffect(
    effect: () => void | (() => void),
    deps?: DependencyList,
  ): void;

  export function useMemo<T>(
    factory: () => T,
    deps?: DependencyList,
  ): T;

  export function useCallback<T extends (...args: never[]) => unknown>(
    callback: T,
    deps?: DependencyList,
  ): T;
}

declare module "react/jsx-runtime" {
  export function jsx(type: unknown, props: unknown, key?: unknown): JSX.Element;
  export function jsxs(type: unknown, props: unknown, key?: unknown): JSX.Element;
  export const Fragment: unique symbol;
}

declare namespace JSX {
  interface Element {}

  interface IntrinsicElements {
    [elemName: string]: unknown;
  }
}
