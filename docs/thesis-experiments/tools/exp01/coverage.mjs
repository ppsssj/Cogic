#!/usr/bin/env node
// EXP-01 Ground Truth coverage report (P1-A).
//
// Counts GT items per category x support x gtStatus from expected.json files and checks
// the P0 minimum sample sizes (exp-01-accuracy.md §5.1). Reads GT only; no predictions.
//
// Usage: node coverage.mjs [--corpus <dir>] [--out-md <file>] [--out-json <file>]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CATEGORIES, categoryFor, gtFileName, listCaseDirs, loadCatalog, readJson } from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");

// P0 exp-01-accuracy.md §5.1 minimums.
export const THRESHOLDS = {
  inScopePerCoreCategory: 30,
  inScopePerFrameworkCategory: 15,
  negativesPerCategory: 5,
  totalDeterminate: 250,
};
const CORE = ["calls", "constructs", "references", "dataflow", "updates"];
const FRAMEWORK = ["react-hook-owner", "vue-hook-owner", "express-route-owner", "nest-route-owner"];

function parseArgs(argv) {
  const corpus = path.join(repoRoot, "docs/thesis-experiments/fixtures/exp-01");
  const args = {
    corpus,
    outMd: path.join(corpus, "COVERAGE.md"),
    outJson: path.join(corpus, "coverage.json"),
    gtVersion: 1,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--corpus") {
      args.corpus = path.resolve(argv[++i]);
    } else if (a === "--out-md") {
      args.outMd = path.resolve(argv[++i]);
    } else if (a === "--out-json") {
      args.outJson = path.resolve(argv[++i]);
    } else if (a === "--gt-version") {
      args.gtVersion = Number(argv[++i]);
    } else {
      throw new Error(`unknown argument ${a}`);
    }
  }
  return args;
}

function emptyRow(category) {
  return {
    category,
    supported: 0,
    unsupported: 0,
    ambiguousDeterminate: 0,
    determinate: 0,
    indeterminate: 0,
    negatives: 0,
  };
}

export function computeCoverage(corpus, catalog, gtVersion = 1) {
  const rows = new Map(CATEGORIES.map((c) => [c, emptyRow(c)]));
  const byPattern = new Map();
  const cases = [];
  for (const dir of listCaseDirs(corpus)) {
    const gt = readJson(path.join(dir, gtFileName(gtVersion)));
    const caseJson = readJson(path.join(dir, "case.json"));
    const nodes = new Map(gt.nodes.map((n) => [n.id, n]));
    const fw = (id) => (nodes.get(id)?.type === "synthetic" ? nodes.get(id).framework : null);
    const perCase = { caseId: gt.caseId, category: caseJson.category, determinate: 0, indeterminate: 0, negatives: 0 };
    for (const r of gt.relations) {
      const category = categoryFor(r.kind, fw(r.source));
      const row = rows.get(category) ?? emptyRow(category);
      rows.set(category, row);
      const support = catalog.get(r.pattern)?.support ?? "?";
      const pk = `${r.pattern}|${category}`;
      if (!byPattern.has(pk)) {
        byPattern.set(pk, { pattern: r.pattern, category, support, determinate: 0, indeterminate: 0, negatives: 0 });
      }
      if (r.gtStatus === "indeterminate") {
        row.indeterminate += 1;
        perCase.indeterminate += 1;
        byPattern.get(pk).indeterminate += 1;
        continue;
      }
      row.determinate += 1;
      perCase.determinate += 1;
      byPattern.get(pk).determinate += 1;
      if (support === "supported") {
        row.supported += 1;
      } else if (support === "unsupported-by-design") {
        row.unsupported += 1;
      } else if (support === "ambiguous") {
        row.ambiguousDeterminate += 1;
      }
    }
    for (const n of gt.negatives) {
      const category = categoryFor(n.kind, fw(n.source));
      const row = rows.get(category) ?? emptyRow(category);
      rows.set(category, row);
      row.negatives += 1;
      perCase.negatives += 1;
      const pk = `${n.pattern}|${category}`;
      if (!byPattern.has(pk)) {
        byPattern.set(pk, { pattern: n.pattern, category, support: "negative", determinate: 0, indeterminate: 0, negatives: 0 });
      }
      byPattern.get(pk).negatives += 1;
    }
    cases.push(perCase);
  }

  const categories = [...rows.values()];
  const checks = [];
  for (const r of categories) {
    if (CORE.includes(r.category)) {
      checks.push({
        category: r.category,
        rule: `in-scope(supported) >= ${THRESHOLDS.inScopePerCoreCategory}`,
        value: r.supported,
        pass: r.supported >= THRESHOLDS.inScopePerCoreCategory,
      });
    }
    if (FRAMEWORK.includes(r.category)) {
      checks.push({
        category: r.category,
        rule: `in-scope(supported) >= ${THRESHOLDS.inScopePerFrameworkCategory}`,
        value: r.supported,
        pass: r.supported >= THRESHOLDS.inScopePerFrameworkCategory,
      });
    }
    if ([...CORE, ...FRAMEWORK].includes(r.category)) {
      checks.push({
        category: r.category,
        rule: `negatives >= ${THRESHOLDS.negativesPerCategory}`,
        value: r.negatives,
        pass: r.negatives >= THRESHOLDS.negativesPerCategory,
      });
    }
  }
  const totals = categories.reduce(
    (acc, r) => {
      for (const k of Object.keys(acc)) {
        acc[k] += r[k];
      }
      return acc;
    },
    { supported: 0, unsupported: 0, ambiguousDeterminate: 0, determinate: 0, indeterminate: 0, negatives: 0 },
  );
  checks.push({
    category: "total",
    rule: `determinate >= ${THRESHOLDS.totalDeterminate}`,
    value: totals.determinate,
    pass: totals.determinate >= THRESHOLDS.totalDeterminate,
  });

  return {
    gtVersion,
    caseCount: cases.length,
    totals,
    categories,
    checks,
    cases,
    patterns: [...byPattern.values()].sort((a, b) =>
      a.category === b.category ? (a.pattern < b.pattern ? -1 : 1) : a.category < b.category ? -1 : 1,
    ),
  };
}

