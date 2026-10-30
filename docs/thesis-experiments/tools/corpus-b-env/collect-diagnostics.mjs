#!/usr/bin/env node
// P1-K2: re-collect every TypeScript diagnostic of the frozen Corpus B cases, classify its root cause
// and its effect on static semantics, and aggregate. Read-only on the corpus; TypeScript API only.
// Usage: node collect-diagnostics.mjs --out <dir>   (writes diagnostics.json, diagnostic-summary.json;
//        refuses to overwrite)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CAUSES, CAUSE_CRITERIA, CLASSIFIER_VERSION, IMPACTS, collectCase, listCases, repoRoot, ts } from "./diagnostics-lib.mjs";

const corpus = path.join(repoRoot, "docs/thesis-experiments/corpus-b/fixtures");
const reportPath = path.join(repoRoot, "docs/thesis-experiments/corpus-b/validation-report.json");
const tally = (rows, key) => {
  const o = {};
  for (const r of rows) {
    const k = typeof key === "function" ? key(r) : r[key];
    o[k] = (o[k] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))));
};

export function run() {
  const cases = listCases(corpus);
  const rows = cases.flatMap((c) => collectCase(c));
  // repetition of the same upstream diagnostic across cases
  const casesByKey = new Map();
  for (const r of rows) casesByKey.set(r.uniqueKey, new Set([...(casesByKey.get(r.uniqueKey) ?? []), r.caseId]));
  for (const r of rows) {
    const s = casesByKey.get(r.uniqueKey);
    r.repeatedInCases = s.size;
    r.otherCases = [...s].filter((x) => x !== r.caseId).sort();
  }

  // comparison with the frozen P1-K1 validation report (same program construction)
  const frozen = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  const perCase = cases.map((c) => {
    const n = rows.filter((r) => r.caseId === c.caseId).length;
    const was = frozen.cases.find((x) => x.caseId === c.caseId)?.environmentDiagnostics;
    return { caseId: c.caseId, framework: c.framework, recollected: n, validationReport: was, same: n === was };
  });

  // TSCONFIG_MISMATCH verification: rerun the lib-overridden cases with the upstream (default) lib
  const variant = [];
  for (const c of cases) {
    const up = JSON.parse(fs.readFileSync(path.join(c.caseDir, "upstream.json"), "utf8"));
    if (!(up.tsconfig.upstreamOptions.lib === undefined && up.tsconfig.derivedOptions.lib !== undefined)) continue;
    const alt = collectCase(c, { optionOverrides: { lib: undefined } });
    const altKeys = new Set(alt.map((r) => r.uniqueKey));
    const baseKeys = new Set(rows.filter((r) => r.caseId === c.caseId).map((r) => r.uniqueKey));
    const mismatch = rows.filter((r) => r.caseId === c.caseId && r.cause === "TSCONFIG_MISMATCH");
    variant.push({
      caseId: c.caseId,
      tsconfigMismatchDiagnostics: mismatch.length,
      goneWithUpstreamLib: mismatch.filter((r) => !altKeys.has(r.uniqueKey)).length,
      otherDiagnosticsGone: rows.filter((r) => r.caseId === c.caseId && r.cause !== "TSCONFIG_MISMATCH" && !altKeys.has(r.uniqueKey)).length,
      newDiagnosticsWithUpstreamLib: alt.filter((r) => !baseKeys.has(r.uniqueKey)).length,
      newDiagnosticCodes: tally(alt.filter((r) => !baseKeys.has(r.uniqueKey)), "code"),
    });
  }

  const unique = [...new Map(rows.map((r) => [r.uniqueKey, r])).values()];
  const summary = {
    schema: "corpus-b-env-diagnostic-summary/1",
    classifier: CLASSIFIER_VERSION,
    typescript: ts.version,
    construction: "parseJsonConfigFileContent(case tsconfig.json) + createProgram + getPreEmitDiagnostics (as tools/exp01/validate-gt.mjs)",
    totals: {
      cases: cases.length,
      diagnostics: rows.length,
      uniqueDiagnostics: unique.length,
      duplicateOccurrences: rows.length - unique.length,
      duplicateRatio: Number(((rows.length - unique.length) / rows.length).toFixed(4)),
      validationReportTotal: frozen.cases.reduce((a, c) => a + c.environmentDiagnostics, 0),
      reproducedPerCase: perCase.every((p) => p.same),
    },
    byCategory: tally(rows, "category"),
    byCode: tally(rows, (r) => `TS${r.code}`),
    byCodeUnique: tally(unique, (r) => `TS${r.code}`),
    byCause: tally(rows, "cause"),
    byCauseUnique: tally(unique, "cause"),
    byFramework: tally(rows, "framework"),
    byFrameworkUnique: Object.fromEntries(["react", "vue", "express", "nest"].map((fw) => [fw, new Set(rows.filter((r) => r.framework === fw).map((r) => r.uniqueKey)).size])),
    byCase: perCase,
    byLocation: tally(rows, "location"),
    byImpact: tally(rows, "impact"),
    activeFile: {
      diagnostics: rows.filter((r) => r.location === "ACTIVE_FILE").length,
      byCase: tally(rows.filter((r) => r.location === "ACTIVE_FILE"), "caseId"),
      byCode: tally(rows.filter((r) => r.location === "ACTIVE_FILE"), (r) => `TS${r.code}`),
      byCause: tally(rows.filter((r) => r.location === "ACTIVE_FILE"), "cause"),
      byImpact: tally(rows.filter((r) => r.location === "ACTIVE_FILE"), "impact"),
    },
    causeByFramework: Object.fromEntries(["react", "vue", "express", "nest"].map((fw) => [fw, tally(rows.filter((r) => r.framework === fw), "cause")])),
    causeByCode: Object.fromEntries(Object.keys(tally(rows, (r) => `TS${r.code}`)).map((code) => [code, tally(rows.filter((r) => `TS${r.code}` === code), "cause")])),
    topUpstreamFiles: Object.entries(tally(rows, "upstreamFile")).slice(0, 15).map(([file, n]) => ({ file, occurrences: n, unique: unique.filter((u) => u.upstreamFile === file).length, cases: new Set(rows.filter((r) => r.upstreamFile === file).map((r) => r.caseId)).size })),
    tsconfigMismatchVerification: variant,
    unknown: rows.filter((r) => r.cause === "UNKNOWN").map((r) => ({ caseId: r.caseId, file: r.file, line: r.line, code: r.code, basis: r.basis })),
    causeCriteria: CAUSE_CRITERIA,
    impactCriteria: IMPACTS,
  };
  return { rows, summary };
}

function main() {
  const i = process.argv.indexOf("--out");
  if (i < 0) throw new Error("--out <dir> is required");
  const out = path.resolve(process.argv[i + 1]);
  const files = ["diagnostics.json", "diagnostic-summary.json"].map((f) => path.join(out, f));
  for (const f of files) if (fs.existsSync(f)) throw new Error(`${f} exists; refusing to overwrite`);
  const { rows, summary } = run();
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(files[0], `${JSON.stringify({ schema: "corpus-b-env-diagnostics/1", classifier: CLASSIFIER_VERSION, typescript: ts.version, causes: CAUSES, diagnostics: rows }, null, 1)}\n`);
  fs.writeFileSync(files[1], `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify({ totals: summary.totals, byCause: summary.byCause, unknown: summary.unknown.length, variant: summary.tsconfigMismatchVerification }, null, 1));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
