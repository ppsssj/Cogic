#!/usr/bin/env node
// EXP-01 runner (P1-B; 1.2 = P1-H post-hoc amended protocol).
//
// Runs the compiled Cogic analyzer (out/analyzer) on every EXP-01 fixture and stores the
// raw output as exp01-raw/1 under docs/thesis-experiments/data/exp-01/<run-id>/.
// It never edits GT, fixtures, manifests or the scorer, and never overwrites a run.
//
// Order of a run (fail-closed at every step):
//   1. preflight: GT manifest + evaluation manifest r2 checks, pinned r2 hash, scorer module
//      version, analyzer build freshness, git dirty state, run directory must not exist.
//      Any failure -> analyzer is not called.
//   2. per case: validate fixture input, then analyze
//        off#1..off#N  cacheEnabled: false        (determinism)
//        on-cold, on-warm  cacheEnabled: true     (cache OFF/ON consistency, warm = hit path)
//      validate GraphPayload structure, flag TS lib endpoints (D11), hash inputs/outputs.
//   3. scoring with tools/exp01/score.mjs only when every case is OK.
//   4. run.json records status, the technical gate result (confirmatory.eligible) and the research
//      status. Runner 1.2 runs the POST_HOC_AMENDED protocol (scorer 1.2, P1-G): even when every
//      technical gate passes, the result is not a pre-registered confirmatory result.
//      Analyzer identity with the baseline commit (src trees, compiled output, TypeScript,
//      package files) is checked; a different analyzer cannot pass the gate.
//
// Usage (repository root, after `npm run compile`):
//   node docs/thesis-experiments/tools/exp01-run.mjs [--run-id <id>] [--cases <id,id>]
//        [--repeat 2] [--bootstrap 10000] [--no-score] [--allow-dirty]
//   --bootstrap: non-negative integer; only the pre-registered 10000 can be confirmatory.
//
// Exit codes: 0 all technical gates passed, 2 usage error, 3 preflight failed,
//             4 run incomplete or invalid, 5 run complete but a technical gate failed.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
// The scorer module version is only compared against the pinned PROTOCOL.scorerVersion; it never
// defines what the runner accepts (runner 1.1 took it from lib.mjs, see P1-G §12).
import { SCORER_VERSION as SCORER_MODULE_VERSION, listCaseDirs } from "./exp01/lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "../../..");
export const RUNNER_VERSION = "exp01-runner/1.2";
export const RAW_SCHEMA = "exp01-raw/1";
export const RUN_SCHEMA = "exp01-run/1";

// Fixed research identifiers. Pre-registered (P1-A, P1-A-R1) values are kept as they were; the
// amendment (P1-G scorer 1.2, P1-H runner 1.2) is recorded next to them, never in their place.
export const PROTOCOL = {
  experiment: "EXP-01",
  gtVersion: 1,
  preregistrationCommit: "41bbe19434b4d284c6368b5fb5158cf1a5dbdf1e",
  evaluationToolCommit: "ae82bfbf0e26b7cba67e40af2b1f0a1fe89b81ca",
  evaluationProtocol: "POST_HOC_AMENDED",
  amendmentReason: "EXTERNAL_NODE_KEY_COLLISION",
  // Pinned. A scorer reporting any other version fails the gate.
  scorerVersion: "exp01-scorer/1.2",
  scorerAmendmentCommit: "52ff632dacd14850d835604f80f9b3b4f4b916cc",
  gtManifest: "docs/thesis-experiments/fixtures/exp-01/gt-manifest.json",
  evaluationManifest: "docs/thesis-experiments/fixtures/exp-01/eval-manifest.r2.json",
  // SHA-256 of the LF-normalized r2 file (same normalization as manifest.mjs).
  evaluationManifestSha256: "cb7bfd62f86da7e374d1c768172386357c9838621ee71388bc4bcfddc38e72b2",
  d11Decision: "D11_KEEP_PRE_REGISTERED_SCORING",
  // P0 exp-01 §9: cluster bootstrap with 10,000 resamples. Other values are diagnostic only.
  bootstrapResamples: 10000,
};

// Research status of every runner 1.2 run. confirmatory.eligible is a technical execution gate only.
export const RESEARCH_STATUS = "POST_HOC_AMENDED_EVALUATION";

