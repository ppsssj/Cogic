// Builds a deterministic P11 target: file list (panel rule), active file, cross-file dependency, file-switch set.
// node make-target.cjs <id> <workRoot> <srcDir(relative)> <out.json>
"use strict";
const fs = require("node:fs"), path = require("node:path");
const { listFiles } = require("./list-files.cjs");
const [id, rootArg, srcRel, outPath] = process.argv.slice(2);
const root = path.resolve(rootArg);
const lf = listFiles(root);
const srcDir = path.join(root, srcRel);
const isCand = (f) => f.startsWith(srcDir + path.sep) && /\.(ts|tsx)$/.test(f) && !/\.d\.ts$/.test(f) && !/([\\/](__tests__|tests?|__mocks__|fixtures?|bench(mark)?s?)[\\/])|\.(test|spec|bench)\.[tj]sx?$/i.test(f);
const cands = lf.files.filter(isCand);
const set = new Set(lf.files.map((f) => f.toLowerCase()));
function resolveRel(from, spec) {
  if (!spec.startsWith(".")) return null;
  const base = path.resolve(path.dirname(from), spec);
  const stem = base.replace(/\.(js|jsx|mjs|cjs)$/, "");
  for (const c of [base, stem + ".ts", stem + ".tsx", base + ".ts", base + ".tsx", path.join(base, "index.ts"), path.join(base, "index.tsx")]) if (set.has(c.toLowerCase()) && fs.existsSync(c)) return c;
  return null;
}
function relImports(f) {
  const src = fs.readFileSync(f, "utf8"); const out = new Set();
  for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*|import\s+|require\s*\(\s*)["']([^"']+)["']/g)) { const r = resolveRel(f, m[1]); if (r && isCand(r)) out.add(r); }
  return [...out].sort();
}
const nonBarrel = cands.filter((f) => !/[\\/]index\.tsx?$/.test(f));
const scored = nonBarrel.map((f) => ({ f, imps: relImports(f) })).sort((a, b) => b.imps.length - a.imps.length || (a.f < b.f ? -1 : 1));
const active = scored[0];
// seeded shuffle (mulberry32, seed 11)
let s = 11; const rnd = () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pool = cands.filter((f) => f !== active.f);
for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
const target = { id, root, srcDir: srcRel, activeFile: active.f, activeRelImports: active.imps.length, crossFile: active.imps[0] || null, switchFiles: pool.slice(0, 18), filePaths: lf.files, filesAll: lf.all, capped: lf.capped, candidates: cands.length };
fs.writeFileSync(outPath, JSON.stringify(target, null, 1));
const rel = (f) => f && path.relative(root, f).replace(/\\/g, "/");
console.log(JSON.stringify({ id, files: lf.files.length, candidates: cands.length, active: rel(active.f), activeRelImports: active.imps.length, crossFile: rel(target.crossFile), switchSample: target.switchFiles.slice(0, 3).map(rel) }));
