#!/usr/bin/env node
// EXP-01 runner (P1-B).
//
// Runs the compiled Cogic analyzer (out/analyzer) on every EXP-01 fixture and stores the
// raw output as exp01-raw/1 under docs/thesis-experiments/data/exp-01/<run-id>/.
// It never edits GT, fixtures, manifests or the scorer, and never overwrites a run.
//
// Order of a run (fail-closed at every step):
//   1. preflight: both manifest checks, analyzer build freshness, git dirty state,
//      run directory must not exist. Any failure -> analyzer is not called.
//   2. per case: validate fixture input, then analyze
//        off#1..off#N  cacheEnabled: false        (determinism)
//        on-cold, on-warm  cacheEnabled: true     (cache OFF/ON consistency, warm = hit path)
//      validate GraphPayload structure, flag TS lib endpoints (D11), hash inputs/outputs.
//   3. scoring with tools/exp01/score.mjs only when every case is OK.
//   4. run.json records status and whether the result may be used as confirmatory.
//
// Usage (repository root, after `npm run compile`):
//   node docs/thesis-experiments/tools/exp01-run.mjs [--run-id <id>] [--cases <id,id>]
//        [--repeat 2] [--bootstrap 10000] [--no-score] [--allow-dirty]
//
// Exit codes: 0 confirmatory-eligible, 2 usage error, 3 preflight failed,
//             4 run incomplete or invalid, 5 run complete but not confirmatory.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { SCORER_VERSION, listCaseDirs } from "./exp01/lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "../../..");
export const RUNNER_VERSION = "exp01-runner/1.0";
export const RAW_SCHEMA = "exp01-raw/1";
export const RUN_SCHEMA = "exp01-run/1";

// Fixed research identifiers (P1-A, P1-A-R1).
export const PROTOCOL = {
  experiment: "EXP-01",
  preregistrationCommit: "41bbe19434b4d284c6368b5fb5158cf1a5dbdf1e",
  evaluationToolCommit: "ae82bfbf0e26b7cba67e40af2b1f0a1fe89b81ca",
  scorerVersion: SCORER_VERSION,
  d11Decision: "D11_KEEP_PRE_REGISTERED_SCORING",
};

const DEFAULT_CORPUS = path.join(REPO_ROOT, "docs/thesis-experiments/fixtures/exp-01");
const DEFAULT_DATA_ROOT = path.join(REPO_ROOT, "docs/thesis-experiments/data/exp-01");
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];
const LANGUAGE_IDS = { ".ts": "typescript", ".tsx": "typescriptreact", ".js": "javascript", ".jsx": "javascriptreact" };
const NODE_KINDS = new Set(["file", "function", "method", "class", "interface", "external"]);
const EDGE_KINDS = new Set(["calls", "constructs", "dataflow", "updates", "references"]);
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

// Fields compared between repetitions. Everything else in the analyzer result is excluded:
//   meta.projectRoot (absolute path) and trace (emission log of the same graph nodes/edges;
//   it is part of orderedHash only). Absolute fixture/repository paths inside the compared
//   fields are replaced by <fixtureRoot>/<repoRoot> before hashing.
export const COMPARED_FIELDS = [
  "graph.nodes",
  "graph.edges",
  "imports",
  "exports",
  "calls",
  "diagnostics",
  "meta.mode",
  "meta.rootFiles",
  "meta.usedTsconfig",
];

// ---------------------------------------------------------------------------
// Hashing and canonical form

export function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

export function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((v) => (v === undefined ? "null" : stableStringify(v))).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function pathVariants(p) {
  const fwd = path.resolve(p).replace(/\\/g, "/");
  const variants = new Set([fwd, fwd.replace(/\//g, "\\")]);
  for (const v of [...variants]) {
    if (/^[A-Za-z]:/.test(v)) {
      variants.add(v[0].toLowerCase() + v.slice(1));
      variants.add(v[0].toUpperCase() + v.slice(1));
    }
  }
  return [...variants].sort((a, b) => b.length - a.length);
}

function replacePaths(value, replacements) {
  if (typeof value === "string") {
    let s = value;
    for (const [from, to] of replacements) {
      s = s.split(from).join(to);
    }
    return s;
  }
  if (Array.isArray(value)) {
    return value.map((v) => replacePaths(v, replacements));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, replacePaths(v, replacements)]));
  }
  return value;
}

