// P1-K3: tests for the blinded review tooling. Reviewer submissions here are SYNTHETIC (derived from
// the GT and then perturbed) and only exercise the reconciliation logic; they are not a review.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CHECKLIST } from "../checklist-data.mjs";
import { NEGATIVE_FORM_COLUMNS, RELATION_FORM_COLUMNS, SITE_FORM_COLUMNS, blindChecklistRows, build, leakScan } from "../build-blind-packet.mjs";
import { reconcile } from "../reconcile.mjs";
import { checkStatus } from "../review-status.mjs";
import { gtItems, inventory, listCases, loadCatalogSupport, toCsv } from "../review-lib.mjs";
import { scenarios } from "../scoring-scope-probe.mjs";

const cases = listCases();
const support = loadCatalogSupport();
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

test("GT export covers every item: 196 determinate, 14 indeterminate, 2 negatives, 73 excluded sites", () => {
  const items = cases.flatMap((c) => gtItems(c, support));
  const by = (f) => items.reduce((o, r) => ((o[f(r)] = (o[f(r)] ?? 0) + 1), o), {});
  assert.equal(cases.length, 20);
  assert.equal(items.length, 285);
  assert.deepEqual(by((r) => r.itemType), { DETERMINATE: 196, INDETERMINATE: 14, NEGATIVE: 2, EXCLUDED_SITE: 73 });
  assert.deepEqual(by((r) => (r.itemType === "DETERMINATE" ? r.support : "-")), { supported: 78, "unsupported-by-design": 116, ambiguous: 2, "-": 89 });
  assert.equal(new Set(items.map((r) => r.gtItemId)).size, 285);
});

test("blind inventory: every excluded-site line is a listed site", () => {
  for (const c of cases) {
    const lines = new Set(inventory(c).sites.map((s) => s.line));
    for (const r of gtItems(c, support).filter((x) => x.itemType === "EXCLUDED_SITE")) assert.ok(lines.has(Number(r.evidenceLines)), `${r.gtItemId}`);
  }
});

test("blind packet: 20 cases, forms present, no GT file, no GT string, checklist without GT positions", () => {
  const out = path.join(tmp("k3-packet-"), "p");
  const m = build(out);
  assert.equal(m.cases.length, 20);
  for (const c of cases) {
    const d = path.join(out, "cases", c.framework, c.caseId);
    for (const f of ["worksheet.md", "sites-form.csv", "relations-form.csv", "negatives-form.csv", "case-info.json", "LICENSE.upstream"]) assert.ok(fs.existsSync(path.join(d, f)), `${c.caseId}/${f}`);
    assert.ok(!fs.existsSync(path.join(d, "source", "expected.json")));
    assert.ok(!fs.existsSync(path.join(d, "source", "case.json")));
  }
  const leak = leakScan(out);
  assert.deepEqual(leak.forbiddenFiles, []);
  assert.deepEqual(leak.hits, []);
  const checklist = fs.readFileSync(path.join(out, "common/review-checklist.csv"), "utf8");
  for (const c of CHECKLIST.filter((x) => x.gtPosition)) assert.ok(!checklist.includes(c.gtPosition), c.checkId);
  assert.ok(!checklist.split("\n")[0].includes("gtPosition"));
  assert.ok(blindChecklistRows().every((r) => r.phase === "BLIND"));
  // the leak scan does catch a leak
  fs.copyFileSync(path.join(cases[0].caseDir, "expected.json"), path.join(out, "cases", cases[0].framework, cases[0].caseId, "source", "expected.json"));
  const leaked = leakScan(out);
  assert.equal(leaked.forbiddenFiles.length, 1);
  assert.ok(leaked.hits.length > 0);
});

test("checklist links every P1-K1 and P1-K2 item", () => {
  const ids = new Set(CHECKLIST.map((c) => c.checkId));
  for (let i = 1; i <= 14; i++) assert.ok(ids.has(`R-${String(i).padStart(2, "0")}`));
  for (let i = 1; i <= 9; i++) assert.ok(ids.has(`R-ENV-${i}`));
  for (const c of CHECKLIST) {
    assert.ok(["BLIND", "RECONCILIATION"].includes(c.phase));
    if (c.phase === "BLIND" && c.gtPosition) assert.ok(!c.question.includes(c.gtPosition));
  }
});

