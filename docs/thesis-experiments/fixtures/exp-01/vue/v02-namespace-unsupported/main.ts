import * as Vue from "vue";
import { onMounted, shallowReactive, shallowRef } from "vue";

function announce(): void {}

export function useStore() {
  const flags = shallowReactive({ ready: false });
  const current = shallowRef(0);
  const counter = Vue.ref(0);
  const doubled = Vue.computed(() => counter.value * 2);

  onMounted(() => {
    announce();
  });

  function ready() {
    flags.ready = true;
    current.value = doubled.value;
    counter.value++;
  }

  return { flags, current, counter, ready };
}