const byId = (a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);

// Returns { semanticHash, orderedHash }. semanticHash ignores node/edge order.
export function canonicalHashes(output, { fixtureRoot, repoRoot = REPO_ROOT }) {
  const replacements = [
    ...pathVariants(fixtureRoot).map((v) => [v, "<fixtureRoot>"]),
    ...pathVariants(repoRoot).map((v) => [v, "<repoRoot>"]),
  ];
  const meta = output?.meta ?? {};
  const compared = replacePaths(
    {
      nodes: output?.graph?.nodes ?? null,
      edges: output?.graph?.edges ?? null,
      imports: output?.imports ?? null,
      exports: output?.exports ?? null,
      calls: output?.calls ?? null,
      diagnostics: output?.diagnostics ?? null,
      meta: { mode: meta.mode, rootFiles: meta.rootFiles, usedTsconfig: meta.usedTsconfig },
    },
    replacements,
  );
  const orderedHash = sha256(stableStringify({ ...compared, trace: replacePaths(output?.trace ?? null, replacements) }));
  const semantic = {
    ...compared,
    nodes: Array.isArray(compared.nodes) ? [...compared.nodes].sort(byId) : compared.nodes,
    edges: Array.isArray(compared.edges) ? [...compared.edges].sort(byId) : compared.edges,
  };
  return { semanticHash: sha256(stableStringify(semantic)), orderedHash };
}

// ---------------------------------------------------------------------------
// Validation

// Fixture input checks. Returns { ok, errors, input } without reading expected.json content.
export function prepareCaseInput(caseDir) {
  const errors = [];
  const caseJsonPath = path.join(caseDir, "case.json");
  let meta = null;
  try {
    meta = JSON.parse(fs.readFileSync(caseJsonPath, "utf8"));
  } catch (e) {
    return { ok: false, caseId: path.basename(caseDir), errors: [`case.json unreadable: ${e.message}`] };
  }
  const caseId = typeof meta.caseId === "string" ? meta.caseId : path.basename(caseDir);
  if (meta.schema !== "exp01-case/1") {
    errors.push(`case.json schema ${JSON.stringify(meta.schema)} is not exp01-case/1`);
  }
  if (meta.caseId !== path.basename(caseDir)) {
    errors.push(`caseId ${JSON.stringify(meta.caseId)} does not match directory ${path.basename(caseDir)}`);
  }
  const active = meta.activeFile;
  let activeAbs = null;
  if (typeof active !== "string" || active === "" || path.isAbsolute(active)) {
    errors.push(`activeFile must be a relative path, got ${JSON.stringify(active)}`);
  } else {
    activeAbs = path.resolve(caseDir, active);
    const rel = path.relative(caseDir, activeAbs);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      errors.push(`activeFile ${active} escapes the case directory`);
    } else if (!SOURCE_EXTENSIONS.includes(path.extname(activeAbs))) {
      errors.push(`activeFile ${active}: unsupported extension (allowed ${SOURCE_EXTENSIONS.join(", ")})`);
    } else if (!fs.existsSync(activeAbs) || !fs.statSync(activeAbs).isFile()) {
      errors.push(`activeFile ${active} does not exist`);
    }
  }
  const tsconfig = path.join(caseDir, "tsconfig.json");
  if (!fs.existsSync(tsconfig)) {
    errors.push("tsconfig.json missing");
  } else {
    try {
      JSON.parse(fs.readFileSync(tsconfig, "utf8"));
    } catch (e) {
      errors.push(`tsconfig.json is not valid JSON: ${e.message}`);
    }
  }
  if (!fs.existsSync(path.join(caseDir, "expected.json"))) {
    errors.push("expected.json missing");
  }
  if (errors.length > 0) {
    return { ok: false, caseId, errors };
  }
  const files = listFiles(caseDir);
  const filePaths = files.filter((f) => SOURCE_EXTENSIONS.includes(path.extname(f))).map((f) => path.join(caseDir, f));
  const fileHashes = Object.fromEntries(files.map((f) => [f, sha256(fs.readFileSync(path.join(caseDir, f)))]));
  return {
    ok: true,
    caseId,
    errors: [],
    input: {
      caseDir,
      activeFileRel: active.replace(/\\/g, "/"),
      activeAbs,
      languageId: LANGUAGE_IDS[path.extname(activeAbs)],
      code: fs.readFileSync(activeAbs, "utf8"),
      filePaths,
      fileHashes,
      // Hash of the analyzer-visible inputs; expected.json and case.json are listed but
      // never passed to the analyzer.
      inputHash: sha256(stableStringify(fileHashes)),
    },
  };
}