// synthetic submission that restates the GT, then perturbations of it
function writeSubmission(mutate = (x) => x) {
  const dir = tmp("k3-sub-");
  for (const c of cases) {
    const items = gtItems(c, support);
    const rel = items
      .filter((r) => r.itemType === "DETERMINATE" || r.itemType === "INDETERMINATE")
      .map((r, i) => ({ caseId: c.caseId, reviewerItemId: `H${i + 1}`, kind: r.kind, source: r.source, target: r.target, argIndex: r.argIndex, gtStatus: r.itemType === "INDETERMINATE" ? "indeterminate" : "determinate", candidates: r.candidates, pattern: r.pattern, evidenceLines: r.evidenceLines }));
    const neg = items.filter((r) => r.itemType === "NEGATIVE").map((r, i) => ({ caseId: c.caseId, reviewerItemId: `N${i + 1}`, kind: r.kind, source: r.source, target: r.target, pattern: r.pattern, evidenceLines: r.evidenceLines }));
    const excl = new Set(items.filter((r) => r.itemType === "EXCLUDED_SITE").map((r) => Number(r.evidenceLines)));
    const sites = inventory(c).sites.map((s) => ({ caseId: c.caseId, ...s, disposition: excl.has(s.line) ? "NO_NODE_TARGET" : "RELATION" }));
    const m = mutate({ caseId: c.caseId, rel, neg, sites });
    const d = path.join(dir, c.caseId);
    fs.mkdirSync(d);
    fs.writeFileSync(path.join(d, "relations-form.csv"), toCsv(m.rel, RELATION_FORM_COLUMNS));
    fs.writeFileSync(path.join(d, "negatives-form.csv"), toCsv(m.neg, NEGATIVE_FORM_COLUMNS));
    fs.writeFileSync(path.join(d, "sites-form.csv"), toCsv(m.sites, SITE_FORM_COLUMNS));
  }
  return dir;
}

test("reconciliation: a submission identical to the GT matches all 285 items", () => {
  const { rows, summary } = reconcile(writeSubmission());
  assert.equal(summary.gtItems, 285);
  assert.deepEqual(summary.byStatus, { MATCH: 212, SITE_MATCH: 73 });
  assert.equal(rows.length, 285);
});

test("reconciliation classifies missing, extra, endpoint, attribute, determinacy and site differences", () => {
  const sub = writeSubmission((m) => {
    if (m.caseId === "bn02-session-repository") {
      m.rel.splice(m.rel.findIndex((r) => r.kind === "references"), 1); // GT_ONLY
      const df = m.rel.find((r) => r.kind === "dataflow");
      df.argIndex = String(Number(df.argIndex) + 1); // ENDPOINT_DIFF argIndex
      m.rel.find((r) => r.kind === "calls").pattern = "CALL-LOCAL-FN"; // ATTRIBUTE_DIFF pattern (probably)
      m.rel.push({ caseId: m.caseId, reviewerItemId: "H999", kind: "calls", source: "file", target: "src/nowhere.ts:1", gtStatus: "determinate", pattern: "CALL-TOPLEVEL", evidenceLines: "1" }); // REVIEWER_ONLY
    }
    if (m.caseId === "be01-userrouter") {
      const c = m.rel.find((r) => r.kind === "calls" && r.source === "file");
      Object.assign(c, { gtStatus: "indeterminate", candidates: "unbounded", target: "" }); // GTSTATUS_DIFF
      const s = m.sites.find((x) => x.disposition === "NO_NODE_TARGET");
      s.disposition = "RELATION"; // SITE_DISPOSITION_DIFF
    }
    return m;
  });
  const { summary } = reconcile(sub);
  const st = summary.byStatus;
  assert.equal(st.GT_ONLY, 1);
  assert.equal(st.REVIEWER_ONLY, 1);
  assert.equal(st.ENDPOINT_DIFF, 1);
  assert.equal(st.GTSTATUS_DIFF, 1);
  assert.ok(st.SITE_DISPOSITION_DIFF >= 1);
  assert.ok((st.ATTRIBUTE_DIFF ?? 0) <= 1);
  assert.equal(Object.values(st).reduce((a, b) => a + b, 0), 286);
});

