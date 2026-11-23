// P11 static figures (grouped bars, print). Palette validated with the dataviz validator (light, surface #fcfcfb):
// #2a78d6 / #eb6834 / #1baf7a — all checks pass; aqua contrast 2.74:1 -> every bar carries a value label.
// Values are read from the summary CSVs (no hand-typed numbers). node figures-p11.cjs <summaryDir> <outDir>
"use strict";
const fs = require("node:fs"), path = require("node:path");
const [sum, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const COL = ["#2a78d6", "#eb6834", "#1baf7a"];
function csv(f) { const [h, ...rows] = fs.readFileSync(f, "utf8").trim().split("\n").map((l) => l.split(",")); return rows.map((r) => Object.fromEntries(h.map((k, i) => [k, r[i]]))); }
function chart({ file, title, subtitle, unit, groups, series, values, note, fmt = (v) => v, colors = COL }) {
  const W = 820, H = 440, L = 74, R = 24, T = 92, B = 92, pw = W - L - R, ph = H - T - B;
  const max = Math.max(...values.flat().filter((v) => v != null)) * 1.15;
  const nice = (m) => { const p = Math.pow(10, Math.floor(Math.log10(m))); return Math.ceil(m / p) * p; }; const ym = nice(max);
  const y = (v) => T + ph - (v / ym) * ph; const gw = pw / groups.length; const bw = Math.min(44, (gw - 30) / series.length);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Segoe UI, Arial, sans-serif"><rect width="${W}" height="${H}" fill="#fcfcfb"/>`;
  s += `<text x="${L}" y="30" font-size="17" font-weight="600" fill="#0b0b0b">${esc(title)}</text><text x="${L}" y="52" font-size="12.5" fill="#52514e">${esc(subtitle)}</text>`;
  series.forEach((n, i) => { const lx = L + i * 190; s += `<rect x="${lx}" y="66" width="12" height="12" rx="2" fill="${colors[i]}"/><text x="${lx + 18}" y="76.5" font-size="12.5" fill="#0b0b0b">${esc(n)}</text>`; });
  for (let k = 0; k <= 4; k++) { const v = (ym * k) / 4, yy = y(v); s += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" stroke="#e6e5e1" stroke-width="1"/><text x="${L - 8}" y="${yy + 4}" font-size="11.5" fill="#52514e" text-anchor="end">${+v.toFixed(1)}</text>`; }
  s += `<text x="16" y="${T + ph / 2}" font-size="12" fill="#52514e" transform="rotate(-90 16 ${T + ph / 2})" text-anchor="middle">${esc(unit)}</text>`;
  groups.forEach((g, gi) => {
    const cx = L + gw * gi + gw / 2, x0 = cx - (bw * series.length + 2 * (series.length - 1)) / 2;
    series.forEach((_, si) => {
      const v = values[gi][si]; if (v == null) return; const x = x0 + si * (bw + 2), yy = y(v), h = T + ph - yy, r = Math.min(4, h / 2);
      s += h > 0 ? `<path d="M${x},${T + ph} V${yy + r} Q${x},${yy} ${x + r},${yy} H${x + bw - r} Q${x + bw},${yy} ${x + bw},${yy + r} V${T + ph} Z" fill="${colors[si]}"/>` : "";
      s += `<text x="${x + bw / 2}" y="${yy - 6}" font-size="10.5" fill="#0b0b0b" text-anchor="middle">${fmt(v)}</text>`;
    });
    s += `<text x="${cx}" y="${T + ph + 20}" font-size="12.5" fill="#0b0b0b" text-anchor="middle">${esc(g.split("|")[0])}</text>`;
    if (g.includes("|")) s += `<text x="${cx}" y="${T + ph + 36}" font-size="11" fill="#52514e" text-anchor="middle">${esc(g.split("|")[1])}</text>`;
  });
  s += `<line x1="${L}" x2="${W - R}" y1="${T + ph}" y2="${T + ph}" stroke="#8a8984" stroke-width="1"/>`;
  note.forEach((t, i) => { s += `<text x="${L}" y="${H - 28 + i * 15}" font-size="11" fill="#52514e">${esc(t)}</text>`; });
  fs.writeFileSync(path.join(out, file), s + "</svg>");
}
const c = csv(path.join(sum, "p11-conditions.csv"));
const get = (p, sc, cond, k) => { const r = c.find((x) => x.project === p && x.scenario === sc && x.condition === cond); return r ? Number(r[k]) : null; };
const P = ["hono", "excalidraw", "vite", "typeorm", "query"];
const label = (p) => `${p}|${get(p, "active-edit", "adaptive", "program_source_files")} SourceFiles`;
const r0 = (v) => Math.round(v);
chart({ file: "fig-p11-edit-analysis.svg", title: "Analysis after an active-file edit (Node, real projects)", subtitle: "Median of 30 samples (2 blocks × 15), v0.0.6 analyzer, Depth 1",
  unit: "ms (lower is better)", groups: P.map(label), series: ["Cache OFF", "Fixed 800 (pre-P9)", "Adaptive (v0.0.6)"],
  values: P.map((p) => ["off", "fixed800", "adaptive"].map((k) => get(p, "active-edit", k, "median_ms"))), fmt: r0,
  note: ["Same PC (i5-9400F, 8 GB). query: root tsconfig limits the Program to 246 files (control).", "Source: p11-conditions.csv"] });
chart({ file: "fig-p11-retained-heap.svg", title: "Heap retained by the analyzer caches after the active-edit block", subtitle: "Forced-GC heap with caches minus after clearing them; median of 2 blocks",
  unit: "MB", groups: P.map(label), series: ["Fixed 800 (pre-P9)", "Adaptive (v0.0.6)"],
  values: P.map((p) => ["fixed800", "adaptive"].map((k) => get(p, "active-edit", k, "retained_heap_MB"))), fmt: r0, colors: [COL[1], COL[2]], // colour follows the condition
  note: ["Includes the 40-entry analysis-result cache. Not a byte bound: the 24M-character budget limits source text only.", "Source: p11-conditions.csv"] });
console.log("figures written");
// UI figure (step 2): valid runs only, median of the 3 run medians, input -> frame callback
const uiF = path.join(path.dirname(sum), "summary-ui", "p11-ui-conditions.csv");
if (fs.existsSync(uiF)) {
  const u = csv(uiF);
  const g = (p, sc, c) => { const r = u.find((x) => x.project === p && x.scenario === sc && x.condition === c); return r ? Number(r.median_of_run_medians_ms) : null; };
  const groups = [["hono", "active-edit", "hono|edit → frame"], ["hono", "file-switch", "hono|file switch → frame"], ["vite", "active-edit", "vite|edit → frame"], ["vite", "file-switch", "vite|file switch → frame"]];
  chart({ file: "fig-p11-ui-response.svg", title: "Graph update in the real VS Code UI (real projects)", subtitle: "Median of 3 independent runs (valid runs only), input → frame callback, Depth 1",
    unit: "ms (lower is better)", groups: groups.map((x) => x[2]), series: ["Cache OFF", "Fixed 800 (pre-P9)", "Adaptive (v0.0.6)"],
    values: groups.map(([p, sc]) => ["off", "fixed800", "adaptive"].map((c) => g(p, sc, c))), fmt: r0,
    note: ["Edit includes the 350 ms debounce. Frame callback ≠ physical display. Same PC; Latin-square run order.", "Source: p11-ui-conditions.csv"] });
}
