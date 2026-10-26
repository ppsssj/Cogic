import { reactive, ref } from "vue";

export function useView() {
  const state = reactive({ count: 0 });
  const flag = ref(false);

  function peek(): number {
    return state.count;
  }

  function copy(): number {
    const snapshot = { ...state };
    snapshot.count = 1;
    return snapshot.count;
  }

  function local(): boolean {
    const flag = { value: true };
    flag.value = false;
    return flag.value;
  }

  return { peek, copy, local, flag };
}
