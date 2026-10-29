// Review of the annotate-assist draft for bv02-use-follow-profile.
export function apply(gt, h) {
  // requester is a const holding one of two api methods chosen at run time from a ComputedRef (guide §6.2):
  // the draft took the first union declaration as the callee. Replace it with an enumerable indeterminate entry.
  h.drop("calls F_toggleFollow_13 X_unfollowUserByUsername_api_ts_519", "callee is requester (conditional alias), not a single method");
  h.drop("dataflow F_toggleFollow_13 X_unfollowUserByUsername_api_ts_519#0", "receiving parameter depends on the run-time choice");
  h.add({ kind: "calls", source: "F_toggleFollow_13", candidates: [{ target: "X_unfollowUserByUsername_api_ts_519" }, { target: "X_followUserByUsername_api_ts_497" }], pattern: "CALL-VARIABLE-ALIAS", gtStatus: "indeterminate", evidence: h.ev(15), reason: "requester = isX.value ? api.<one> : api.<other>; which method runs depends on a run-time ComputedRef value." });
  h.add({ kind: "dataflow", source: "F_toggleFollow_13", candidates: [{ target: "X_unfollowUserByUsername_api_ts_519", argIndex: 0 }, { target: "X_followUserByUsername_api_ts_497", argIndex: 0 }], pattern: "DF-INDIRECT", gtStatus: "indeterminate", evidence: h.ev(15), reason: "the argument goes to parameter 0 of whichever method requester holds." });
  h.note("references F_toggleFollow_13 X_unfollowUserByUsername_api_ts_519", "method value read without a call in the conditional expression (line 14).");
}
