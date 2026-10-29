// Review of the annotate-assist draft for bv04-use-async (src/utils/use-async.ts).
export function apply(gt, h) {
  h.note("calls F_run_15", "fn is the generic parameter of the exported useAsync (guide §6.2 unbounded); its arguments are a spread of run's rest parameter.");
  h.note("calls F_run_15 X_remove_storage_ts_31", "userStorage is the module-level Storage instance exported from src/store/user.ts.");
}
