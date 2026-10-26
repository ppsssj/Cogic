#!/usr/bin/env node
// EXP-01 reviewer agreement (P1-A tool, used after a human fills review-sheet.csv).
//
// Joins the filled blind sheet with review-key.csv and reports Cohen's kappa between the
// GT label and the reviewer label (exists / not-exists / undeterminable), overall and per
// category. Rows with an empty reviewerLabel are reported as unreviewed, not as agreement.
//
// Usage: node review-agreement.mjs --sheet <filled.csv> --key <review-key.csv> [--json <out>]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cohenKappa, parseCsv } from "./lib.mjs";

const LABELS = new Set(["exists", "not-exists", "undeterminable"]);

export function agreement(sheetRows, keyRows) {
  const key = new Map(keyRows.map((r) => [r.sampleId, r]));
  const reviewed = [];
  const unreviewed = [];
  const invalid = [];
  for (const row of sheetRows) {
    const k = key.get(row.sampleId);
    if (!k) {
      invalid.push({ sampleId: row.sampleId, reason: "not in key" });
      continue;
    }
    const label = (row.reviewerLabel ?? "").trim();
    if (label === "") {
      unreviewed.push(row.sampleId);
      continue;
    }
    if (!LABELS.has(label)) {
      invalid.push({ sampleId: row.sampleId, reason: `invalid label ${label}` });
      continue;
    }
    reviewed.push({ sampleId: row.sampleId, category: k.category, gt: k.gtLabel, reviewer: label });
  }
  const overall = cohenKappa(
    reviewed.map((r) => r.gt),
    reviewed.map((r) => r.reviewer),
  );
  const categories = [...new Set(reviewed.map((r) => r.category))].sort().map((category) => {
    const rows = reviewed.filter((r) => r.category === category);
    return { category, ...cohenKappa(rows.map((r) => r.gt), rows.map((r) => r.reviewer)) };
  });
  const disagreements = reviewed.filter((r) => r.gt !== r.reviewer);
  return { reviewed: reviewed.length, unreviewed, invalid, overall, categories, disagreements };
}

function main() {
  const argv = process.argv;
  const get = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : null;
  };
  const sheet = get("--sheet");
  const keyFile = get("--key");
  if (!sheet || !keyFile) {
    throw new Error("--sheet and --key are required");
  }
  const result = agreement(parseCsv(fs.readFileSync(sheet, "utf8")), parseCsv(fs.readFileSync(keyFile, "utf8")));
  console.log(
    `reviewed ${result.reviewed}, unreviewed ${result.unreviewed.length}, invalid ${result.invalid.length}, kappa ${result.overall.kappa ?? "n/a"}`,
  );
  const out = get("--json");
  if (out) {
    fs.writeFileSync(path.resolve(out), `${JSON.stringify(result, null, 2)}\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
