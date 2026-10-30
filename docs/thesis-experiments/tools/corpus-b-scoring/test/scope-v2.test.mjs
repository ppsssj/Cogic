// P1-K4: tests of the DRAFT scoring-scope sensitivity analysis with SYNTHETIC predictions only.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { classifyTarget, scoreV1V2, splitPrediction, workspaceFiles } from "../scope-v2.mjs";
import { P1K3_SCENARIOS, asDoc, corpus, loadCases, rel } from "../synthetic-scenarios.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../../..");
const lib = await import(pathToFileURL(path.join(repoRoot, "docs/thesis-experiments/tools/exp01/lib.mjs")).href);
const score = await import(pathToFileURL(path.join(repoRoot, "docs/thesis-experiments/tools/exp01/score.mjs")).href);
const { scenarios: probeScenarios } = await import(pathToFileURL(path.join(repoRoot, "docs/thesis-experiments/tools/corpus-b-review/scoring-scope-probe.mjs")).href);

const cases = loadCases();
const byId = new Map(cases.map((c) => [c.caseId, c]));
const run = (gen) => scoreV1V2({ corpus, predictionFor: (id) => score.loadPrediction(asDoc(id, gen(byId.get(id))), id) }).comparison;
const r4 = (x) => (x === null ? null : Number(x.toFixed(4)));

test("regression: v1 equals the P1-K3 probe for all 11 scenarios", () => {
  const probe = probeScenarios().scenarios;
  assert.equal(Object.keys(P1K3_SCENARIOS).length, 11);
  assert.deepEqual(Object.keys(P1K3_SCENARIOS), Object.keys(probe));
  for (const [name, gen] of Object.entries(P1K3_SCENARIOS)) {
    const v1 = run(gen).v1;
    const p = probe[name];
    assert.deepEqual([v1.tp, v1.fp, v1.excluded, r4(v1.precision), r4(v1.recallInScope), r4(v1.recallOverall), r4(v1.f1InScope)], [p.tp, p.fp, p.excluded, p.precision, p.recallInScope, p.recallOverall, p.f1InScope], name);
  }
});

test("v2 on the 11 scenarios: shim targets set aside, recall never changes", () => {
  const expectRemoved = { S3a_supported_plus_external_distinct: 73, S3b_supported_plus_external_wrong_target: 73, S3c_supported_plus_external_module_key: 17, S5_S3a_plus_unsupported_tp: 73 };
  for (const [name, gen] of Object.entries(P1K3_SCENARIOS)) {
    const c = run(gen);
    assert.equal(c.predictions.removed, expectRemoved[name] ?? 0, name);
    assert.equal(c.v2.recallInScope, c.v1.recallInScope, name);
    assert.equal(c.v2.recallOverall, c.v1.recallOverall, name);
    assert.equal(c.v2.tp, c.v1.tp, name);
    assert.equal(c.v2.excluded, c.v1.excluded, name);
    assert.ok(c.v2.precision >= c.v1.precision, name);
  }
  assert.equal(run(P1K3_SCENARIOS.S3a_supported_plus_external_distinct).v2.precision, 1);
  assert.equal(run(P1K3_SCENARIOS.S5_S3a_plus_unsupported_tp).v2.f1InScope, 1);
});

test("external API FP is removed; correct local stays TP; wrong local stays FP", () => {
  const c0 = byId.get("be01-userrouter");
  const local = c0.det.find((r) => r.tgtKey?.startsWith("X|src/"));
  const gen = (c) => {
    if (c !== c0) return [];
    return [
      rel(local.kind, local.srcKey, local.tgtKey, local.argIndex), // correct local
      rel("calls", local.srcKey, "X|src/api/user/userController.ts|9999"), // wrong local (workspace file, wrong line)
      rel("calls", c.fileKey, "X|shims/third-party.d.ts|2"), // external API
    ];
  };
  const x = run(gen);
  assert.deepEqual([x.v1.tp, x.v1.fp], [1, 2]);
  assert.deepEqual([x.v2.tp, x.v2.fp], [1, 1]);
  assert.deepEqual(x.predictions.removedByClass, { OUT_SHIM_DECLARATION: 1 });
  assert.equal(x.removed[0].key, `calls|${c0.fileKey}|X|shims/third-party.d.ts|2`);
});

