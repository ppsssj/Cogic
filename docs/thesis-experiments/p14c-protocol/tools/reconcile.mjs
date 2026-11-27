#!/usr/bin/env node
// P14-C: compares a reviewer's frozen relations/negatives forms with GT v1, case by case, and writes
// the disagreement table for adjudication. Researcher-only: its output contains GT content and must
// never go back to a reviewer before that reviewer's forms are frozen.
//
//   node docs/thesis-experiments/p14c-protocol/tools/reconcile.mjs --forms <frozen forms dir>
//        --key <researcher/blind-key.json> --out <reconciliation.csv> [--reviewer <name>]
//
// It reads GT v1 (expected.json) from git at the commits recorded in the packet manifest; it never
// reads analyzer output or scores, and it never writes GT.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DEFAULTS } from "./build-review-packet.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, "../../../..");

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let q = false;
  const t = text.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"' && t[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((x) => x.trim() !== ""));
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}
const csvCell = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const ROLES = { "<callback-owner>": "callback-owner", "<state-source>": "state-source", "<route-owner>": "route-owner" };
const norm = (f) => (f ?? "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/^source\//, "");

/** A reviewer endpoint as a comparable key. */
export function reviewerNodeKey(file, line, name) {
  if (!file && !name) return null;
  if (norm(file) === "lib") return `L|${name}`;
  if (name === "<file>") return `F|${norm(file)}`;
  if (ROLES[name]) return `S|${norm(file)}|${Number(line)}`; // one anchor per line (guide §2)
  if (name === "<module>") return `M|${norm(file)}`;
  return `D|${norm(file)}|${Number(line)}`;
}
/** A GT v1 node as the same kind of key. */
export function gtNodeKey(node) {
  switch (node.type) {
    case "lib": return `L|${node.symbol}`;
    case "file": return `F|${norm(node.file)}`;
    case "synthetic": return `S|${norm(node.file)}|${node.line}`;
    case "module": return `M|${norm(node.file)}`;
    default: return `D|${norm(node.file)}|${node.line}`;
  }
}
const relKey = (kind, src, tgt, argIndex) => (kind === "owner" ? `owner|${src}` : kind === "dataflow" ? `dataflow|${src}|${tgt}|${argIndex}` : `${kind}|${src}|${tgt}`);
const endpoints = (src, tgt) => `${src}|${tgt}`;

export function gtItems(gt) {
  const byId = new Map(gt.nodes.map((n) => [n.id, n]));
  const k = (id) => (id == null ? null : byId.has(id) ? gtNodeKey(byId.get(id)) : `?|${id}`);
  const items = [];
  for (const r of gt.relations) {
    const src = k(r.source);
    const targets = [r.target, ...(r.targetAlternatives ?? [])].filter((x) => x != null).map(k);
    items.push({
      id: r.id, kind: r.kind, src, tgt: r.kind === "owner" ? null : targets[0] ?? null, alternatives: targets.slice(1), argIndex: r.kind === "dataflow" ? String(r.argIndex ?? "") : "",
      determinacy: r.gtStatus, candidates: r.candidates === "unbounded" ? "unbounded" : (r.candidates ?? []).map((c) => k(c.target)).sort().join(";"),
      evidence: (r.evidence ?? []).join(";"), polarity: "positive",
    });
  }
  for (const n of gt.negatives ?? []) items.push({ id: n.id, kind: n.kind, src: k(n.source), tgt: n.kind === "owner" ? null : k(n.target), alternatives: [], argIndex: n.kind === "dataflow" ? String(n.argIndex ?? "") : "", determinacy: "", candidates: "", evidence: (n.evidence ?? []).join(";"), polarity: "negative" });
  return items;
}
export function reviewerItems(rels, negs) {
  const items = [];
  for (const r of rels) {
    const src = reviewerNodeKey(r.sourceFile, r.sourceLine, r.sourceName);
    const tgt = r.kind === "owner" ? null : reviewerNodeKey(r.targetFile, r.targetLine, r.targetName);
    const cands = (r.candidates ?? "").trim();
    items.push({ id: `rel${r.relNo}`, kind: r.kind, src, tgt, argIndex: r.kind === "dataflow" ? r.argIndex : "", determinacy: r.determinacy, candidates: cands === "unbounded" ? "unbounded" : cands, evidence: r.evidence, confidence: r.confidence, polarity: "positive" });
  }
  for (const n of negs) items.push({ id: `neg${n.negNo}`, kind: n.kind, src: reviewerNodeKey(n.sourceFile, n.sourceLine, n.sourceName), tgt: n.kind === "owner" ? null : reviewerNodeKey(n.targetFile, n.targetLine, n.targetName), argIndex: n.kind === "dataflow" ? n.argIndex ?? "" : "", determinacy: "", candidates: "", evidence: n.evidence, polarity: "negative" });
  return items;
}

/**
 * Outcome codes:
 *   AGREE, AGREE_ALTERNATIVE (reviewer target is one of GT's allowed alternatives),
 *   DETERMINACY_DIFF, CANDIDATES_DIFF (both indeterminate, different candidate sets),
 *   KIND_DIFF (same endpoints, other kind), ARG_DIFF (dataflow, other argument position),
 *   POLARITY_CONFLICT (one side says it exists, the other lists it as a negative),
 *   GT_ONLY, REVIEWER_ONLY, NEGATIVE_AGREE, NEGATIVE_GT_ONLY, NEGATIVE_REVIEWER_ONLY.
 */
export function compareCase(gtList, revList) {
  const rows = [];
  const usedG = new Set();
  const usedR = new Set();
  const key = (x, tgt = x.tgt) => relKey(x.kind, x.src, tgt, x.argIndex);
  const pair = (g, r, outcome) => {
    usedG.add(g);
    usedR.add(r);
    rows.push({ outcome, gt: g, rev: r });
  };
  const pos = (l) => l.filter((x) => x.polarity === "positive");
  const neg = (l) => l.filter((x) => x.polarity === "negative");
  // 1. exact (or alternative) key, positive with positive
  for (const g of pos(gtList)) {
    const r = pos(revList).find((x) => !usedR.has(x) && key(x) === key(g));
    const ra = !r && pos(revList).find((x) => !usedR.has(x) && g.alternatives.some((a) => key(x) === key(g, a)));
    const hit = r ?? ra;
    if (!hit) continue;
    let outcome = r ? "AGREE" : "AGREE_ALTERNATIVE";
    if (g.determinacy !== hit.determinacy) outcome = "DETERMINACY_DIFF";
    else if (g.determinacy === "indeterminate" && g.candidates !== hit.candidates) outcome = "CANDIDATES_DIFF";
    pair(g, hit, outcome);
  }
  // indeterminate entries may have no single target: match by kind and source
  for (const g of pos(gtList).filter((x) => !usedG.has(x) && x.determinacy === "indeterminate")) {
    const r = pos(revList).find((x) => !usedR.has(x) && x.kind === g.kind && x.src === g.src && x.determinacy === "indeterminate");
    if (r) pair(g, r, g.candidates === r.candidates ? "AGREE" : "CANDIDATES_DIFF");
  }
  // 2. negatives
  for (const g of neg(gtList)) {
    const r = neg(revList).find((x) => !usedR.has(x) && key(x) === key(g));
    if (r) pair(g, r, "NEGATIVE_AGREE");
  }
  // 3. polarity conflicts
  for (const g of gtList.filter((x) => !usedG.has(x))) {
    const r = revList.find((x) => !usedR.has(x) && x.polarity !== g.polarity && key(x) === key(g));
    if (r) pair(g, r, "POLARITY_CONFLICT");
  }
  // 4. near misses
  for (const g of pos(gtList).filter((x) => !usedG.has(x))) {
    const r = pos(revList).find((x) => !usedR.has(x) && x.kind === "dataflow" && g.kind === "dataflow" && endpoints(x.src, x.tgt) === endpoints(g.src, g.tgt));
    if (r) { pair(g, r, "ARG_DIFF"); continue; }
    const k = pos(revList).find((x) => !usedR.has(x) && x.kind !== g.kind && x.kind !== "dataflow" && g.kind !== "dataflow" && endpoints(x.src, x.tgt) === endpoints(g.src, g.tgt));
    if (k) pair(g, k, "KIND_DIFF");
  }
  for (const g of gtList.filter((x) => !usedG.has(x))) rows.push({ outcome: g.polarity === "negative" ? "NEGATIVE_GT_ONLY" : "GT_ONLY", gt: g, rev: null });
  for (const r of revList.filter((x) => !usedR.has(x))) rows.push({ outcome: r.polarity === "negative" ? "NEGATIVE_REVIEWER_ONLY" : "REVIEWER_ONLY", gt: null, rev: r });
  return rows;
}

/** Positive specific agreement (pairwise F1) on determinate positive relations. */
export function agreement(rows) {
  const both = rows.filter((r) => ["AGREE", "AGREE_ALTERNATIVE"].includes(r.outcome) && r.gt.determinacy === "determinate").length;
  const gtOnly = rows.filter((r) => r.gt?.polarity === "positive" && r.gt.determinacy === "determinate" && !["AGREE", "AGREE_ALTERNATIVE"].includes(r.outcome)).length;
  const revOnly = rows.filter((r) => r.rev?.polarity === "positive" && r.rev.determinacy === "determinate" && !["AGREE", "AGREE_ALTERNATIVE"].includes(r.outcome)).length;
  return { both, gtOnly, reviewerOnly: revOnly, positiveSpecificAgreement: both + gtOnly + revOnly ? (2 * both) / (2 * both + gtOnly + revOnly) : null };
}

export const COLUMNS = ["blindId", "caseId", "rowNo", "outcome", "kind", "gtId", "gtSource", "gtTarget", "gtArgIndex", "gtDeterminacy", "gtCandidates", "gtEvidence",
  "reviewerItem", "revSource", "revTarget", "revArgIndex", "revDeterminacy", "revCandidates", "revEvidence", "revConfidence",
  "adjudicationDecision", "decisionRationale", "ruleCited", "gtChangeProposed", "decidedBy", "decidedAt", "predictionsSeenByDecider"];

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
  if (!opt("--forms") || !opt("--key") || !opt("--out")) {
    console.error("usage: reconcile.mjs --forms <dir> --key <blind-key.json> --out <file.csv> [--reviewer <name>]");
    process.exit(2);
  }
  const key = JSON.parse(fs.readFileSync(opt("--key"), "utf8"));
  const rels = parseCsv(fs.readFileSync(path.join(opt("--forms"), "relations.csv"), "utf8")).filter((r) => !opt("--reviewer") || r.reviewer === opt("--reviewer"));
  const negs = parseCsv(fs.readFileSync(path.join(opt("--forms"), "negatives.csv"), "utf8")).filter((r) => !opt("--reviewer") || r.reviewer === opt("--reviewer"));
  const out = [COLUMNS.join(",")];
  const summary = {};
  for (const c of key) {
    const root = c.corpus === "A" ? DEFAULTS.corpusAPath : DEFAULTS.corpusBPath;
    const commit = c.corpus === "A" ? DEFAULTS.corpusACommit : DEFAULTS.corpusBCommit;
    const gt = JSON.parse(execFileSync("git", ["show", `${commit}:${root}/${c.category}/${c.caseId}/expected.json`], { cwd: REPO, encoding: "utf8" }));
    const rows = compareCase(gtItems(gt), reviewerItems(rels.filter((r) => r.blindId === c.blindId), negs.filter((r) => r.blindId === c.blindId)));
    summary[c.blindId] = { caseId: c.caseId, ...agreement(rows), outcomes: rows.reduce((m, r) => ({ ...m, [r.outcome]: (m[r.outcome] ?? 0) + 1 }), {}) };
    rows.forEach((r, i) => out.push([c.blindId, c.caseId, i + 1, r.outcome, r.gt?.kind ?? r.rev?.kind, r.gt?.id, r.gt?.src, r.gt?.tgt, r.gt?.argIndex, r.gt?.determinacy, r.gt?.candidates, r.gt?.evidence,
      r.rev?.id, r.rev?.src, r.rev?.tgt, r.rev?.argIndex, r.rev?.determinacy, r.rev?.candidates, r.rev?.evidence, r.rev?.confidence, "", "", "", "", "", "", ""].map(csvCell).join(",")));
  }
  fs.writeFileSync(opt("--out"), `${out.join("\n")}\n`);
  fs.writeFileSync(`${opt("--out")}.summary.json`, `${JSON.stringify(summary, null, 1)}\n`);
  console.log(`${key.length} cases; ${out.length - 1} rows -> ${opt("--out")}`);
}
