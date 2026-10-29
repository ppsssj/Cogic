#!/usr/bin/env node
// Corpus B (P1-K1) validation. Runs the unchanged EXP-01 validator (tools/exp01/validate-gt.mjs) on the
// Corpus B fixtures and splits its errors:
//   - "TS diagnostic: ..." errors are ENVIRONMENT diagnostics: the corpus has no npm dependencies and
//     declares third-party modules as untyped shorthand ambient modules, so type errors are expected.
//     They are counted per case and never block.
//   - every other error (schema, node/declaration mismatch, evidence, call-site coverage) is a GT error.
// Usage: node validate.mjs [--json <out>]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const corpus = path.join(repoRoot, "docs/thesis-experiments/corpus-b/fixtures");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "corpus-b-validate-"));
const report = path.join(tmp, "report.json");
try {
  execFileSync(process.execPath, [path.join(repoRoot, "docs/thesis-experiments/tools/exp01/validate-gt.mjs"), "--corpus", corpus, "--json", report], { stdio: "pipe" });
} catch {
  // validate-gt exits non-zero when any error exists; the report is still written
}
const raw = JSON.parse(fs.readFileSync(report, "utf8"));
fs.rmSync(tmp, { recursive: true, force: true });
const cases = raw.results.map((c) => {
  const env = c.errors.filter((e) => e.startsWith("TS diagnostic:"));
  const gt = c.errors.filter((e) => !e.startsWith("TS diagnostic:"));
  return { caseId: c.caseId, category: c.category, gtErrors: gt, environmentDiagnostics: env.length, warnings: c.warnings, stats: c.stats };
});
const out = { validator: "tools/exp01/validate-gt.mjs (unchanged)", cases, gtErrorCount: cases.reduce((a, c) => a + c.gtErrors.length, 0) };
const i = process.argv.indexOf("--json");
if (i >= 0) fs.writeFileSync(process.argv[i + 1], `${JSON.stringify(out, null, 2)}\n`);
for (const c of cases) {
  console.log(`${c.caseId}: gtErrors ${c.gtErrors.length}, envDiagnostics ${c.environmentDiagnostics}, warnings ${c.warnings.length}, relations ${c.stats?.relations ?? "-"}, callSites ${c.stats?.callSites ?? "-"}`);
  for (const e of c.gtErrors) console.log(`   ERROR ${e}`);
  for (const w of c.warnings) console.log(`   warn  ${w}`);
}
console.log(`GT errors: ${out.gtErrorCount}`);
process.exitCode = out.gtErrorCount === 0 ? 0 : 1;
