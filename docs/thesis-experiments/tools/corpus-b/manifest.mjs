#!/usr/bin/env node
// Corpus B (P1-K1) freeze manifest. SHA-256 of LF-normalized text for every file that defines the
// evaluation input and its Ground Truth: corpus-b/fixtures/**, corpus-b/review/**, corpus-b/selection.json
// and tools/corpus-b/**. The manifest file and generated reports are excluded.
// Usage: node manifest.mjs --write   (refuses to overwrite)   |   node manifest.mjs --check
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const manifestPath = path.join(repoRoot, "docs/thesis-experiments/corpus-b/MANIFEST.json");
const ROOTS = ["docs/thesis-experiments/corpus-b/fixtures", "docs/thesis-experiments/corpus-b/review", "docs/thesis-experiments/corpus-b/selection.json", "docs/thesis-experiments/tools/corpus-b"];
const toPosix = (p) => p.split(path.sep).join("/");
const walk = (rel) => {
  const abs = path.join(repoRoot, rel);
  if (fs.statSync(abs).isFile()) return [rel];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => walk(`${rel}/${e.name}`));
};
const hash = (rel) => crypto.createHash("sha256").update(fs.readFileSync(path.join(repoRoot, rel), "utf8").replace(/\r\n/g, "\n"), "utf8").digest("hex");
const current = () => Object.fromEntries(ROOTS.flatMap(walk).map(toPosix).sort().map((f) => [f, hash(f)]));

if (process.argv.includes("--write")) {
  if (fs.existsSync(manifestPath)) throw new Error("MANIFEST.json exists; refusing to overwrite");
  const files = current();
  fs.writeFileSync(manifestPath, `${JSON.stringify({ schema: "corpus-b-manifest/1", note: "SHA-256 of LF-normalized UTF-8 text", fileCount: Object.keys(files).length, files }, null, 2)}\n`);
  console.log(`wrote MANIFEST.json (${Object.keys(files).length} files)`);
} else {
  const recorded = JSON.parse(fs.readFileSync(manifestPath, "utf8")).files;
  const now = current();
  const problems = [
    ...Object.keys(recorded).filter((f) => !(f in now)).map((f) => `missing ${f}`),
    ...Object.keys(recorded).filter((f) => f in now && now[f] !== recorded[f]).map((f) => `changed ${f}`),
    ...Object.keys(now).filter((f) => !(f in recorded)).map((f) => `added ${f}`),
  ];
  for (const p of problems) console.log(p);
  console.log(problems.length === 0 ? `corpus-b manifest OK (${Object.keys(recorded).length} files)` : `corpus-b manifest DRIFT (${problems.length})`);
  process.exitCode = problems.length === 0 ? 0 : 1;
}
