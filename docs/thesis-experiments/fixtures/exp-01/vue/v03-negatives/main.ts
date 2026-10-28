import { ref } from "vue";
import { computed as derive } from "./local";
import * as Other from "./local";

export function useNeg() {
  const a = ref(0);
  const b = derive(() => a.value + 1);
  const c = Other.computed(() => 2);
  const n = Other.ref(0);
  const snapshot = Other.reactive({ x: 1 });

  Other.watch(a, () => {
    n.value++;
  });

  return { a, b, c, snapshot };
}
