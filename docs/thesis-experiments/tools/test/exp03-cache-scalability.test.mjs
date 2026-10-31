// EXP-03 tool tests (synthetic inputs only; the analyzer build is not loaded).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as T from "../exp03-cache-scalability.mjs";
import * as R from "../exp03-report.mjs";
import { mulberry32 } from "../exp02-cache-benchmark.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const EV = (k) => `analyzer.sourceFileCache.${k}`;

const SAMPLE = ['"use strict";', 'const fs = require("fs");', "const MAX_DISK_SOURCE_FILE_CACHE_ENTRIES = 800;", "const diskSourceFileCache = new Map();", "function prune() {", "  if (diskSourceFileCache.size <= MAX_DISK_SOURCE_FILE_CACHE_ENTRIES) return;", "  const removeCount = diskSourceFileCache.size - MAX_DISK_SOURCE_FILE_CACHE_ENTRIES;", "}", ""];

test("capacity injection replaces only the literal of the single declaration", () => {
  for (const eol of ["\n", "\r\n"]) {
    const text = SAMPLE.join(eol);
    for (const C of [400, 1600]) {
      const r = T.injectCapacity(text, C);
      assert.equal(r.ok, true, JSON.stringify(r.checks));
      assert.equal(r.changedLines.length, 1);
      assert.equal(r.changedLines[0].line, 3);
      assert.equal(r.out, text.replace("ENTRIES = 800;", `ENTRIES = ${C};`));
      assert.equal(r.identifierOccurrences, 3);
    }
    const same = T.injectCapacity(text, 800);
    assert.equal(same.ok, true);
    assert.equal(same.out, text);
    assert.equal(same.changedLines.length, 0);
  }
  const lines = SAMPLE.join("\n");
  assert.equal(T.injectCapacity(lines.replace("const MAX_DISK_SOURCE_FILE_CACHE_ENTRIES = 800;", ""), 400).ok, false);
  assert.equal(T.injectCapacity(`${lines}\nconst MAX_DISK_SOURCE_FILE_CACHE_ENTRIES = 800;\n`, 400).ok, false);
  assert.equal(T.injectCapacity(`${lines}\nlet MAX_DISK_SOURCE_FILE_CACHE_ENTRIES = 3;\n`, 400).ok, false);
  assert.equal(T.injectCapacity(lines.replace("= 800;", "= 900;"), 400).ok, false);
  assert.equal(T.injectCapacity(lines, 0).ok, false);
  const diff = T.unifiedDiff("a", "b", T.injectCapacity(lines, 400).changedLines);
  assert.match(diff, /^--- a\n\+\+\+ b\n@@ -3,1 \+3,1 @@\n-const MAX_DISK_SOURCE_FILE_CACHE_ENTRIES = 800;\n\+const MAX_DISK_SOURCE_FILE_CACHE_ENTRIES = 400;\n$/);
});

test("prune re-implementation is the analyzer's pruneDiskSourceFileCache with the capacity as argument", () => {
  const extract = (src, header) => {
    const start = src.indexOf(header);
    assert.ok(start >= 0, header);
    let depth = 0;
    for (let k = src.indexOf("{", start); k < src.length; k++) {
      if (src[k] === "{") depth++;
      else if (src[k] === "}" && --depth === 0) return src.slice(src.indexOf("{", start), k + 1);
    }
    throw new Error("unbalanced");
  };
  const norm = (s) => s.replace(/\s+/g, "");
  const analyzer = extract(fs.readFileSync(path.join(repoRoot, "src/analyzer/analyze.ts"), "utf8"), "function pruneDiskSourceFileCache() {");
  const tool = extract(fs.readFileSync(path.join(here, "../exp03-cache-scalability.mjs"), "utf8"), "function pruneReimpl(cache, max) {");
  assert.equal(norm(tool), norm(analyzer.replace(/diskSourceFileCache/g, "cache").replace(/MAX_DISK_SOURCE_FILE_CACHE_ENTRIES/g, "max")));
  assert.match(fs.readFileSync(path.join(repoRoot, "src/analyzer/analyze.ts"), "utf8"), /^const MAX_DISK_SOURCE_FILE_CACHE_ENTRIES = 800;$/m);
});

