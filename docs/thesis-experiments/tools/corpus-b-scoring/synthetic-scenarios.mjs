// P1-K4: the SYNTHETIC prediction scenarios of P1-K3 scoring-scope-audit.md (same generators as
// tools/corpus-b-review/scoring-scope-probe.mjs), as exp01-pred/1 documents per case, plus the extra
// P1-K4 cases. Built only from the GT and excludedSites; no Cogic output exists or is read.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const lib = await import(pathToFileURL(path.join(repoRoot, "docs/thesis-experiments/tools/exp01/lib.mjs")).href);
export const corpus = path.join(repoRoot, "docs/thesis-experiments/corpus-b/fixtures");

export function loadCases() {
  const catalog = lib.loadCatalog(path.join(corpus, "catalog.csv"));
  return lib.listCaseDirs(corpus).map((dir) => {
    const gt = lib.readJson(path.join(dir, "expected.json"));
    const nodes = new Map(gt.nodes.map((n) => [n.id, n]));
    const k = (id) => lib.nodeKey(nodes.get(id));
    const det = gt.relations.filter((r) => r.gtStatus === "determinate").map((r) => ({ id: r.id, kind: r.kind, srcKey: k(r.source), tgtKey: r.kind === "owner" ? null : k(r.target), argIndex: r.argIndex, support: catalog.get(r.pattern)?.support, lib: r.target ? nodes.get(r.target).type === "lib" : false }));
    const ind = gt.relations.filter((r) => r.gtStatus === "indeterminate").map((r) => ({ kind: r.kind, srcKey: k(r.source), candidates: r.candidates === "unbounded" ? "unbounded" : r.candidates.map((c) => ({ tgtKey: k(c.target), argIndex: c.argIndex })) }));
    const neg = gt.negatives.map((n) => ({ kind: n.kind, srcKey: k(n.source), tgtKey: n.target ? k(n.target) : null }));
    return { caseId: gt.caseId, dir, activeFile: gt.activeFile, fileKey: `F|${gt.activeFile}`, det, ind, neg, excluded: gt.excludedSites.map((s) => Number(s.site.split(":").pop())) };
  });
}

export const rel = (kind, srcKey, tgtKey, argIndex) => ({ kind, srcKey, tgtKey, ...(kind === "dataflow" ? { argIndex } : {}) });
const gtPreds = (c, f = () => true) => c.det.filter(f).map((r) => rel(r.kind, r.srcKey, r.tgtKey, r.argIndex));
const ext = (c, mode) =>
  c.excluded.map((line) => {
    if (mode === "distinct") return rel("calls", c.fileKey, `X|shims/third-party.d.ts|${100 + line}`);
    if (mode === "wrong") return rel("calls", c.fileKey, `X|shims/third-party.d.ts|${900 + line}`);
    return rel("calls", c.fileKey, "X|shims/third-party.d.ts|3");
  });
const sup = (r) => r.support === "supported";

// The 11 scenarios of P1-K3 (S8 there simulated a v2 filter by hand; here v2 is computed for every scenario).
export const P1K3_SCENARIOS = {
  S0_perfect: (c) => gtPreds(c),
  S1_perfect_without_lib_targets: (c) => gtPreds(c, (r) => !r.lib),
  S2_supported_only: (c) => gtPreds(c, sup),
  S3a_supported_plus_external_distinct: (c) => [...gtPreds(c, sup), ...ext(c, "distinct")],
  S3b_supported_plus_external_wrong_target: (c) => [...gtPreds(c, sup), ...ext(c, "wrong")],
  S3c_supported_plus_external_module_key: (c) => [...gtPreds(c, sup), ...ext(c, "module")],
  S4_supported_plus_unsupported_tp: (c) => gtPreds(c, (r) => r.support !== "ambiguous"),
  S5_S3a_plus_unsupported_tp: (c) => [...gtPreds(c, (r) => r.support !== "ambiguous"), ...ext(c, "distinct")],
  S6_supported_plus_indeterminate_candidates: (c) => [...gtPreds(c, sup), ...c.ind.flatMap((e) => (e.candidates === "unbounded" ? [rel(e.kind, e.srcKey, "X|src/anything.ts|1", 0)] : e.candidates.map((x) => rel(e.kind, e.srcKey, x.tgtKey, x.argIndex))))],
  S7_perfect_plus_negative_violations: (c) => [...gtPreds(c), ...c.neg.map((n) => rel(n.kind, n.srcKey, n.tgtKey))],
  S8_S3a_with_shim_targets_set_aside: (c) => [...gtPreds(c, sup), ...ext(c, "distinct")].filter((p) => !String(p.tgtKey ?? "").startsWith("X|shims/")),
};

export const asDoc = (caseId, relations) => ({ schema: lib.PRED_SCHEMA, caseId, relations });
