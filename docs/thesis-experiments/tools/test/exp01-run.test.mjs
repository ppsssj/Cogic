// Unit tests for the EXP-01 runner (P1-B; runner 1.2 = P1-H).
// Everything here is synthetic: temporary fixture corpora, a mock analyzer and stubbed
// git/build checks. The real Cogic analyzer is never loaded and the EXP-01 corpus is never analyzed.
// Run: node --test docs/thesis-experiments/tools/test/exp01-run.test.mjs

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  ANALYZER_BASELINE,
  PROTOCOL,
  RESEARCH_STATUS,
  RUNNER_VERSION,
  cacheHitPathClaim,
  canonicalHashes,
  compareAnalyzerIdentity,
  defaultAnalyzerIdentity,
  defaultBuildCheck,
  defaultNpmVersion,
  defaultProtocolCheck,
  defaultScorer,
  defaultManifestChecks,
  environment,
  parseArgs,
  prepareCaseInput,
  runExperiment,
  sha256,
  tsLibRelations,
  validateAnalyzerOutput,
  validateBootstrap,
} from "../exp01-run.mjs";
import { loadPrediction } from "../exp01/score.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const realCorpus = path.resolve(here, "../../fixtures/exp-01");

// --- synthetic corpus -------------------------------------------------------
const MAIN = "export function a() {\n  return b();\n}\nexport function b() {\n  return 1;\n}\n";

function gtFor(caseId) {
  return {
    schema: "exp01-gt/1",
    caseId,
    gtVersion: 1,
    activeFile: "main.ts",
    nodes: [
      { id: "file", type: "file", file: "main.ts" },
      { id: "a", type: "callable", file: "main.ts", line: 1, name: "a" },
      { id: "b", type: "callable", file: "main.ts", line: 4, name: "b" },
    ],
    relations: [{ id: "R1", kind: "calls", source: "a", target: "b", pattern: "CALL-LOCAL-FN", gtStatus: "determinate", evidence: ["main.ts:2"] }],
    negatives: [],
    excludedSites: [],
  };
}

function writeCase(corpus, caseId, overrides = {}) {
  const dir = path.join(corpus, "calls", caseId);
  fs.mkdirSync(dir, { recursive: true });
  const caseJson = { schema: "exp01-case/1", caseId, category: "calls", activeFile: "main.ts", ...overrides.case };
  fs.writeFileSync(path.join(dir, "case.json"), JSON.stringify(caseJson));
  if (overrides.main !== null) {
    fs.writeFileSync(path.join(dir, overrides.mainName ?? "main.ts"), overrides.main ?? MAIN);
  }
  if (overrides.tsconfig !== null) {
    fs.writeFileSync(path.join(dir, "tsconfig.json"), overrides.tsconfig ?? JSON.stringify({ compilerOptions: { strict: true }, include: ["**/*.ts"] }));
  }
  fs.writeFileSync(path.join(dir, "expected.json"), JSON.stringify(gtFor(caseId)));
  return dir;
}

function makeEnv(caseIds = ["t01-ok", "t02-ok"]) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "exp01-run-"));
  const corpus = path.join(tmp, "corpus");
  fs.mkdirSync(corpus);
  fs.copyFileSync(path.join(realCorpus, "catalog.csv"), path.join(corpus, "catalog.csv"));
  for (const id of caseIds) {
    writeCase(corpus, id);
  }
  const protectedDir = path.join(tmp, "protected");
  fs.mkdirSync(protectedDir);
  fs.writeFileSync(path.join(protectedDir, "results.json"), "{}");
  return { tmp, corpus, dataRoot: path.join(tmp, "data"), protectedDir, cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

// --- mock analyzer ------------------------------------------------------------
// Builds a Cogic-like GraphPayload for main.ts: a() calls b().
function mockAnalyzer(behaviour = {}) {
  const state = { calls: [], sinceClear: 0, total: 0 };
  return {
    state,
    clearAnalyzerCaches() {
      state.sinceClear = 0;
    },
    analyzeWorkspaceActive(args) {
      state.calls.push(args);
      state.total += 1;
      state.perRoot = state.perRoot ?? {};
      const nth = (state.perRoot[args.workspaceRoot] = (state.perRoot[args.workspaceRoot] ?? 0) + 1);
      const warm = args.cacheEnabled && state.sinceClear > 0;
      state.sinceClear += 1;
      if (args.cacheEnabled) {
        args.debug?.(warm && !behaviour.noHits ? "analyzer.sourceFileCache.hit" : "analyzer.sourceFileCache.miss");
      }
      if (behaviour.failAtCall === nth) {
        throw new Error(`synthetic failure at call ${nth}`);
      }
      if (behaviour.throwFor && args.workspaceRoot.endsWith(behaviour.throwFor)) {
        throw new Error("synthetic analyzer failure");
      }
      if (behaviour.sideEffect) {
        behaviour.sideEffect();
      }
      const f = args.active.fileName;
      const node = (kind, line, name, pos) => ({
        id: `${kind}:${f}:${pos}`,
        kind,
        name,
        file: f,
        range: { start: { line, character: 0 }, end: { line, character: 1 } },
      });
      const nodes = [node("file", 0, "main.ts", 0), node("function", 0, "a", 7), node("function", 3, "b", 40)];
      if (behaviour.collide) {
        nodes.push(node("function", 0, "a2", 9));
      }
      const edges = [{ id: `calls:${nodes[1].id}->${nodes[2].id}@@@@`, kind: "calls", source: nodes[1].id, target: nodes[2].id, label: "b()" }];
      if (behaviour.nondeterministic) {
        nodes.push(node("function", 4, `n${state.total}`, 100 + state.total));
      }
      if (behaviour.cacheDiff && args.cacheEnabled) {
        edges.pop();
      }
      if (behaviour.tsLib) {
        const lib = { ...node("external", 10, "map", 5), id: "external:C:/x/node_modules/typescript/lib/lib.es5.d.ts:5", file: "C:/x/node_modules/typescript/lib/lib.es5.d.ts" };
        nodes.push(lib);
        edges.push({ id: `calls:${nodes[1].id}->${lib.id}@@@@`, kind: "calls", source: nodes[1].id, target: lib.id });
      }
      if (behaviour.badOutput) {
        edges.push({ id: "calls:x->missing@@@@", kind: "calls", source: nodes[1].id, target: "missing" });
      }
      if (behaviour.cyclicAtCall === nth) {
        const cyclic = { graph: { nodes, edges } };
        cyclic.self = cyclic;
        return cyclic;
      }
      return {
        imports: [],
        exports: [{ name: "a", kind: "function" }],
        calls: [],
        diagnostics: [],
        graph: { nodes: behaviour.shuffle ? [...nodes].reverse() : nodes, edges },
        trace: [],
        meta: { mode: "workspace", rootFiles: args.filePaths.length, usedTsconfig: behaviour.noTsconfig ? false : true, projectRoot: args.workspaceRoot },
      };
    },
  };
}

const CLEAN_GIT = () => ({ headCommit: "f".repeat(40), branch: "test", dirty: false, porcelain: "", diff: "" });
const BUILD_OK = () => ({ ok: true, problems: [], buildHash: "b".repeat(64), files: {} });
const MANIFEST_OK = () => [
  { command: "gt", ok: true, exitCode: 0, output: "manifest OK" },
  { command: "eval", ok: true, exitCode: 0, output: "manifest OK" },
];
const SCORER_COMPLETE = () => ({ exitCode: 0, log: "", summary: { scorerVersion: "exp01-scorer/1.2", scoringStatus: "COMPLETE", blockedCases: [] } });
// Runner 1.2: synthetic runs use the baseline analyzer identity unless a test overrides it, and a
// stub environment (the real environment(), npm included, is tested separately).
const { commit: _baselineCommit, ...BASELINE_FIELDS } = ANALYZER_BASELINE;
const IDENTITY_OK = () => compareAnalyzerIdentity({ headCommit: "f".repeat(40), ...BASELINE_FIELDS });
const ENV_STUB = (gitInfo) => ({ stub: true, gitHead: gitInfo?.headCommit ?? null });

function run(env, extra = {}) {
  const analyzer = extra.analyzer ?? mockAnalyzer(extra.behaviour);
  let loaded = 0;
  const result = runExperiment({
    corpus: env.corpus,
    dataRoot: env.dataRoot,
    runId: extra.runId ?? "test-run",
    manifestChecks: extra.manifestChecks ?? MANIFEST_OK,
    gitInfo: extra.gitInfo ?? CLEAN_GIT,
    buildCheck: extra.buildCheck ?? BUILD_OK,
    loadAnalyzer: () => {
      loaded += 1;
      return analyzer;
    },
    scorer: extra.scorer ?? SCORER_COMPLETE,
    protocolCheck: extra.protocolCheck,
    analyzerIdentity: extra.analyzerIdentity ?? IDENTITY_OK,
    environment: extra.environment ?? ENV_STUB,
    protectedRoots: [env.protectedDir],
    score: extra.score,
    cases: extra.cases,
    allowDirty: extra.allowDirty,
    bootstrap: extra.bootstrap ?? 10000,
  });
  return { ...result, analyzer, loaded: () => loaded };
}

const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));

