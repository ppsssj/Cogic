#!/usr/bin/env node
// P1-F independent diagnostic (read-only). Not part of the pre-registered evaluation.
//
// Reads raw predictions of an EXP-01 run, reproduces the scorer 1.1 node-key-collision gate with the
// unchanged tools/exp01/lib.mjs, and lists each colliding Cogic node (raw id, name, range, key).
//
// It also scores the blocked cases twice with the unchanged scoreCase():
//   - "v1.1-as-is": the scorer 1.1 normalization (collided keys; rows are what score/matches.csv holds)
//   - "diag-enclosing-decl": an in-memory re-keying used only for this audit. Inside a collision group,
//     the external node whose range encloses all others (the declaration statement) keeps X|file|line;
//     every other node gets a distinct key by suffixing "#c<column>" to its file. Groups without a
//     unique enclosing node are left collided (still blocked). GT, scorer, predictions are not changed.
// The second result is post-hoc and diagnostic only. It must not be reported as EXP-01 accuracy.
//
// Usage: node collision-audit.mjs --run <docs/thesis-experiments/data/exp-01/<run-id>> [--json <out>]

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const lib = await import(pathToFileURL(path.join(repoRoot, "docs/thesis-experiments/tools/exp01/lib.mjs")).href);
const corpus = path.join(repoRoot, "docs/thesis-experiments/fixtures/exp-01");

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
};
const runDir = arg("--run");
if (!runDir) {
  throw new Error("--run is required");
}

const contains = (outer, inner) => {
  const a = outer.range, b = inner.range;
  const le = (p, q) => p.line < q.line || (p.line === q.line && p.character <= q.character);
  return le(a.start, b.start) && le(b.end, a.end);
};

function rekey(graph, fixtureRoot, collisions) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const renamed = new Map();
  const unresolved = [];
  for (const c of collisions) {
    const group = c.ids.map((id) => byId.get(id));
    const enclosing = group.filter((n) => n.kind === "external" && group.every((m) => contains(n, m)));
    if (enclosing.length !== 1 || group.some((n) => n.kind !== "external")) {
      unresolved.push(c.key);
      continue;
    }
    for (const n of group) {
      if (n !== enclosing[0]) {
        renamed.set(n.id, { ...n, file: `${n.file}#c${n.range.start.character}` });
      }
    }
  }
  const nodes = graph.nodes.map((n) => renamed.get(n.id) ?? n);
  return { graph: { ...graph, nodes }, unresolved };
}

function counts(scored) {
  const c = { gt: {}, pred: {}, negativesViolated: 0 };
  for (const r of scored.gtRows) {
    c.gt[r.kind] ??= { TP: 0, FN: 0 };
    c.gt[r.kind][r.verdict] += 1;
  }
  for (const r of scored.predRows) {
    c.pred[r.kind] ??= {};
    c.pred[r.kind][r.verdict] = (c.pred[r.kind][r.verdict] ?? 0) + 1;
  }
  c.negativesViolated = scored.negativeRows.filter((n) => n.violated).length;
  return c;
}

const catalog = lib.loadCatalog(path.join(corpus, "catalog.csv"));
const caseDirs = new Map(lib.listCaseDirs(corpus).map((d) => [path.basename(d), d]));
const runJson = lib.readJson(path.join(runDir, "run.json"));
const out = {
  runId: runJson.runId,
  headCommit: runJson.headCommit,
  scorerVersion: runJson.scorerVersion,
  runStatus: runJson.status,
  scoringStatus: runJson.scoring?.status ?? null,
  cases: [],
};

for (const file of fs.readdirSync(path.join(runDir, "predictions")).sort()) {
  const rawText = fs.readFileSync(path.join(runDir, "predictions", file));
  const doc = JSON.parse(rawText.toString("utf8"));
  const graph = doc.analyzerOutput.graph;
  const norm = lib.normalizeCogicGraph(graph, { fixtureRoot: doc.fixtureRoot, caseId: doc.caseId });
  if (norm.collisions.length === 0) {
    continue;
  }
  // Raw ids embed the absolute fixture path of the machine that ran the analyzer; replace it for the record.
  const rootPattern = new RegExp(lib.normalizeFsPath(doc.fixtureRoot).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  const strip = (s) => String(s).replace(/\\/g, "/").replace(rootPattern, "<fixtureRoot>");
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const edgesTouching = (id) =>
    graph.edges
      .filter((e) => e.target === id || e.source === id)
      .map((e) => ({ kind: e.kind, source: strip(e.source), label: e.label ?? null, argIndex: (String(e.id).match(/@@arg#(\d+)$/) ?? [])[1] ?? null }));
  const collisions = norm.collisions.map((c) => ({
    key: c.key,
    nodes: c.ids.map((id) => {
      const n = byId.get(id);
      return {
        id: strip(id),
        kind: n.kind,
        name: n.name,
        range: n.range,
        signature: n.signature ?? null,
        edges: edgesTouching(id),
      };
    }),
  }));
  const gt = lib.readJson(path.join(caseDirs.get(doc.caseId), "expected.json"));
  const resolved = lib.resolveGt(gt, catalog);
  const asIs = lib.scoreCase(resolved, norm, "strict");
  const { graph: rekeyed, unresolved } = rekey(graph, doc.fixtureRoot, norm.collisions);
  const diagNorm = lib.normalizeCogicGraph(rekeyed, { fixtureRoot: doc.fixtureRoot, caseId: doc.caseId });
  const diag = lib.scoreCase(resolved, diagNorm, "strict");
  const tpAsIs = new Set(asIs.gtRows.filter((r) => r.verdict === "TP").map((r) => r.key));
  const tpDiag = new Set(diag.gtRows.filter((r) => r.verdict === "TP").map((r) => r.key));
  out.cases.push({
    caseId: doc.caseId,
    rawSha256: crypto.createHash("sha256").update(rawText).digest("hex"),
    collisions,
    cogicEdgeKinds: graph.edges.reduce((m, e) => ((m[e.kind] = (m[e.kind] ?? 0) + 1), m), {}),
    gtRelationKinds: gt.relations.reduce((m, r) => ((m[r.kind] = (m[r.kind] ?? 0) + 1), m), {}),
    strict: {
      asIs: { status: asIs.status, ...counts(asIs) },
      diagEnclosingDecl: { status: diag.status, unresolved, remainingCollisions: diagNorm.collisions.map((c) => c.key), ...counts(diag) },
      tpOnlyUnderCollidedKey: [...tpAsIs].filter((k) => !tpDiag.has(k)),
      tpOnlyUnderDiagKey: [...tpDiag].filter((k) => !tpAsIs.has(k)),
      updatesGtRows: diag.gtRows.filter((r) => r.kind === "updates").map((r) => ({ key: r.key, verdict: r.verdict })),
    },
  });
}

const text = `${JSON.stringify(out, null, 2)}\n`;
const json = arg("--json");
if (json) {
  fs.writeFileSync(path.resolve(json), text);
}
console.log(text);
