#!/usr/bin/env node
// Corpus B (P1-K1) file selection. Deterministic: fixed repositories, commits, rules and seeds.
//
// The rules below were fixed before any candidate file was opened. The script never reads Cogic
// output. It reads only git-tracked files of the pinned commits.
//
// Usage: node select-files.mjs --src <dir with one checkout per framework: react, vue, express, nest>
//                              [--json <out>]
// Each checkout must be at the pinned commit (verified).

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const { seededShuffle } = await import(pathToFileURL(path.join(repoRoot, "docs/thesis-experiments/tools/exp01/lib.mjs")).href);
const ts = createRequire(path.join(repoRoot, "package.json"))("typescript");

// selection/2 (2026-10-29, before MANIFEST.json and before any Cogic run): REEXPORT_ONLY parses the
// file instead of splitting it with a regex. Only the vue selection changed; see corpus-b/README.md §3.
export const SELECTION_VERSION = "corpus-b-selection/2";
export const SAMPLE_SIZE = 5;
export const MIN_CODE_LINES = 10;
export const MAX_CODE_LINES = 120;

export const FRAMEWORKS = [
  { id: "react", repo: "alan2207/bulletproof-react", sha: "9506629ed003a561c6627735480cce4994244bb4", license: "MIT", srcRoot: "apps/react-vite/src", frameworkModule: (m) => m === "react", seed: 20261030 },
  { id: "vue", repo: "mutoe/vue3-realworld-example-app", sha: "741c215ef0f674f90fcb03c5493a1b3a3a7f1b03", license: "MIT", srcRoot: "src", frameworkModule: (m) => m === "vue", seed: 20261031 },
  { id: "express", repo: "edwinhern/express-typescript", sha: "983fa0413659cd921c5754b00f7817903eb91364", license: "MIT", srcRoot: "src", frameworkModule: (m) => m === "express", seed: 20261032 },
  { id: "nest", repo: "brocoders/nestjs-boilerplate", sha: "9620f159eefe38f47747d02ab162852367c5472c", license: "MIT", srcRoot: "src", frameworkModule: (m) => m.startsWith("@nestjs/"), seed: 20261033 },
];

const TEST_DIR = /(^|\/)(__tests__|__mocks__|mocks?|tests?|e2e|testing|fixtures?|stories|seeds?|migrations?)(\/|$)/i;
const TEST_FILE = /\.(test|spec|stories|e2e|mock)\.tsx?$/i;
const GENERATED = /@generated|auto-?generated|do not edit/i;

export function codeLines(text) {
  let inBlock = false;
  let n = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (inBlock) {
      if (line.includes("*/")) inBlock = false;
      continue;
    }
    if (line === "" || line.startsWith("//")) continue;
    if (line.startsWith("/*")) {
      if (!line.includes("*/")) inBlock = true;
      continue;
    }
    n += 1;
  }
  return n;
}

// Static `import ... from "m"` / `import "m"` / `export ... from "m"` specifiers (no code execution).
export function moduleSpecifiers(text) {
  const out = [];
  const re = /^\s*(?:import|export)\b[^'"`;]*?(?:from\s*)?["']([^"']+)["']/gm;
  for (const m of text.matchAll(re)) out.push(m[1]);
  return out;
}

// Every top-level statement is an import declaration or an `export ... from "m"` declaration.
// selection/1 split statements with a regex on `;`/newlines; in files without semicolons the last
// import swallowed the code after it (vue src/main.ts was wrongly excluded). selection/2 parses.
export function isReexportOnly(text) {
  const sf = ts.createSourceFile("x.tsx", text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
  return sf.statements.length > 0 && sf.statements.every((s) => ts.isImportDeclaration(s) || (ts.isExportDeclaration(s) && s.moduleSpecifier !== undefined));
}

export function classify(file, text, fw) {
  if (!file.startsWith(`${fw.srcRoot}/`)) return "OUTSIDE_SRC_ROOT";
  if (!/\.tsx?$/.test(file) || file.endsWith(".d.ts")) return "NOT_TS_SOURCE";
  if (TEST_DIR.test(file.slice(fw.srcRoot.length)) || TEST_FILE.test(file)) return "TEST_OR_FIXTURE";
  if (/(^|\/)generated(\/|$)/i.test(file) || GENERATED.test(text.split(/\r?\n/).slice(0, 5).join("\n"))) return "GENERATED";
  if (!moduleSpecifiers(text).some(fw.frameworkModule)) return "NO_FRAMEWORK_IMPORT";
  if (isReexportOnly(text)) return "REEXPORT_ONLY";
  const n = codeLines(text);
  if (n < MIN_CODE_LINES) return "TOO_SMALL";
  if (n > MAX_CODE_LINES) return "TOO_LARGE";
  return "ELIGIBLE";
}

export function selectFor(fw, checkoutDir) {
  const head = execFileSync("git", ["-C", checkoutDir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (head !== fw.sha) throw new Error(`${fw.id}: checkout at ${head}, expected ${fw.sha}`);
  const files = execFileSync("git", ["-C", checkoutDir, "ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean).sort();
  const rows = files
    .filter((f) => f.startsWith(`${fw.srcRoot}/`))
    .map((f) => {
      const text = fs.readFileSync(path.join(checkoutDir, f), "utf8");
      return { file: f, reason: classify(f, text, fw), codeLines: /\.tsx?$/.test(f) ? codeLines(text) : null };
    });
  const eligible = rows.filter((r) => r.reason === "ELIGIBLE").map((r) => r.file);
  const selected = seededShuffle(eligible, fw.seed).slice(0, SAMPLE_SIZE);
  return {
    framework: fw.id,
    repo: fw.repo,
    url: `https://github.com/${fw.repo}`,
    sha: fw.sha,
    license: fw.license,
    srcRoot: fw.srcRoot,
    seed: fw.seed,
    candidates: rows.length,
    eligibleCount: eligible.length,
    eligible,
    excluded: rows.filter((r) => r.reason !== "ELIGIBLE"),
    selected,
  };
}

function main() {
  const arg = (n) => {
    const i = process.argv.indexOf(n);
    return i >= 0 ? process.argv[i + 1] : null;
  };
  const src = arg("--src");
  if (!src) throw new Error("--src is required");
  const result = {
    selectionVersion: SELECTION_VERSION,
    rules: {
      sampleSize: SAMPLE_SIZE,
      codeLines: [MIN_CODE_LINES, MAX_CODE_LINES],
      order: "eligible paths sorted, then seededShuffle(paths, seed) from tools/exp01/lib.mjs (mulberry32), first sampleSize",
      exclusions: ["OUTSIDE_SRC_ROOT", "NOT_TS_SOURCE", "TEST_OR_FIXTURE", "GENERATED", "NO_FRAMEWORK_IMPORT", "REEXPORT_ONLY", "TOO_SMALL", "TOO_LARGE"],
    },
    frameworks: FRAMEWORKS.map((fw) => selectFor(fw, path.join(src, fw.id))),
  };
  const text = `${JSON.stringify(result, null, 2)}\n`;
  const out = arg("--json");
  if (out) fs.writeFileSync(path.resolve(out), text);
  for (const f of result.frameworks) {
    console.log(`${f.framework}: candidates ${f.candidates}, eligible ${f.eligibleCount}, selected ${f.selected.join(", ")}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
