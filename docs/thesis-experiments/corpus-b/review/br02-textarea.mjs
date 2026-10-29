// Review of the annotate-assist draft (forwardRef form field component).
export function apply(gt, h) {
  // The render function passed to React.forwardRef (untyped third-party) is anonymous: owner is the file (guide §3.3).
  for (const r of gt.relations.filter((x) => x.source === "file" && x.kind === "calls" && x.target === "X_cn_cn_ts_4")) {
    r.note = "Inside the anonymous render function passed to React.forwardRef; cn(...inputs) has a rest parameter, so both arguments go to index 0.";
  }
}
