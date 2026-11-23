// Completeness check for one P11 project run. node check-project.cjs <runDir> <project>
// Expected plan (full design): cold-start 5 x 3 conditions; warm-cleared/repeated/active-edit/cross-file/file-switch 2 blocks x 3 conditions.
"use strict";
const fs = require("node:fs"), path = require("node:path");
const [dir, project] = process.argv.slice(2);
const lines = fs.readFileSync(path.join(dir, "blocks.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const conds = ["off", "fixed800", "adaptive"];
const expected = [];
for (const c of conds) for (let k = 0; k < 5; k++) expected.push(["cold-start", c, k, 1]);
const plan = { "warm-cleared": 5, repeated: 15, "active-edit": 15, "cross-file": 15, "file-switch": 15 };
for (const [s, n] of Object.entries(plan)) for (const c of conds) for (let b = 0; b < 2; b++) expected.push([s, c, b, n]);
const issues = [];
const good = new Map();
for (const r of lines.filter((x) => x.project === project)) {
  const key = `${r.scenario}|${r.condition}|${r.block}`;
  if (r.skipped) { issues.push(`SKIP ${key}: ${r.skipped}`); continue; }
  if (r.exit !== 0 || r.error || r.parseError) { issues.push(`FAIL ${key}: exit=${r.exit} ${r.error || r.stderrTail || ""}`.slice(0, 300)); continue; }
  if (good.has(key)) issues.push(`DUPLICATE ${key} (later record kept for review)`);
  good.set(key, r);
}
let complete = 0;
const fieldGaps = [];
for (const [s, c, b, n] of expected) {
  const r = good.get(`${s}|${c}|${b}`);
  if (!r) { issues.push(`MISSING ${s}|${c}|${b}`); continue; }
  if (r.samples.length !== n) issues.push(`SAMPLES ${s}|${c}|${b}: ${r.samples.length}/${n}`);
  for (const x of r.samples) {
    const miss = ["extensionSideMs", "sf", "mem", "hash", "nodes", "edges"].filter((k) => x[k] === undefined || x[k] === null);
    if (c !== "off" && !x.resultCacheHit && !x.cacheStats) miss.push("cacheStats");
    if (miss.length) { fieldGaps.push(`${s}|${c}|${b}#${x.iteration}: ${miss.join(",")}`); break; }
  }
  if (!r.retained) fieldGaps.push(`${s}|${c}|${b}: retained memory`);
  complete++;
}
const restores = fs.existsSync(path.join(dir, "restores.jsonl")) ? fs.readFileSync(path.join(dir, "restores.jsonl"), "utf8").trim().split("\n").filter(Boolean) : [];
const out = { project, records: lines.length, expectedBlocks: expected.length, completeBlocks: complete, issues, fieldGaps, restores: restores.length };
fs.writeFileSync(path.join(dir, `check-${project}.json`), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
