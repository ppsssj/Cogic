#!/usr/bin/env node
// EXP-01 pre-registration manifest (P1-A).
//
// Records SHA-256 of every Ground Truth / fixture / scoring-tool file so a later run can
// prove that GT and rules did not change after pre-registration. Hashes are computed on
// LF-normalized text so core.autocrlf checkouts produce the same value.
//
// Usage:
//   node manifest.mjs            # write fixtures/exp-01/gt-manifest.json
//   node manifest.mjs --check    # verify current files against the manifest (exit 1 on drift)

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const corpus = path.join(repoRoot, "docs/thesis-experiments/fixtures/exp-01");
const manifestPath = path.join(corpus, "gt-manifest.json");
const ROOTS = ["docs/thesis-experiments/fixtures/exp-01", "docs/thesis-experiments/tools/exp01"];
// Generated or reviewer-owned files that may legitimately change after pre-registration.
const EXCLUDE = new Set([
  "docs/thesis-experiments/fixtures/exp-01/gt-manifest.json",
  "docs/thesis-experiments/fixtures/exp-01/validation-report.json",
]);

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

function main() {
  const check = process.argv.includes("--check");
  const current = build();
  if (!check) {
    const doc = {
      schema: "exp01-manifest/1",
      note: "SHA-256 of LF-normalized UTF-8 text. Excludes this file and validation-report.json.",
      fileCount: Object.keys(current).length,
      files: current,
    };
    fs.writeFileSync(manifestPath, `${JSON.stringify(doc, null, 2)}\n`);
    console.log(`wrote ${path.relative(repoRoot, manifestPath)} (${doc.fileCount} files)`);
    return;
  }
  const recorded = JSON.parse(fs.readFileSync(manifestPath, "utf8")).files;
  const problems = [];
  for (const [f, h] of Object.entries(recorded)) {
    if (!(f in current)) {
      problems.push(`missing ${f}`);
    } else if (current[f] !== h) {
      problems.push(`changed ${f}`);
    }
  }
  for (const f of Object.keys(current)) {
    if (!(f in recorded)) {
      problems.push(`added ${f}`);
    }
  }
  for (const p of problems) {
    console.log(p);
  }
  console.log(problems.length === 0 ? `manifest OK (${Object.keys(recorded).length} files)` : `manifest DRIFT (${problems.length})`);
  process.exitCode = problems.length === 0 ? 0 : 1;
}

main();
