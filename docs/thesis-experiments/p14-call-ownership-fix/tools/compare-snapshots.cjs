// Compare two hono-snapshot outputs without exposing local paths.
"use strict";
const fs = require("node:fs");
if (process.argv.length !== 4) throw Error("Usage: node compare-snapshots.cjs <before.json> <after.json>");
const load = file => JSON.parse(fs.readFileSync(file, "utf8"));
const before = load(process.argv[2]), after = load(process.argv[3]);
if (before.revision !== after.revision) throw Error("Workspace revisions differ");
const keyed = xs => new Map(xs.map(x => [x.id, x]));
const an = keyed(before.graph.nodes), bn = keyed(after.graph.nodes), ae = keyed(before.graph.edges), be = keyed(after.graph.edges);
const removed = [...ae].filter(([id]) => !be.has(id)).map(([, e]) => e);
const sameExceptOwner = e => [...be.values()].some(x => x.kind === e.kind && x.target === e.target && x.label === e.label && x.id.split("@@").at(-1) === e.id.split("@@").at(-1));
console.log(JSON.stringify({
  revision: before.revision,
  nodes: { before: an.size, after: bn.size, removed: [...an.keys()].filter(k => !bn.has(k)).length, changedRetained: [...an].filter(([k, v]) => bn.has(k) && JSON.stringify(v) !== JSON.stringify(bn.get(k))).length },
  edges: { before: ae.size, after: be.size, removedIds: removed.length, addedIds: [...be.keys()].filter(k => !ae.has(k)).length, removedWithoutSameTargetAndLabel: removed.filter(e => !sameExceptOwner(e)).length, duplicateIds: after.graph.edges.length - be.size },
  durationsMs: { before: before.durationsMs, after: after.durationsMs },
  hashes: { beforeDeterministic: new Set(before.hashes.off).size === 1, afterDeterministic: new Set(after.hashes.off).size === 1, beforeCacheConsistent: before.hashes.off[0] === before.hashes.cold && before.hashes.cold === before.hashes.warm, afterCacheConsistent: after.hashes.off[0] === after.hashes.cold && after.hashes.cold === after.hashes.warm },
}, null, 2));