function listFiles(dir, prefix = "") {
  const out = [];
  for (const e of fs.readdirSync(path.join(dir, prefix), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) {
      out.push(...listFiles(dir, rel));
    } else {
      out.push(rel);
    }
  }
  return out;
}

// GraphPayload structure check. Errors make the case INVALID_OUTPUT; warnings are recorded.
export function validateAnalyzerOutput(output) {
  const errors = [];
  const warnings = [];
  if (!output || typeof output !== "object") {
    return { errors: ["analyzer returned no object"], warnings };
  }
  const g = output.graph;
  if (!g || !Array.isArray(g.nodes) || !Array.isArray(g.edges)) {
    return { errors: ["graph.nodes / graph.edges missing or not arrays"], warnings };
  }
  const ids = new Set();
  g.nodes.forEach((n, i) => {
    const where = `node[${i}]`;
    if (!n || typeof n.id !== "string" || n.id === "") {
      errors.push(`${where}: id missing`);
      return;
    }
    if (ids.has(n.id)) {
      errors.push(`${where}: duplicate node id ${n.id}`);
    }
    ids.add(n.id);
    if (!NODE_KINDS.has(n.kind)) {
      errors.push(`${where} ${n.id}: unknown node kind ${JSON.stringify(n.kind)}`);
    }
    if (typeof n.name !== "string" || typeof n.file !== "string") {
      errors.push(`${where} ${n.id}: name/file must be strings`);
    }
    const r = n.range;
    const okPos = (p) => p && Number.isInteger(p.line) && p.line >= 0 && Number.isInteger(p.character) && p.character >= 0;
    if (!r || !okPos(r.start) || !okPos(r.end)) {
      errors.push(`${where} ${n.id}: invalid range`);
    }
  });
  const edgeIds = new Set();
  g.edges.forEach((e, i) => {
    const where = `edge[${i}]`;
    if (!e || typeof e.id !== "string" || e.id === "") {
      errors.push(`${where}: id missing`);
      return;
    }
    if (edgeIds.has(e.id)) {
      warnings.push(`${where}: duplicate edge id ${e.id}`);
    }
    edgeIds.add(e.id);
    if (!EDGE_KINDS.has(e.kind)) {
      errors.push(`${where} ${e.id}: unknown edge kind ${JSON.stringify(e.kind)}`);
    }
    if (!ids.has(e.source) || !ids.has(e.target)) {
      errors.push(`${where} ${e.id}: endpoint not in nodes`);
    }
    if (e.kind === "dataflow" && !/@@arg#\d+$/.test(e.id)) {
      errors.push(`${where} ${e.id}: dataflow edge id without arg#i`);
    }
  });
  const meta = output.meta ?? {};
  if (meta.mode !== "workspace") {
    errors.push(`meta.mode is ${JSON.stringify(meta.mode)}, expected "workspace"`);
  }
  if (meta.usedTsconfig !== true) {
    errors.push("meta.usedTsconfig is not true: fixture tsconfig.json was not applied");
  }
  return { errors, warnings };
}

export function isTsLibFile(file) {
  const f = String(file ?? "").replace(/\\/g, "/");
  return f.includes("/node_modules/typescript/lib/");
}

// D11: relations whose endpoint is a TypeScript lib declaration. Expected to be absent.
export function tsLibRelations(output) {
  const nodes = new Map((output?.graph?.nodes ?? []).map((n) => [n.id, n]));
  return (output?.graph?.edges ?? [])
    .filter((e) => isTsLibFile(nodes.get(e.source)?.file) || isTsLibFile(nodes.get(e.target)?.file))
    .map((e) => ({ edgeId: e.id, kind: e.kind, source: e.source, target: e.target }));
}

// ---------------------------------------------------------------------------
// Preflight

