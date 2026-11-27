// P14-C: the review packet builder (blindness, determinism) and the reconciliation tool.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DEFAULTS, blindGuide, buildPacket, leakPatterns, scanForLeaks } from "../build-review-packet.mjs";
import { agreement, compareCase, gtItems, parseCsv, reviewerItems } from "../reconcile.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, "../../../../..");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "p14c-"));

let built;
const packet = () => {
  if (!built) {
    const out = path.join(tmp(), "out");
    built = { out, ...buildPacket({ out }) };
  }
  return built;
};

test("the packet holds all 64 cases under blind IDs, and no GT, catalog or case metadata", () => {
  const { out, cases } = packet();
  assert.equal(cases, 64);
  const ids = fs.readdirSync(path.join(out, "packet", "cases"));
  assert.equal(ids.filter((x) => /^A\d\d$/.test(x)).length, 44);
  assert.equal(ids.filter((x) => /^B\d\d$/.test(x)).length, 20);
  const all = fs.readdirSync(path.join(out, "packet"), { recursive: true }).map((f) => String(f));
  assert.equal(all.filter((f) => /expected|case\.json$|catalog|blind-key|build-report/.test(f)).length, 0);
  const key = JSON.parse(fs.readFileSync(path.join(out, "researcher", "blind-key.json"), "utf8"));
  assert.equal(new Set(key.map((k) => k.caseId)).size, 64);
});

test("the leak check passes on the packet and catches planted leaks", () => {
  const { out, report } = packet();
  assert.deepEqual(report.leakCheck.hits, []);
  const key = JSON.parse(fs.readFileSync(path.join(out, "researcher", "blind-key.json"), "utf8"));
  const pats = leakPatterns({ originalCaseIds: key.map((k) => k.caseId), patternIds: ["CALL-LOCAL-FN"] });
  const dir = tmp();
  const plant = (name, text) => fs.writeFileSync(path.join(dir, name), text);
  plant("a.md", "see h03 for an example");
  plant("b.md", "relation R07 is determinate");
  plant("c.md", "pattern CALL-LOCAL-FN");
  plant("d.md", "this is supported");
  plant("e.md", `the case ${key[0].caseId}`);
  plant("expected.json", "{}");
  const hits = scanForLeaks(dir, pats);
  for (const f of ["a.md", "b.md", "c.md", "d.md", "e.md", "expected.json"]) assert.ok(hits.some((h) => h.file === f), f);
});

test("the relation definitions keep the rules and drop the support-scope sentences", () => {
  const guide = execFileSync("git", ["show", `${DEFAULTS.guideCommit}:${DEFAULTS.guidePath}`], { cwd: REPO, encoding: "utf8" });
  const { text, applied } = blindGuide(guide);
  assert.ok(applied.length >= 7);
  for (const heading of ["## 2. 노드", "## 3. Owner", "### 4.1 calls", "### 4.5 dataflow", "### 5.4 NestJS", "결정성"]) assert.ok(text.includes(heading), heading);
  for (const gone of ["unsupported-by-design", "§6.1 분류", "catalog.csv", "h03", "adapter"]) assert.ok(!text.includes(gone), gone);
});

test("the packet is reproducible: same inputs, same packet hash", () => {
  const { packetSha256 } = packet();
  const again = buildPacket({ out: path.join(tmp(), "out") });
  assert.equal(again.packetSha256, packetSha256);
});

test("the builder refuses to write inside the repository", () => {
  assert.throws(() => buildPacket({ out: path.join(REPO, "tmp-p14c-packet-test") }), /outside the repository/);
  assert.equal(fs.existsSync(path.join(REPO, "tmp-p14c-packet-test")), false);
});

