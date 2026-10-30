// Review of the annotate-assist draft for bv01-main (src/main.ts).
// Added by selection/2 (README §3). The draft is accepted; only notes are added.
export function apply(gt, h) {
  h.note("calls file X_setAuthorizationToken_set_authorization_token_ts_4", "Module top-level call of a default import (owner file, EXP-01 e03/h03: CALL-TOPLEVEL).");
  h.note("dataflow file X_registerGlobalComponents_global_components_ts_4#0", "Argument `app` (local const, value of untyped createApp) flows to parameter app of registerGlobalComponents.");
  // createApp/createPinia/app.use/app.mount are untyped vue/pinia APIs and App is a *.vue shorthand module
  // (excluded sites). `router` (line 11) is an exported const initialised by untyped createRouter: not a §2 node.
}