function toMarkdown(cov, catalog) {
  const lines = [];
  lines.push("# EXP-01 Ground Truth Coverage");
  lines.push("");
  lines.push("이 파일은 `tools/exp01/coverage.mjs`가 `expected.json`에서 생성한다. 손으로 고치지 않는다.");
  lines.push("");
  lines.push(`- GT 버전: v${cov.gtVersion}`);
  lines.push(`- 사례(fixture) 수: ${cov.caseCount}`);
  lines.push(
    `- 확증 평가 대상(determinate) 관계: **${cov.totals.determinate}** (supported ${cov.totals.supported}, unsupported-by-design ${cov.totals.unsupported}, ambiguous·determinate ${cov.totals.ambiguousDeterminate})`,
  );
  lines.push(`- 별도 보고(indeterminate): ${cov.totals.indeterminate}`);
  lines.push(`- 부정 사례(negative): ${cov.totals.negatives}`);
  lines.push("");
  lines.push("## 1. 범주별 분포");
  lines.push("");
  lines.push("| 범주 | supported (in-scope) | unsupported-by-design | ambiguous·determinate | determinate 합계 (overall 분모) | indeterminate | negative |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|");
  for (const r of cov.categories) {
    lines.push(
      `| ${r.category} | ${r.supported} | ${r.unsupported} | ${r.ambiguousDeterminate} | ${r.determinate} | ${r.indeterminate} | ${r.negatives} |`,
    );
  }
  const t = cov.totals;
  lines.push(`| **합계** | ${t.supported} | ${t.unsupported} | ${t.ambiguousDeterminate} | ${t.determinate} | ${t.indeterminate} | ${t.negatives} |`);
  lines.push("");
  lines.push("## 2. P0 최소 표본 기준 점검");
  lines.push("");
  lines.push("기준 출처: [exp-01-accuracy.md §5.1](../../experiments/exp-01-accuracy.md#51-코퍼스-a--마이크로-fixture-확증-분석의-주-대상).");
  lines.push("");
  lines.push("| 범주 | 기준 | 값 | 결과 |");
  lines.push("|---|---|---:|---|");
  for (const c of cov.checks) {
    lines.push(`| ${c.category} | ${c.rule} | ${c.value} | ${c.pass ? "PASS" : "**미충족**"} |`);
  }
  lines.push("");
  lines.push("## 3. 패턴별 분포");
  lines.push("");
  lines.push("| 패턴 | 범주 | 지원 분류 | determinate | indeterminate | negative |");
  lines.push("|---|---|---|---:|---:|---:|");
  for (const p of cov.patterns) {
    lines.push(`| ${p.pattern} | ${p.category} | ${p.support} | ${p.determinate} | ${p.indeterminate} | ${p.negatives} |`);
  }
  lines.push("");
  lines.push("## 4. 사례별 분포");
  lines.push("");
  lines.push("| 사례 | 폴더 범주 | determinate | indeterminate | negative |");
  lines.push("|---|---|---:|---:|---:|");
  for (const c of cov.cases) {
    lines.push(`| ${c.caseId} | ${c.category} | ${c.determinate} | ${c.indeterminate} | ${c.negatives} |`);
  }
  lines.push("");
  lines.push("## 5. 정량 평가에서 제외한 형식");
  lines.push("");
  const excluded = [...catalog.values()].filter((p) => p.polarity === "excluded");
  for (const p of excluded) {
    lines.push(`- \`${p.patternId}\`: ${p.description}. ${p.notes}`);
  }
  lines.push("");
  return `${lines.join("\n")}`;
}

function main() {
  const args = parseArgs(process.argv);
  const catalog = loadCatalog(path.join(args.corpus, "catalog.csv"));
  const cov = computeCoverage(args.corpus, catalog, args.gtVersion);
  fs.writeFileSync(args.outJson, `${JSON.stringify(cov, null, 2)}\n`);
  fs.writeFileSync(args.outMd, toMarkdown(cov, catalog));
  for (const c of cov.checks) {
    console.log(`${c.pass ? "PASS" : "MISS"} ${c.category.padEnd(20)} ${c.rule.padEnd(32)} ${c.value}`);
  }
  console.log(`\ncases ${cov.caseCount}, determinate ${cov.totals.determinate}, indeterminate ${cov.totals.indeterminate}, negatives ${cov.totals.negatives}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
