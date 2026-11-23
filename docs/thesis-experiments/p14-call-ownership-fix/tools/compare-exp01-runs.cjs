// Diagnostic row-level transition comparison; does not change scoring or emit accuracy metrics.
"use strict";
const fs = require("node:fs");
if (process.argv.length !== 4) throw Error("Usage: node compare-exp01-runs.cjs <before/matches.csv> <after/matches.csv>");
function csv(file) {
  const s = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""), rows = []; let row = [], cell = "", quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) { if (c === '"' && s[i + 1] === '"') { cell += c; i++; } else if (c === '"') quoted = false; else cell += c; }
    else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ""; }
    else if (c === '\n') { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (quoted) throw Error("Unclosed CSV quote");
  if (cell || row.length) { row.push(cell.replace(/\r$/, "")); rows.push(row); }
  const headers = rows.shift(); return rows.map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
}
function map(rows, side) {
  const out = new Map();
  for (const r of rows.filter(r => r.side === side && r.mode === "strict" && r.caseStatus === "SCORED")) {
    const key = JSON.stringify([r.caseId, side === "gt" ? r.id : r.key]);
    if (out.has(key)) throw Error("Duplicate scoring row");
    out.set(key, r);
  }
  return out;
}
const a = csv(process.argv[2]), b = csv(process.argv[3]);
for (const side of ["gt", "pred"]) {
  const left = map(a, side), right = map(b, side), keys = new Set([...left.keys(), ...right.keys()]), counts = {}, changes = [];
  for (const key of keys) {
    const x = left.get(key), y = right.get(key), old = x?.verdict ?? "ABSENT", next = y?.verdict ?? "ABSENT", transition = `${old}->${next}`;
    counts[transition] = (counts[transition] ?? 0) + 1;
    if (old !== next) changes.push({ caseId: (x ?? y).caseId, kind: (x ?? y).kind, pattern: (x ?? y).pattern, id: side === "gt" ? (x ?? y).id : "", transition });
  }
  console.log(JSON.stringify({ side, counts, changes }, null, 2));
}