test("a local relation wrongly connected to a shim is removed by v2 but surfaces in the risk indicator", () => {
  const c0 = byId.get("bn02-session-repository");
  const g = c0.det.find((r) => r.kind === "calls" && r.support === "supported" && r.srcKey !== c0.fileKey);
  const gen = (c) => (c === c0 ? [...c.det.filter((r) => r !== g).map((r) => rel(r.kind, r.srcKey, r.tgtKey, r.argIndex)), rel("calls", g.srcKey, "X|shims/third-party.d.ts|5")] : []);
  const x = run(gen);
  assert.equal(x.v1.fp, 1);
  assert.equal(x.v2.fp, 0);
  assert.equal(x.v1.recallInScope, x.v2.recallInScope); // the missed GT relation stays FN in both
  assert.equal(x.riskIndicator.removedShimTargetsWithSameOwnerFn, 1);
  assert.ok(x.riskIndicator.items[0].sameOwnerFnGt.includes(g.id));
});

test("module (dynamic import) targets: workspace module kept, unresolved / shim / outside module removed", () => {
  const files = workspaceFiles(byId.get("bv01-main").dir);
  assert.equal(classifyTarget("M|src/router.ts", files), "IN_LOCAL_MODULE");
  assert.equal(classifyTarget("M|src/pages/Home.vue", files), "OUT_UNRESOLVED_MODULE");
  assert.equal(classifyTarget("M|shims/third-party.d.ts", files), "OUT_SHIM_DECLARATION");
  assert.equal(classifyTarget("M|<outside>/index.d.ts", files), "OUT_OUTSIDE_WORKSPACE");
  const c0 = byId.get("bv01-main");
  const x = run((c) => (c === c0 ? [rel("calls", c.fileKey, "M|src/router.ts"), rel("calls", c.fileKey, "M|src/pages/Home.vue")] : []));
  assert.deepEqual(x.predictions.keptByClass, { IN_LOCAL_MODULE: 1 });
  assert.deepEqual(x.predictions.removedByClass, { OUT_UNRESOLVED_MODULE: 1 });
  assert.equal(x.v2.fp, 1); // a kept module relation that is not in the GT is still an FP
});

test("every other key form is classified without the GT", () => {
  const files = workspaceFiles(byId.get("be01-userrouter").dir);
  const t = (k) => classifyTarget(k, files);
  assert.equal(t(null), "IN_NO_TARGET");
  assert.equal(t("F|src/api/user/userRouter.ts"), "IN_FILE");
  assert.equal(t("L|Promise.then"), "IN_LIB");
  assert.equal(t("S|src/api/user/userRouter.ts|21"), "IN_SYNTHETIC");
  assert.equal(t("D|src/api/user/userRouter.ts|9|callable"), "IN_LOCAL_DECLARATION");
  assert.equal(t("X|src/api/user/userController.ts|6"), "IN_LOCAL_DECLARATION");
  assert.equal(t("X|<tslib>/lib.es5.d.ts|1200"), "IN_TSLIB_EXTERNAL");
  assert.equal(t("X|<outside>/index.d.ts|3"), "OUT_OUTSIDE_WORKSPACE");
  assert.equal(t("X|src/not-a-file.ts|3"), "IN_UNCLASSIFIED");
  assert.equal(t("?|src/a.ts|1|enum"), "IN_UNCLASSIFIED");
  assert.equal(t("X|tsconfig.json|1"), "IN_UNCLASSIFIED");
});

test("indeterminate and negatives behave as in v1", () => {
  const s6 = run(P1K3_SCENARIOS.S6_supported_plus_indeterminate_candidates);
  assert.deepEqual([s6.v1.excluded, s6.v2.excluded], [18, 18]);
  const s7 = run(P1K3_SCENARIOS.S7_perfect_plus_negative_violations);
  assert.deepEqual([s7.v1.fp, s7.v2.fp], [2, 2]);
  // an unbounded indeterminate also absorbs a shim-target prediction in v1; v2 removes it first
  const c0 = byId.get("bn05-files-service");
  const e = c0.ind.find((x) => x.kind === "calls");
  const x = run((c) => (c === c0 ? [rel("calls", e.srcKey, "X|shims/third-party.d.ts|4")] : []));
  assert.deepEqual([x.v1.fp, x.v1.excluded, x.v2.fp, x.v2.excluded, x.predictions.removed], [0, 1, 0, 0, 1]);
});

test("duplicate keys are merged by the scorer before the split; occurrences are kept", () => {
  const c0 = byId.get("br01-form-drawer");
  const dup = rel("calls", c0.fileKey, "X|shims/third-party.d.ts|7");
  const x = run((c) => (c === c0 ? [dup, dup, { ...dup }] : []));
  assert.equal(x.predictions.removed, 1);
  assert.equal(x.removed[0].occurrences, 3);
  assert.equal(x.predictions.removedOccurrences, 3);
});

