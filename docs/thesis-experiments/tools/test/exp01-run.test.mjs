// Unit tests for the EXP-01 runner (P1-B).
// Everything here is synthetic: temporary fixture corpora, a mock analyzer and stubbed
// git/build checks. The real Cogic analyzer is never loaded and the EXP-01 corpus is never analyzed.
// Run: node --test docs/thesis-experiments/tools/test/exp01-run.test.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  canonicalHashes,
  defaultManifestChecks,
  parseArgs,
  prepareCaseInput,
  runExperiment,
  sha256,
  tsLibRelations,
  validateAnalyzerOutput,
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
      const warm = args.cacheEnabled && state.sinceClear > 0;
      state.sinceClear += 1;
      if (args.cacheEnabled) {
        args.debug?.(warm ? "analyzer.sourceFileCache.hit" : "analyzer.sourceFileCache.miss");
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
const SCORER_COMPLETE = () => ({ exitCode: 0, log: "", summary: { scorerVersion: "exp01-scorer/1.1", scoringStatus: "COMPLETE", blockedCases: [] } });

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
    protectedRoots: [env.protectedDir],
    score: extra.score,
    cases: extra.cases,
    bootstrap: 0,
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
  assert.match(checks[1].command, /eval-manifest\.r1\.json/);
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
      assert.equal(raw.run.scorerVersion, "exp01-scorer/1.1");
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
    const blocked = () => ({ exitCode: 2, log: "SCORING_BLOCKED", summary: { scorerVersion: "exp01-scorer/1.1", scoringStatus: "BLOCKED", blockedCases: ["t01-ok"] } });
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
