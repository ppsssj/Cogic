export default function buildUser() {
  return { ok: true };
}

export const api = {
  run() {
    return helper();
  },
  save: () => helper(),
  nested: {
    sync() {
      return helper();
    },
  },
};

const helperRef = helper;

export function useHelperRef() {
  return helperRef;
}

function helper() {
  return 1;
}