// --- 1. preflight ------------------------------------------------------------
test("manifest check failure blocks the run before the analyzer is loaded", () => {
  const env = makeEnv();
  try {
    const failing = () => [
      { command: "gt", ok: true, exitCode: 0, output: "manifest OK" },
      { command: "eval", ok: false, exitCode: 1, output: "changed docs/thesis-experiments/tools/exp01/lib.mjs\nmanifest DRIFT (1)" },
    ];
    const r = run(env, { manifestChecks: failing });
    assert.equal(r.exitCode, 3);
    assert.equal(r.record.status, "aborted");
    assert.deepEqual(r.record.statusReasons, ["MANIFEST_CHECK_FAILED"]);
    assert.equal(r.loaded(), 0);
    assert.equal(r.analyzer.state.calls.length, 0);
    assert.equal(fs.existsSync(path.join(r.runDir, "predictions")), false);
    const saved = readJson(path.join(r.runDir, "run.json"));
    assert.equal(saved.preflight.manifests[1].output.includes("DRIFT"), true, "check output is preserved");
    assert.equal(saved.confirmatory.eligible, false);
  } finally {
    env.cleanup();
  }
});

test("stale build, dirty tree or unknown git state also block before analysis", () => {
  const env = makeEnv();
  try {
    const stale = run(env, { runId: "stale", buildCheck: () => ({ ok: false, problems: ["out/analyzer/analyze.js older than src"], buildHash: null }) });
    assert.deepEqual(stale.record.statusReasons, ["ANALYZER_BUILD_STALE_OR_MISSING"]);
    const dirty = run(env, { runId: "dirty", gitInfo: () => ({ ...CLEAN_GIT(), dirty: true, porcelain: " M src/x.ts", diff: "diff" }) });
    assert.deepEqual(dirty.record.statusReasons, ["WORKING_TREE_DIRTY"]);
    assert.ok(fs.existsSync(path.join(dirty.runDir, "git-diff.patch")));
    const unknown = run(env, { runId: "nogit", gitInfo: () => ({ headCommit: null, branch: null, dirty: null }) });
    assert.deepEqual(unknown.record.statusReasons, ["GIT_STATE_UNKNOWN"]);
    for (const r of [stale, dirty, unknown]) {
      assert.equal(r.exitCode, 3);
      assert.equal(r.loaded(), 0);
    }
  } finally {
    env.cleanup();
  }
});

test("real manifest checks pass on this checkout (no analyzer involved)", () => {
  const checks = defaultManifestChecks();
  assert.equal(checks.length, 2);
  for (const c of checks) {
    assert.equal(c.ok, true, `${c.command}\n${c.output}`);
  }
  assert.match(checks[0].command, /--scope gt/);
  assert.match(checks[1].command, /eval-manifest\.r2\.json/);
  assert.ok(checks.every((c) => !/eval-manifest\.r1\.json/.test(c.command)), "runner 1.2 never checks r1");
});

// --- 2. fixture input --------------------------------------------------------
test("invalid fixture inputs are rejected and never reach the analyzer", () => {
  const env = makeEnv(["t01-ok"]);
  try {
    writeCase(env.corpus, "t02-schema", { case: { schema: "exp01-case/0" } });
    writeCase(env.corpus, "t03-escape", { case: { activeFile: "../t01-ok/main.ts" } });
    writeCase(env.corpus, "t04-notsconfig", { tsconfig: null });
    writeCase(env.corpus, "t05-vue", { case: { activeFile: "App.vue" }, mainName: "App.vue" });
    writeCase(env.corpus, "t06-badjson", { tsconfig: "{ not json" });
    writeCase(env.corpus, "t07-missing", { case: { activeFile: "nope.ts" } });
    writeCase(env.corpus, "t08-idmismatch", { case: { caseId: "other" } });
    const r = run(env);
    const byId = Object.fromEntries(r.record.cases.map((c) => [c.caseDir.split("/").pop(), c]));
    assert.equal(byId["t01-ok"].status, "OK");
    for (const id of ["t02-schema", "t03-escape", "t04-notsconfig", "t05-vue", "t06-badjson", "t07-missing", "t08-idmismatch"]) {
      assert.equal(byId[id].status, "INVALID_INPUT", id);
      assert.ok(byId[id].errors.length > 0, id);
      assert.ok(fs.existsSync(path.join(r.runDir, byId[id].files.failure)), `${id}: failure record kept`);
    }
    const analyzedRoots = new Set(r.analyzer.state.calls.map((c) => path.basename(c.workspaceRoot)));
    assert.deepEqual([...analyzedRoots], ["t01-ok"]);
    assert.equal(r.exitCode, 4);
    assert.equal(r.record.status, "incomplete");
    assert.equal(r.record.scoring.status, "NOT_RUN");
    assert.equal(r.record.confirmatory.eligible, false);
  } finally {
    env.cleanup();
  }
});

test("analyzer input follows case.json, the active file and the fixture tsconfig directory", () => {
  const env = makeEnv(["t01-ok"]);
  try {
    const dir = path.join(env.corpus, "calls", "t01-ok");
    fs.mkdirSync(path.join(dir, "shims"));
    fs.writeFileSync(path.join(dir, "shims", "react.d.ts"), "export {};\n");
    const p = prepareCaseInput(dir);
    assert.equal(p.ok, true);
    assert.equal(p.input.activeAbs, path.join(dir, "main.ts"));
    assert.equal(p.input.languageId, "typescript");
    assert.equal(p.input.code, MAIN);
    assert.deepEqual(p.input.filePaths, [path.join(dir, "main.ts"), path.join(dir, "shims", "react.d.ts")]);
    const r = run(env);
    const call = r.analyzer.state.calls[0];
    assert.equal(call.workspaceRoot, dir);
    assert.equal(call.active.fileName, path.join(dir, "main.ts"));
    assert.deepEqual(r.analyzer.state.calls.map((c) => c.cacheEnabled), [false, false, true, true]);
  } finally {
    env.cleanup();
  }
});

