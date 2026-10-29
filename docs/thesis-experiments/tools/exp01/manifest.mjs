#!/usr/bin/env node
// EXP-01 pre-registration manifest (P1-A).
//
// Records SHA-256 of every Ground Truth / fixture / scoring-tool file so a later run can
// prove that GT and rules did not change after pre-registration. Hashes are computed on
// LF-normalized text so core.autocrlf checkouts produce the same value.
//
// Manifests:
//   fixtures/exp-01/gt-manifest.json        pre-registration (41bbe19). Frozen; never rewritten.
//   fixtures/exp-01/eval-manifest.r1.json   evaluation-tool baseline after P1-A-R1 (scorer fix).
//   fixtures/exp-01/eval-manifest.r2.json   P1-G post-hoc amendment (scorer 1.2). r1 is kept as is.
//
// Usage:
//   node manifest.mjs --check [--manifest <file>] [--scope all|gt]
//       verify current files (exit 1 on drift). Default manifest: gt-manifest.json.
//       --scope gt checks only GT data: every file under fixtures/exp-01 except *.md
//       (expected/case JSON, fixture sources, tsconfig, shims, catalog.csv, review sample).
//   node manifest.mjs --write --manifest <file> [--force]
//       write a new manifest. Refuses to overwrite an existing file without --force.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const corpus = path.join(repoRoot, "docs/thesis-experiments/fixtures/exp-01");
const defaultManifest = path.join(corpus, "gt-manifest.json");
const ROOTS = ["docs/thesis-experiments/fixtures/exp-01", "docs/thesis-experiments/tools/exp01"];
// Generated or reviewer-owned files that may legitimately change after pre-registration.
const EXCLUDE = new Set([
  "docs/thesis-experiments/fixtures/exp-01/gt-manifest.json",
  "docs/thesis-experiments/fixtures/exp-01/eval-manifest.r1.json",
  "docs/thesis-experiments/fixtures/exp-01/eval-manifest.r2.json",
  "docs/thesis-experiments/fixtures/exp-01/validation-report.json",
]);

export function isGtData(rel) {
  return rel.startsWith("docs/thesis-experiments/fixtures/exp-01/") && !rel.endsWith(".md");
}

function walk(rel) {
  const abs = path.join(repoRoot, rel);
  const out = [];
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const childRel = `${rel}/${e.name}`;
    if (e.isDirectory()) {
      if (childRel.endsWith("/review/filled")) {
        continue;
      }
      out.push(...walk(childRel));
    } else if (!EXCLUDE.has(childRel)) {
      out.push(childRel);
    }
  }
  return out;
}

export function hashFile(abs) {
  const text = fs.readFileSync(abs, "utf8").replace(/\r\n/g, "\n");
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function build() {
  const files = ROOTS.flatMap(walk).sort();
  return Object.fromEntries(files.map((f) => [f, hashFile(path.join(repoRoot, f))]));
}

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

function main() {
  const manifestArg = argValue("--manifest");
  const manifestPath = manifestArg ? path.resolve(manifestArg) : defaultManifest;
  const scope = argValue("--scope") ?? "all";
  if (!["all", "gt"].includes(scope)) {
    throw new Error(`unknown scope ${scope}`);
  }
  const current = build();
  if (process.argv.includes("--write")) {
    if (fs.existsSync(manifestPath) && !process.argv.includes("--force")) {
      throw new Error(`${path.relative(repoRoot, manifestPath)} exists; refusing to overwrite (use --force)`);
    }
    const doc = {
      schema: "exp01-manifest/1",
      note: "SHA-256 of LF-normalized UTF-8 text. Excludes manifest files and validation-report.json.",
      fileCount: Object.keys(current).length,
      files: current,
    };
    fs.writeFileSync(manifestPath, `${JSON.stringify(doc, null, 2)}
`);
    console.log(`wrote ${path.relative(repoRoot, manifestPath)} (${doc.fileCount} files)`);
    return;
  }
  if (!process.argv.includes("--check")) {
    throw new Error("use --check or --write");
  }
  const inScope = (f) => scope === "all" || isGtData(f);
  const recorded = Object.fromEntries(
    Object.entries(JSON.parse(fs.readFileSync(manifestPath, "utf8")).files).filter(([f]) => inScope(f)),
  );
  const problems = [];
  for (const [f, h] of Object.entries(recorded)) {
    if (!(f in current)) {
      problems.push(`missing ${f}`);
    } else if (current[f] !== h) {
      problems.push(`changed ${f}`);
    }
  }
  for (const f of Object.keys(current).filter(inScope)) {
    if (!(f in recorded)) {
      problems.push(`added ${f}`);
    }
  }
  for (const p of problems) {
    console.log(p);
  }
  const label = `${path.relative(repoRoot, manifestPath).replace(/\\/g, "/")}, scope ${scope}`;
  console.log(problems.length === 0 ? `manifest OK (${Object.keys(recorded).length} files; ${label})` : `manifest DRIFT (${problems.length}; ${label})`);
  process.exitCode = problems.length === 0 ? 0 : 1;
}

main();
