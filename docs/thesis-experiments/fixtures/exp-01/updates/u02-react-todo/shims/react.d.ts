// Minimal React declaration shim for EXP-01 fixtures (not the real @types/react).
export interface Context<T> {
  value: T;
}
export declare function useState<S>(initial: S): [S, (next: S | ((prev: S) => S)) => void];
export declare function useReducer<S, A>(reducer: (state: S, action: A) => S, initial: S): [S, (action: A) => void];
export declare function useEffect(effect: () => void, deps?: readonly unknown[]): void;
export declare function useLayoutEffect(effect: () => void, deps?: readonly unknown[]): void;
export declare function useMemo<T>(factory: () => T, deps: readonly unknown[]): T;
export declare function useCallback<T>(callback: T, deps: readonly unknown[]): T;
export declare function useRef<T>(initial: T): { current: T };
export declare function useContext<T>(context: Context<T>): T;
export declare function createContext<T>(value: T): Context<T>;