// --- 3. raw results ----------------------------------------------------------
test("successful cases are stored as exp01-raw/1 and are readable by score.mjs", () => {
  const env = makeEnv();
  try {
    const r = run(env);
    assert.equal(r.exitCode, 0);
    assert.equal(r.record.status, "completed");
    assert.equal(r.record.confirmatory.eligible, true);
    for (const c of r.record.cases) {
      const file = path.join(r.runDir, c.files.raw);
      assert.equal(sha256(fs.readFileSync(file)), c.files.rawSha256, "recorded hash matches file");
      const raw = readJson(file);
      assert.equal(raw.schema, "exp01-raw/1");
      assert.equal(raw.caseId, c.caseId);
      assert.equal(raw.fixtureRoot, path.join(env.corpus, c.caseDir));
      assert.equal(raw.analyzerInput.cacheEnabled, false);
      assert.equal(raw.run.preregistrationCommit, "41bbe19434b4d284c6368b5fb5158cf1a5dbdf1e");
      assert.equal(raw.run.evaluationToolCommit, "ae82bfbf0e26b7cba67e40af2b1f0a1fe89b81ca");
      assert.equal(raw.run.scorerVersion, "exp01-scorer/1.2");
      assert.equal(raw.run.runnerVersion, "exp01-runner/1.2");
      assert.equal(raw.run.evaluationProtocol, "POST_HOC_AMENDED");
      assert.equal(raw.run.analyzerBaselineCommit, "43ace0fdfdf442d7871c3ef4a92d73b28f1b5e77");
      assert.equal(raw.run.headCommit, "f".repeat(40));
      assert.ok(raw.inputHash && raw.inputFiles["main.ts"]);
      assert.ok(Array.isArray(raw.analyzerOutput.graph.nodes));
      const pred = loadPrediction(raw, c.caseId);
      assert.equal(pred.relations.length, 1);
      assert.deepEqual(pred.malformed, []);
    }
    for (const f of ["run.json", "env.json"]) {
      assert.ok(fs.existsSync(path.join(r.runDir, f)), f);
    }
    const saved = readJson(path.join(r.runDir, "run.json"));
    assert.deepEqual(saved.comparedFields.slice(0, 2), ["graph.nodes", "graph.edges"]);
    assert.equal(saved.protectedOutputs[0].unchanged, true);
  } finally {
    env.cleanup();
  }
});

test("analyzer exceptions are recorded per case; the other cases still run", () => {
  const env = makeEnv();
  try {
    const r = run(env, { behaviour: { throwFor: "t02-ok" } });
    const bad = r.record.cases.find((c) => c.caseId === "t02-ok");
    assert.equal(bad.status, "ANALYZER_ERROR");
    const failure = readJson(path.join(r.runDir, bad.files.failure));
    assert.equal(failure.status, "ANALYZER_ERROR");
    assert.match(failure.errors[0], /synthetic analyzer failure/);
    assert.ok(failure.stack);
    assert.equal(r.record.cases.find((c) => c.caseId === "t01-ok").status, "OK");
    assert.equal(r.record.status, "incomplete");
    assert.equal(r.exitCode, 4);
    assert.match(r.record.statusReasons[0], /t02-ok=ANALYZER_ERROR/);
  } finally {
    env.cleanup();
  }
});

test("invalid GraphPayload marks the case INVALID_OUTPUT but keeps the raw output", () => {
  const env = makeEnv(["t01-ok"]);
  try {
    const r = run(env, { behaviour: { badOutput: true } });
    const c = r.record.cases[0];
    assert.equal(c.status, "INVALID_OUTPUT");
    assert.ok(c.errors.some((e) => e.includes("endpoint not in nodes")));
    assert.ok(fs.existsSync(path.join(r.runDir, c.files.raw)));
    assert.equal(r.exitCode, 4);
  } finally {
    env.cleanup();
  }
});

test("GraphPayload validator rejects structural problems and unapplied tsconfig", () => {
  const ok = mockAnalyzer().analyzeWorkspaceActive({ active: { code: "", fileName: "C:/f/main.ts", languageId: "typescript" }, workspaceRoot: "C:/f", filePaths: [], cacheEnabled: false });
  assert.deepEqual(validateAnalyzerOutput(ok).errors, []);
  assert.ok(validateAnalyzerOutput({ ...ok, meta: { ...ok.meta, usedTsconfig: false } }).errors.some((e) => e.includes("usedTsconfig")));
  assert.ok(validateAnalyzerOutput({ graph: { nodes: [] } }).errors.length > 0);
  const dup = { ...ok, graph: { nodes: [...ok.graph.nodes, ok.graph.nodes[0]], edges: ok.graph.edges } };
  assert.ok(validateAnalyzerOutput(dup).errors.some((e) => e.includes("duplicate node id")));
  const kind = { ...ok, graph: { nodes: ok.graph.nodes, edges: [{ ...ok.graph.edges[0], kind: "imports" }] } };
  assert.ok(validateAnalyzerOutput(kind).errors.some((e) => e.includes("unknown edge kind")));
  const df = { ...ok, graph: { nodes: ok.graph.nodes, edges: [{ ...ok.graph.edges[0], kind: "dataflow" }] } };
  assert.ok(validateAnalyzerOutput(df).errors.some((e) => e.includes("arg#i")));
  assert.deepEqual(validateAnalyzerOutput(null).errors, ["analyzer returned no object"]);
});

// --- 4. no overwrite --------------------------------------------------------
test("an existing run directory is never overwritten, failed runs included", () => {
  const env = makeEnv(["t01-ok"]);
  try {
    const first = run(env, { behaviour: { throwFor: "t01-ok" } });
    const before = fs.readdirSync(first.runDir, { recursive: true }).map((f) => [f, fs.statSync(path.join(first.runDir, f)).isFile() ? sha256(fs.readFileSync(path.join(first.runDir, f))) : "dir"]);
    assert.throws(() => run(env), /run directory already exists/);
    const after = fs.readdirSync(first.runDir, { recursive: true }).map((f) => [f, fs.statSync(path.join(first.runDir, f)).isFile() ? sha256(fs.readFileSync(path.join(first.runDir, f))) : "dir"]);
    assert.deepEqual(after, before);
    assert.throws(() => run(env, { runId: "../escape" }), /invalid run id/);
  } finally {
    env.cleanup();
  }
});

// --- 5. determinism and cache ------------------------------------------------
test("canonical hash ignores absolute fixture paths and node order, not content", () => {
  const mk = (root, beh) => {
    const m = mockAnalyzer(beh);
    return m.analyzeWorkspaceActive({ active: { code: "", fileName: path.join(root, "main.ts"), languageId: "typescript" }, workspaceRoot: root, filePaths: [path.join(root, "main.ts")], cacheEnabled: false });
  };
  const r1 = path.join(os.tmpdir(), "rootA");
  const r2 = path.join(os.tmpdir(), "elsewhere", "rootB");
  const h1 = canonicalHashes(mk(r1), { fixtureRoot: r1 });
  const h2 = canonicalHashes(mk(r2), { fixtureRoot: r2 });
  assert.equal(h1.semanticHash, h2.semanticHash, "projectRoot and absolute paths excluded");
  const shuffled = canonicalHashes(mk(r1, { shuffle: true }), { fixtureRoot: r1 });
  assert.equal(shuffled.semanticHash, h1.semanticHash);
  assert.notEqual(shuffled.orderedHash, h1.orderedHash);
  const changed = canonicalHashes(mk(r1, { badOutput: true }), { fixtureRoot: r1 });
  assert.notEqual(changed.semanticHash, h1.semanticHash);
});

