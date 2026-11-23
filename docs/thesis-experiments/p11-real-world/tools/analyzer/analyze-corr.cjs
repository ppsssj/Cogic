// Analyses the step-1 correctness pass. node analyze-corr.cjs <runDir> <outDir>
"use strict";
const fs = require("node:fs"), path = require("node:path");
const [dir, outDir] = process.argv.slice(2);
const recs = fs.readFileSync(path.join(dir, "blocks.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const rows = [["part", "project", "condition", "vs", "iterations", "result_cache_hits", "strict_equal", "json_equal", "graphSet_equal", "ids_equal"].join(",")];
const cmp = (A, B, part, project) => {
  const n = Math.min(A.samples.length, B.samples.length); let st = 0, js = 0, gs = 0, id = 0, hits = 0;
  for (let i = 0; i < n; i++) { const a = A.samples[i].hash, b = B.samples[i].hash; if (B.samples[i].resultCacheHit) hits++; if (a.strict === b.strict) st++; if (a.json === b.json) js++; if (a.graphSet === b.graphSet) gs++; if (a.ids === b.ids) id++; }
  rows.push([part, project, B.label, A.label, n, hits, st, js, gs, id].join(","));
};
for (const p of ["hono", "excalidraw", "vite", "typeorm", "query"]) {
  const off = recs.find((r) => r.key === `a|${p}|off`); if (!off) continue;
  for (const c of ["fixed800", "adaptive"]) { const r = recs.find((x) => x.key === `a|${p}|${c}`); if (r) cmp(off, r, "a-repeated", p); }
}
const boff = recs.find((r) => r.key === "b|excalidraw|off");
for (const c of ["adaptive-sk", "adaptive"]) { const r = recs.find((x) => x.key === `b|excalidraw|${c}`); if (boff && r) cmp(boff, r, "b-scriptkind", "excalidraw"); }
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "p11-correctness-pass.csv"), rows.join("\n") + "\n");
console.log(rows.join("\n"));
const fails = recs.filter((r) => r.exit !== 0 || r.error || r.skipped);
console.log(`records=${recs.length} failures=${fails.length}`);
