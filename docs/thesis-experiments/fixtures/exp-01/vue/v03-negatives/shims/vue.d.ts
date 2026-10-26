// Minimal Vue declaration shim for EXP-01 fixtures (not the real vue package types).
export interface Ref<T> {
  value: T;
}
export declare function ref<T>(value: T): Ref<T>;
export declare function shallowRef<T>(value: T): Ref<T>;
export declare function reactive<T extends object>(value: T): T;
export declare function shallowReactive<T extends object>(value: T): T;
export declare function computed<T>(getter: () => T): { readonly value: T };
export declare function watch<T>(source: Ref<T>, callback: (value: T, old: T) => void): void;
export declare function watchEffect(effect: () => void): void;
export declare function onMounted(hook: () => void): void;
