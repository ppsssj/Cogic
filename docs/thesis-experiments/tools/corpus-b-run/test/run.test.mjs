// P1-L: synthetic tests for the Corpus B runner and pair scorer. Fake analyzers and SYNTHETIC predictions
// only; the real analyzers are never loaded here.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { defaultAnalyzerCheck, runCase, runCorpusB } from "../run.mjs";
import { pairedBootstrap, scorePair } from "../score-pair.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../../..");
const { P1K3_SCENARIOS, asDoc, loadCases } = await import(pathToFileURL(path.join(repoRoot, "docs/thesis-experiments/tools/corpus-b-scoring/synthetic-scenarios.mjs")).href);
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

function tinyCorpus() {
  const root = tmp("k5-corpus-");
  for (const id of ["t01-a", "t02-b"]) {
    const d = path.join(root, "x", id);
    fs.mkdirSync(path.join(d, "src"), { recursive: true });
    fs.writeFileSync(path.join(d, "case.json"), JSON.stringify({ schema: "exp01-case/1", caseId: id, activeFile: "src/a.ts" }));
    fs.writeFileSync(path.join(d, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true }, include: ["**/*.ts"] }));
    fs.writeFileSync(path.join(d, "expected.json"), "{}");
    fs.writeFileSync(path.join(d, "src", "a.ts"), "export function f() { return 1; }\n");
  }
  return root;
}

function fakeAnalyzer({ vary = () => 0, write = null } = {}) {
  let calls = 0;
  return {
    calls: () => calls,
    clearAnalyzerCaches() {},
    analyzeWorkspaceActive({ active, cacheEnabled, debug }) {
      calls += 1;
      if (write) write();
      if (cacheEnabled) debug("analyzer.sourceFileCache.hit");
      const extra = vary(calls, cacheEnabled);
      const node = (id, line) => ({ id, kind: id === "file" ? "file" : "function", name: id, file: active.fileName, range: { start: { line, character: 0 }, end: { line, character: 1 } } });
      return { graph: { nodes: [node("file", 0), node(`fn${extra}`, 0)], edges: [] }, meta: { mode: "workspace", usedTsconfig: true, rootFiles: 1 } };
    },
  };
}
const okChecks = () => ({ all: { ok: true, out: "stub" } });
const okAnalyzer = () => ({ ok: true, problems: [], head: "stub", buildHash: "stub", identity: null });

test("runCase: deterministic, cache-consistent output is OK and written as exp01-raw/1", () => {
  const corpus = tinyCorpus();
  const runDir = tmp("k5-run-");
  const r = runCase({ analyzer: fakeAnalyzer(), caseDir: path.join(corpus, "x", "t01-a"), runDir, repeat: 2, runInfo: {} });
  assert.equal(r.status, "OK");
  assert.deepEqual(r.completedVariants, ["off#1", "off#2", "on-cold", "on-warm"]);
  assert.deepEqual([r.checks.deterministic, r.checks.cacheConsistent, r.checks.cacheHitPathExercised], [true, true, true]);
  const raw = JSON.parse(fs.readFileSync(path.join(runDir, "predictions", "t01-a.json"), "utf8"));
  assert.equal(raw.schema, "exp01-raw/1");
  assert.ok(fs.existsSync(path.join(runDir, "repeats", "t01-a.off2.json")));
  assert.throws(() => runCase({ analyzer: fakeAnalyzer(), caseDir: path.join(corpus, "x", "t01-a"), runDir, repeat: 2, runInfo: {} }), /refusing to overwrite/);
});

test("runCase detects nondeterminism, cache inconsistency and invalid output", () => {
  const corpus = tinyCorpus();
  const nd = runCase({ analyzer: fakeAnalyzer({ vary: (n, c) => (!c ? n : 1) }), caseDir: path.join(corpus, "x", "t01-a"), runDir: tmp("k5-a-"), repeat: 2, runInfo: {} });
  assert.equal(nd.checks.deterministic, false);
  const cc = runCase({ analyzer: fakeAnalyzer({ vary: (n, c) => (c ? 9 : 0) }), caseDir: path.join(corpus, "x", "t01-a"), runDir: tmp("k5-b-"), repeat: 2, runInfo: {} });
  assert.deepEqual([cc.checks.deterministic, cc.checks.cacheConsistent], [true, false]);
  const bad = { clearAnalyzerCaches() {}, analyzeWorkspaceActive: ({ debug }) => (debug("analyzer.sourceFileCache.hit"), { graph: { nodes: [], edges: [] }, meta: { mode: "single" } }) };
  assert.equal(runCase({ analyzer: bad, caseDir: path.join(corpus, "x", "t01-a"), runDir: tmp("k5-c-"), repeat: 2, runInfo: {} }).status, "INVALID_OUTPUT");
  const thrower = { analyzeWorkspaceActive: () => { throw new Error("boom"); } };
  assert.equal(runCase({ analyzer: thrower, caseDir: path.join(corpus, "x", "t01-a"), runDir: tmp("k5-d-"), repeat: 2, runInfo: {} }).status, "ANALYZER_ERROR");
});