test("deterministic analyzer passes; nondeterministic output is detected and kept as evidence", () => {
  const env = makeEnv(["t01-ok"]);
  try {
    const good = run(env, { runId: "det" });
    assert.equal(good.record.cases[0].checks.deterministic, true);
    assert.equal(good.record.cases[0].checks.cacheConsistent, true);
    assert.equal(good.record.cases[0].checks.cacheHitPathExercised, true);
    const bad = run(env, { runId: "nondet", behaviour: { nondeterministic: true } });
    const c = bad.record.cases[0];
    assert.equal(c.checks.deterministic, false);
    assert.notEqual(c.hashes["off#1"].semanticHash, c.hashes["off#2"].semanticHash);
    assert.ok(fs.existsSync(path.join(bad.runDir, "repeats", "t01-ok.off2.json")));
    assert.equal(bad.exitCode, 5);
    assert.ok(bad.record.confirmatory.reasons.some((x) => x.startsWith("NONDETERMINISTIC")));
  } finally {
    env.cleanup();
  }
});

test("cache OFF/ON mismatch is reported and blocks confirmatory use", () => {
  const env = makeEnv(["t01-ok"]);
  try {
    const r = run(env, { behaviour: { cacheDiff: true } });
    const c = r.record.cases[0];
    assert.equal(c.checks.deterministic, true);
    assert.equal(c.checks.cacheConsistent, false);
    assert.ok(fs.existsSync(path.join(r.runDir, "repeats", "t01-ok.on-cold.json")));
    assert.equal(r.record.confirmatory.eligible, false);
    assert.ok(r.record.confirmatory.reasons.some((x) => x.startsWith("CACHE_OFF_ON_MISMATCH")));
  } finally {
    env.cleanup();
  }
});

// --- 6. D11 and protected outputs --------------------------------------------
test("TS lib endpoints are diagnosed separately (D11) and require review", () => {
  const env = makeEnv(["t01-ok"]);
  try {
    const r = run(env, { behaviour: { tsLib: true } });
    const c = r.record.cases[0];
    assert.equal(c.status, "OK");
    assert.equal(c.tsLibRelations.length, 1);
    assert.match(c.tsLibRelations[0].target, /typescript\/lib\/lib\.es5\.d\.ts/);
    assert.ok(r.record.confirmatory.reasons.some((x) => x.startsWith("D11_TS_LIB_RELATIONS_REVIEW_REQUIRED")));
    assert.equal(r.record.d11Decision, "D11_KEEP_PRE_REGISTERED_SCORING");
    assert.deepEqual(tsLibRelations({ graph: { nodes: [], edges: [] } }), []);
  } finally {
    env.cleanup();
  }
});

test("a change to protected outputs during the run invalidates it", () => {
  const env = makeEnv(["t01-ok"]);
  try {
    const target = path.join(env.protectedDir, "results.json");
    const r = run(env, { behaviour: { sideEffect: () => fs.writeFileSync(target, '{"overwritten":true}') } });
    assert.equal(r.record.status, "invalid");
    assert.ok(r.record.statusReasons.includes("PROTECTED_OUTPUTS_CHANGED"));
    assert.equal(r.exitCode, 4);
  } finally {
    env.cleanup();
  }
});

// --- 7. scoring status --------------------------------------------------------
test("BLOCKED scoring status prevents confirmatory reporting (mock scorer)", () => {
  const env = makeEnv();
  try {
    const blocked = () => ({ exitCode: 2, log: "SCORING_BLOCKED", summary: { scorerVersion: "exp01-scorer/1.2", scoringStatus: "BLOCKED", blockedCases: ["t01-ok"] } });
    const r = run(env, { scorer: blocked });
    assert.equal(r.record.status, "completed");
    assert.equal(r.record.scoring.status, "BLOCKED");
    assert.deepEqual(r.record.scoring.blockedCases, ["t01-ok"]);
    assert.equal(r.record.confirmatory.eligible, false);
    assert.ok(r.record.confirmatory.reasons.includes("SCORING_BLOCKED"));
    assert.equal(r.exitCode, 5);
    const missing = run(env, { runId: "nosummary", scorer: () => ({ exitCode: 1, log: "crash", summary: null }) });
    assert.ok(missing.record.confirmatory.reasons.includes("SCORING_MISSING_SUMMARY"));
    const version = run(env, { runId: "oldscorer", scorer: () => ({ exitCode: 0, log: "", summary: { scorerVersion: "exp01-scorer/1.0", scoringStatus: "COMPLETE", blockedCases: [] } }) });
    assert.ok(version.record.confirmatory.reasons.some((x) => x.startsWith("SCORER_VERSION_MISMATCH")));
    // runner 1.2 also rejects the pre-registered scorer 1.1
    const v11 = run(env, { runId: "scorer11", scorer: () => ({ exitCode: 0, log: "", summary: { scorerVersion: "exp01-scorer/1.1", scoringStatus: "COMPLETE", blockedCases: [] } }) });
    assert.deepEqual(v11.record.scoring.gateFailures, ["SCORER_VERSION_MISMATCH:exp01-scorer/1.1"]);
    assert.equal(v11.record.confirmatory.eligible, false);
    assert.equal(v11.exitCode, 5);
  } finally {
    env.cleanup();
  }
});

test("end to end with the real score.mjs on synthetic GT: COMPLETE vs BLOCKED", async () => {
  const { defaultScorer } = await import("../exp01-run.mjs");
  const env = makeEnv(["t01-ok"]);
  try {
    const ok = run(env, { runId: "e2e-ok", scorer: defaultScorer });
    assert.equal(ok.record.scoring.status, "COMPLETE", fs.readFileSync(path.join(ok.runDir, "score-log.txt"), "utf8"));
    assert.equal(ok.record.confirmatory.eligible, true);
    const blocked = run(env, { runId: "e2e-blocked", scorer: defaultScorer, behaviour: { collide: true } });
    assert.equal(blocked.record.scoring.status, "BLOCKED");
    assert.deepEqual(blocked.record.scoring.blockedCases, ["t01-ok"]);
    assert.equal(blocked.record.confirmatory.eligible, false);
    const diag = readJson(path.join(blocked.runDir, "score", "diagnostics.json"));
    assert.equal(diag[0].blockers[0].code, "node-key-collision");
    assert.ok(fs.existsSync(path.join(blocked.runDir, "predictions", "t01-ok.json")), "raw output kept");
  } finally {
    env.cleanup();
  }
});

test("--no-score and case subsets are never confirmatory", () => {
  const env = makeEnv();
  try {
    const noScore = run(env, { runId: "noscore", score: false });
    assert.ok(noScore.record.confirmatory.reasons.includes("NOT_SCORED"));
    const subset = run(env, { runId: "subset", cases: ["t01-ok"] });
    assert.ok(subset.record.confirmatory.reasons.includes("CASE_SUBSET"));
    assert.equal(subset.record.cases.length, 1);
    const unknown = run(env, { runId: "unknown", cases: ["nope"] });
    assert.equal(unknown.record.status, "invalid");
    assert.equal(unknown.loaded(), 0);
  } finally {
    env.cleanup();
  }
});