// A model of getCachedDiskSourceFile + pruneDiskSourceFileCache (same Map semantics, timestamps with
// ties) that emits the analyzer's debug events, to check the eviction/occupancy derivation.
function modelAnalysis(keys, cache, C, clock, staleKeys = new Set()) {
  const events = [];
  let evicted = 0;
  for (const k of keys) {
    const c = cache.get(k);
    if (c && !staleKeys.has(k)) {
      c.t = clock();
      events.push({ event: EV("hit"), detail: {} });
      continue;
    }
    events.push({ event: EV(c ? "stale" : "miss"), detail: {} });
    cache.set(k, { t: clock() });
    if (cache.size > C) {
      const sorted = [...cache.entries()].sort((a, b) => a[1].t - b[1].t);
      const n = cache.size - C;
      for (const [key] of sorted.slice(0, n)) cache.delete(key);
      evicted += n;
    }
    events.push({ event: EV("store"), detail: { entries: cache.size } });
  }
  return { events, evicted };
}

test("eviction and occupancy derived from store events equal the model's true evictions", () => {
  for (const [W, C] of [[10, 12], [12, 12], [13, 12], [30, 7], [5, 1]]) {
    const cache = new Map();
    let tick = 0;
    const clock = () => Math.floor(tick++ / 3); // ties: three accesses per "millisecond"
    const keys = Array.from({ length: W }, (_, i) => `f${i}`);
    let occ = 0;
    for (let it = 0; it < 4; it++) {
      const stale = it === 2 ? new Set([keys[W - 1]]) : new Set();
      const { events, evicted } = modelAnalysis(keys, cache, C, clock, stale);
      const d = T.deriveIteration(events, occ);
      assert.equal(d.evictDerived, evicted, `W=${W} C=${C} it=${it}`);
      assert.equal(d.occupancyEnd, cache.size);
      assert.ok(d.maxEntries <= C);
      assert.equal(d.derivationAnomalies, 0);
      assert.equal(d.sfHit + d.sfMiss + d.sfStale, W);
      assert.equal(d.statCalls, W);
      if (it >= 1 && it !== 2) assert.equal(d.sfHit, W <= C ? W : 0, `cyclic LRU W=${W} C=${C}`);
      occ = d.occupancyEnd;
    }
  }
});

test("reuse distances equal a naive count; pure-LRU hits equal reuse distance < C", () => {
  const rand = mulberry32(7);
  for (let rep = 0; rep < 20; rep++) {
    const keys = Array.from({ length: 300 }, () => `k${Math.floor(rand() * 40)}`);
    const d = T.reuseDistances(keys);
    for (let i = 0; i < keys.length; i++) {
      const p = i === 0 ? -1 : keys.lastIndexOf(keys[i], i - 1);
      assert.equal(d[i], p < 0 ? null : new Set(keys.slice(p + 1, i)).size);
    }
    for (const C of [1, 5, 20, 39, 40, 60]) assert.equal(T.lruHits(d, C), T.simulateLru(keys, C));
  }
});

test("trace summary: cyclic access gives reuse distance W-1 and the LRU cliff at W = C", () => {
  for (const [W, C] of [[399, 400], [400, 400], [401, 400]]) {
    const seq = [];
    for (let it = 0; it < 4; it++) for (let i = 0; i < W; i++) seq.push({ iteration: it, kind: it === 0 ? "miss" : W <= C ? "hit" : "miss", label: `ws:f${i}.ts` });
    const rows = T.traceSummary(seq, C, 1);
    assert.equal(rows[0].firstAccess, W);
    for (const r of rows.slice(1)) {
      assert.equal(r.reuseMin, W - 1);
      assert.equal(r.reuseMax, W - 1);
      assert.equal(r.lruPredictedHits, W <= C ? W : 0);
      assert.equal(r.observedHits, r.lruPredictedHits);
      assert.equal(r.orderSameAsPrevious, 1);
    }
  }
});