export function defaultManifestChecks(repoRoot = REPO_ROOT) {
  const tool = path.join(repoRoot, "docs/thesis-experiments/tools/exp01/manifest.mjs");
  const commands = [
    ["--check", "--scope", "gt"],
    ["--check", "--manifest", "docs/thesis-experiments/fixtures/exp-01/eval-manifest.r1.json"],
  ];
  return commands.map((args) => {
    const r = spawnSync(process.execPath, [tool, ...args], { cwd: repoRoot, encoding: "utf8" });
    return {
      command: `node docs/thesis-experiments/tools/exp01/manifest.mjs ${args.join(" ")}`,
      exitCode: r.status,
      ok: r.status === 0,
      output: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim(),
    };
  });
}

function git(args, cwd) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

export function defaultGitInfo(repoRoot = REPO_ROOT) {
  const porcelain = git(["status", "--porcelain"], repoRoot);
  return {
    headCommit: git(["rev-parse", "HEAD"], repoRoot),
    branch: git(["rev-parse", "--abbrev-ref", "HEAD"], repoRoot),
    dirty: porcelain === null ? null : porcelain.length > 0,
    porcelain,
    diff: porcelain ? git(["diff", "HEAD"], repoRoot) : "",
  };
}

// Every src/analyzer and src/shared .ts file must have an out/*.js at least as new.
export function defaultBuildCheck(repoRoot = REPO_ROOT) {
  const problems = [];
  const hashes = {};
  for (const dir of ["analyzer", "shared"]) {
    const srcDir = path.join(repoRoot, "src", dir);
    if (!fs.existsSync(srcDir)) {
      problems.push(`src/${dir} missing`);
      continue;
    }
    for (const rel of listFiles(srcDir).filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"))) {
      const src = path.join(srcDir, rel);
      const out = path.join(repoRoot, "out", dir, rel.replace(/\.ts$/, ".js"));
      const key = `out/${dir}/${rel.replace(/\.ts$/, ".js")}`;
      if (!fs.existsSync(out)) {
        problems.push(`${key} missing (run npm run compile)`);
        continue;
      }
      if (fs.statSync(out).mtimeMs < fs.statSync(src).mtimeMs) {
        problems.push(`${key} older than src/${dir}/${rel} (run npm run compile)`);
      }
      hashes[key] = sha256(fs.readFileSync(out));
    }
  }
  return { ok: problems.length === 0, problems, buildHash: sha256(stableStringify(hashes)), files: hashes };
}

function hashTree(root) {
  if (!fs.existsSync(root)) {
    return {};
  }
  return Object.fromEntries(listFiles(root).map((f) => [f, sha256(fs.readFileSync(path.join(root, f)))]));
}

export function defaultLoadAnalyzer(repoRoot = REPO_ROOT) {
  const require = createRequire(import.meta.url);
  return require(path.join(repoRoot, "out", "analyzer"));
}

export function environment() {
  const require = createRequire(import.meta.url);
  let typescript = null;
  try {
    typescript = require(path.join(REPO_ROOT, "node_modules/typescript/package.json")).version;
  } catch {
    typescript = null;
  }
  return {
    os: { platform: process.platform, release: os.release(), version: os.version?.() ?? null, arch: process.arch },
    cpu: { model: os.cpus()[0]?.model ?? null, logicalCores: os.cpus().length },
    memory: { totalBytes: os.totalmem(), freeBytesAtStart: os.freemem() },
    node: process.version,
    v8: process.versions.v8,
    typescript,
    execArgv: process.execArgv,
  };
}

// ---------------------------------------------------------------------------
// Run

function writeNew(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof data === "string" ? data : `${JSON.stringify(data, null, 2)}\n`, { flag: "wx" });
  return sha256(fs.readFileSync(file));
}

