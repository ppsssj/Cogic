// P12-A: compare two graph dumps written by profile-depth-v2.cjs --dump-graph.
// Usage: node graph-diff.cjs <baseline.graph.json> <candidate.graph.json> <out.json> [labelA] [labelB]
// Absolute paths are replaced by <projects>/ and <cogic>/ placeholders so no local path is stored.
"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const [aPath, bPath, outPath, labelA = "baseline", labelB = "candidate"] = process.argv.slice(2);
if (!aPath || !bPath || !outPath) throw Error("usage: graph-diff.cjs <a> <b> <out.json> [labelA] [labelB]");
if (fs.existsSync(outPath)) throw Error("Output already exists");
const cogicRoot = path.resolve(__dirname, "../../../..").replace(/\\/g, "/");
const sanitize = (v) => JSON.parse(JSON.stringify(v).split(cogicRoot).join("<cogic>").replace(/[A-Za-z]:\/[^"]*?\/projects\//g, "<projects>/"));
const rawA = fs.readFileSync(aPath, "utf8"), rawB = fs.readFileSync(bPath, "utf8");
const a = JSON.parse(rawA), b = JSON.parse(rawB), s = (x) => JSON.stringify(x);
const hash = (t) => crypto.createHash("sha256").update(t).digest("hex");
const out = { labelA, labelB, hashA: hash(rawA), hashB: hash(rawB), identical: rawA === rawB };
for (const k of ["nodes", "edges"]) {
  const ma = new Map(a[k].map((x) => [x.id, x])), mb = new Map(b[k].map((x) => [x.id, x]));
  const onlyA = [...ma.keys()].filter((i) => !mb.has(i)), onlyB = [...mb.keys()].filter((i) => !ma.has(i));
  const changed = [...ma.keys()].filter((i) => mb.has(i) && s(ma.get(i)) !== s(mb.get(i)));
  const fields = {};
  for (const i of changed) { const x = ma.get(i), y = mb.get(i); for (const f of new Set([...Object.keys(x), ...Object.keys(y)])) if (s(x[f]) !== s(y[f])) fields[f] = (fields[f] || 0) + 1; }
  out[k] = { countA: ma.size, countB: mb.size, onlyA: sanitize(onlyA), onlyB: sanitize(onlyB), changed: changed.length, changedFields: fields,
    changedDetail: sanitize(changed.map((i) => { const x = ma.get(i), y = mb.get(i), d = { id: i }; for (const f of Object.keys({ ...x, ...y })) if (s(x[f]) !== s(y[f])) d[f] = { [labelA]: x[f], [labelB]: y[f] }; return d; })) };
}
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ identical: out.identical, nodes: { a: out.nodes.countA, b: out.nodes.countB, onlyA: out.nodes.onlyA.length, onlyB: out.nodes.onlyB.length, changed: out.nodes.changed }, edges: { a: out.edges.countA, b: out.edges.countB, onlyA: out.edges.onlyA.length, onlyB: out.edges.onlyB.length, changed: out.edges.changed } }));