test("workload list and phase conditions follow the plan", () => {
  const L = 159;
  const Ln = 50;
  assert.deepEqual(T.boundaryNs(800, L), [640, 641, 642]);
  const workloads = [];
  const add = (n, types, role) => {
    const id = `n${n}${types === "none" ? "-notypes" : ""}`;
    const ex = workloads.find((x) => x.id === id);
    if (ex) ex.roles.push(role);
    else workloads.push({ id, n, types, roles: [role], W: n + (types === "none" ? Ln : L) });
  };
  for (const n of T.MAIN_N) add(n, "default", "main");
  for (const C of T.CAPACITIES) T.boundaryNs(C, L).forEach((n, i) => add(n, "default", `boundary:C${C}:${["C-1", "C", "C+1"][i]}`));
  T.boundaryNs(800, Ln).forEach((n, i) => add(n, "none", `h3-4:C800:${["C-1", "C", "C+1"][i]}`));
  T.boundaryNs(800, L).slice(1).forEach((n, i) => add(n, "none", `h3-4:sameN:${["C", "C+1"][i]}`));
  const wl = { workloads };
  assert.equal(T.phaseConditions("time", wl).length, 16);
  assert.equal(T.phaseConditions("repeated", wl).length, 16);
  assert.equal(T.phaseConditions("memory", wl).length, 16);
  const b = T.phaseConditions("boundary", wl);
  assert.equal(b.length, 14);
  assert.deepEqual(b.filter((c) => c.role.startsWith("boundary:C400")).map((c) => [c.workload, c.build]), [["n240", "c400"], ["n241", "c400"], ["n242", "c400"]]);
  assert.ok(b.filter((c) => c.role.startsWith("h3-4")).every((c) => c.build === "c800"));
  assert.equal(T.phaseConditions("trace", wl).length, 26);
  assert.ok(T.phaseConditions("time", wl).filter((c) => c.mode === "off").every((c) => c.build === "original"));
  assert.deepEqual(T.PHASE_DEFAULTS.time, { kind: "time", warmup: 5, runs: 30, blocks: 3 });
  assert.deepEqual(T.PHASE_DEFAULTS.boundary, { kind: "time", warmup: 3, runs: 15, blocks: 3 });
});

test("request labels carry no absolute paths", () => {
  const ws = path.join("C:", "w", "n100");
  assert.equal(T.requestLabel(path.join(ws, "src", "helper-1.ts"), ws), "ws:src/helper-1.ts");
  assert.equal(T.requestLabel(path.join("C:", "a", "node_modules", "typescript", "lib", "lib.d.ts"), ws), "nm:typescript/lib/lib.d.ts");
  assert.equal(T.requestCategory("nm:@types/node/index.d.ts"), "@types");
  assert.equal(T.requestCategory("nm:undici-types/fetch.d.ts"), "other-node_modules");
  assert.equal(T.requestCategory("nm:typescript/lib/lib.es5.d.ts"), "typescript-lib");
});

test("GC entries are assigned to the analysis window they started in", () => {
  const rows = [{ iteration: 0 }, { iteration: 1 }];
  T.attachGc(rows, [{ iteration: 0, start: 0, end: 10 }, { iteration: 1, start: 20, end: 30 }], [{ start: 1, duration: 2, kind: 1 }, { start: 9.9, duration: 3, kind: 4 }, { start: 15, duration: 50, kind: 4 }, { start: 25, duration: 1, kind: 1 }]);
  assert.deepEqual([rows[0].gcMsInAnalysis, rows[0].gcCountInAnalysis, rows[0].gcMajorInAnalysis], [5, 2, 1]);
  assert.deepEqual([rows[1].gcMsInAnalysis, rows[1].gcCountInAnalysis, rows[1].gcMajorInAnalysis], [1, 1, 0]);
});

test("two-stage bootstrap: deterministic, CI covers the true reduction, k = 1 works", () => {
  const rand = mulberry32(3);
  const blk = (m) => Array.from({ length: 30 }, () => m * (1 + (rand() - 0.5) * 0.1));
  const off = [blk(1000), blk(1010), blk(990)];
  const on = [blk(300), blk(303), blk(297)];
  const a = R.clusterBootstrap(off, on, { resamples: 2000, seed: 5 });
  const b = R.clusterBootstrap(off, on, { resamples: 2000, seed: 5 });
  assert.deepEqual(a, b);
  assert.ok(a.rLow < 0.7 && a.rHigh > 0.7, JSON.stringify(a));
  assert.ok(a.deltaLow > 600 && a.deltaHigh < 800);
  const same = R.clusterBootstrap([blk(500)], [blk(500)], { resamples: 2000, seed: 5 });
  assert.ok(same.rLow < 0 && same.rHigh > 0);
  assert.throws(() => R.clusterBootstrap([[1]], [[1], [2]]));
});

test("OLS recovers an exact line", () => {
  const o = R.ols([1, 2, 3, 4], [3, 5, 7, 9]);
  assert.equal(o.slope, 2);
  assert.equal(o.intercept, 1);
  assert.equal(o.r2, 1);
  const b = R.olsBootstrap([1, 2, 3, 4, 5], [2, 4, 6, 8, 10], { resamples: 500, seed: 1 });
  assert.equal(b.slopeLow, 2);
  assert.equal(b.slopeHigh, 2);
});
