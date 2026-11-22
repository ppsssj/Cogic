// Summarise P9 cache-policy runs. node summarize-p9.cjs <dataDir>...
"use strict";
const fs = require("node:fs"); const path = require("node:path");
const med = (a) => { const b = a.filter(Number.isFinite).sort((p, q) => p - q), n = b.length; return !n ? NaN : n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2; };
const p95 = (a) => { const b = a.filter(Number.isFinite).sort((p, q) => p - q); return b.length ? b[Math.ceil(0.95 * b.length) - 1] : NaN; };
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const f = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : "—");
const lines = ["| 파일 | 시나리오 | 변형 | n | 확장측 중앙값 ms | 평균 | P95 | Δ vs baseline(ON) | Δ vs OFF | 적중/미적중/축출/건너뜀 (평균, 분석 1회) | 적중률 | 유지 캐시 MB(중앙값) | 그래프 해시 = OFF |", "|---:|---|---|---:|---:|---:|---:|---:|---:|---|---:|---:|---|"];
const csv = ["size,scenario,variant,n,median,mean,p95,hits,misses,evictions,skipFull,hitRate,retainedMB,hashSameAsOff"];
for (const dir of process.argv.slice(2)) {
  const env = JSON.parse(fs.readFileSync(path.join(dir, "env.json"), "utf8"));
  const rows = fs.readFileSync(path.join(dir, "raw.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const errs = rows.filter((r) => !r.samples); if (errs.length) lines.push(`| ${env.size} | 오류 ${errs.length}건 | | | | | | | | | | | |`);
  for (const sc of [...new Set(rows.map((r) => r.scenario))]) {
    const g = (label) => rows.filter((r) => r.scenario === sc && r.label === label && r.samples);
    const S = (label) => g(label).flatMap((r) => r.samples);
    const base = med(S("baseline").map((x) => x.extensionSideMs)), off = med(S("baseline-off").map((x) => x.extensionSideMs));
    const offHashes = new Set(S("baseline-off").map((x) => x.graphHash));
    for (const label of ["baseline-off", "baseline", "lru", "scan-resistant", "adaptive", "final"]) {
      const s = S(label); if (!s.length) continue;
      const t = s.map((x) => x.extensionSideMs); const m = med(t);
      const hits = mean(s.map((x) => x.sourceFileCacheHits)), miss = mean(s.map((x) => x.sourceFileCacheMisses)), ev = mean(s.map((x) => x.sourceFileCacheEvictions ?? 0)), sk = mean(s.map((x) => x.sourceFileCacheSkipFull ?? 0));
      const hr = hits + miss > 0 ? hits / (hits + miss) : NaN;
      const ret = med(g(label).map((r) => r.retainedCacheMB));
      const same = s.every((x) => offHashes.has(x.graphHash)) && [...new Set(s.map((x) => x.graphHash))].length === offHashes.size;
      lines.push(`| ${env.size} | ${sc} | ${label} | ${t.length} | ${f(m)} | ${f(mean(t))} | ${f(p95(t))} | ${label.startsWith("baseline") ? "—" : `${f(base - m)} (${f((1 - m / base) * 100)}%)`} | ${f(off - m)} (${f((1 - m / off) * 100)}%) | ${f(hits, 0)}/${f(miss, 0)}/${f(ev, 0)}/${f(sk, 0)} | ${f(hr * 100)}% | ${f(ret)} | ${same ? "yes" : "NO"} |`);
      csv.push([env.size, sc, label, t.length, f(m), f(mean(t)), f(p95(t)), f(hits), f(miss), f(ev), f(sk), f(hr, 3), f(ret), same].join(","));
    }
  }
}
const out = process.env.OUT || "<RESULTS>/p9-final/bench/p9-cache-summary";
fs.writeFileSync(out + ".md", lines.join("\n") + "\n"); fs.writeFileSync(out + ".csv", csv.join("\n") + "\n");
console.log(lines.join("\n"));