// Analyzer measured by the first EXP-01 runs (exp01-20261029-0651-43ace0f-50587 baseline,
// exp01-20261029-0636-43ace0f replication). Git object ids at that commit, the compiled output hash
// recorded by both runs (defaultBuildCheck) and the TypeScript version in their env.json.
export const ANALYZER_BASELINE = {
  commit: "43ace0fdfdf442d7871c3ef4a92d73b28f1b5e77",
  srcAnalyzerTree: "33f97d7bb566937a0ea6e70759e1464c53bfde60",
  srcSharedTree: "110f25582a4420b023f2a1d47cce1d3eb888ef23",
  packageJsonBlob: "2374e831679e8b4dcc12b85c10f9d82b0bb85b08",
  packageLockBlob: "eda5350ee58cd0689e2931e7b710da600b0ffe9d",
  tsconfigBlob: "8f51e5eb12e5c5fe259e0db25da8675533307de4",
  analyzerBuildHash: "958dbf677b6085ddf478265b3cc2b64c5fb1452bf28cfb4c255ed5ef00566270",
  typescript: "5.9.3",
};

// Accepts a non-negative integer. 0 (no bootstrap CI) is allowed for diagnostic runs only.
export function validateBootstrap(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new Error(`--bootstrap must be a non-negative integer, got ${JSON.stringify(String(value))}`);
  }
  return value;
}

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

