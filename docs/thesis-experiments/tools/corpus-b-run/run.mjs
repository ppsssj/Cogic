#!/usr/bin/env node
// P1-L: Corpus B runner (corpus-b-runner/1). Runs one compiled Cogic analyzer (out/analyzer of a clean
// worktree at a pinned commit) on the 20 frozen Corpus B cases, with the same per-case input as EXP-01
// runner 1.2 (workspace = case dir, all .ts/.tsx/.js/.jsx files, activeFile from case.json) and the
// same variants: off#1, off#2 (determinism), on-cold, on-warm (cache OFF/ON consistency, warm = hit path).
// The EXP-01 runner (tools/exp01-run.mjs) and its analyzer identity gate are not modified; this file only
// imports its exported helpers. Raw outputs contain absolute paths and are written OUTSIDE the repository.
// Usage: node run.mjs --analyzer-root <clean worktree> --label ORIGINAL|IMPROVED --out-root <dir> [--run-id <id>]
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "../../../..");
const exp01 = await import(pathToFileURL(path.join(REPO_ROOT, "docs/thesis-experiments/tools/exp01-run.mjs")).href);
const lib = await import(pathToFileURL(path.join(REPO_ROOT, "docs/thesis-experiments/tools/exp01/lib.mjs")).href);

export const RUNNER_VERSION = "corpus-b-runner/1";
export const RUN_SCHEMA = "corpus-b-run/1";
export const RESEARCH_STATUS = "PROVISIONAL_HOLDOUT_DIAGNOSTIC";
export const CORPUS = path.join(REPO_ROOT, "docs/thesis-experiments/corpus-b/fixtures");
export const ANALYZERS = {
  ORIGINAL: { commit: "43ace0fdfdf442d7871c3ef4a92d73b28f1b5e77", mustMatchBaseline: true },
  IMPROVED: { commit: "bbe4cbf5b1f784d9223ca3d46d96058617687b12", mustMatchBaseline: false },
};
const FREEZE = "docs/thesis-experiments/corpus-b/review-preparation/protocol-freeze.v2.json";
const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");
const git = (args, cwd) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();

function node(args) {
  const r = spawnSync(process.execPath, args, { cwd: REPO_ROOT, encoding: "utf8" });
  return { ok: r.status === 0, status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split(/\r?\n/).slice(-1)[0] };
}

// Repository-side checks. Each returns { ok, detail }. Injected in tests.
export function defaultRepoChecks() {
  const T = "docs/thesis-experiments/tools";
  const F = "docs/thesis-experiments/fixtures/exp-01";
  const checks = {
    corpusBManifest: node([`${T}/corpus-b/manifest.mjs`, "--check"]),
    gtValidator: node([`${T}/corpus-b/validate.mjs`]),
    exp01GtManifest: node([`${T}/exp01/manifest.mjs`, "--check", "--manifest", `${F}/gt-manifest.json`, "--scope", "gt"]),
    exp01EvalManifest: node([`${T}/exp01/manifest.mjs`, "--check", "--manifest", `${F}/eval-manifest.r2.json`]),
    baselineHashes: node([`${T}/corpus-b-env/baseline-hashes.mjs`, "--check", "docs/thesis-experiments/corpus-b/environment-audit/baseline-hashes.json"]),
    protocolFreeze: node([`${T}/corpus-b-scoring/protocol-freeze.mjs`, "--check", FREEZE]),
  };
  const dirty = git(["status", "--porcelain"], REPO_ROOT);
  checks.runnerRepoClean = { ok: dirty === "", out: dirty === "" ? "clean" : "dirty working tree" };
  checks.scorerVersion = { ok: lib.SCORER_VERSION === "exp01-scorer/1.2", out: lib.SCORER_VERSION };
  return checks;
}

// Analyzer-side identity. ORIGINAL must equal the EXP-01 ANALYZER_BASELINE (same fields as runner 1.2).
export function defaultAnalyzerCheck(label, analyzerRoot) {
  const spec = ANALYZERS[label];
  const problems = [];
  if (!spec) return { ok: false, problems: [`unknown label ${label}`] };
  const head = git(["rev-parse", "HEAD"], analyzerRoot);
  if (head !== spec.commit) problems.push(`HEAD ${head} != ${spec.commit}`);
  const dirty = git(["status", "--porcelain", "--untracked-files=no"], analyzerRoot);
  if (dirty) problems.push("analyzer worktree has tracked changes");
  const build = exp01.defaultBuildCheck(analyzerRoot);
  if (!build.ok) problems.push(...build.problems);
  const identity = exp01.defaultAnalyzerIdentity({ repoRoot: analyzerRoot, buildHash: build.buildHash });
  if (identity.current.typescript !== "5.9.3") problems.push(`typescript ${identity.current.typescript}`);
  if (spec.mustMatchBaseline && !identity.identical) problems.push(`not identical to EXP-01 ANALYZER_BASELINE: ${identity.mismatches.join(", ")}`);
  return { ok: problems.length === 0, problems, head, buildHash: build.buildHash, identity };
}

