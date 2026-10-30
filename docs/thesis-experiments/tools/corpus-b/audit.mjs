#!/usr/bin/env node
// Corpus B (P1-K1) audit: consistency of the frozen GT, counts by support level, licenses, overlap with
// EXP-01 and selection determinism. Read-only; never runs Cogic.
// Usage: node audit.mjs --src <checkouts dir> [--json <out>]
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const lib = await import(pathToFileURL(path.join(repoRoot, "docs/thesis-experiments/tools/exp01/lib.mjs")).href);
const { FRAMEWORKS, selectFor } = await import(pathToFileURL(path.join(here, "select-files.mjs")).href);
const corpus = path.join(repoRoot, "docs/thesis-experiments/corpus-b/fixtures");
const exp01 = path.join(repoRoot, "docs/thesis-experiments/fixtures/exp-01");
const arg = (n) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : null);
const lf = (f) => crypto.createHash("sha256").update(fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n")).digest("hex");
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

const catalog = lib.loadCatalog(path.join(corpus, "catalog.csv"));
const supportOf = (p) => catalog.get(p)?.support ?? "UNKNOWN";
const out = { cases: [], problems: [], totals: {} };
const tally = (o, k, n = 1) => (o[k] = (o[k] ?? 0) + n);
const totals = { cases: 0, nodes: 0, relations: 0, determinate: 0, indeterminate: 0, negatives: 0, excludedSites: 0, bySupport: {}, byKind: {}, byFramework: {}, byPattern: {} };

for (const dir of lib.listCaseDirs(corpus)) {
  const gt = lib.readJson(path.join(dir, "expected.json"));
  const cj = lib.readJson(path.join(dir, "case.json"));
  const structural = lib.validateGtStructure(gt, catalog);
  const keyOf = (r) => `${r.kind}|${r.source}|${r.target ?? ""}|${r.argIndex ?? ""}`;
  const det = gt.relations.filter((r) => r.gtStatus === "determinate");
  const ind = gt.relations.filter((r) => r.gtStatus === "indeterminate");
  const dup = det.map(keyOf).filter((k, i, a) => a.indexOf(k) !== i);
  const negKeys = new Set(gt.negatives.map(keyOf));
  const contradict = det.filter((r) => negKeys.has(keyOf(r))).map(keyOf);
  const overlap = [];
  for (const i of ind) {
    for (const c of Array.isArray(i.candidates) ? i.candidates : []) {
      const k = `${i.kind}|${i.source}|${c.target}|${c.argIndex ?? ""}`;
      if (det.some((r) => keyOf(r) === k)) overlap.push(k);
    }
  }
  const ids = new Set(gt.nodes.map((n) => n.id));
  const dangling = [...gt.relations, ...gt.negatives].flatMap((r) => [r.source, r.target, ...(Array.isArray(r.candidates) ? r.candidates.map((c) => c.target) : [])].filter((x) => x && !ids.has(x)));
  const unknownPatterns = [...gt.relations, ...gt.negatives].filter((r) => !catalog.has(r.pattern)).map((r) => r.pattern);
  const problems = [
    ...structural.errors.map((e) => `structure: ${e}`),
    ...dup.map((k) => `duplicate relation ${k}`),
    ...contradict.map((k) => `relation also listed as negative ${k}`),
    ...overlap.map((k) => `determinate relation equals an indeterminate candidate ${k}`),
    ...dangling.map((x) => `dangling endpoint ${x}`),
    ...unknownPatterns.map((p) => `pattern not in catalog ${p}`),
    ...(cj.reviewStatus !== "REVIEW_PENDING" ? [`reviewStatus ${cj.reviewStatus}`] : []),
    ...(cj.authoring?.humanReviewed !== false ? ["humanReviewed must stay false until a human review is recorded"] : []),
    ...(cj.authoring?.cogicOutputUsed !== false ? ["cogicOutputUsed must be false"] : []),
  ];
  for (const p of problems) out.problems.push(`${gt.caseId}: ${p}`);
  totals.cases += 1;
  totals.nodes += gt.nodes.length;
  totals.relations += gt.relations.length;
  totals.determinate += det.length;
  totals.indeterminate += ind.length;
  totals.negatives += gt.negatives.length;
  totals.excludedSites += gt.excludedSites.length;
  for (const r of det) {
    tally(totals.bySupport, supportOf(r.pattern));
    tally(totals.byKind, r.kind);
    tally(totals.byPattern, r.pattern);
  }
  const fw = (totals.byFramework[cj.category] ??= { cases: 0, determinate: 0, indeterminate: 0, negatives: 0, excludedSites: 0 });
  fw.cases += 1;
  fw.determinate += det.length;
  fw.indeterminate += ind.length;
  fw.negatives += gt.negatives.length;
  fw.excludedSites += gt.excludedSites.length;
  const up = lib.readJson(path.join(dir, "upstream.json"));
  const licenseText = fs.readFileSync(path.join(dir, "LICENSE.upstream"), "utf8");
  out.cases.push({
    caseId: gt.caseId,
    framework: cj.category,
    upstream: `${up.repo}@${up.commit.slice(0, 12)}:${up.upstreamActiveFile}`,
    license: up.license,
    licenseFileIsMit: /^MIT License/m.test(licenseText),
    vendoredFiles: up.files.length,
    vendoredFilesMatchUpstreamHash: up.files.every((f) => crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, f.path))).digest("hex") === f.sha256),
    determinate: det.length,
    indeterminate: ind.length,
    negatives: gt.negatives.length,
    excludedSites: gt.excludedSites.length,
    problems,
  });
}
out.totals = totals;

// overlap with EXP-01: no Corpus B source file may be byte-identical (LF) to an EXP-01 fixture source
const exp01Hashes = new Map(walk(exp01).filter((f) => /\.(ts|tsx)$/.test(f)).map((f) => [lf(f), path.relative(exp01, f)]));
out.overlapWithExp01 = walk(corpus).filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes(`${path.sep}shims${path.sep}`)).map((f) => [path.relative(corpus, f), exp01Hashes.get(lf(f))]).filter(([, hit]) => hit);

// selection determinism and pinned commits (needs the checkouts)
const src = arg("--src");
if (src) {
  const frozen = lib.readJson(path.join(repoRoot, "docs/thesis-experiments/corpus-b/selection.json"));
  out.selection = FRAMEWORKS.map((fw) => {
    const again = selectFor(fw, path.join(src, fw.id));
    const was = frozen.frameworks.find((x) => x.framework === fw.id);
    return { framework: fw.id, sha: fw.sha, sameSelection: JSON.stringify(again.selected) === JSON.stringify(was.selected), sameEligible: JSON.stringify(again.eligible) === JSON.stringify(was.eligible) };
  });
}

const text = `${JSON.stringify(out, null, 2)}\n`;
if (arg("--json")) fs.writeFileSync(arg("--json"), text);
console.log(JSON.stringify({ totals, problems: out.problems, overlapWithExp01: out.overlapWithExp01, selection: out.selection, licenses: out.cases.every((c) => c.licenseFileIsMit), vendored: out.cases.every((c) => c.vendoredFilesMatchUpstreamHash) }, null, 1));
process.exitCode = out.problems.length === 0 && out.overlapWithExp01.length === 0 ? 0 : 1;