// Runner 1.2 checks the GT manifest and evaluation manifest r2. r1 is kept in the repository but
// describes scorer 1.1 and is not used.
export function defaultManifestChecks(repoRoot = REPO_ROOT) {
  const tool = path.join(repoRoot, "docs/thesis-experiments/tools/exp01/manifest.mjs");
  const commands = [
    ["--check", "--scope", "gt"],
    ["--check", "--manifest", PROTOCOL.evaluationManifest],
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

export function sha256Lf(file) {
  return sha256(Buffer.from(fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n"), "utf8"));
}

// Pinned protocol files (P1-H): the r2 file itself is not covered by any manifest, so its content is
// pinned here; the scorer module must report the pinned scorer version.
export function defaultProtocolCheck(repoRoot = REPO_ROOT) {
  const problems = [];
  const manifestPath = path.join(repoRoot, PROTOCOL.evaluationManifest);
  let evaluationManifestSha256 = null;
  try {
    evaluationManifestSha256 = sha256Lf(manifestPath);
  } catch {
    problems.push("EVAL_MANIFEST_MISSING");
  }
  if (evaluationManifestSha256 && evaluationManifestSha256 !== PROTOCOL.evaluationManifestSha256) {
    problems.push("EVAL_MANIFEST_HASH_MISMATCH");
  }
  if (SCORER_MODULE_VERSION !== PROTOCOL.scorerVersion) {
    problems.push(`SCORER_MODULE_VERSION_MISMATCH:${SCORER_MODULE_VERSION}`);
  }
  return {
    ok: problems.length === 0,
    problems,
    evaluationManifest: PROTOCOL.evaluationManifest,
    evaluationManifestSha256,
    scorerModuleVersion: SCORER_MODULE_VERSION,
  };
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

function installedTypescript(repoRoot) {
  const require = createRequire(import.meta.url);
  try {
    return require(path.join(repoRoot, "node_modules/typescript/package.json")).version;
  } catch {
    return null;
  }
}

// Compares the analyzer of this checkout with ANALYZER_BASELINE. Git ids are taken from HEAD, so a
// dirty tree (already non-confirmatory) is not reflected here. Unknown values count as mismatches.
export function defaultAnalyzerIdentity({ repoRoot = REPO_ROOT, buildHash = null } = {}) {
  const current = {
    headCommit: git(["rev-parse", "HEAD"], repoRoot),
    srcAnalyzerTree: git(["rev-parse", "HEAD:src/analyzer"], repoRoot),
    srcSharedTree: git(["rev-parse", "HEAD:src/shared"], repoRoot),
    packageJsonBlob: git(["rev-parse", "HEAD:package.json"], repoRoot),
    packageLockBlob: git(["rev-parse", "HEAD:package-lock.json"], repoRoot),
    tsconfigBlob: git(["rev-parse", "HEAD:tsconfig.json"], repoRoot),
    analyzerBuildHash: buildHash,
    typescript: installedTypescript(repoRoot),
  };
  return compareAnalyzerIdentity(current);
}

export function compareAnalyzerIdentity(current) {
  const fields = ["srcAnalyzerTree", "srcSharedTree", "packageJsonBlob", "packageLockBlob", "tsconfigBlob", "analyzerBuildHash", "typescript"];
  const mismatches = fields.filter((f) => !current[f] || current[f] !== ANALYZER_BASELINE[f]);
  return {
    baselineCommit: ANALYZER_BASELINE.commit,
    baseline: { ...ANALYZER_BASELINE },
    current,
    mismatches,
    identical: mismatches.length === 0,
    note: "Same analyzer implementation as the baseline commit; the HEAD commit itself differs (runner/scorer changes).",
  };
}

// npm is not used by the run; its version is recorded only. A failure is recorded as null, never guessed.
export function defaultNpmVersion() {
  // Fixed command string (no user input); a shell is needed on Windows, where npm is npm.cmd.
  const r = spawnSync("npm --version", { encoding: "utf8", shell: true, timeout: 60000 });
  const out = String(r.stdout ?? "").trim();
  if (r.status === 0 && /^\d+\.\d+\.\d+\S*$/.test(out)) {
    return { version: out, error: null };
  }
  return { version: null, error: r.error?.message ?? `exit ${r.status}: ${String(r.stderr ?? "").trim().slice(0, 200)}` };
}

export function toolHashes(repoRoot = REPO_ROOT) {
  const files = [
    "docs/thesis-experiments/tools/exp01-run.mjs",
    "docs/thesis-experiments/tools/exp01/lib.mjs",
    "docs/thesis-experiments/tools/exp01/score.mjs",
    "docs/thesis-experiments/tools/exp01/manifest.mjs",
    PROTOCOL.gtManifest,
    PROTOCOL.evaluationManifest,
  ];
  return Object.fromEntries(
    files.map((f) => {
      try {
        return [f, sha256Lf(path.join(repoRoot, f))];
      } catch {
        return [f, null];
      }
    }),
  );
}

export function defaultLoadAnalyzer(repoRoot = REPO_ROOT) {
  const require = createRequire(import.meta.url);
  return require(path.join(repoRoot, "out", "analyzer"));
}

export function environment({ repoRoot = REPO_ROOT, gitInfo = null, npmVersion = defaultNpmVersion } = {}) {
  const npm = npmVersion();
  return {
    os: { platform: process.platform, release: os.release(), version: os.version?.() ?? null, arch: process.arch },
    cpu: { model: os.cpus()[0]?.model ?? null, logicalCores: os.cpus().length },
    memory: { totalBytes: os.totalmem(), freeBytesAtStart: os.freemem() },
    node: process.version,
    v8: process.versions.v8,
    typescript: installedTypescript(repoRoot),
    npm: npm.version,
    npmError: npm.error,
    execArgv: process.execArgv,
    gitHead: gitInfo?.headCommit ?? null,
    runnerVersion: RUNNER_VERSION,
    // SHA-256 of LF-normalized text (same as manifest.mjs).
    toolHashes: toolHashes(repoRoot),
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
  let summary = null;
  let summaryError = null;
  if (fs.existsSync(summaryPath)) {
    try {
      summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
    } catch (e) {
      summaryError = `summary.json unreadable: ${e.message}`;
    }
  }
  return {
    exitCode: r.status,
    signal: r.signal ?? null,
    spawnError: r.error ? String(r.error.message ?? r.error) : null,
    log: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim(),
    summary,
    summaryError,
  };
}

// Confirmatory gate for one scorer result (P1-B-R1). All conditions must hold:
// exit code 0, summary present, scoringStatus COMPLETE, scorerVersion equal to the pinned
// PROTOCOL.scorerVersion (exp01-scorer/1.2 in runner 1.2).
export function scoringGate(s) {
  const reasons = [];
  if (s.exitCode !== 0) {
    reasons.push(`SCORER_EXIT_${s.exitCode ?? "NULL"}`);
  }
  if (!s.summary) {
    reasons.push("SCORING_MISSING_SUMMARY");
  } else {
    if (s.summary.scoringStatus !== "COMPLETE") {
      reasons.push(`SCORING_${s.summary.scoringStatus ?? "UNKNOWN"}`);
    }
    if (s.summary.scorerVersion !== PROTOCOL.scorerVersion) {
      reasons.push(`SCORER_VERSION_MISMATCH:${s.summary.scorerVersion}`);
    }
  }
  return reasons;
}

// Cache hit-path claim (P1-B-R1), kept separate from accuracy confirmatory eligibility.
export function cacheHitPathClaim(cases) {
  if (cases.length === 0 || cases.some((c) => c.status !== "OK" || !c.checks)) {
    return { status: "NOT_EVALUATED", casesWithoutHits: [], mismatchedCases: [] };
  }
  const mismatchedCases = cases.filter((c) => !c.checks.cacheConsistent).map((c) => c.caseId);
  const casesWithoutHits = cases.filter((c) => !c.checks.cacheHitPathExercised).map((c) => c.caseId);
  const status = mismatchedCases.length > 0 ? "MISMATCH" : casesWithoutHits.length > 0 ? "NOT_VERIFIED_NO_HITS" : "VERIFIED";
  return { status, casesWithoutHits, mismatchedCases };
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
  const protocolCheck = options.protocolCheck ?? (() => defaultProtocolCheck(repoRoot));
  const analyzerIdentity = options.analyzerIdentity ?? ((build) => defaultAnalyzerIdentity({ repoRoot, buildHash: build.buildHash }));
  const environmentFn = options.environment ?? ((git) => environment({ repoRoot, gitInfo: git }));
  const now = options.now ?? (() => new Date());
  const protectedRoots = options.protectedRoots ?? [path.join(repoRoot, "docs/benchmarks")];
  const log = options.log ?? (() => {});

  if (!Number.isInteger(repeat) || repeat < 2) {
    throw new Error("--repeat must be an integer >= 2");
  }
  const bootstrap = validateBootstrap(options.bootstrap ?? PROTOCOL.bootstrapResamples);
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
    researchStatus: RESEARCH_STATUS,
    preregisteredConfirmatory: false,
    analyzerBaselineCommit: ANALYZER_BASELINE.commit,
    startedAt: startedAt.toISOString(),
    finishedAt: null,
    headCommit: gitInfo.headCommit,
    branch: gitInfo.branch,
    dirty: gitInfo.dirty,
    args: options.args ?? null,
    corpus: path.relative(repoRoot, corpus).replace(/\\/g, "/") || corpus,
    repeat,
    bootstrap,
    comparedFields: COMPARED_FIELDS,
    status: null,
    statusReasons: [],
    preflight: {},
    cases: [],
    scoring: null,
    cacheHitPath: null,
    analyzerIdentity: null,
    confirmatory: { eligible: false, reasons: [] },
  };
  // confirmatory.eligible is kept for record compatibility; in runner 1.2 it is the technical gate.
  const setConfirmatory = (reasons) => {
    record.confirmatory = {
      eligible: reasons.length === 0,
      reasons,
      scope: "TECHNICAL_EXECUTION_GATE",
      note: "eligible=true means every runner gate passed under the POST_HOC_AMENDED protocol. It is not a pre-registered confirmatory result.",
    };
  };
  setConfirmatory(["NOT_FINISHED"]);
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
  writeNew(path.join(runDir, "env.json"), environmentFn(gitInfo));
  const manifests = manifestChecks();
  record.preflight.manifests = manifests;
  const protocol = protocolCheck();
  record.preflight.protocol = protocol;
  record.evaluationManifestSha256 = protocol.evaluationManifestSha256 ?? null;
  const build = buildCheck();
  record.preflight.build = { ok: build.ok, problems: build.problems, buildHash: build.buildHash };
  record.analyzerBuildHash = build.buildHash;
  record.analyzerIdentity = analyzerIdentity(build);
  record.analyzerSourceTrees = {
    "src/analyzer": record.analyzerIdentity.current?.srcAnalyzerTree ?? null,
    "src/shared": record.analyzerIdentity.current?.srcSharedTree ?? null,
  };
  record.preflight.git = { dirty: gitInfo.dirty, allowDirty };
  const preflightReasons = [];
  if (manifests.length === 0 || manifests.some((m) => !m.ok)) {
    preflightReasons.push("MANIFEST_CHECK_FAILED");
  }
  if (!protocol.ok) {
    preflightReasons.push(...protocol.problems.map((p) => `PROTOCOL_CHECK_FAILED:${p}`));
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
    setConfirmatory(preflightReasons);
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
      setConfirmatory(record.statusReasons);
      return finish("invalid", 4);
    }
    caseDirs = caseDirs.filter((d) => wanted.has(path.basename(d)));
  }
  let analyzer;
  try {
    analyzer = loadAnalyzer();
  } catch (e) {
    record.statusReasons = ["ANALYZER_LOAD_FAILED"];
    setConfirmatory(record.statusReasons);
    record.analyzerLoadError = { message: e?.message ?? String(e), stack: e?.stack ?? null };
    return finish("aborted", 3);
  }
  for (const caseDir of caseDirs) {
    record.cases.push(runCase({ analyzer, caseDir, corpus, runDir, repeat, record, repoRoot, log }));
  }
  record.cacheHitPath = cacheHitPathClaim(record.cases);

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
    setConfirmatory(reasons);
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
  if (bootstrap !== PROTOCOL.bootstrapResamples) {
    confirmReasons.push(`BOOTSTRAP_NOT_PREREGISTERED:${bootstrap}`);
  }
  if (!record.analyzerIdentity?.identical) {
    // Not the analyzer measured by the baseline run: not a valid comparison target.
    confirmReasons.push(`ANALYZER_NOT_IDENTICAL_TO_BASELINE:${(record.analyzerIdentity?.mismatches ?? ["unknown"]).join(",")}`);
  }
  if (doScore) {
    const scoreDir = path.join(runDir, "score");
    let s;
    try {
      s = scorer({ repoRoot, corpus, predictionsDir: path.join(runDir, "predictions"), outDir: scoreDir, bootstrap });
    } catch (e) {
      s = { exitCode: null, log: "", summary: null, error: { message: e?.message ?? String(e), stack: e?.stack ?? null } };
    }
    const gate = s.error ? ["SCORER_ERROR"] : scoringGate(s);
    record.scoring = {
      status: s.error ? "SCORER_ERROR" : (s.summary?.scoringStatus ?? "MISSING_SUMMARY"),
      exitCode: s.exitCode ?? null,
      signal: s.signal ?? null,
      spawnError: s.spawnError ?? null,
      summaryError: s.summaryError ?? null,
      error: s.error ?? null,
      scorerVersion: s.summary?.scorerVersion ?? null,
      blockedCases: s.summary?.blockedCases ?? [],
      gateFailures: gate,
      logTail: String(s.log ?? "").slice(-4000),
      outDir: "score/",
    };
    writeNew(path.join(runDir, "score-log.txt"), `${s.log ?? ""}\n`);
    confirmReasons.push(...gate);
  } else {
    record.scoring = { status: "NOT_RUN", reason: "--no-score" };
    confirmReasons.push("NOT_SCORED");
  }
  setConfirmatory(confirmReasons);
  return finish("completed", confirmReasons.length === 0 ? 0 : 5);
}

function runCase(ctx) {
  const holder = {};
  try {
    return runCaseInner({ ...ctx, holder });
  } catch (e) {
    // Runner-side failure (e.g. unserializable output). Files already written stay, and the
    // partial entry keeps the completed variants and saved file hashes.
    const caseId = path.basename(ctx.caseDir);
    const entry = holder.entry ?? {
      caseId,
      caseDir: path.relative(ctx.corpus, ctx.caseDir).replace(/\\/g, "/"),
      files: {},
      warnings: [],
      tsLibRelations: [],
      completedVariants: [],
    };
    entry.status = "RUNNER_ERROR";
    entry.errors = [e?.message ?? String(e)];
    entry.failedVariant = holder.currentVariant ?? null;
    entry.stack = e?.stack ?? null;
    return entry;
  }
}

function runCaseInner({ analyzer, caseDir, corpus, runDir, repeat, record, repoRoot, log, holder }) {
  const prepared = prepareCaseInput(caseDir);
  const entry = {
    caseId: prepared.caseId,
    caseDir: path.relative(corpus, caseDir).replace(/\\/g, "/"),
    status: null,
    errors: [],
    warnings: [],
    inputHash: prepared.input?.inputHash ?? null,
    completedVariants: [],
    failedVariant: null,
    checks: null,
    hashes: {},
    events: {},
    tsLibRelations: [],
    files: {},
  };
  holder.entry = entry;
  const fail = (status, errors, extra = {}) => {
    entry.status = status;
    entry.errors = errors;
    entry.files.failure = `failures/${entry.caseId}.json`;
    entry.files.failureSha256 = writeNew(path.join(runDir, "failures", `${entry.caseId}.json`), {
      schema: "exp01-failure/1",
      caseId: entry.caseId,
      status,
      errors,
      completedVariants: entry.completedVariants,
      savedFiles: { ...entry.files },
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
  const analyzerInput = (v) => ({
    workspaceRoot: "<fixtureRoot>",
    activeFile: input.activeFileRel,
    languageId: input.languageId,
    filePaths: input.filePaths.map((f) => path.relative(caseDir, f).replace(/\\/g, "/")),
    cacheEnabled: v.cacheEnabled,
    variant: v.name,
  });
  const runInfo = {
    runId: record.runId,
    runnerVersion: RUNNER_VERSION,
    headCommit: record.headCommit,
    dirty: record.dirty,
    preregistrationCommit: PROTOCOL.preregistrationCommit,
    evaluationToolCommit: PROTOCOL.evaluationToolCommit,
    scorerVersion: PROTOCOL.scorerVersion,
    evaluationProtocol: PROTOCOL.evaluationProtocol,
    analyzerBaselineCommit: ANALYZER_BASELINE.commit,
    analyzerBuildHash: record.analyzerBuildHash,
    node: process.version,
    platform: process.platform,
  };
  // Each variant is written as soon as it returns: off#1 to predictions/ (scored),
  // the others to repeats/ (evidence). A later failure cannot remove earlier files.
  const results = {};
  for (const v of variants) {
    holder.currentVariant = v.name;
    let r;
    try {
      if (v.clear && typeof analyzer.clearAnalyzerCaches === "function") {
        analyzer.clearAnalyzerCaches();
      }
      r = analyzeOnce(analyzer, input, v.cacheEnabled);
    } catch (e) {
      entry.failedVariant = v.name;
      return fail("ANALYZER_ERROR", [`${v.name}: ${e?.message ?? String(e)}`], { failedVariant: v.name, stack: e?.stack ?? null });
    }
    const doc = {
      schema: RAW_SCHEMA,
      caseId: entry.caseId,
      fixtureRoot: caseDir,
      analyzerInput: analyzerInput(v),
      run: runInfo,
      inputHash: input.inputHash,
      inputFiles: input.fileHashes,
      analyzerOutput: r.output,
    };
    if (v.name === "off#1") {
      entry.files.raw = `predictions/${entry.caseId}.json`;
      entry.files.rawSha256 = writeNew(path.join(runDir, entry.files.raw), doc);
    } else {
      const rel = `repeats/${entry.caseId}.${v.name.replace("#", "")}.json`;
      entry.files[`variant:${v.name}`] = rel;
      entry.files[`variant:${v.name}:sha256`] = writeNew(path.join(runDir, rel), doc);
    }
    results[v.name] = r;
    entry.completedVariants.push(v.name);
    entry.events[v.name] = r.events;
  }
  holder.currentVariant = null;
  const primary = results["off#1"].output;

  for (const [name, r] of Object.entries(results)) {
    entry.hashes[name] = canonicalHashes(r.output, { fixtureRoot: caseDir, repoRoot });
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
      const v = next();
      if (!/^\d+$/.test(v)) {
        throw new Error(`--bootstrap must be a non-negative integer, got ${JSON.stringify(v)}`);
      }
      args.bootstrap = validateBootstrap(Number(v));
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
  console.log(`cache hit path: ${r.cacheHitPath?.status ?? "NOT_EVALUATED"}`);
  console.log(
    r.confirmatory.eligible
      ? "technical gates: PASSED"
      : `technical gates: NOT PASSED — do not report these numbers (${r.confirmatory.reasons.join("; ")})`,
  );
  console.log(`research status: ${r.researchStatus} (scorer ${r.scorerVersion}); not a pre-registered confirmatory result`);
  console.log(`analyzer identity with ${ANALYZER_BASELINE.commit.slice(0, 7)}: ${r.analyzerIdentity?.identical ? "IDENTICAL" : `NOT IDENTICAL (${(r.analyzerIdentity?.mismatches ?? []).join(", ")})`}`);
  console.log(`record: ${path.relative(REPO_ROOT, path.join(result.runDir, "run.json"))}`);
  process.exitCode = result.exitCode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