export function defaultRunId(gitInfo, now = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}-${p(now.getUTCHours())}${p(now.getUTCMinutes())}`;
  const sha = (gitInfo.headCommit ?? "nogit").slice(0, 7);
  return `exp01-${stamp}-${sha}${gitInfo.dirty ? "-dirty" : ""}`;
}

function analyzeOnce(analyzer, input, cacheEnabled) {
  const events = {};
  const output = analyzer.analyzeWorkspaceActive({
    active: { code: input.code, fileName: input.activeAbs, languageId: input.languageId },
    workspaceRoot: input.caseDir,
    filePaths: input.filePaths,
    cacheEnabled,
    debug: (event) => {
      events[event] = (events[event] ?? 0) + 1;
    },
  });
  return { output, events };
}

export function defaultScorer({ repoRoot = REPO_ROOT, corpus, predictionsDir, outDir, bootstrap }) {
  const tool = path.join(repoRoot, "docs/thesis-experiments/tools/exp01/score.mjs");
  const r = spawnSync(
    process.execPath,
    [tool, "--corpus", corpus, "--predictions", predictionsDir, "--out", outDir, "--bootstrap", String(bootstrap)],
    { cwd: repoRoot, encoding: "utf8" },
  );
  const summaryPath = path.join(outDir, "summary.json");
  const summary = fs.existsSync(summaryPath) ? JSON.parse(fs.readFileSync(summaryPath, "utf8")) : null;
  return { exitCode: r.status, log: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim(), summary };
}

// Main entry. All side-effecting dependencies are injectable for tests.
export function runExperiment(options = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const corpus = path.resolve(options.corpus ?? DEFAULT_CORPUS);
  const dataRoot = path.resolve(options.dataRoot ?? DEFAULT_DATA_ROOT);
  const repeat = options.repeat ?? 2;
  const doScore = options.score ?? true;
  const allowDirty = options.allowDirty ?? false;
  const manifestChecks = options.manifestChecks ?? (() => defaultManifestChecks(repoRoot));
  const gitInfoFn = options.gitInfo ?? (() => defaultGitInfo(repoRoot));
  const buildCheck = options.buildCheck ?? (() => defaultBuildCheck(repoRoot));
  const loadAnalyzer = options.loadAnalyzer ?? (() => defaultLoadAnalyzer(repoRoot));
  const scorer = options.scorer ?? defaultScorer;
  const now = options.now ?? (() => new Date());
  const protectedRoots = options.protectedRoots ?? [path.join(repoRoot, "docs/benchmarks")];
  const log = options.log ?? (() => {});

  if (!Number.isInteger(repeat) || repeat < 2) {
    throw new Error("--repeat must be an integer >= 2");
  }
  const startedAt = now();
  const gitInfo = gitInfoFn();
  const runId = options.runId ?? defaultRunId(gitInfo, startedAt);
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new Error(`invalid run id ${JSON.stringify(runId)}`);
  }
  const runDir = path.join(dataRoot, runId);
  if (fs.existsSync(runDir)) {
    // Never overwrite or extend an existing run, failed ones included.
    throw new Error(`run directory already exists: ${runDir}`);
  }

  const record = {
    schema: RUN_SCHEMA,
    runId,
    runnerVersion: RUNNER_VERSION,
    ...PROTOCOL,
    startedAt: startedAt.toISOString(),
    finishedAt: null,
    headCommit: gitInfo.headCommit,
    branch: gitInfo.branch,
    dirty: gitInfo.dirty,
    args: options.args ?? null,
    corpus: path.relative(repoRoot, corpus).replace(/\\/g, "/") || corpus,
    repeat,
    comparedFields: COMPARED_FIELDS,
    status: null,
    statusReasons: [],
    preflight: {},
    cases: [],
    scoring: null,
    confirmatory: { eligible: false, reasons: [] },
  };
  const finish = (status, exitCode) => {
    record.status = status;
    record.finishedAt = now().toISOString();
    record.exitCode = exitCode;
    record.runJsonNote = "run.json is written last; files listed in cases[].files are not modified after writing.";
    writeNew(path.join(runDir, "run.json"), record);
    return { runId, runDir, record, exitCode };
  };

  // 1. Preflight. Nothing below calls the analyzer unless all of it passes.
  fs.mkdirSync(runDir, { recursive: true });
  writeNew(path.join(runDir, "env.json"), environment());
  const manifests = manifestChecks();
  record.preflight.manifests = manifests;
  const build = buildCheck();
  record.preflight.build = { ok: build.ok, problems: build.problems, buildHash: build.buildHash };
  record.analyzerBuildHash = build.buildHash;
  record.preflight.git = { dirty: gitInfo.dirty, allowDirty };
  const preflightReasons = [];
  if (manifests.length === 0 || manifests.some((m) => !m.ok)) {
    preflightReasons.push("MANIFEST_CHECK_FAILED");
  }
  if (!build.ok) {
    preflightReasons.push("ANALYZER_BUILD_STALE_OR_MISSING");
  }
  if (gitInfo.dirty === null) {
    preflightReasons.push("GIT_STATE_UNKNOWN");
  } else if (gitInfo.dirty && !allowDirty) {
    preflightReasons.push("WORKING_TREE_DIRTY");
  }
  if (gitInfo.dirty) {
    writeNew(path.join(runDir, "git-status.txt"), `${gitInfo.porcelain}\n`);
    writeNew(path.join(runDir, "git-diff.patch"), gitInfo.diff ?? "");
  }
  if (preflightReasons.length > 0) {
    record.statusReasons = preflightReasons;
    record.confirmatory.reasons = preflightReasons;
    log(`preflight failed: ${preflightReasons.join(", ")}; analyzer not run`);
    return finish("aborted", 3);
  }
  const protectedBefore = Object.fromEntries(protectedRoots.map((r) => [r, hashTree(r)]));

  // 2. Cases.
  let caseDirs = listCaseDirs(corpus);
  if (options.cases) {
    const wanted = new Set(options.cases);
    const unknown = [...wanted].filter((id) => !caseDirs.some((d) => path.basename(d) === id));
    if (unknown.length > 0) {
      record.statusReasons = [`UNKNOWN_CASES:${unknown.join(",")}`];
      record.confirmatory.reasons = record.statusReasons;
      return finish("invalid", 4);
    }
    caseDirs = caseDirs.filter((d) => wanted.has(path.basename(d)));
  }
  const analyzer = loadAnalyzer();
  for (const caseDir of caseDirs) {
    record.cases.push(runCase({ analyzer, caseDir, corpus, runDir, repeat, record, repoRoot, log }));
  }

  const protectedAfter = Object.fromEntries(protectedRoots.map((r) => [r, hashTree(r)]));
  const protectedChanged = protectedRoots.filter((r) => stableStringify(protectedBefore[r]) !== stableStringify(protectedAfter[r]));
  record.protectedOutputs = protectedRoots.map((r) => ({
    root: path.relative(repoRoot, r).replace(/\\/g, "/"),
    files: Object.keys(protectedBefore[r]).length,
    unchanged: !protectedChanged.includes(r),
  }));

  const failed = record.cases.filter((c) => c.status !== "OK");
  const reasons = [];
  if (failed.length > 0) {
    reasons.push(`CASES_NOT_OK:${failed.map((c) => `${c.caseId}=${c.status}`).join(",")}`);
  }
  if (protectedChanged.length > 0) {
    reasons.push("PROTECTED_OUTPUTS_CHANGED");
  }
  if (caseDirs.length === 0) {
    reasons.push("NO_CASES");
  }
  if (reasons.length > 0) {
    record.statusReasons = reasons;
    record.scoring = { status: "NOT_RUN", reason: "run incomplete or invalid; partial runs are not scored" };
    record.confirmatory.reasons = reasons;
    return finish(protectedChanged.length > 0 ? "invalid" : "incomplete", 4);
  }

  // 3. Scoring (existing score.mjs, unchanged).
  const confirmReasons = [];
  if (options.cases) {
    confirmReasons.push("CASE_SUBSET");
  }
  if (gitInfo.dirty) {
    confirmReasons.push("DIRTY_WORKING_TREE");
  }
  const nondeterministic = record.cases.filter((c) => !c.checks.deterministic);
  if (nondeterministic.length > 0) {
    confirmReasons.push(`NONDETERMINISTIC:${nondeterministic.map((c) => c.caseId).join(",")}`);
  }
  const cacheMismatch = record.cases.filter((c) => !c.checks.cacheConsistent);
  if (cacheMismatch.length > 0) {
    confirmReasons.push(`CACHE_OFF_ON_MISMATCH:${cacheMismatch.map((c) => c.caseId).join(",")}`);
  }
  const libCases = record.cases.filter((c) => c.tsLibRelations.length > 0);
  if (libCases.length > 0) {
    // D11: pre-registered scoring is kept; unexpected TS lib relations require review first.
    confirmReasons.push(`D11_TS_LIB_RELATIONS_REVIEW_REQUIRED:${libCases.map((c) => c.caseId).join(",")}`);
  }
  if (doScore) {
    const scoreDir = path.join(runDir, "score");
    const s = scorer({
      repoRoot,
      corpus,
      predictionsDir: path.join(runDir, "predictions"),
      outDir: scoreDir,
      bootstrap: options.bootstrap ?? 10000,
    });
    const scoringStatus = s.summary?.scoringStatus ?? "MISSING_SUMMARY";
    record.scoring = {
      status: scoringStatus,
      exitCode: s.exitCode,
      scorerVersion: s.summary?.scorerVersion ?? null,
      blockedCases: s.summary?.blockedCases ?? [],
      outDir: "score/",
    };
    writeNew(path.join(runDir, "score-log.txt"), `${s.log ?? ""}\n`);
    if (scoringStatus !== "COMPLETE") {
      confirmReasons.push(`SCORING_${scoringStatus}`);
    }
    if (s.summary && s.summary.scorerVersion !== PROTOCOL.scorerVersion) {
      confirmReasons.push(`SCORER_VERSION_MISMATCH:${s.summary.scorerVersion}`);
    }
  } else {
    record.scoring = { status: "NOT_RUN", reason: "--no-score" };
    confirmReasons.push("NOT_SCORED");
  }
  record.confirmatory = { eligible: confirmReasons.length === 0, reasons: confirmReasons };
  return finish("completed", confirmReasons.length === 0 ? 0 : 5);
}

function runCase({ analyzer, caseDir, corpus, runDir, repeat, record, repoRoot, log }) {
  const prepared = prepareCaseInput(caseDir);
  const entry = {
    caseId: prepared.caseId,
    caseDir: path.relative(corpus, caseDir).replace(/\\/g, "/"),
    status: null,
    errors: [],
    warnings: [],
    inputHash: prepared.input?.inputHash ?? null,
    checks: null,
    hashes: {},
    events: {},
    tsLibRelations: [],
    files: {},
  };
  const fail = (status, errors, extra = {}) => {
    entry.status = status;
    entry.errors = errors;
    entry.files.failure = `failures/${entry.caseId}.json`;
    entry.files.failureSha256 = writeNew(path.join(runDir, "failures", `${entry.caseId}.json`), {
      schema: "exp01-failure/1",
      caseId: entry.caseId,
      status,
      errors,
      ...extra,
    });
    log(`${entry.caseId}: ${status}`);
    return entry;
  };
  if (!prepared.ok) {
    return fail("INVALID_INPUT", prepared.errors);
  }
  const input = prepared.input;
  const variants = [
    ...Array.from({ length: repeat }, (_, i) => ({ name: `off#${i + 1}`, cacheEnabled: false, clear: i === 0 })),
    { name: "on-cold", cacheEnabled: true, clear: true },
    { name: "on-warm", cacheEnabled: true, clear: false },
  ];
  const results = {};
  for (const v of variants) {
    try {
      if (v.clear && typeof analyzer.clearAnalyzerCaches === "function") {
        analyzer.clearAnalyzerCaches();
      }
      results[v.name] = analyzeOnce(analyzer, input, v.cacheEnabled);
    } catch (e) {
      return fail("ANALYZER_ERROR", [`${v.name}: ${e?.message ?? String(e)}`], { variant: v.name, stack: e?.stack ?? null });
    }
  }
  const primary = results["off#1"].output;
  const raw = {
    schema: RAW_SCHEMA,
    caseId: entry.caseId,
    fixtureRoot: caseDir,
    analyzerInput: {
      workspaceRoot: "<fixtureRoot>",
      activeFile: input.activeFileRel,
      languageId: input.languageId,
      filePaths: input.filePaths.map((f) => path.relative(caseDir, f).replace(/\\/g, "/")),
      cacheEnabled: false,
      variant: "off#1",
    },
    run: {
      runId: record.runId,
      runnerVersion: RUNNER_VERSION,
      headCommit: record.headCommit,
      dirty: record.dirty,
      preregistrationCommit: PROTOCOL.preregistrationCommit,
      evaluationToolCommit: PROTOCOL.evaluationToolCommit,
      scorerVersion: PROTOCOL.scorerVersion,
      analyzerBuildHash: record.analyzerBuildHash,
      node: process.version,
      platform: process.platform,
    },
    inputHash: input.inputHash,
    inputFiles: input.fileHashes,
    analyzerOutput: primary,
  };
  entry.files.raw = `predictions/${entry.caseId}.json`;
  entry.files.rawSha256 = writeNew(path.join(runDir, "predictions", `${entry.caseId}.json`), raw);

  for (const [name, r] of Object.entries(results)) {
    entry.hashes[name] = canonicalHashes(r.output, { fixtureRoot: caseDir, repoRoot });
    entry.events[name] = r.events;
  }
  const ref = entry.hashes["off#1"].semanticHash;
  const offNames = variants.filter((v) => !v.cacheEnabled).map((v) => v.name);
  const deterministic = offNames.every((n) => entry.hashes[n].semanticHash === ref);
  const cacheConsistent = ["on-cold", "on-warm"].every((n) => entry.hashes[n].semanticHash === ref);
  const warmHits = entry.events["on-warm"]["analyzer.sourceFileCache.hit"] ?? 0;
  entry.checks = {
    deterministic,
    orderStable: offNames.every((n) => entry.hashes[n].orderedHash === entry.hashes["off#1"].orderedHash),
    cacheConsistent,
    cacheHitPathExercised: warmHits > 0,
    warmSourceFileCacheHits: warmHits,
  };
  if (!entry.checks.cacheHitPathExercised) {
    entry.warnings.push("on-warm run reported no sourceFileCache.hit events; OFF/ON check did not exercise the hit path");
  }
  // Keep every differing repetition as evidence.
  for (const [name, r] of Object.entries(results)) {
    if (name !== "off#1" && entry.hashes[name].semanticHash !== ref) {
      entry.files[`repeat:${name}`] = writeNew(path.join(runDir, "repeats", `${entry.caseId}.${name.replace("#", "")}.json`), {
        schema: RAW_SCHEMA,
        caseId: entry.caseId,
        fixtureRoot: caseDir,
        variant: name,
        analyzerOutput: r.output,
      });
    }
  }

  const structure = validateAnalyzerOutput(primary);
  entry.warnings.push(...structure.warnings);
  entry.tsLibRelations = tsLibRelations(primary);
  if (structure.errors.length > 0) {
    entry.status = "INVALID_OUTPUT";
    entry.errors = structure.errors;
    log(`${entry.caseId}: INVALID_OUTPUT`);
    return entry;
  }
  entry.status = "OK";
  log(`${entry.caseId}: OK${deterministic ? "" : " (nondeterministic)"}${cacheConsistent ? "" : " (cache mismatch)"}`);
  return entry;
}

