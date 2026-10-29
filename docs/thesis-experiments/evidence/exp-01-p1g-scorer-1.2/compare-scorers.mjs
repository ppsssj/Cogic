#!/usr/bin/env node
// P1-G diagnostic (read-only): scorer 1.1 vs scorer 1.2 on the raw predictions of an existing EXP-01 run.
// Post-hoc amendment check, not an EXP-01 measurement. Nothing in the run folder, GT or tools is written.
//
// scorer 1.1 = tools/exp01/lib.mjs at --base (git), loaded from a temporary copy;
// scorer 1.2 = tools/exp01/lib.mjs in this checkout.
//
// Checks
//   1. cases with no collision under 1.1: every row (GT, prediction, negative, indeterminate) is identical
//   2. cases blocked under 1.1: status, resolved groups, row verdicts; no TP that 1.1 did not also have;
//      no TP relation that carries an edge of a re-keyed node
//
// Usage: node compare-scorers.mjs --run <run dir> [--base <git rev>] [--json <out>]

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const arg = (n, d = null) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : d;
};
const runDir = arg("--run");
const base = arg("--base", "2c52de4f65770d0855275d89e5227b91f9b6acc3");
if (!runDir) {
  throw new Error("--run is required");
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p1g-scorer11-"));
const oldLibPath = path.join(tmp, "lib.mjs");
fs.writeFileSync(oldLibPath, execFileSync("git", ["-C", repoRoot, "show", `${base}:docs/thesis-experiments/tools/exp01/lib.mjs`]));
const v11 = await import(pathToFileURL(oldLibPath).href);
const v12 = await import(pathToFileURL(path.join(repoRoot, "docs/thesis-experiments/tools/exp01/lib.mjs")).href);
fs.rmSync(tmp, { recursive: true, force: true });

const corpus = path.join(repoRoot, "docs/thesis-experiments/fixtures/exp-01");
const caseDirs = new Map(v12.listCaseDirs(corpus).map((d) => [path.basename(d), d]));
const rowSig = (r) => ({
  gt: r.gtRows.map((g) => [g.id, g.key, g.verdict, g.matchedBy ?? null]),
  pred: r.predRows.map((p) => [p.key, p.verdict, p.note, p.occurrences]),
  neg: r.negativeRows.map((n) => [n.id, n.violated]),
  ind: r.indeterminateRows.map((x) => [x.id, x.excludedCount]),
});
const tally = (r) => ({
  tp: r.gtRows.filter((g) => g.verdict === "TP").length,
  fn: r.gtRows.filter((g) => g.verdict === "FN").length,
  fp: r.predRows.filter((p) => p.verdict === "FP").length,
  excluded: r.predRows.filter((p) => p.verdict === "EXCLUDED").length,
  negativesViolated: r.negativeRows.filter((n) => n.violated).length,
});

const runJson = JSON.parse(fs.readFileSync(path.join(runDir, "run.json"), "utf8"));
const out = { runId: runJson.runId, headCommit: runJson.headCommit, scorer11: v11.SCORER_VERSION, scorer12: v12.SCORER_VERSION, base, unchanged: [], resolved: [], problems: [] };

for (const file of fs.readdirSync(path.join(runDir, "predictions")).sort()) {
  const doc = JSON.parse(fs.readFileSync(path.join(runDir, "predictions", file), "utf8"));
  const before = JSON.stringify(doc);
  const gt = v12.readJson(path.join(caseDirs.get(doc.caseId), "expected.json"));
  const catalog = v12.loadCatalog(path.join(corpus, "catalog.csv"));
  const n11 = v11.normalizeCogicGraph(doc.analyzerOutput.graph, { fixtureRoot: doc.fixtureRoot, caseId: doc.caseId });
  const n12 = v12.normalizeCogicGraph(doc.analyzerOutput.graph, { fixtureRoot: doc.fixtureRoot, caseId: doc.caseId });
  if (JSON.stringify(doc) !== before) {
    out.problems.push(`${doc.caseId}: prediction object modified`);
  }
  for (const mode of ["strict", "lenient"]) {
    const r11 = v11.scoreCase(v11.resolveGt(gt, v11.loadCatalog(path.join(corpus, "catalog.csv"))), n11, mode);
    const r12 = v12.scoreCase(v12.resolveGt(gt, catalog), n12, mode);
    if (n11.collisions.length === 0) {
      const same = JSON.stringify(rowSig(r11)) === JSON.stringify(rowSig(r12)) && r11.status === r12.status && n12.resolvedCollisions.length === 0;
      if (!same) {
        out.problems.push(`${doc.caseId} ${mode}: rows differ for a case without 1.1 collisions`);
      }
      if (mode === "strict") {
        out.unchanged.push({ caseId: doc.caseId, status11: r11.status, status12: r12.status, rowsIdentical: same, ...tally(r12) });
      } else {
        out.unchanged[out.unchanged.length - 1].lenientRowsIdentical = same;
      }
      continue;
    }
    const rekeyedIds = new Set(n12.resolvedCollisions.flatMap((c) => c.rekeyed.map((x) => x.id)));
    const rekeyedEdgeIds = new Set(doc.analyzerOutput.graph.edges.filter((e) => rekeyedIds.has(e.target) || rekeyedIds.has(e.source)).map((e) => e.id));
    const tpRel12 = r12.gtRows.filter((g) => g.verdict === "TP").map((g) => g.matchedBy);
    const fakeTp = n12.relations.filter((p) => tpRel12.includes(p.key) && p.cogicIds.some((id) => rekeyedEdgeIds.has(id))).map((p) => p.key);
    const tp11 = new Set(r11.gtRows.filter((g) => g.verdict === "TP").map((g) => g.id));
    const newTp = r12.gtRows.filter((g) => g.verdict === "TP" && !tp11.has(g.id)).map((g) => g.id);
    const fpOnRekeyed = r12.predRows.filter((p) => p.verdict === "FP" && /\|c\d+(\||$)/.test(p.key)).length;
    const entry = {
      caseId: doc.caseId,
      mode,
      status11: r11.status,
      status12: r12.status,
      collisions11: n11.collisions.map((c) => c.key),
      collisions12: n12.collisions.map((c) => c.key),
      resolved: n12.resolvedCollisions.map((c) => ({ key: c.key, rekeyed: c.rekeyed.map((x) => x.key) })),
      gtRowsIdenticalTo11: JSON.stringify(rowSig(r11).gt.map((g) => [g[0], g[2]])) === JSON.stringify(rowSig(r12).gt.map((g) => [g[0], g[2]])),
      newTpVs11: newTp,
      fakeTp,
      fpOnRekeyedKeys: fpOnRekeyed,
      ...tally(r12),
    };
    if (fakeTp.length || newTp.length || r12.status !== "SCORED") {
      out.problems.push(`${doc.caseId} ${mode}: ${JSON.stringify({ fakeTp, newTp, status: r12.status })}`);
    }
    out.resolved.push(entry);
  }
}

const sum = (rows, k) => rows.reduce((a, r) => a + r[k], 0);
const strictResolved = out.resolved.filter((r) => r.mode === "strict");
out.totals = {
  unchangedCases: out.unchanged.length,
  unchangedRowsIdentical: out.unchanged.filter((u) => u.rowsIdentical && u.lenientRowsIdentical).length,
  resolvedCases: strictResolved.length,
  resolvedStrict: { tp: sum(strictResolved, "tp"), fp: sum(strictResolved, "fp"), fn: sum(strictResolved, "fn"), fpOnRekeyedKeys: sum(strictResolved, "fpOnRekeyedKeys") },
  problems: out.problems.length,
};
const text = `${JSON.stringify(out, null, 2)}\n`;
const json = arg("--json");
if (json) {
  fs.writeFileSync(path.resolve(json), text);
}
console.log(JSON.stringify(out.totals, null, 2));
process.exitCode = out.problems.length === 0 ? 0 : 1;
