// Same-workspace before/after snapshot. Do not commit its full output: paths may be private.
"use strict";
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process"), crypto = require("node:crypto");
const repo = path.resolve(__dirname, "../../../.."), root = path.resolve(process.argv[2] || ""), out = process.argv[3];
if (!process.argv[2] || !out) throw Error("Usage: node hono-snapshot.cjs <hono-worktree> <new-output.json>");
if (fs.existsSync(out)) throw Error("Output already exists");
const analyzer = require(path.join(repo, "out/analyzer/index.js"));
const file = path.join(root, "src/hono-base.ts"), code = fs.readFileSync(file, "utf8");
const files = cp.execFileSync("git", ["-C", root, "ls-files", "src"], { encoding: "utf8" }).trim().split(/\r?\n/).filter(s => /\.(ts|tsx|js|jsx)$/.test(s)).map(s => path.join(root, s));
const args = { active: { code, fileName: file, languageId: "typescript" }, workspaceRoot: root, filePaths: files };
function run(cacheEnabled) { const start = performance.now(), result = analyzer.analyzeWorkspaceActive({ ...args, cacheEnabled }); return { ms: Math.round(performance.now() - start), graph: result.graph }; }
function norm(graph) { return { nodes: [...graph.nodes].sort((a,b) => a.id.localeCompare(b.id)), edges: [...graph.edges].sort((a,b) => a.id.localeCompare(b.id)) }; }
const hash = g => crypto.createHash("sha256").update(JSON.stringify(norm(g))).digest("hex");
const off = []; for (let i = 0; i < 3; i++) { analyzer.clearAnalyzerCaches(); off.push(run(false)); }
analyzer.clearAnalyzerCaches(); const cold = run(true), warm = run(true);
const snapshot = { revision: cp.execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), durationsMs: { off: off.map(x=>x.ms), cold: cold.ms, warm: warm.ms }, hashes: { off: off.map(x=>hash(x.graph)), cold: hash(cold.graph), warm: hash(warm.graph) }, graph: norm(off[0].graph) };
fs.writeFileSync(out, JSON.stringify(snapshot, null, 2), { flag: "wx" });
console.log(JSON.stringify({ revision: snapshot.revision, durationsMs: snapshot.durationsMs, nodes: snapshot.graph.nodes.length, edges: snapshot.graph.edges.length, deterministic: new Set(snapshot.hashes.off).size === 1, cacheConsistent: snapshot.hashes.off[0] === snapshot.hashes.cold && snapshot.hashes.cold === snapshot.hashes.warm }));