// ---------------------------------------------------------------------------
// CLI

export function parseArgs(argv) {
  const args = { runId: undefined, cases: undefined, repeat: 2, score: true, allowDirty: false, bootstrap: 10000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) {
        throw new Error(`${a} needs a value`);
      }
      return argv[++i];
    };
    if (a === "--run-id") {
      args.runId = next();
    } else if (a === "--cases") {
      args.cases = next().split(",").map((s) => s.trim()).filter(Boolean);
    } else if (a === "--repeat") {
      args.repeat = Number(next());
    } else if (a === "--bootstrap") {
      args.bootstrap = Number(next());
    } else if (a === "--no-score") {
      args.score = false;
    } else if (a === "--allow-dirty") {
      args.allowDirty = true;
    } else {
      throw new Error(`unknown argument ${a}`);
    }
  }
  return args;
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exitCode = 2;
    return;
  }
  let result;
  try {
    result = runExperiment({ ...args, args: process.argv.slice(2), log: (m) => console.log(m) });
  } catch (e) {
    console.error(e.message);
    process.exitCode = 2;
    return;
  }
  const r = result.record;
  console.log(`run ${r.runId}: status ${r.status}${r.statusReasons.length ? ` (${r.statusReasons.join("; ")})` : ""}`);
  console.log(`scoring: ${r.scoring?.status ?? "NOT_RUN"}`);
  console.log(
    r.confirmatory.eligible
      ? "confirmatory: ELIGIBLE"
      : `confirmatory: NOT ELIGIBLE — do not report these numbers as confirmatory (${r.confirmatory.reasons.join("; ")})`,
  );
  console.log(`record: ${path.relative(REPO_ROOT, path.join(result.runDir, "run.json"))}`);
  process.exitCode = result.exitCode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