test("CLI argument parsing", () => {
  assert.deepEqual(parseArgs(["--run-id", "x", "--cases", "a, b", "--no-score"]), { runId: "x", cases: ["a", "b"], repeat: 2, score: false, allowDirty: false, bootstrap: 10000 });
  assert.throws(() => parseArgs(["--bogus"]), /unknown argument/);
  assert.throws(() => parseArgs(["--run-id"]), /needs a value/);
  const env = makeEnv(["t01-ok"]);
  try {
    assert.throws(() => runExperiment({ corpus: env.corpus, dataRoot: env.dataRoot, repeat: 1 }), /repeat/);
  } finally {
    env.cleanup();
  }
});

// ===========================================================================
// P1-B-R1 regression tests (synthetic only)
// ===========================================================================

// --- R1-1. scorer exit code and summary gate ---------------------------------
test("R1-1 scorer gate: only exit 0 + summary + COMPLETE + exp01-scorer/1.2 passes (runner 1.2)", () => {
  const env = makeEnv();
  try {
    const summary = (scoringStatus, scorerVersion = "exp01-scorer/1.2") => ({ scorerVersion, scoringStatus, blockedCases: scoringStatus === "BLOCKED" ? ["t01-ok"] : [] });
    const cases = [
      { id: "s1", scorer: () => ({ exitCode: 0, log: "", summary: summary("COMPLETE") }), eligible: true, reasons: [] },
      { id: "s2", scorer: () => ({ exitCode: 1, log: "boom", summary: summary("COMPLETE") }), eligible: false, reasons: ["SCORER_EXIT_1"] },
      { id: "s3", scorer: () => ({ exitCode: 2, log: "SCORING_BLOCKED", summary: summary("BLOCKED") }), eligible: false, reasons: ["SCORER_EXIT_2", "SCORING_BLOCKED"] },
      { id: "s4", scorer: () => ({ exitCode: 0, log: "", summary: null }), eligible: false, reasons: ["SCORING_MISSING_SUMMARY"] },
      { id: "s6", scorer: () => ({ exitCode: null, signal: "SIGKILL", log: "", summary: null }), eligible: false, reasons: ["SCORER_EXIT_NULL", "SCORING_MISSING_SUMMARY"] },
      { id: "s7", scorer: () => ({ exitCode: 0, log: "", summary: summary("COMPLETE", "exp01-scorer/1.1") }), eligible: false, reasons: ["SCORER_VERSION_MISMATCH:exp01-scorer/1.1"] },
    ];
    for (const c of cases) {
      const r = run(env, { runId: c.id, scorer: c.scorer });
      assert.equal(r.record.confirmatory.eligible, c.eligible, c.id);
      assert.deepEqual(r.record.scoring.gateFailures, c.reasons, c.id);
      for (const reason of c.reasons) {
        assert.ok(r.record.confirmatory.reasons.includes(reason), `${c.id}: ${reason}`);
      }
      assert.equal(r.exitCode, c.eligible ? 0 : 5, c.id);
      const saved = readJson(path.join(r.runDir, "run.json"));
      assert.deepEqual(saved.scoring.gateFailures, c.reasons, `${c.id}: persisted`);
    }
  } finally {
    env.cleanup();
  }
});

test("R1-1 scorer exception is caught, blocks confirmatory use and is written to run.json", () => {
  const env = makeEnv();
  try {
    const r = run(env, {
      scorer: () => {
        throw new Error("synthetic scorer crash");
      },
    });
    assert.equal(r.record.status, "completed");
    assert.equal(r.record.scoring.status, "SCORER_ERROR");
    assert.equal(r.record.confirmatory.eligible, false);
    assert.ok(r.record.confirmatory.reasons.includes("SCORER_ERROR"));
    assert.equal(r.exitCode, 5);
    const saved = readJson(path.join(r.runDir, "run.json"));
    assert.match(saved.scoring.error.message, /synthetic scorer crash/);
    assert.ok(saved.scoring.error.stack);
    assert.ok(fs.existsSync(path.join(r.runDir, "predictions", "t01-ok.json")), "raw output kept");
  } finally {
    env.cleanup();
  }
});

