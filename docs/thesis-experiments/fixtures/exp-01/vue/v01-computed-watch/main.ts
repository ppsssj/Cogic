import { computed, ref, watch, watchEffect } from "vue";

function log(message: string): void {
  void message;
}

export function useSearch() {
  const query = ref("");
  const page = ref(1);

  const normalized = computed(() => `${query.value}!`);

  watch(query, (next) => {
    page.value = 1;
    log(next);
  });

  watchEffect(() => {
    log(`page ${page.value}`);
  });

  function nextPage() {
    page.value += 1;
  }

  return { query, page, normalized, nextPage };
}
