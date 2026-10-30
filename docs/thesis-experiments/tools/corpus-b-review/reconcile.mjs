#!/usr/bin/env node
// P1-K3: reconciliation of an independent reviewer's submission with the frozen Corpus B GT v1.
// Run only AFTER the submission is final (REVIEW_SUBMITTED). Produces the reconciliation packet:
//   gt-items.csv          the existing GT as 285 reviewable items
//   reconciliation.csv    one row per GT item and per reviewer-only item (template columns)
//   summary.json          counts by status, item type, kind and case
// The adjudication columns (causeCode, proposedChange, finalDecision, ...) are left empty: they are
// filled by a human adjudicator. This tool never edits expected.json.
// Usage: node reconcile.mjs --submission <dir> --out <new dir>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHECKLIST, CHECKLIST_COLUMNS } from "./checklist-data.mjs";
import { GT_ITEM_COLUMNS, gtItems, listCases, loadCatalogSupport, normalizeEndpoint, parseCsv, toCsv } from "./review-lib.mjs";

export const RECON_COLUMNS = ["reconId", "caseId", "itemType", "gtItemId", "reviewerItemId", "kind", "source", "target", "argIndex", "gtStatusGt", "gtStatusReviewer", "candidatesGt", "candidatesReviewer", "patternGt", "patternReviewer", "supportGt", "supportReviewer", "evidenceGt", "evidenceReviewer", "matchStatus", "diffFields", "causeCode", "proposedChange", "finalDecision", "decisionRationale", "guideClause", "sourceCodeEvidence", "adjudicator", "decidedAt"];
export const MATCH_STATUSES = ["MATCH", "ATTRIBUTE_DIFF", "ENDPOINT_DIFF", "GTSTATUS_DIFF", "GT_ONLY", "REVIEWER_ONLY", "SITE_MATCH", "SITE_DISPOSITION_DIFF", "SITE_NOT_DISPOSED"];
export const CAUSE_CODES = ["GT-ERROR", "GUIDE-AMBIGUOUS", "REVIEWER-DIFF", "ENVIRONMENT", "OPEN"];

function collect(dir, name) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === name) out.push(...parseCsv(fs.readFileSync(p, "utf8")));
    }
  };
  walk(dir);
  return out;
}

const normCandidates = (s) => {
  const t = String(s ?? "").trim();
  if (t === "unbounded") return "unbounded";
  return t
    .split(/\s*;\s*/)
    .filter(Boolean)
    .map((x) => {
      const [ep, arg] = x.split("#");
      return `${normalizeEndpoint(ep)}${arg !== undefined ? `#${Number(arg)}` : ""}`;
    })
    .sort()
    .join(" ; ");
};
const lineSet = (s) => new Set(String(s ?? "").split(/[\s,]+/).filter(Boolean).map(Number));

