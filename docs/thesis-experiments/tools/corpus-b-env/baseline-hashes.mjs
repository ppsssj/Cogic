#!/usr/bin/env node
// P1-K2: hashes of everything the environment audit must leave unchanged (Corpus B inputs and GT,
// EXP-01 scorer/runner, production analyzer). SHA-256 of LF-normalized UTF-8 text, plus the git tree
// ids of src/analyzer and src/shared at HEAD. Read-only except for the --write output file.
// Usage: node baseline-hashes.mjs --write <out.json>   (refuses to overwrite)
//        node baseline-hashes.mjs --check <out.json>
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const corpus = "docs/thesis-experiments/corpus-b/fixtures";
const toPosix = (p) => p.split(path.sep).join("/");
const walk = (rel) => {
  const abs = path.join(repoRoot, rel);
  if (fs.statSync(abs).isFile()) return [rel];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => walk(`${rel}/${e.name}`));
};
const hash = (rel) => crypto.createHash("sha256").update(fs.readFileSync(path.join(repoRoot, rel), "utf8").replace(/\r\n/g, "\n"), "utf8").digest("hex");

export function groups() {
  const caseFiles = walk(corpus).map(toPosix);
  const pick = (re) => caseFiles.filter((f) => re.test(f)).sort();
  return {
    corpusBManifest: ["docs/thesis-experiments/corpus-b/MANIFEST.json"],
    expectedJson: pick(/\/expected\.json$/),
    caseJson: pick(/\/case\.json$/),
    tsconfigJson: pick(/\/tsconfig\.json$/),
    shims: pick(/\/shims\//),
    scorer: ["docs/thesis-experiments/tools/exp01/score.mjs", "docs/thesis-experiments/tools/exp01/lib.mjs", "docs/thesis-experiments/tools/exp01/validate-gt.mjs"],
    runner: ["docs/thesis-experiments/tools/exp01-run.mjs"],
    analyzer: walk("src/analyzer").map(toPosix).sort(),
    shared: walk("src/shared").map(toPosix).sort(),
  };
}

export function snapshot() {
  const g = groups();
  const files = {};
  for (const [name, list] of Object.entries(g)) files[name] = Object.fromEntries(list.map((f) => [f, hash(f)]));
  const tree = (p) => execFileSync("git", ["-C", repoRoot, "rev-parse", `HEAD:${p}`], { encoding: "utf8" }).trim();
  return { schema: "corpus-b-env-baseline/1", note: "SHA-256 of LF-normalized UTF-8 text", gitTrees: { "src/analyzer": tree("src/analyzer"), "src/shared": tree("src/shared") }, counts: Object.fromEntries(Object.entries(g).map(([k, v]) => [k, v.length])), files };
}

function main() {
  const w = process.argv.indexOf("--write");
  const c = process.argv.indexOf("--check");
  if (w >= 0) {
    const out = path.resolve(process.argv[w + 1]);
    if (fs.existsSync(out)) throw new Error(`${out} exists; refusing to overwrite`);
    const s = snapshot();
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(s, null, 2)}\n`);
    console.log(`wrote ${path.basename(out)}: ${JSON.stringify(s.counts)}`);
  } else if (c >= 0) {
    const recorded = JSON.parse(fs.readFileSync(path.resolve(process.argv[c + 1]), "utf8"));
    const now = snapshot();
    const problems = [];
    for (const [g, files] of Object.entries(recorded.files)) {
      for (const [f, h] of Object.entries(files)) if (now.files[g]?.[f] !== h) problems.push(`${g}: ${now.files[g]?.[f] ? "changed" : "missing"} ${f}`);
      for (const f of Object.keys(now.files[g] ?? {})) if (!(f in files)) problems.push(`${g}: added ${f}`);
    }
    for (const [p, t] of Object.entries(recorded.gitTrees)) if (now.gitTrees[p] !== t) problems.push(`git tree ${p}: ${t} -> ${now.gitTrees[p]}`);
    for (const p of problems) console.log(p);
    console.log(problems.length === 0 ? `baseline OK (${JSON.stringify(recorded.counts)})` : `baseline DRIFT (${problems.length})`);
    process.exitCode = problems.length === 0 ? 0 : 1;
  } else {
    throw new Error("--write <out> or --check <out>");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