test("the same policy applies to two analyzers: the split depends only on the key and the workspace", () => {
  const c0 = byId.get("be02-server");
  const files = workspaceFiles(c0.dir);
  const original = score.loadPrediction(asDoc(c0.caseId, [rel("calls", c0.fileKey, "X|shims/third-party.d.ts|2"), rel("calls", c0.fileKey, "X|src/common/middleware/requestLogger.ts|20")]), c0.caseId);
  const improved = score.loadPrediction(asDoc(c0.caseId, [rel("calls", c0.fileKey, "X|src/common/middleware/requestLogger.ts|20"), rel("references", c0.fileKey, "X|shims/third-party.d.ts|2")]), c0.caseId);
  const so = splitPrediction(original, files);
  const si = splitPrediction(improved, files);
  const cls = (s) => Object.fromEntries([...s.keptClasses.map((k) => [k.key, k.scopeClass]), ...s.removed.map((r) => [r.key, r.scopeClass])]);
  assert.equal(cls(so)[`calls|${c0.fileKey}|X|src/common/middleware/requestLogger.ts|20`], cls(si)[`calls|${c0.fileKey}|X|src/common/middleware/requestLogger.ts|20`]);
  assert.deepEqual(so.removed.map((r) => r.scopeClass), si.removed.map((r) => r.scopeClass));
  // the split never reads expected.json: it gives the same result with an empty GT workspace copy
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "k4-ws-"));
  for (const f of files) {
    fs.mkdirSync(path.dirname(path.join(tmp, f)), { recursive: true });
    fs.writeFileSync(path.join(tmp, f), f.endsWith("expected.json") ? "{}" : "");
  }
  assert.deepEqual(splitPrediction(original, workspaceFiles(tmp)).removed, so.removed);
});

test("a case blocked in v1 is blocked in v2", () => {
  const c0 = byId.get("be03-ratelimiter");
  const x = scoreV1V2({ corpus, predictionFor: (id) => score.loadPrediction(asDoc(id, id === c0.caseId ? [{ kind: "dataflow", srcKey: c0.fileKey, tgtKey: "X|shims/third-party.d.ts|2" }] : []), id) }).comparison;
  assert.deepEqual(x.blockedCases.v1, [c0.caseId]);
  assert.deepEqual(x.blockedCases.v2, [c0.caseId]);
});

test("CLI: the v1 output is byte-identical to score.mjs; the scorer is unchanged", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "k4-cli-"));
  const preds = path.join(tmp, "preds");
  fs.mkdirSync(preds);
  for (const c of cases) fs.writeFileSync(path.join(preds, `${c.caseId}.json`), JSON.stringify(asDoc(c.caseId, P1K3_SCENARIOS.S5_S3a_plus_unsupported_tp(c))));
  const T = path.join(repoRoot, "docs/thesis-experiments/tools");
  execFileSync(process.execPath, [path.join(T, "exp01/score.mjs"), "--corpus", corpus, "--predictions", preds, "--out", path.join(tmp, "score"), "--bootstrap", "200"], { stdio: "pipe" });
  execFileSync(process.execPath, [path.join(T, "corpus-b-scoring/scope-v2.mjs"), "--corpus", corpus, "--predictions", preds, "--out", path.join(tmp, "scope"), "--bootstrap", "200"], { stdio: "pipe" });
  const a = fs.readdirSync(path.join(tmp, "score")).sort();
  assert.deepEqual(fs.readdirSync(path.join(tmp, "scope", "v1")).sort(), a);
  for (const f of a) assert.equal(fs.readFileSync(path.join(tmp, "scope", "v1", f), "utf8"), fs.readFileSync(path.join(tmp, "score", f), "utf8"), f);
  const cmp = JSON.parse(fs.readFileSync(path.join(tmp, "scope", "scope-comparison.json"), "utf8"));
  assert.equal(cmp.predictions.removed, 73);
  assert.equal(lib.SCORER_VERSION, "exp01-scorer/1.2");
});

test("premise: no GT v1 target (determinate, indeterminate candidate or negative) falls in an OUT class", () => {
  for (const c of cases) {
    const files = workspaceFiles(c.dir);
    const keys = [...c.det.map((r) => r.tgtKey), ...c.ind.flatMap((e) => (e.candidates === "unbounded" ? [] : e.candidates.map((x) => x.tgtKey))), ...c.neg.map((n) => n.tgtKey)];
    for (const k of keys) assert.ok(!classifyTarget(k, files).startsWith("OUT_"), `${c.caseId} ${k}`);
  }
});