export function reconcile(submissionDir, cases = listCases()) {
  const support = loadCatalogSupport();
  const relationsAll = collect(submissionDir, "relations-form.csv");
  const negativesAll = collect(submissionDir, "negatives-form.csv");
  const sitesAll = collect(submissionDir, "sites-form.csv");
  const gtRows = [];
  const rows = [];
  let n = 0;
  const push = (r) => rows.push({ reconId: `C${String(++n).padStart(4, "0")}`, ...r });

  for (const c of cases) {
    const items = gtItems(c, support);
    gtRows.push(...items);
    const rv = relationsAll
      .filter((r) => r.caseId === c.caseId)
      .map((r) => ({
        ...r,
        source: normalizeEndpoint(r.source),
        target: normalizeEndpoint(r.target),
        argIndex: r.argIndex === "" ? "" : String(Number(r.argIndex)),
        gtStatus: r.gtStatus || "determinate",
        cand: normCandidates(r.candidates),
        used: false,
      }));
    const key = (kind, s, t, a) => `${kind}|${s}|${kind === "owner" ? "" : t}|${kind === "dataflow" ? a : ""}`;
    const base = (g, r, status, diff) => ({
      caseId: c.caseId,
      itemType: g ? g.itemType : r.gtStatus === "indeterminate" ? "INDETERMINATE" : "DETERMINATE",
      gtItemId: g?.gtItemId ?? "",
      reviewerItemId: r?.reviewerItemId ?? "",
      kind: g?.kind ?? r?.kind ?? "",
      source: g?.source ?? r?.source ?? "",
      target: g?.target ?? r?.target ?? "",
      argIndex: g?.argIndex ?? r?.argIndex ?? "",
      gtStatusGt: g ? (g.itemType === "INDETERMINATE" ? "indeterminate" : g.itemType === "DETERMINATE" ? "determinate" : "") : "",
      gtStatusReviewer: r?.gtStatus ?? "",
      candidatesGt: g?.candidates ?? "",
      candidatesReviewer: r?.cand ?? "",
      patternGt: g?.pattern ?? "",
      patternReviewer: r?.pattern ?? "",
      supportGt: g?.support ?? "",
      supportReviewer: r?.pattern ? (support.get(r.pattern) ?? "UNKNOWN_PATTERN") : "",
      evidenceGt: g?.evidenceLines ?? "",
      evidenceReviewer: r?.evidenceLines ?? "",
      matchStatus: status,
      diffFields: diff.join(" "),
    });
    const attrDiff = (g, r) => {
      const d = [];
      if ((g.pattern ?? "") !== (r.pattern ?? "")) d.push("pattern");
      if ((support.get(g.pattern) ?? "") !== (support.get(r.pattern) ?? "")) d.push("support");
      if (g.itemType === "INDETERMINATE" && normCandidates(g.candidates) !== r.cand) d.push("candidates");
      const ge = lineSet(g.evidenceLines);
      if (![...lineSet(r.evidenceLines)].some((l) => ge.has(l))) d.push("evidence");
      return d;
    };

    const det = items.filter((g) => g.itemType === "DETERMINATE");
    const ind = items.filter((g) => g.itemType === "INDETERMINATE");
    const pending = [];
    // 1. exact endpoint matches, same determinacy
    for (const g of det) {
      const r = rv.find((x) => !x.used && x.gtStatus === "determinate" && key(x.kind, x.source, x.target, x.argIndex) === key(g.kind, g.source, g.target, String(g.argIndex)));
      if (r) {
        r.used = true;
        const d = attrDiff(g, r);
        push(base(g, r, d.length ? "ATTRIBUTE_DIFF" : "MATCH", d));
      } else pending.push(g);
    }
    for (const g of ind) {
      const r = rv.find((x) => !x.used && x.gtStatus === "indeterminate" && x.kind === g.kind && x.source === g.source);
      if (r) {
        r.used = true;
        const d = attrDiff(g, r);
        push(base(g, r, d.length ? "ATTRIBUTE_DIFF" : "MATCH", d));
      } else pending.push(g);
    }
    // 2. determinacy differs: GT determinate target appears among the reviewer's candidates, or the reverse
    for (const g of [...pending]) {
      const r =
        g.itemType === "DETERMINATE"
          ? rv.find((x) => !x.used && x.gtStatus === "indeterminate" && x.kind === g.kind && x.source === g.source && (x.cand === "unbounded" || x.cand.split(" ; ").some((cc) => cc.split("#")[0] === g.target)))
          : rv.find((x) => !x.used && x.gtStatus === "determinate" && x.kind === g.kind && x.source === g.source && (g.candidates === "unbounded" || normCandidates(g.candidates).split(" ; ").some((cc) => cc.split("#")[0] === x.target)));
      if (r) {
        r.used = true;
        pending.splice(pending.indexOf(g), 1);
        push(base(g, r, "GTSTATUS_DIFF", ["gtStatus", ...attrDiff(g, r).filter((f) => f !== "candidates")]));
      }
    }
    // 3. one endpoint attribute differs (argIndex, source/owner, target, kind) on the same evidence line
    for (const g of [...pending]) {
      if (g.itemType !== "DETERMINATE") continue;
      const ge = lineSet(g.evidenceLines);
      const near = rv.find((x) => {
        if (x.used || x.gtStatus !== "determinate" || ![...lineSet(x.evidenceLines)].some((l) => ge.has(l))) return false;
        const same = [x.kind === g.kind, x.source === g.source, (x.target ?? "") === (g.target ?? ""), x.kind !== "dataflow" || x.argIndex === String(g.argIndex)];
        return same.filter(Boolean).length === 3;
      });
      if (near) {
        near.used = true;
        pending.splice(pending.indexOf(g), 1);
        const d = [];
        if (near.kind !== g.kind) d.push("kind");
        if (near.source !== g.source) d.push("source");
        if ((near.target ?? "") !== (g.target ?? "")) d.push("target");
        if (g.kind === "dataflow" && near.argIndex !== String(g.argIndex)) d.push("argIndex");
        push({ ...base(g, near, "ENDPOINT_DIFF", d), reviewerItemId: near.reviewerItemId, candidatesReviewer: `${near.kind} ${near.source} -> ${near.target}${near.argIndex !== "" ? `#${near.argIndex}` : ""}` });
      }
    }
    for (const g of pending) push(base(g, null, "GT_ONLY", []));
    for (const r of rv.filter((x) => !x.used)) push(base(null, r, "REVIEWER_ONLY", []));

    // negatives
    const rn = negativesAll.filter((r) => r.caseId === c.caseId).map((r) => ({ ...r, source: normalizeEndpoint(r.source), target: normalizeEndpoint(r.target), used: false }));
    for (const g of items.filter((x) => x.itemType === "NEGATIVE")) {
      const r = rn.find((x) => !x.used && x.kind === g.kind && x.source === g.source && (g.kind === "owner" || x.target === g.target));
      if (r) r.used = true;
      push({ ...base(g, r ? { ...r, gtStatus: "" } : null, r ? (r.pattern === g.pattern ? "MATCH" : "ATTRIBUTE_DIFF") : "GT_ONLY", r && r.pattern !== g.pattern ? ["pattern"] : []), itemType: "NEGATIVE", gtStatusGt: "" });
    }
    for (const r of rn.filter((x) => !x.used)) push({ ...base(null, { ...r, gtStatus: "" }, "REVIEWER_ONLY", []), itemType: "NEGATIVE" });

    // excluded sites vs the reviewer's site dispositions
    const rs = sitesAll.filter((s) => s.caseId === c.caseId);
    for (const g of items.filter((x) => x.itemType === "EXCLUDED_SITE")) {
      const line = Number(g.evidenceLines);
      const onLine = rs.filter((s) => Number(s.line) === line);
      const disp = onLine.map((s) => s.disposition || "");
      const status = onLine.length === 0 || disp.every((d) => d === "") ? "SITE_NOT_DISPOSED" : disp.some((d) => d === "RELATION" || d === "INDETERMINATE") ? "SITE_DISPOSITION_DIFF" : "SITE_MATCH";
      push({ ...base(g, null, status, status === "SITE_DISPOSITION_DIFF" ? ["disposition"] : []), itemType: "EXCLUDED_SITE", reviewerItemId: onLine.map((s) => s.siteId).join(" "), candidatesReviewer: onLine.map((s) => `${s.siteId}:${s.disposition || "-"}${s.relationItemIds ? `(${s.relationItemIds})` : ""}`).join(" "), gtStatusGt: "", gtStatusReviewer: "", candidatesGt: g.note });
    }
  }
  const tally = (f) => rows.reduce((o, r) => ((o[f(r)] = (o[f(r)] ?? 0) + 1), o), {});
  const summary = {
    schema: "corpus-b-reconciliation/1",
    gtItems: gtRows.length,
    gtItemsByType: gtRows.reduce((o, r) => ((o[r.itemType] = (o[r.itemType] ?? 0) + 1), o), {}),
    reviewerRelations: relationsAll.length,
    reviewerNegatives: negativesAll.length,
    reviewerSites: sitesAll.length,
    rows: rows.length,
    byStatus: tally((r) => r.matchStatus),
    byTypeStatus: tally((r) => `${r.itemType}/${r.matchStatus}`),
    byCase: tally((r) => r.caseId),
    unknownPatterns: rows.filter((r) => r.supportReviewer === "UNKNOWN_PATTERN").map((r) => `${r.caseId}/${r.reviewerItemId}`),
  };
  return { gtRows, rows, summary };
}

function main() {
  const arg = (k) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : null);
  const sub = path.resolve(arg("--submission"));
  const out = path.resolve(arg("--out"));
  if (fs.existsSync(out)) throw new Error(`${out} exists; refusing to overwrite`);
  const { gtRows, rows, summary } = reconcile(sub);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "gt-items.csv"), toCsv(gtRows, GT_ITEM_COLUMNS));
  fs.writeFileSync(path.join(out, "reconciliation.csv"), toCsv(rows, RECON_COLUMNS));
  fs.writeFileSync(path.join(out, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  // checklist with the existing GT / P1-K1 position, for the adjudicator only
  fs.writeFileSync(path.join(out, "checklist-reconciliation.csv"), toCsv(CHECKLIST.map((c) => ({ ...c, status: "OPEN", adjudication: "" })), [...CHECKLIST_COLUMNS.slice(0, 9), "gtPosition", ...CHECKLIST_COLUMNS.slice(9), "adjudication"]));
  console.log(JSON.stringify(summary.byStatus));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
