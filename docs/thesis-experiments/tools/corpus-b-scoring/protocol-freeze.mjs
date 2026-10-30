#!/usr/bin/env node
// P1-K4: hash freeze for the Corpus B scoring protocol v2 (EVALUATION_PROTOCOL.v2.md §10).
// --print shows the current hashes (no file written). --write <file> records them AFTER the researcher
// approved the protocol; it refuses to overwrite. --check <file> verifies a recorded freeze.
// SHA-256 of LF-normalized UTF-8 text.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
export const FROZEN = [
  "docs/thesis-experiments/corpus-b/review-preparation/EVALUATION_PROTOCOL.v2.md",
  "docs/thesis-experiments/corpus-b/EVALUATION_PROTOCOL.md",
  "docs/thesis-experiments/corpus-b/MANIFEST.json",
  "docs/thesis-experiments/tools/exp01/score.mjs",
  "docs/thesis-experiments/tools/exp01/lib.mjs",
  "docs/thesis-experiments/tools/corpus-b-scoring/scope-v2.mjs",
  "docs/thesis-experiments/tools/corpus-b-scoring/synthetic-scenarios.mjs",
  "docs/thesis-experiments/tools/corpus-b-scoring/protocol-freeze.mjs",
  "docs/thesis-experiments/tools/corpus-b-scoring/test/scope-v2.test.mjs",
];
const hash = (rel) => crypto.createHash("sha256").update(fs.readFileSync(path.join(repoRoot, rel), "utf8").replace(/\r\n/g, "\n"), "utf8").digest("hex");
export const current = () => Object.fromEntries(FROZEN.map((f) => [f, hash(f)]));

function main() {
  const a = process.argv;
  if (a.includes("--print")) {
    for (const [f, h] of Object.entries(current())) console.log(`${h}  ${f}`);
  } else if (a.includes("--write")) {
    const out = path.resolve(a[a.indexOf("--write") + 1]);
    if (fs.existsSync(out)) throw new Error(`${out} exists; refusing to overwrite`);
    const text = fs.readFileSync(path.join(repoRoot, FROZEN[0]), "utf8");
    if (!/상태: \*\*APPROVED/.test(text)) throw new Error("EVALUATION_PROTOCOL.v2.md is not marked APPROVED; freeze only after the researcher's approval");
    fs.writeFileSync(out, `${JSON.stringify({ schema: "corpus-b-scoring-protocol-freeze/1", files: current() }, null, 2)}\n`);
    console.log(`wrote ${out}`);
  } else if (a.includes("--check")) {
    const rec = JSON.parse(fs.readFileSync(path.resolve(a[a.indexOf("--check") + 1]), "utf8")).files;
    const now = current();
    const bad = Object.keys(rec).filter((f) => now[f] !== rec[f]);
    for (const f of bad) console.log(`changed ${f}`);
    console.log(bad.length ? `protocol freeze DRIFT (${bad.length})` : `protocol freeze OK (${Object.keys(rec).length} files)`);
    process.exitCode = bad.length ? 1 : 0;
  } else {
    throw new Error("--print | --write <file> | --check <file>");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