// A reviewer who writes exactly GT v1, in the reviewer form's notation, for every case of both corpora.
function perfectReviewer(gt, blindId) {
  const byId = new Map(gt.nodes.map((n) => [n.id, n]));
  const ep = (id) => {
    const n = byId.get(id);
    if (!n) return ["", "", ""];
    if (n.type === "lib") return ["lib", "", n.symbol];
    if (n.type === "file") return [n.file, "", "<file>"];
    if (n.type === "module") return [n.file, "", "<module>"];
    if (n.type === "synthetic") return [n.file, String(n.line), `<${n.role}>`];
    return [n.file, String(n.line), n.name ?? n.id];
  };
  const rels = gt.relations.map((r, i) => {
    const [sf, sl, sn] = ep(r.source);
    const [tf, tl, tn] = r.target != null ? ep(r.target) : ["", "", ""];
    const cands = r.candidates === "unbounded" ? "unbounded" : (r.candidates ?? []).map((c) => {
      const n = byId.get(c.target);
      return n.type === "lib" ? `L|${n.symbol}` : n.type === "file" ? `F|${n.file}` : n.type === "synthetic" ? `S|${n.file}|${n.line}` : n.type === "module" ? `M|${n.file}` : `D|${n.file}|${n.line}`;
    }).sort().join(";");
    return { blindId, relNo: String(i + 1), kind: r.kind, sourceFile: sf, sourceLine: sl, sourceName: sn, targetFile: tf, targetLine: tl, targetName: tn, argIndex: r.argIndex == null ? "" : String(r.argIndex), determinacy: r.gtStatus, candidates: cands, evidence: (r.evidence ?? []).join(";"), confidence: "high" };
  });
  const negs = (gt.negatives ?? []).map((n, i) => {
    const [sf, sl, sn] = ep(n.source);
    const [tf, tl, tn] = n.target != null ? ep(n.target) : ["", "", ""];
    return { blindId, negNo: String(i + 1), kind: n.kind, sourceFile: sf, sourceLine: sl, sourceName: sn, targetFile: tf, targetLine: tl, targetName: tn, argIndex: n.argIndex == null ? "" : String(n.argIndex), evidence: (n.evidence ?? []).join(";") };
  });
  return { rels, negs };
}

test("reconcile: a reviewer who writes GT v1 agrees on every item of all 64 cases", () => {
  const { out } = packet();
  const key = JSON.parse(fs.readFileSync(path.join(out, "researcher", "blind-key.json"), "utf8"));
  let items = 0;
  for (const c of key) {
    const root = c.corpus === "A" ? DEFAULTS.corpusAPath : DEFAULTS.corpusBPath;
    const commit = c.corpus === "A" ? DEFAULTS.corpusACommit : DEFAULTS.corpusBCommit;
    const gt = JSON.parse(execFileSync("git", ["show", `${commit}:${root}/${c.category}/${c.caseId}/expected.json`], { cwd: REPO, encoding: "utf8" }));
    const { rels, negs } = perfectReviewer(gt, c.blindId);
    const rows = compareCase(gtItems(gt), reviewerItems(rels, negs));
    const bad = rows.filter((r) => !["AGREE", "AGREE_ALTERNATIVE", "NEGATIVE_AGREE"].includes(r.outcome));
    assert.deepEqual(bad.map((r) => [r.outcome, r.gt?.id, r.rev?.id]), [], c.caseId);
    items += rows.length;
  }
  assert.ok(items > 900);
});

test("reconcile: disagreements get their own outcome codes", () => {
  const gt = {
    nodes: [{ id: "file", type: "file", file: "main.ts" }, { id: "a", type: "callable", file: "main.ts", line: 1, name: "a" }, { id: "b", type: "callable", file: "main.ts", line: 5, name: "b" }, { id: "c", type: "callable", file: "main.ts", line: 9, name: "c" }],
    relations: [
      { id: "R1", kind: "calls", source: "a", target: "b", gtStatus: "determinate" },
      { id: "R2", kind: "dataflow", source: "a", target: "b", argIndex: 0, gtStatus: "determinate" },
      { id: "R3", kind: "calls", source: "c", target: "b", gtStatus: "determinate" },
      { id: "R4", kind: "references", source: "file", target: "c", gtStatus: "determinate" },
    ],
    negatives: [{ id: "N1", kind: "calls", source: "b", target: "a" }],
  };
  const row = (relNo, kind, s, t, extra = {}) => ({ relNo, kind, sourceFile: "main.ts", sourceLine: s === "<file>" ? "" : s, sourceName: s === "<file>" ? "<file>" : "x", targetFile: "main.ts", targetLine: t, targetName: "y", argIndex: "", determinacy: "determinate", candidates: "", ...extra });
  const rev = reviewerItems(
    [row("1", "calls", "1", "5"), row("2", "dataflow", "1", "5", { argIndex: "1" }), row("3", "references", "9", "5"), row("4", "calls", "5", "1"), row("5", "calls", "9", "1")],
    [],
  );
  const rows = compareCase(gtItems(gt), rev);
  const by = (o) => rows.filter((r) => r.outcome === o).map((r) => r.gt?.id ?? r.rev?.id);
  assert.deepEqual(by("AGREE"), ["R1"]);
  assert.deepEqual(by("ARG_DIFF"), ["R2"]);
  assert.deepEqual(by("KIND_DIFF"), ["R3"]);
  assert.deepEqual(by("POLARITY_CONFLICT"), ["N1"]);
  assert.deepEqual(by("GT_ONLY"), ["R4"]);
  assert.deepEqual(by("REVIEWER_ONLY"), ["rel5"]);
  const a = agreement(rows);
  assert.equal(a.both, 1);
});

test("parseCsv reads quoted cells and a BOM", () => {
  assert.deepEqual(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\n'), [{ a: "x, y", b: 'say "hi"' }]);
});