test("R1-1 defaultScorer reports a crashing scorer process and an unreadable summary", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "exp01-scorer-"));
  try {
    // A repo root without score.mjs: node exits non-zero, no summary.
    const crashed = defaultScorer({ repoRoot: tmp, corpus: tmp, predictionsDir: tmp, outDir: path.join(tmp, "out"), bootstrap: 0 });
    assert.notEqual(crashed.exitCode, 0);
    assert.equal(crashed.summary, null);
    assert.match(crashed.log, /Cannot find module|ERR_MODULE_NOT_FOUND/);
    // Unreadable summary.json left in the output directory.
    const out = path.join(tmp, "out2");
    fs.mkdirSync(out);
    fs.writeFileSync(path.join(out, "summary.json"), "{ truncated");
    const broken = defaultScorer({ repoRoot: tmp, corpus: tmp, predictionsDir: tmp, outDir: out, bootstrap: 0 });
    assert.equal(broken.summary, null);
    assert.match(broken.summaryError, /summary\.json unreadable/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// --- R1-2. partial results are preserved -------------------------------------
test("R1-2 a failure in a later variant keeps every earlier result and records the variant", () => {
  const variantsInOrder = ["off#1", "off#2", "on-cold", "on-warm"];
  for (const [failAtCall, failedVariant] of [[2, "off#2"], [3, "on-cold"], [4, "on-warm"]]) {
    const env = makeEnv(["t01-ok"]);
    try {
      const r = run(env, { behaviour: { failAtCall } });
      const c = r.record.cases[0];
      assert.equal(c.status, "ANALYZER_ERROR", failedVariant);
      assert.equal(c.failedVariant, failedVariant);
      assert.deepEqual(c.completedVariants, variantsInOrder.slice(0, failAtCall - 1));
      const rawFile = path.join(r.runDir, "predictions", "t01-ok.json");
      assert.ok(fs.existsSync(rawFile), `${failedVariant}: off#1 kept`);
      assert.equal(sha256(fs.readFileSync(rawFile)), c.files.rawSha256);
      assert.equal(readJson(rawFile).analyzerInput.variant, "off#1");
      for (const done of c.completedVariants.slice(1)) {
        const rel = c.files[`variant:${done}`];
        assert.ok(rel && fs.existsSync(path.join(r.runDir, rel)), `${failedVariant}: ${done} kept`);
        assert.equal(sha256(fs.readFileSync(path.join(r.runDir, rel))), c.files[`variant:${done}:sha256`]);
      }
      const failure = readJson(path.join(r.runDir, c.files.failure));
      assert.equal(failure.failedVariant, failedVariant);
      assert.match(failure.errors[0], new RegExp(`^${failedVariant}: synthetic failure`));
      assert.ok(failure.stack);
      assert.deepEqual(failure.completedVariants, c.completedVariants);
      assert.equal(r.record.status, "incomplete");
      assert.equal(r.record.scoring.status, "NOT_RUN");
      assert.equal(r.record.confirmatory.eligible, false);
    } finally {
      env.cleanup();
    }
  }
});

test("R1-2 a failure in off#1 writes no prediction and is still recorded", () => {
  const env = makeEnv(["t01-ok"]);
  try {
    const r = run(env, { behaviour: { failAtCall: 1 } });
    const c = r.record.cases[0];
    assert.equal(c.failedVariant, "off#1");
    assert.deepEqual(c.completedVariants, []);
    assert.equal(fs.existsSync(path.join(r.runDir, "predictions", "t01-ok.json")), false);
    assert.ok(fs.existsSync(path.join(r.runDir, c.files.failure)));
  } finally {
    env.cleanup();
  }
});

test("R1-2 every variant is saved as it completes, in a scorer-compatible format", () => {
  const env = makeEnv(["t01-ok"]);
  try {
    const r = run(env);
    const c = r.record.cases[0];
    assert.deepEqual(c.completedVariants, ["off#1", "off#2", "on-cold", "on-warm"]);
    for (const v of ["off#2", "on-cold", "on-warm"]) {
      const doc = readJson(path.join(r.runDir, c.files[`variant:${v}`]));
      assert.equal(doc.schema, "exp01-raw/1");
      assert.equal(doc.analyzerInput.variant, v);
      assert.equal(doc.analyzerInput.cacheEnabled, v !== "off#2");
      assert.equal(loadPrediction(doc, c.caseId).relations.length, 1);
    }
    assert.deepEqual(fs.readdirSync(path.join(r.runDir, "predictions")), ["t01-ok.json"], "only off#1 is scored");
  } finally {
    env.cleanup();
  }
});

test("R1-2 a runner-side error (unserializable output) keeps earlier files and run.json", () => {
  const env = makeEnv(["t01-ok", "t02-ok"]);
  try {
    const r = run(env, { behaviour: { cyclicAtCall: 3 } });
    for (const c of r.record.cases) {
      assert.equal(c.status, "RUNNER_ERROR");
      assert.equal(c.failedVariant, "on-cold");
      assert.deepEqual(c.completedVariants, ["off#1", "off#2"]);
      assert.equal(sha256(fs.readFileSync(path.join(r.runDir, c.files.raw))), c.files.rawSha256);
      assert.ok(c.stack);
    }
    assert.ok(fs.existsSync(path.join(r.runDir, "run.json")));
    assert.equal(r.record.status, "incomplete");
    assert.equal(r.exitCode, 4);
  } finally {
    env.cleanup();
  }
});

test("R1-2 analyzer load failure aborts with a record", () => {
  const env = makeEnv(["t01-ok"]);
  try {
    const result = runExperiment({
      corpus: env.corpus,
      dataRoot: env.dataRoot,
      runId: "noload",
      manifestChecks: MANIFEST_OK,
      gitInfo: CLEAN_GIT,
      buildCheck: BUILD_OK,
      loadAnalyzer: () => {
        throw new Error("Cannot find module out/analyzer");
      },
      protectedRoots: [env.protectedDir],
    });
    assert.equal(result.exitCode, 3);
    assert.deepEqual(result.record.statusReasons, ["ANALYZER_LOAD_FAILED"]);
    assert.match(readJson(path.join(result.runDir, "run.json")).analyzerLoadError.message, /Cannot find module/);
  } finally {
    env.cleanup();
  }
});

// --- R1-3. bootstrap --------------------------------------------------------
test("R1-3 --bootstrap accepts non-negative integers only", () => {
  for (const bad of ["NaN", "Infinity", "-1", "1.5", "1e4", "", "10000abc", "0x10"]) {
    assert.throws(() => parseArgs(["--bootstrap", bad]), /non-negative integer/, bad);
  }
  assert.equal(parseArgs(["--bootstrap", "0"]).bootstrap, 0);
  assert.equal(parseArgs(["--bootstrap", "10000"]).bootstrap, 10000);
  for (const bad of [NaN, Infinity, -1, 1.5, "10000", null]) {
    assert.throws(() => validateBootstrap(bad), /non-negative integer/, String(bad));
  }
  const env = makeEnv(["t01-ok"]);
  try {
    assert.throws(() => runExperiment({ corpus: env.corpus, dataRoot: env.dataRoot, bootstrap: Number.NaN }), /non-negative integer/);
    assert.equal(fs.existsSync(env.dataRoot), false, "rejected before anything is written");
  } finally {
    env.cleanup();
  }
});

test("R1-3 only the pre-registered 10,000 resamples can be confirmatory", () => {
  const env = makeEnv(["t01-ok"]);
  try {
    let seen = null;
    const spy = (args) => {
      seen = args.bootstrap;
      return SCORER_COMPLETE();
    };
    const pre = run(env, { runId: "b10000", scorer: spy });
    assert.equal(seen, 10000);
    assert.equal(pre.record.bootstrap, 10000);
    assert.equal(pre.record.confirmatory.eligible, true);
    for (const n of [0, 1000, 20000]) {
      const r = run(env, { runId: `b${n}`, bootstrap: n, scorer: spy });
      assert.equal(seen, n);
      assert.equal(r.record.confirmatory.eligible, false, String(n));
      assert.ok(r.record.confirmatory.reasons.includes(`BOOTSTRAP_NOT_PREREGISTERED:${n}`));
    }
  } finally {
    env.cleanup();
  }
});

// --- R1-4. cache hit path claim ------------------------------------------------
test("R1-4 cache hit-path claim is separate from accuracy eligibility", () => {
  const env = makeEnv();
  try {
    const hits = run(env, { runId: "hits" });
    assert.equal(hits.record.cacheHitPath.status, "VERIFIED");
    const noHits = run(env, { runId: "nohits", behaviour: { noHits: true } });
    assert.equal(noHits.record.cacheHitPath.status, "NOT_VERIFIED_NO_HITS");
    assert.deepEqual(noHits.record.cacheHitPath.casesWithoutHits, ["t01-ok", "t02-ok"]);
    assert.equal(noHits.record.confirmatory.eligible, true, "accuracy scoring itself is not blocked");
    assert.ok(noHits.record.cases.every((c) => c.warnings.some((w) => w.includes("did not exercise the hit path"))));
    const mismatch = run(env, { runId: "mismatch", behaviour: { cacheDiff: true } });
    assert.equal(mismatch.record.cacheHitPath.status, "MISMATCH");
    assert.equal(mismatch.record.confirmatory.eligible, false);
    const broken = run(env, { runId: "broken", behaviour: { throwFor: "t02-ok" } });
    assert.equal(broken.record.cacheHitPath.status, "NOT_EVALUATED");
    assert.equal(cacheHitPathClaim([]).status, "NOT_EVALUATED");
  } finally {
    env.cleanup();
  }
});

// ===========================================================================
// P1-H runner 1.2 tests (synthetic runs; the real analyzer is never loaded)
// ===========================================================================

test("H1 protocol constants: runner 1.2, pinned scorer 1.2, r2, amended protocol, pre-registered ids kept", () => {
  assert.equal(RUNNER_VERSION, "exp01-runner/1.2");
  assert.equal(PROTOCOL.scorerVersion, "exp01-scorer/1.2");
  assert.equal(PROTOCOL.gtVersion, 1);
  assert.equal(PROTOCOL.preregistrationCommit, "41bbe19434b4d284c6368b5fb5158cf1a5dbdf1e");
  assert.equal(PROTOCOL.evaluationToolCommit, "ae82bfbf0e26b7cba67e40af2b1f0a1fe89b81ca");
  assert.equal(PROTOCOL.scorerAmendmentCommit, "52ff632dacd14850d835604f80f9b3b4f4b916cc");
  assert.equal(PROTOCOL.evaluationManifest, "docs/thesis-experiments/fixtures/exp-01/eval-manifest.r2.json");
  assert.equal(PROTOCOL.evaluationProtocol, "POST_HOC_AMENDED");
  assert.equal(PROTOCOL.amendmentReason, "EXTERNAL_NODE_KEY_COLLISION");
  assert.equal(PROTOCOL.bootstrapResamples, 10000);
  assert.equal(RESEARCH_STATUS, "POST_HOC_AMENDED_EVALUATION");
  assert.equal(ANALYZER_BASELINE.commit, "43ace0fdfdf442d7871c3ef4a92d73b28f1b5e77");
});

test("H2 the accepted scorer version is a literal in the runner, not the scorer module constant", () => {
  const src = fs.readFileSync(path.resolve(here, "../exp01-run.mjs"), "utf8");
  assert.match(src, /scorerVersion: "exp01-scorer\/1\.2",/);
  assert.doesNotMatch(src, /scorerVersion: SCORER_/);
  assert.ok(!/eval-manifest\.r1\.json/.test(src.replace(/^\s*\/\/.*$/gm, "")), "r1 is not referenced in code");
});

test("H3 real protocol check passes on this checkout: pinned r2 hash and scorer module 1.2", () => {
  const p = defaultProtocolCheck();
  assert.equal(p.ok, true, p.problems.join(", "));
  assert.equal(p.evaluationManifestSha256, PROTOCOL.evaluationManifestSha256);
  assert.equal(p.scorerModuleVersion, "exp01-scorer/1.2");
});

test("H4 protocol check failures (r2 changed, scorer module mismatch) abort before the analyzer", () => {
  const env = makeEnv(["t01-ok"]);
  try {
    const failures = {
      r2: ["EVAL_MANIFEST_HASH_MISMATCH"],
      module: ["SCORER_MODULE_VERSION_MISMATCH:exp01-scorer/1.1"],
      missing: ["EVAL_MANIFEST_MISSING"],
    };
    for (const [id, problems] of Object.entries(failures)) {
      const r = run(env, { runId: `proto-${id}`, protocolCheck: () => ({ ok: false, problems, evaluationManifestSha256: null, scorerModuleVersion: "x" }) });
      assert.equal(r.exitCode, 3, id);
      assert.equal(r.record.status, "aborted", id);
      assert.deepEqual(r.record.statusReasons, problems.map((x) => `PROTOCOL_CHECK_FAILED:${x}`), id);
      assert.equal(r.loaded(), 0, id);
      assert.equal(r.record.confirmatory.eligible, false, id);
    }
  } finally {
    env.cleanup();
  }
});

test("H5 run.json records the amended protocol separately from the technical gate", () => {
  const env = makeEnv(["t01-ok"]);
  try {
    const r = run(env, { runId: "protocol" });
    assert.equal(r.exitCode, 0);
    const saved = readJson(path.join(r.runDir, "run.json"));
    for (const rec of [r.record, saved]) {
      assert.equal(rec.runnerVersion, "exp01-runner/1.2");
      assert.equal(rec.scorerVersion, "exp01-scorer/1.2");
      assert.equal(rec.gtVersion, 1);
      assert.equal(rec.preregistrationCommit, "41bbe19434b4d284c6368b5fb5158cf1a5dbdf1e");
      assert.equal(rec.evaluationToolCommit, "ae82bfbf0e26b7cba67e40af2b1f0a1fe89b81ca");
      assert.equal(rec.scorerAmendmentCommit, "52ff632dacd14850d835604f80f9b3b4f4b916cc");
      assert.equal(rec.evaluationManifestSha256, PROTOCOL.evaluationManifestSha256);
      assert.equal(rec.analyzerBaselineCommit, "43ace0fdfdf442d7871c3ef4a92d73b28f1b5e77");
      assert.equal(rec.headCommit, "f".repeat(40), "the HEAD of the run, not the baseline commit");
      assert.deepEqual(rec.analyzerSourceTrees, { "src/analyzer": ANALYZER_BASELINE.srcAnalyzerTree, "src/shared": ANALYZER_BASELINE.srcSharedTree });
      assert.equal(rec.analyzerIdentity.identical, true);
      assert.equal(rec.evaluationProtocol, "POST_HOC_AMENDED");
      assert.equal(rec.amendmentReason, "EXTERNAL_NODE_KEY_COLLISION");
      assert.equal(rec.researchStatus, "POST_HOC_AMENDED_EVALUATION");
      assert.equal(rec.preregisteredConfirmatory, false);
      assert.equal(rec.confirmatory.eligible, true);
      assert.equal(rec.confirmatory.scope, "TECHNICAL_EXECUTION_GATE");
      assert.match(rec.confirmatory.note, /not a pre-registered confirmatory result/);
    }
    // aborted runs carry the same protocol fields
    const aborted = run(env, { runId: "protocol-aborted", buildCheck: () => ({ ok: false, problems: ["x"], buildHash: null }) });
    assert.equal(aborted.record.researchStatus, "POST_HOC_AMENDED_EVALUATION");
    assert.equal(aborted.record.confirmatory.scope, "TECHNICAL_EXECUTION_GATE");
  } finally {
    env.cleanup();
  }
});

test("H6 an analyzer that differs from the baseline cannot pass the gate (recorded, not hidden)", () => {
  const env = makeEnv(["t01-ok"]);
  try {
    const changed = () => compareAnalyzerIdentity({ ...IDENTITY_OK().current, srcAnalyzerTree: "0".repeat(40), analyzerBuildHash: "c".repeat(64) });
    const r = run(env, { runId: "identity-diff", analyzerIdentity: changed });
    assert.equal(r.record.status, "completed");
    assert.equal(r.record.confirmatory.eligible, false);
    assert.ok(r.record.confirmatory.reasons.includes("ANALYZER_NOT_IDENTICAL_TO_BASELINE:srcAnalyzerTree,analyzerBuildHash"));
    assert.equal(r.exitCode, 5);
    assert.deepEqual(r.record.analyzerIdentity.mismatches, ["srcAnalyzerTree", "analyzerBuildHash"]);
    const unknown = compareAnalyzerIdentity({ headCommit: null, srcAnalyzerTree: null, srcSharedTree: null, packageJsonBlob: null, packageLockBlob: null, tsconfigBlob: null, analyzerBuildHash: null, typescript: null });
    assert.equal(unknown.identical, false, "unknown values are mismatches");
    assert.equal(unknown.mismatches.length, 7);
    const ts = compareAnalyzerIdentity({ ...IDENTITY_OK().current, typescript: "5.9.2" });
    assert.deepEqual(ts.mismatches, ["typescript"]);
    const lock = compareAnalyzerIdentity({ ...IDENTITY_OK().current, packageLockBlob: "1".repeat(40) });
    assert.deepEqual(lock.mismatches, ["packageLockBlob"]);
  } finally {
    env.cleanup();
  }
});

// H7 is split so that an intentional analyzer change (e.g. PR #10) does not fail the suite while every
// baseline guarantee stays checked:
//   H7a  the frozen baseline constants equal the git ids of the baseline commit itself
//   H7b  the identity verdict for this checkout is exactly the set of real differences, and a checkout
//        that differs from the baseline cannot pass the runner 1.2 technical gate
//   H7c  compareAnalyzerIdentity accepts only the baseline and detects each kind of difference
const gitAt = (args) => {
  try {
    return execFileSync("git", args, { cwd: path.resolve(here, "../../../.."), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
};
const IDENTITY_FIELDS = ["srcAnalyzerTree", "srcSharedTree", "packageJsonBlob", "packageLockBlob", "tsconfigBlob", "analyzerBuildHash", "typescript"];

test("H7a frozen baseline: ANALYZER_BASELINE equals the git ids of commit 43ace0f and the P1-I build evidence", () => {
  const c = "43ace0fdfdf442d7871c3ef4a92d73b28f1b5e77";
  assert.equal(ANALYZER_BASELINE.commit, c);
  assert.equal(gitAt(["cat-file", "-t", c]), "commit", "baseline commit must be present in this clone (no shallow clone)");
  const paths = { srcAnalyzerTree: "src/analyzer", srcSharedTree: "src/shared", packageJsonBlob: "package.json", packageLockBlob: "package-lock.json", tsconfigBlob: "tsconfig.json" };
  for (const [field, p] of Object.entries(paths)) {
    assert.equal(gitAt(["rev-parse", `${c}:${p}`]), ANALYZER_BASELINE[field], field);
  }
  // Compiled output hash and TypeScript version recorded by the baseline runs (0651, 0636) and the
  // P1-I run 0802; they are not derivable from git and are pinned here as evidence values.
  assert.equal(ANALYZER_BASELINE.analyzerBuildHash, "958dbf677b6085ddf478265b3cc2b64c5fb1452bf28cfb4c255ed5ef00566270");
  assert.equal(ANALYZER_BASELINE.typescript, "5.9.3");
});

test("H7b this checkout: identity verdict equals the real differences; a changed analyzer cannot pass the gate", () => {
  const build = defaultBuildCheck();
  const id = defaultAnalyzerIdentity({ buildHash: build.buildHash });
  assert.notEqual(id.current.headCommit, ANALYZER_BASELINE.commit, "HEAD is not claimed to be the baseline commit");
  // independent recomputation of the differing fields
  const expected = IDENTITY_FIELDS.filter((f) => !id.current[f] || id.current[f] !== ANALYZER_BASELINE[f]);
  assert.deepEqual(id.mismatches, expected);
  assert.equal(id.identical, expected.length === 0);
  if (gitAt(["rev-parse", "HEAD:src/analyzer"]) !== ANALYZER_BASELINE.srcAnalyzerTree) {
    assert.ok(id.mismatches.includes("srcAnalyzerTree"), "a changed src/analyzer tree is reported");
    assert.equal(id.identical, false);
  }
  if (build.ok && build.buildHash !== ANALYZER_BASELINE.analyzerBuildHash) {
    assert.ok(id.mismatches.includes("analyzerBuildHash"), "a changed compiled output is reported");
  }
  // The real identity of this checkout drives a synthetic run: only an identical analyzer passes.
  const env = makeEnv(["t01-ok"]);
  try {
    const r = run(env, { runId: "h7b-real-identity", analyzerIdentity: () => id });
    assert.equal(r.record.status, "completed");
    if (id.identical) {
      assert.equal(r.record.confirmatory.eligible, true);
      assert.equal(r.exitCode, 0);
    } else {
      assert.equal(r.record.confirmatory.eligible, false, "changed analyzer must not pass the baseline gate");
      assert.ok(r.record.confirmatory.reasons.includes(`ANALYZER_NOT_IDENTICAL_TO_BASELINE:${id.mismatches.join(",")}`));
      assert.equal(r.exitCode, 5);
    }
  } finally {
    env.cleanup();
  }
});

test("H7c compareAnalyzerIdentity accepts only the baseline and detects every field", () => {
  const same = compareAnalyzerIdentity({ headCommit: "e".repeat(40), ...BASELINE_FIELDS });
  assert.equal(same.identical, true, "baseline values are identical whatever HEAD is");
  assert.deepEqual(same.mismatches, []);
  const changedValue = {
    srcAnalyzerTree: "2c9359d471b543ce0c15b5f22473cd39a9e8e269", // src/analyzer of PR #10 (4c744ad)
    srcSharedTree: "0".repeat(40),
    packageJsonBlob: "1".repeat(40),
    packageLockBlob: "2".repeat(40),
    tsconfigBlob: "3".repeat(40),
    analyzerBuildHash: "1a78af192f1fd2b536627a4df8e87823000950242419832a5e3138146ac4b793", // build of 4c744ad
    typescript: "5.9.2",
  };
  for (const field of IDENTITY_FIELDS) {
    const one = compareAnalyzerIdentity({ ...BASELINE_FIELDS, [field]: changedValue[field] });
    assert.deepEqual(one.mismatches, [field], field);
    assert.equal(one.identical, false, field);
    const missing = compareAnalyzerIdentity({ ...BASELINE_FIELDS, [field]: null });
    assert.deepEqual(missing.mismatches, [field], `${field} unknown`);
  }
  const pr10 = compareAnalyzerIdentity({ ...BASELINE_FIELDS, srcAnalyzerTree: changedValue.srcAnalyzerTree, analyzerBuildHash: changedValue.analyzerBuildHash });
  assert.deepEqual(pr10.mismatches, ["srcAnalyzerTree", "analyzerBuildHash"], "PR #10 analyzer is rejected as in run exp01-20261029-0829-4c744ad");
});

test("H8 env.json records npm, node, TypeScript, OS, CPU, git HEAD and tool hashes; npm failure is null", () => {
  const git = { headCommit: "a".repeat(40) };
  const e = environment({ gitInfo: git, npmVersion: () => ({ version: "10.9.0", error: null }) });
  assert.equal(e.npm, "10.9.0");
  assert.equal(e.npmError, null);
  assert.equal(e.node, process.version);
  assert.equal(e.typescript, ANALYZER_BASELINE.typescript);
  assert.ok(e.os.platform && e.cpu.logicalCores > 0);
  assert.equal(e.gitHead, git.headCommit);
  assert.equal(e.runnerVersion, "exp01-runner/1.2");
  assert.equal(e.toolHashes[PROTOCOL.evaluationManifest], PROTOCOL.evaluationManifestSha256);
  assert.match(e.toolHashes["docs/thesis-experiments/tools/exp01/lib.mjs"], /^[0-9a-f]{64}$/);
  const failed = environment({ gitInfo: git, npmVersion: () => ({ version: null, error: "spawn npm ENOENT" }) });
  assert.equal(failed.npm, null, "no guessed version");
  assert.equal(failed.npmError, "spawn npm ENOENT");
  const real = defaultNpmVersion();
  assert.ok((real.version && /^\d+\.\d+\.\d+/.test(real.version) && real.error === null) || (real.version === null && real.error), JSON.stringify(real));
  // the runner passes its git info to the environment function and stores the result as env.json
  const env = makeEnv(["t01-ok"]);
  try {
    const r = run(env, { runId: "envjson", environment: (gi) => environment({ gitInfo: gi, npmVersion: () => ({ version: "10.9.0", error: null }) }) });
    const saved = readJson(path.join(r.runDir, "env.json"));
    assert.equal(saved.npm, "10.9.0");
    assert.equal(saved.gitHead, "f".repeat(40));
  } finally {
    env.cleanup();
  }
});

test("H9 existing gates still hold under runner 1.2: dirty with --allow-dirty, subset, bootstrap", () => {
  const env = makeEnv();
  try {
    const dirty = run(env, { runId: "allowdirty", allowDirty: true, gitInfo: () => ({ ...CLEAN_GIT(), dirty: true, porcelain: " M x", diff: "d" }) });
    assert.equal(dirty.record.status, "completed");
    assert.ok(dirty.record.confirmatory.reasons.includes("DIRTY_WORKING_TREE"));
    assert.equal(dirty.exitCode, 5);
    const subset = run(env, { runId: "subset12", cases: ["t01-ok"] });
    assert.ok(subset.record.confirmatory.reasons.includes("CASE_SUBSET"));
    const boot = run(env, { runId: "boot12", bootstrap: 100 });
    assert.ok(boot.record.confirmatory.reasons.includes("BOOTSTRAP_NOT_PREREGISTERED:100"));
    for (const r of [dirty, subset, boot]) {
      assert.equal(r.record.confirmatory.eligible, false);
      assert.equal(r.record.researchStatus, "POST_HOC_AMENDED_EVALUATION");
    }
  } finally {
    env.cleanup();
  }
});
