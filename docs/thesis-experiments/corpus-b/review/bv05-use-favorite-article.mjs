// Review of the annotate-assist draft for bv05-use-favorite-article.
export function apply(gt, h) {
  // requestor is a const holding one of two api methods chosen at run time from a ComputedRef (guide §6.2):
  // the draft took the first union declaration as the callee. Replace it with an enumerable indeterminate entry.
  h.drop("calls F_favoriteArticle_13 X_deleteArticleFavorite_api_ts_810", "callee is requestor (conditional alias), not a single method");
  h.drop("dataflow F_favoriteArticle_13 X_deleteArticleFavorite_api_ts_810#0", "receiving parameter depends on the run-time choice");
  h.add({ kind: "calls", source: "F_favoriteArticle_13", candidates: [{ target: "X_deleteArticleFavorite_api_ts_810" }, { target: "X_createArticleFavorite_api_ts_788" }], pattern: "CALL-VARIABLE-ALIAS", gtStatus: "indeterminate", evidence: h.ev(15), reason: "requestor = isX.value ? api.<one> : api.<other>; which method runs depends on a run-time ComputedRef value." });
  h.add({ kind: "dataflow", source: "F_favoriteArticle_13", candidates: [{ target: "X_deleteArticleFavorite_api_ts_810", argIndex: 0 }, { target: "X_createArticleFavorite_api_ts_788", argIndex: 0 }], pattern: "DF-INDIRECT", gtStatus: "indeterminate", evidence: h.ev(15), reason: "the argument goes to parameter 0 of whichever method requestor holds." });
  h.note("references F_favoriteArticle_13 X_deleteArticleFavorite_api_ts_810", "method value read without a call in the conditional expression (line 14).");
}
