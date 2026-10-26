import { reactive, ref } from "vue";

export function useCart() {
  const items = ref(0);
  const total = ref(0);
  const state = reactive({ open: false, count: 0 });

  function add(price: number) {
    items.value++;
    total.value += price;
    state.count = items.value;
  }

  function clear() {
    items.value = 0;
    total.value = 0;
    state.count = 0;
    state.open = false;
  }

  const toggle = () => {
    state.open = !state.open;
  };

  return { items, total, state, add, clear, toggle };
}
