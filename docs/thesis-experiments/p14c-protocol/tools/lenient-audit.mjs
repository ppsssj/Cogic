#!/usr/bin/env node
// P14-C: which row verdicts the candidate lenient rules would change, on real predictions.
// Audit only. It prints row counts and changed rows, not precision, recall or F1, and it writes
// nothing into the repository.
//
//   node docs/thesis-experiments/p14c-protocol/tools/lenient-audit.mjs --predictions <run>/predictions [--out <file.json>]
//
// Step 1 checks that the variant scorer with default options equals lib.mjs scoreCase on every
// case and mode (otherwise the audit is meaningless and it stops with exit code 3).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gtFileName, listCaseDirs, loadCatalog, normalizeCogicGraph, readJson, resolveGt, scoreCase } from "../../tools/exp01/lib.mjs";
import { diffVerdicts, scoreCaseVariant } from "./scorer-variants.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const corpus = path.resolve(here, "../../fixtures/exp-01");
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const predictionsDir = opt("--predictions");
if (!predictionsDir) {
  console.error("usage: lenient-audit.mjs --predictions <dir> [--out <file>]");
  process.exit(2);
}
const catalog = loadCatalog(path.join(corpus, "catalog.csv"));
export const VARIANTS = {
  L1: { matching: "mincost" },
  L2: { indeterminateBeforeExtra: true },
  "L1+L2": { matching: "mincost", indeterminateBeforeExtra: true },
  L3: { lenientNegatives: "sameKind" },
  "L1+L2+L3": { matching: "mincost", indeterminateBeforeExtra: true, lenientNegatives: "sameKind" },
  L4: { lenientCollapse: true },
  "L1+L2+L4": { matching: "mincost", indeterminateBeforeExtra: true, lenientCollapse: true },
};
const tally = (r) => ({
  predTP: r.predRows.filter((x) => x.verdict === "TP").length,
  predFP: r.predRows.filter((x) => x.verdict === "FP").length,
  predExcluded: r.predRows.filter((x) => x.verdict === "EXCLUDED").length,
  gtTP: r.gtRows.filter((x) => x.verdict === "TP").length,
  predCollapsed: r.predRows.filter((x) => x.verdict === "COLLAPSED").length,
  negViolated: r.negativeRows.filter((x) => x.violated).length,
});
const report = { tool: "p14c-lenient-audit/1", scorerReference: "exp01-scorer/1.2 (lib.mjs, unchanged)", cases: 0, equivalence: { checked: 0, differing: [] }, variants: {} };
for (const name of Object.keys(VARIANTS)) report.variants[name] = { options: VARIANTS[name], strict: { casesChanged: [], rowsChanged: 0, delta: {} }, lenient: { casesChanged: [], rowsChanged: 0, delta: {} } };

for (const dir of listCaseDirs(corpus)) {
  const caseId = path.basename(dir);
  const gt = readJson(path.join(dir, gtFileName(1)));
  const resolved = resolveGt(gt, catalog);
  const doc = readJson(path.join(predictionsDir, `${caseId}.json`));
  const pred = normalizeCogicGraph(doc.analyzerOutput.graph, { fixtureRoot: doc.fixtureRoot, caseId });
  report.cases += 1;
  for (const mode of ["strict", "lenient"]) {
    const ref = scoreCase(resolved, pred, mode);
    const same = scoreCaseVariant(resolved, pred, mode);
    report.equivalence.checked += 1;
    const d = diffVerdicts(ref, same);
    if (d.length || JSON.stringify(tally(ref)) !== JSON.stringify(tally(same))) report.equivalence.differing.push({ caseId, mode, d });
    for (const [name, o] of Object.entries(VARIANTS)) {
      const v = scoreCaseVariant(resolved, pred, mode, o);
      const diff = diffVerdicts(ref, v);
      const slot = report.variants[name][mode];
      if (diff.length) {
        slot.casesChanged.push({ caseId, rows: diff });
        slot.rowsChanged += diff.length;
      }
      const a = tally(ref);
      const b = tally(v);
      for (const k of Object.keys(a)) slot.delta[k] = (slot.delta[k] ?? 0) + (b[k] - a[k]);
    }
  }
}
const ok = report.equivalence.differing.length === 0;
console.log(`cases ${report.cases}; default variant equals lib.mjs scoreCase: ${ok ? "yes" : "NO"} (${report.equivalence.checked} case-modes)`);
for (const [name, v] of Object.entries(report.variants)) {
  for (const mode of ["strict", "lenient"]) {
    const s = v[mode];
    console.log(`${name.padEnd(9)} ${mode.padEnd(7)} cases changed ${s.casesChanged.length} (${s.casesChanged.map((c) => c.caseId).join(", ") || "-"}); rows ${s.rowsChanged}; delta ${JSON.stringify(s.delta)}`);
  }
}
if (opt("--out")) fs.writeFileSync(opt("--out"), JSON.stringify(report, null, 1));
process.exitCode = ok ? 0 : 3;