const hashFiles = (root) => {
  const out = {};
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), r);
      else out[r] = sha256(fs.readFileSync(path.join(d, e.name)));
    }
  };
  walk(root, "");
  return out;
};

function writeNew(file, data) {
  if (fs.existsSync(file)) throw new Error(`refusing to overwrite ${file}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = `${JSON.stringify(data, null, 1)}\n`;
  fs.writeFileSync(file, text);
  return sha256(text);
}

export function runCase({ analyzer, caseDir, runDir, repeat, runInfo }) {
  const prepared = exp01.prepareCaseInput(caseDir);
  const entry = { caseId: prepared.caseId, status: null, errors: [], warnings: [], inputHash: prepared.input?.inputHash ?? null, completedVariants: [], hashes: {}, events: {}, checks: null, tsLibRelations: [], files: {} };
  if (!prepared.ok) return { ...entry, status: "INVALID_INPUT", errors: prepared.errors };
  const input = prepared.input;
  const variants = [...Array.from({ length: repeat }, (_, i) => ({ name: `off#${i + 1}`, cacheEnabled: false, clear: i === 0 })), { name: "on-cold", cacheEnabled: true, clear: true }, { name: "on-warm", cacheEnabled: true, clear: false }];
  const results = {};
  for (const v of variants) {
    let output;
    const events = {};
    try {
      if (v.clear && typeof analyzer.clearAnalyzerCaches === "function") analyzer.clearAnalyzerCaches();
      output = analyzer.analyzeWorkspaceActive({
        active: { code: input.code, fileName: input.activeAbs, languageId: input.languageId },
        workspaceRoot: input.caseDir,
        filePaths: input.filePaths,
        cacheEnabled: v.cacheEnabled,
        debug: (e) => (events[e] = (events[e] ?? 0) + 1),
      });
    } catch (e) {
      return { ...entry, status: "ANALYZER_ERROR", errors: [`${v.name}: ${e?.message ?? e}`], failedVariant: v.name };
    }
    const doc = {
      schema: exp01.RAW_SCHEMA,
      caseId: entry.caseId,
      fixtureRoot: caseDir,
      analyzerInput: { workspaceRoot: "<fixtureRoot>", activeFile: input.activeFileRel, languageId: input.languageId, filePaths: input.filePaths.map((f) => path.relative(caseDir, f).split(path.sep).join("/")), cacheEnabled: v.cacheEnabled, variant: v.name },
      run: runInfo,
      inputHash: input.inputHash,
      inputFiles: input.fileHashes,
      analyzerOutput: output,
    };
    const rel = v.name === "off#1" ? `predictions/${entry.caseId}.json` : `repeats/${entry.caseId}.${v.name.replace("#", "")}.json`;
    entry.files[v.name] = { path: rel, sha256: writeNew(path.join(runDir, rel), doc) };
    results[v.name] = output;
    entry.events[v.name] = events;
    entry.completedVariants.push(v.name);
  }
  for (const [n, o] of Object.entries(results)) entry.hashes[n] = exp01.canonicalHashes(o, { fixtureRoot: caseDir, repoRoot: REPO_ROOT });
  const ref = entry.hashes["off#1"].semanticHash;
  const offs = variants.filter((v) => !v.cacheEnabled).map((v) => v.name);
  const warmHits = entry.events["on-warm"]["analyzer.sourceFileCache.hit"] ?? 0;
  entry.checks = {
    deterministic: offs.every((n) => entry.hashes[n].semanticHash === ref),
    orderStable: offs.every((n) => entry.hashes[n].orderedHash === entry.hashes["off#1"].orderedHash),
    cacheConsistent: ["on-cold", "on-warm"].every((n) => entry.hashes[n].semanticHash === ref),
    cacheHitPathExercised: warmHits > 0,
    warmSourceFileCacheHits: warmHits,
  };
  const structure = exp01.validateAnalyzerOutput(results["off#1"]);
  entry.warnings.push(...structure.warnings);
  if (!entry.checks.cacheHitPathExercised) entry.warnings.push("on-warm reported no sourceFileCache.hit events");
  entry.tsLibRelations = exp01.tsLibRelations(results["off#1"]);
  if (structure.errors.length) return { ...entry, status: "INVALID_OUTPUT", errors: structure.errors };
  return { ...entry, status: "OK" };
}

export function runCorpusB({ label, analyzerRoot, outRoot, runId, repeat = 2, corpus = CORPUS, repoChecks = defaultRepoChecks, analyzerCheck = defaultAnalyzerCheck, loadAnalyzer = (root) => createRequire(import.meta.url)(path.join(root, "out", "analyzer")), now = new Date() }) {
  const runDir = path.join(outRoot, runId ?? `corpusb-${now.toISOString().slice(0, 10).replace(/-/g, "")}-${label.toLowerCase()}`);
  if (fs.existsSync(runDir)) throw new Error(`run directory exists: ${runDir}`);
  const preflight = { repo: repoChecks(), analyzer: analyzerCheck(label, analyzerRoot) };
  const failed = [...Object.entries(preflight.repo).filter(([, v]) => !v.ok).map(([k, v]) => `${k}: ${v.out}`), ...(preflight.analyzer.ok ? [] : preflight.analyzer.problems.map((p) => `analyzer: ${p}`))];
  const record = {
    schema: RUN_SCHEMA,
    runnerVersion: RUNNER_VERSION,
    label,
    researchStatus: RESEARCH_STATUS,
    gtStatus: { version: "v1", reviewStatus: "REVIEW_PENDING", humanReviewed: false },
    protocol: { primary: "corpus-b/EVALUATION_PROTOCOL.md (v1)", sensitivity: "corpus-b/review-preparation/EVALUATION_PROTOCOL.v2.md (APPROVED 2026-10-30)", freeze: FREEZE },
    runnerCommit: git(["rev-parse", "HEAD"], REPO_ROOT),
    analyzer: { label, commit: ANALYZERS[label]?.commit, head: preflight.analyzer.head ?? null, buildHash: preflight.analyzer.buildHash ?? null, identity: preflight.analyzer.identity ?? null },
    environment: { node: process.version, platform: process.platform, arch: process.arch },
    startedAt: now.toISOString(),
    preflight,
    cases: [],
  };
  fs.mkdirSync(runDir, { recursive: true });
  if (failed.length) {
    record.status = "PREFLIGHT_FAILED";
    record.errors = failed;
    writeNew(path.join(runDir, "run.json"), record);
    return { runDir, record, exitCode: 2 };
  }
  const analyzer = loadAnalyzer(analyzerRoot);
  const before = hashFiles(corpus);
  const runInfo = { runnerVersion: RUNNER_VERSION, label, analyzerCommit: record.analyzer.commit, analyzerBuildHash: record.analyzer.buildHash, runnerCommit: record.runnerCommit, researchStatus: RESEARCH_STATUS };
  for (const caseDir of lib.listCaseDirs(corpus)) record.cases.push(runCase({ analyzer, caseDir, runDir, repeat, runInfo }));
  const after = hashFiles(corpus);
  const changed = Object.keys({ ...before, ...after }).filter((k) => before[k] !== after[k]);
  record.corpusUnchanged = changed.length === 0;
  record.corpusChangedFiles = changed;
  record.finishedAt = new Date().toISOString();
  const ok = record.cases.filter((c) => c.status === "OK");
  record.summary = {
    cases: record.cases.length,
    ok: ok.length,
    failed: record.cases.filter((c) => c.status !== "OK").map((c) => `${c.caseId}:${c.status}`),
    deterministic: ok.every((c) => c.checks.deterministic),
    orderStable: ok.every((c) => c.checks.orderStable),
    cacheConsistent: ok.every((c) => c.checks.cacheConsistent),
    cacheHitPathExercised: ok.filter((c) => c.checks.cacheHitPathExercised).length,
    tsLibRelations: ok.reduce((a, c) => a + c.tsLibRelations.length, 0),
  };
  record.status = record.corpusUnchanged && ok.length === record.cases.length ? "COMPLETE" : "PARTIAL";
  writeNew(path.join(runDir, "run.json"), record);
  return { runDir, record, exitCode: record.status === "COMPLETE" ? 0 : 3 };
}

function main() {
  const arg = (n) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : null);
  const r = runCorpusB({ label: arg("--label"), analyzerRoot: path.resolve(arg("--analyzer-root")), outRoot: path.resolve(arg("--out-root")), runId: arg("--run-id") ?? undefined });
  console.log(`${r.record.label}: ${r.record.status}${r.record.errors ? ` ${r.record.errors.join("; ")}` : ""}`);
  if (r.record.summary) console.log(JSON.stringify(r.record.summary));
  console.log(`run dir: ${r.runDir}`);
  process.exitCode = r.exitCode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