test("review status: AI or tool review can never be REVIEW_ACCEPTED", () => {
  const doc = JSON.parse(fs.readFileSync(path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../../../corpus-b/review-preparation/review-status.json"), "utf8"));
  assert.deepEqual(checkStatus(doc), []);
  const accepted = (over) => ({ ...doc, independentReviewerSecured: true, cases: doc.cases.map((c, i) => (i === 0 ? { ...c, status: "REVIEW_ACCEPTED", reviewer: "Jane Doe", reviewerType: "human", targetSha: "a".repeat(40), packetSha256: "b".repeat(64), startedAt: "2026-11-01", scope: "ALL", submissionSha256: "c".repeat(64), submittedAt: "2026-11-05", independenceDeclaration: "signed", reconciliation: "reconciliation/r1", adjudicator: "Kim", adjudicatorType: "human", decisionBasis: "reconciliation rows adjudicated with guide clauses", acceptedAt: "2026-11-07", ...over } : c)) });
  assert.deepEqual(checkStatus(accepted({})), []);
  assert.ok(checkStatus(accepted({ reviewer: "Claude Code", reviewerType: "ai" })).some((e) => /not a human/.test(e)));
  assert.ok(checkStatus(accepted({ adjudicatorType: "tool" })).some((e) => /adjudicatorType/.test(e)));
  assert.ok(checkStatus(accepted({ reconciliation: null })).some((e) => /reconciliation/.test(e)));
  assert.ok(checkStatus({ ...accepted({}), independentReviewerSecured: false }).some((e) => /independentReviewerSecured/.test(e)));
  assert.ok(checkStatus({ ...doc, cases: doc.cases.map((c, i) => (i === 0 ? { ...c, reviewer: "x" } : c)) }).some((e) => /must not carry/.test(e)));
});

test("scoring scope probe: unchanged scorer 1.2 on synthetic predictions", () => {
  const { counts, scenarios: s } = scenarios();
  assert.deepEqual(counts, { determinate: 196, supported: 78, libTargets: 52, excludedSites: 73, indeterminate: 14, negatives: 2 });
  assert.deepEqual([s.S0_perfect.precision, s.S0_perfect.recallInScope, s.S0_perfect.recallOverall], [1, 1, 1]);
  assert.equal(s.S1_perfect_without_lib_targets.recallOverall, Number((144 / 196).toFixed(4)));
  // external API predictions at excluded sites are FP and lower In-scope F1 with In-scope recall unchanged
  assert.equal(s.S3a_supported_plus_external_distinct.fp, 73);
  assert.equal(s.S3a_supported_plus_external_distinct.recallInScope, 1);
  assert.ok(s.S3a_supported_plus_external_distinct.f1InScope < 0.7);
  // a correct and a wrong external target score identically
  assert.deepEqual({ ...s.S3a_supported_plus_external_distinct }, { ...s.S3b_supported_plus_external_wrong_target });
  // key granularity changes the FP count
  assert.ok(s.S3c_supported_plus_external_module_key.fp < s.S3a_supported_plus_external_distinct.fp);
  // out-of-scope true positives raise In-scope F1
  assert.ok(s.S5_S3a_plus_unsupported_tp.f1InScope > s.S3a_supported_plus_external_distinct.f1InScope);
  assert.equal(s.S5_S3a_plus_unsupported_tp.recallInScope, 1);
  // indeterminate matches are EXCLUDED, not FP; negatives are FP and violations
  assert.equal(s.S6_supported_plus_indeterminate_candidates.fp, 0);
  assert.equal(s.S6_supported_plus_indeterminate_candidates.excluded, 18);
  assert.equal(s.S7_perfect_plus_negative_violations.negativeViolations, 2);
  assert.equal(s.S7_perfect_plus_negative_violations.fp, 2);
});