test("runCorpusB: a failed preflight never loads the analyzer", () => {
  const r = runCorpusB({ label: "ORIGINAL", analyzerRoot: "unused", outRoot: tmp("k5-out-"), runId: "p", corpus: tinyCorpus(), repoChecks: () => ({ corpusBManifest: { ok: false, out: "DRIFT" } }), analyzerCheck: okAnalyzer, loadAnalyzer: () => assert.fail("analyzer loaded") });
  assert.equal(r.record.status, "PREFLIGHT_FAILED");
  assert.equal(r.exitCode, 2);
  const a = runCorpusB({ label: "ORIGINAL", analyzerRoot: "unused", outRoot: tmp("k5-out-"), runId: "p", corpus: tinyCorpus(), repoChecks: okChecks, analyzerCheck: () => ({ ok: false, problems: ["HEAD x != y"] }), loadAnalyzer: () => assert.fail("analyzer loaded") });
  assert.equal(a.record.status, "PREFLIGHT_FAILED");
});

test("runCorpusB: complete run, provisional status recorded, no overwrite, corpus change detected", () => {
  const corpus = tinyCorpus();
  const outRoot = tmp("k5-out-");
  const fake = fakeAnalyzer();
  const r = runCorpusB({ label: "IMPROVED", analyzerRoot: "unused", outRoot, runId: "r1", corpus, repoChecks: okChecks, analyzerCheck: okAnalyzer, loadAnalyzer: () => fake });
  assert.equal(r.record.status, "COMPLETE");
  assert.equal(r.record.researchStatus, "PROVISIONAL_HOLDOUT_DIAGNOSTIC");
  assert.deepEqual(r.record.gtStatus, { version: "v1", reviewStatus: "REVIEW_PENDING", humanReviewed: false });
  assert.equal(r.record.summary.ok, 2);
  assert.equal(fake.calls(), 8);
  assert.throws(() => runCorpusB({ label: "IMPROVED", analyzerRoot: "unused", outRoot, runId: "r1", corpus, repoChecks: okChecks, analyzerCheck: okAnalyzer, loadAnalyzer: () => fake }), /exists/);
  const writer = fakeAnalyzer({ write: () => fs.writeFileSync(path.join(corpus, "x", "t01-a", "src", "a.ts"), `// ${Math.random()}\n`) });
  const w = runCorpusB({ label: "IMPROVED", analyzerRoot: "unused", outRoot, runId: "r2", corpus, repoChecks: okChecks, analyzerCheck: okAnalyzer, loadAnalyzer: () => writer });
  assert.equal(w.record.corpusUnchanged, false);
  assert.equal(w.record.status, "PARTIAL");
});

test("defaultAnalyzerCheck rejects a worktree at the wrong commit", () => {
  const c = defaultAnalyzerCheck("IMPROVED", repoRoot);
  assert.equal(c.ok, false);
  assert.ok(c.problems.some((p) => /HEAD .* != bbe4cbf/.test(p)));
  assert.equal(defaultAnalyzerCheck("OTHER", repoRoot).ok, false);
});

function writePreds(gen) {
  const dir = tmp("k5-pred-");
  for (const c of loadCases()) fs.writeFileSync(path.join(dir, `${c.caseId}.json`), JSON.stringify(asDoc(c.caseId, gen(c))));
  return dir;
}

test("scorePair: transitions, deltas, v2 split and paired bootstrap on synthetic predictions", () => {
  const cases = loadCases();
  const lostCase = cases.find((c) => c.caseId === "bn02-session-repository");
  const lost = lostCase.det.find((r) => r.support === "supported" && r.kind === "calls");
  const original = writePreds((c) => P1K3_SCENARIOS.S2_supported_only(c));
  // IMPROVED: recovers the unsupported relations, loses one supported call, adds one local FP and one shim FP
  const improved = writePreds((c) => {
    const base = P1K3_SCENARIOS.S4_supported_plus_unsupported_tp(c).filter((p) => !(c.caseId === lostCase.caseId && p.kind === lost.kind && p.srcKey === lost.srcKey && p.tgtKey === lost.tgtKey));
    return c.caseId === lostCase.caseId ? [...base, { kind: "calls", srcKey: c.fileKey, tgtKey: "X|src/session/domain/session.ts|999" }, { kind: "calls", srcKey: c.fileKey, tgtKey: "X|shims/third-party.d.ts|3" }] : base;
  });
  const r = scorePair({ originalPredictions: original, improvedPredictions: improved, bootstrap: 300 });
  assert.equal(r.pairedCases, 20);
  assert.equal(r.transitions.counts.TP_FN_lost, 1);
  assert.equal(r.transitions.counts.FN_TP_recovered, 116);
  assert.equal(r.transitions.counts.newFP, 2);
  assert.equal(r.table.v1.ORIGINAL.precision, 1);
  assert.equal(r.table.v1.IMPROVED.fp, 2);
  assert.equal(r.table.v2.IMPROVED.fp, 1);
  assert.equal(r.scope.IMPROVED.predictions.removed, 1);
  assert.equal(r.table.v1.delta.recallInScope, Number((-1 / 78).toFixed(6)));
  assert.ok(r.pairedBootstrap.v1.recallOverall.low > 0);
  assert.equal(r.byKind.IMPROVED.calls.fp, 2);
  assert.deepEqual(Object.keys(r.frameworks).sort(), ["express", "nest", "react", "vue"]);
});

test("pairedBootstrap: identical versions give a zero-width difference", () => {
  const c = { tpPred: 5, fp: 1, excluded: 0, gtInScope: 4, tpInScope: 3, gtOverall: 8, tpOverall: 5 };
  const per = Array.from({ length: 6 }, (_, k) => ({ caseId: `c${k}`, o: { v1: c, v2: c }, i: { v1: c, v2: c } }));
  const b = pairedBootstrap(per, { resamples: 200 });
  assert.deepEqual([b.v1.f1InScope.low, b.v1.f1InScope.high, b.diffOfDiffF1InScope.low], [0, 0, 0]);
});
