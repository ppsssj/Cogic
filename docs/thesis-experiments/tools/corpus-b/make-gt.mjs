#!/usr/bin/env node
// Corpus B (P1-K1): rebuild every expected.json from the deterministic annotate-assist draft plus the
// committed review module corpus-b/review/<caseId>.mjs. Cases without a review module are skipped.
// Usage: node make-gt.mjs [--case <caseId>] [--print]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assist } from "./annotate-assist.mjs";
import { finalize } from "./finalize-gt.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const corpusRoot = path.resolve(here, "../../corpus-b");
const only = process.argv.includes("--case") ? process.argv[process.argv.indexOf("--case") + 1] : null;
for (const fw of fs.readdirSync(path.join(corpusRoot, "fixtures")).sort()) {
  const dir = path.join(corpusRoot, "fixtures", fw);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const caseId of fs.readdirSync(dir).sort()) {
    if (only && caseId !== only) continue;
    const reviewPath = path.join(corpusRoot, "review", `${caseId}.mjs`);
    if (!fs.existsSync(reviewPath)) continue;
    const caseDir = path.join(dir, caseId);
    const { gt: draft } = assist(caseDir);
    const review = await import(pathToFileURL(reviewPath).href);
    const { gt, reviewLog } = finalize(draft, review);
    fs.writeFileSync(path.join(caseDir, "expected.json"), `${JSON.stringify(gt, null, 2)}\n`);
    console.log(`${caseId}: nodes ${gt.nodes.length}, relations ${gt.relations.length}, negatives ${gt.negatives.length}, excludedSites ${gt.excludedSites.length}${reviewLog.length ? `, dropped ${reviewLog.length}` : ""}`);
    if (process.argv.includes("--print")) {
      for (const r of [...gt.relations, ...gt.negatives]) console.log(`  ${r.id} ${r.kind} ${r.source} -> ${r.target ?? JSON.stringify(r.candidates ?? "")}${r.argIndex !== undefined ? `#${r.argIndex}` : ""} ${r.pattern} ${r.gtStatus ?? ""} ${(r.evidence ?? []).map((e) => e.split(":").pop()).join(",")}`);
      for (const s of gt.excludedSites) console.log(`  X ${s.site.split(":").pop()} ${s.reason}`);
    }
  }
}
