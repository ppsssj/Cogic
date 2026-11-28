// Field-level differences among 3 reviewers for relations matched by the official reconcile key,
// and site decisions/links aligned by (blindId,file,line,occurrence). Read-only.
import fs from "node:fs"; import path from "node:path";
import { parseCsv, reviewerNodeKey } from "../../../p14c-protocol/tools/reconcile.mjs";
const [root] = process.argv.slice(2); const M = ["claude","codex","gemini"];
const R = Object.fromEntries(M.map((m) => [m, parseCsv(fs.readFileSync(path.join(root, `forms-${m}`, "relations.csv"), "utf8"))]));
const S = Object.fromEntries(M.map((m) => [m, parseCsv(fs.readFileSync(path.join(root, `forms-${m}`, "sites.csv"), "utf8"))]));
const key = (r) => [r.blindId, r.kind, reviewerNodeKey(r.sourceFile, r.sourceLine, r.sourceName), reviewerNodeKey(r.targetFile, r.targetLine, r.targetName), r.kind === "dataflow" ? r.argIndex : ""].join("|");
const idx = Object.fromEntries(M.map((m) => [m, new Map(R[m].map((r) => [key(r), r]))]));
const keys = [...new Set(M.flatMap((m) => [...idx[m].keys()]))].sort();
const diffs = {}; const ex = {};
for (const k of keys) for (const f of ["sourceName","targetName","paramName","determinacy","candidates","confidence","targetFile","sourceLine"]) {
  const v = M.map((m) => idx[m].get(k)?.[f] ?? "∅"); if (new Set(v).size > 1) { diffs[f] = (diffs[f] ?? 0) + 1; (ex[f] ??= []).push(`${k} :: ${M.map((m,i)=>m+"="+v[i]).join(" | ")}`); } }
console.log("relation keys:", keys.length, "present in all:", keys.filter((k) => M.every((m) => idx[m].has(k))).length);
console.log("field diffs:", JSON.stringify(diffs));
for (const f of Object.keys(ex)) { console.log(`-- ${f}`); for (const e of ex[f].slice(0, f === "sourceName" || f === "targetName" ? 6 : 40)) console.log("  ", e); }
// sites
const relKeyByNo = (m, id, no) => { const r = R[m].find((x) => x.blindId === id && x.relNo === no); return r ? key(r) : `?rel${no}`; };
const al = {};
for (const m of M) { const occ = {}; for (const s of S[m]) { const b = `${s.blindId}|${s.file}|${s.line}`; occ[b] = (occ[b] ?? 0) + 1; const k = `${b}|#${occ[b]}`;
  (al[k] ??= {})[m] = { text: s.siteText, decision: s.decision, links: (s.relNos ?? "").split(/[;,]/).filter(Boolean).map((n) => relKeyByNo(m, s.blindId, n.trim())).sort().join(" + ") }; } }
const sk = Object.keys(al); console.log("\nsites aligned:", sk.length, "in all 3:", sk.filter((k) => M.every((m) => al[k][m])).length);
let dd = 0, ld = 0, td = 0;
for (const k of sk) { const v = al[k]; const dec = M.map((m) => v[m]?.decision); const lk = M.map((m) => v[m]?.links); const tx = M.map((m) => v[m]?.text);
  if (new Set(tx).size > 1) td++;
  if (new Set(dec).size > 1) { dd++; console.log("DECISION", k, M.map((m,i)=>`${m}=${dec[i]} [${tx[i]}]`).join(" | ")); }
  else if (new Set(lk).size > 1) { ld++; console.log("LINKS", k, v.claude.text, "\n    ", M.map((m,i)=>`${m}: ${lk[i]||"(none)"}`).join("\n     ")); } }
console.log("decision diffs", dd, "link diffs (same decision)", ld, "siteText spelling diffs", td);
