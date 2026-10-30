// Review of the annotate-assist draft for bv03-user (src/store/user.ts).
export function apply(gt, h) {
  h.note("constructs file X_Storage_storage_ts_3", "Storage (default export class of src/utils/storage.ts) has an explicit constructor(key, storageType = 'localStorage'); only key is passed.");
  h.note("calls file X_get_storage_ts_16", "Inside the anonymous setup callback passed to pinia defineStore (third-party): the callback is not a node, so the owner is the file (guide §3.3).");
  h.note("owner S_vue_callback_owner_13_2", "computed getter (guide §5.2). The local const isAuthorized (computed value) shadows the module-level isAuthorized arrow function, so the shorthand isAuthorized on line 30 refers to no §2 node.");
}
