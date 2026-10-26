#!/usr/bin/env node
// EXP-01 independent review sample generator (P1-A).
//
// Draws a seeded, category-stratified sample (default 20%, rounded up per category) of GT
// items (determinate relations, indeterminate entries, negatives) and writes:
//   review/review-sheet.csv : blind sheet for a human reviewer (no GT answer, shuffled)
//   review/review-key.csv   : GT answers keyed by sampleId (reviewer must not open it)
//   review/sample.json      : sampling parameters and counts
// The reviewer columns are left empty. This tool never fills in review results.
//
// Usage: node review-sample.mjs [--corpus <dir>] [--out <dir>] [--rate 0.2] [--seed 20261026]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { categoryFor, gtFileName, listCaseDirs, readJson, seededShuffle, toCsv } from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");

function parseArgs(argv) {
  const corpus = path.join(repoRoot, "docs/thesis-experiments/fixtures/exp-01");
  const args = { corpus, out: path.join(corpus, "review"), rate: 0.2, seed: 20261026, gtVersion: 1 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--corpus") {
      args.corpus = path.resolve(argv[++i]);
    } else if (a === "--out") {
      args.out = path.resolve(argv[++i]);
    } else if (a === "--rate") {
      args.rate = Number(argv[++i]);
    } else if (a === "--seed") {
      args.seed = Number(argv[++i]);
    } else {
      throw new Error(`unknown argument ${a}`);
    }
  }
  return args;
}

function describeNode(n) {
  if (!n) {
    return "";
  }
  switch (n.type) {
    case "file":
      return `${n.file} (모듈 최상위)`;
    case "module":
      return `${n.file} (모듈)`;
    case "lib":
      return `TS lib: ${n.symbol}`;
    case "synthetic":
      return `${n.file}:${n.line} [${n.framework} ${n.role}: ${n.anchor}]`;
    default:
      return `${n.file}:${n.line} ${n.type} ${n.name}`;
  }
}

export function collectItems(corpus, gtVersion = 1) {
  const items = [];
  for (const dir of listCaseDirs(corpus)) {
    const gt = readJson(path.join(dir, gtFileName(gtVersion)));
    const nodes = new Map(gt.nodes.map((n) => [n.id, n]));
    const fw = (id) => (nodes.get(id)?.type === "synthetic" ? nodes.get(id).framework : null);
    const lines = new Map();
    const lineText = (ev) => {
      const [rel, ln] = ev.split(/:(?=\d+$)/);
      if (!lines.has(rel)) {
        lines.set(rel, fs.readFileSync(path.join(dir, rel), "utf8").split(/\r?\n/));
      }
      return (lines.get(rel)[Number(ln) - 1] ?? "").trim();
    };
    const base = (r, itemType, gtLabel) => ({
      caseId: gt.caseId,
      itemId: r.id,
      itemType,
      gtLabel,
      category: categoryFor(r.kind, fw(r.source)),
      kind: r.kind,
      source: describeNode(nodes.get(r.source)),
      target:
        r.kind === "owner"
          ? "(노드 존재 여부)"
          : r.target
            ? describeNode(nodes.get(r.target))
            : r.candidates === "unbounded"
              ? "(후보를 열거할 수 없는 호출 대상)"
              : r.candidates.map((c) => describeNode(nodes.get(c.target))).join(" | "),
      argIndex: r.argIndex ?? (Array.isArray(r.candidates) ? r.candidates.map((c) => c.argIndex ?? "").join(" | ") : ""),
      sites: (r.evidence ?? []).join(" ; "),
      siteText: (r.evidence ?? []).map(lineText).join(" ⏎ "),
      gtPattern: r.pattern,
      gtStatus: r.gtStatus ?? "",
    });
    for (const r of gt.relations) {
      if (r.gtStatus === "indeterminate") {
        items.push(base(r, "indeterminate", "undeterminable"));
      } else {
        items.push(base(r, "relation", "exists"));
      }
    }
    for (const n of gt.negatives) {
      items.push(base(n, "negative", "not-exists"));
    }
  }
  return items;
}

export function drawSample(items, { rate, seed }) {
  const byCategory = new Map();
  for (const it of items) {
    if (!byCategory.has(it.category)) {
      byCategory.set(it.category, []);
    }
    byCategory.get(it.category).push(it);
  }
  const sample = [];
  const perCategory = [];
  let offset = 0;
  for (const category of [...byCategory.keys()].sort()) {
    const pool = byCategory.get(category);
    const k = Math.min(pool.length, Math.ceil(pool.length * rate));
    const picked = seededShuffle(pool, seed + offset).slice(0, k);
    offset += 1;
    sample.push(...picked);
    perCategory.push({ category, population: pool.length, sampled: k });
  }
  const shuffled = seededShuffle(sample, seed + 1000).map((it, idx) => ({
    ...it,
    sampleId: `S${String(idx + 1).padStart(3, "0")}`,
  }));
  return { sample: shuffled, perCategory };
}

function main() {
  const args = parseArgs(process.argv);
  const items = collectItems(args.corpus, args.gtVersion);
  const { sample, perCategory } = drawSample(items, args);
  fs.mkdirSync(args.out, { recursive: true });
  const blind = sample.map((s) => ({
    sampleId: s.sampleId,
    caseId: s.caseId,
    category: s.category,
    kind: s.kind,
    source: s.source,
    target: s.target,
    argIndex: s.argIndex,
    sites: s.sites,
    siteText: s.siteText,
    reviewerLabel: "",
    reviewerConfidence: "",
    reviewerComment: "",
    reviewerId: "",
    reviewedAt: "",
  }));
  fs.writeFileSync(
    path.join(args.out, "review-sheet.csv"),
    toCsv(blind, Object.keys(blind[0])),
  );
  fs.writeFileSync(
    path.join(args.out, "review-key.csv"),
    toCsv(sample, ["sampleId", "caseId", "itemId", "itemType", "gtLabel", "gtStatus", "gtPattern", "category", "kind"]),
  );
  const meta = {
    gtVersion: args.gtVersion,
    rate: args.rate,
    seed: args.seed,
    population: items.length,
    sampled: sample.length,
    sampledShare: sample.length / items.length,
    perCategory,
    labels: ["exists", "not-exists", "undeterminable"],
  };
  fs.writeFileSync(path.join(args.out, "sample.json"), `${JSON.stringify(meta, null, 2)}\n`);
  console.log(`population ${items.length}, sampled ${sample.length} (${(meta.sampledShare * 100).toFixed(1)}%)`);
  for (const c of perCategory) {
    console.log(`  ${c.category.padEnd(20)} ${c.sampled}/${c.population}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
