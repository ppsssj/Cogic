#!/usr/bin/env node
// P14-D: counts GT v1 relations of Corpus A and B by kind, determinacy and the evidence question each
// raises (decorators, owner position, framework semantics). Reads GT from git at the pinned commits;
// prints counts only; writes nothing unless --out is given.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const CORPORA = {
  A: { commit: "6ee778418e189d02ba11089de7550231c75292ac", root: "docs/thesis-experiments/fixtures/exp-01" },
  B: { commit: "4c5a3e234f930057b15e3f0a608939839c0dc62a", root: "docs/thesis-experiments/corpus-b/fixtures" },
};
const git = (args) => execFileSync("git", args, { cwd: REPO, encoding: "utf8", maxBuffer: 1 << 26 });
// Evidence classes that can decide a relation of this pattern family (see evidence-matrix.md).
export function evidenceClass(r, nodes) {
  const p = r.pattern ?? "";
  const tgt = nodes.get(r.target);
  if (/DECORATOR/.test(p)) return "decorator";
  if (r.kind === "owner" || /^FW-|^UPD-|^REF-.*STATE|SETTER|DISPATCH/.test(p) || r.kind === "updates") return "framework-semantics";
  if (r.gtStatus === "indeterminate") return "dynamic/indeterminate";
  if (tgt?.type === "lib") return "ts-lib";
  if (tgt?.type === "external" || tgt?.type === "module") return "cross-file";
  if (/OVERLOAD|GENERIC|UNION|ALIAS|BARREL|CALLBACK|HOF|DYNAMIC|SPREAD|REST/.test(p)) return "type-resolution";
  return "local-syntax";
}
const result = {};
for (const [label, c] of Object.entries(CORPORA)) {
  const files = git(["ls-tree", "-r", "--name-only", c.commit, c.root]).split("\n").filter((f) => f.endsWith("/expected.json") && !f.includes("/review/"));
  const t = { cases: files.length, relations: 0, negatives: 0, byKind: {}, byDeterminacy: {}, byEvidenceClass: {}, decoratorPatterns: {} };
  for (const f of files) {
    const gt = JSON.parse(git(["show", `${c.commit}:${f}`]));
    const nodes = new Map(gt.nodes.map((n) => [n.id, n]));
    for (const r of gt.relations) {
      t.relations += 1;
      t.byKind[r.kind] = (t.byKind[r.kind] ?? 0) + 1;
      t.byDeterminacy[r.gtStatus] = (t.byDeterminacy[r.gtStatus] ?? 0) + 1;
      const e = evidenceClass(r, nodes);
      t.byEvidenceClass[e] = (t.byEvidenceClass[e] ?? 0) + 1;
      if (/DECORATOR/.test(r.pattern ?? "")) t.decoratorPatterns[r.pattern] = (t.decoratorPatterns[r.pattern] ?? 0) + 1;
    }
    t.negatives += (gt.negatives ?? []).length;
  }
  result[label] = t;
}
console.log(JSON.stringify(result, null, 1));
const i = process.argv.indexOf("--out");
if (i > 0) fs.writeFileSync(process.argv[i + 1], `${JSON.stringify(result, null, 1)}\n`);
