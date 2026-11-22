// P9 cache-policy benchmark orchestrator. node run-p9.cjs <RUN_ID> <size> <scenario,...>
// Variants: baseline(9126f35 build, LRU+sort prune) | lru(O(1) LRU) | scan-resistant | adaptive, all cache ON; plus baseline cache OFF.
// Each block = fresh process; 2 blocks per variant; block order rotates (Latin-square style) to spread order effects.
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs"); const path = require("node:path"); const os = require("node:os");
const [RUN_ID, SIZE, SCEN] = process.argv.slice(2);
const OUT = path.join("<RESULTS>/p9-final/bench/data", RUN_ID);
if (fs.existsSync(OUT)) throw new Error("exists " + OUT);
fs.mkdirSync(OUT, { recursive: true });
const V = "<COGIC_REPO>/.p9-variants";
const variants = process.env.P9_VARIANTS ? process.env.P9_VARIANTS.split(",").map((x) => x.split(":")) : [["baseline-off", "baseline", "off"], ["baseline", "baseline", "on"], ["lru", "lru", "on"], ["scan-resistant", "scan-resistant", "on"], ["adaptive", "adaptive", "on"]];
const WS = `<RESULTS>/scratch/workspaces/synthetic-${SIZE}`;
const listFiles = (root) => { const out = []; const visit = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const f = path.join(d, e.name); if (e.isDirectory()) { if (!["node_modules", ".git", ".debug-dist"].includes(e.name)) visit(f); } else if (/\.(ts|tsx|js|jsx)$/i.test(e.name)) out.push(f); } }; visit(root); return out; };
const target = { id: `synthetic-${SIZE}`, root: WS, activeFile: path.join(WS, "entry.ts"), filePaths: listFiles(WS) };
const tjson = path.join(OUT, "target.json"); fs.writeFileSync(tjson, JSON.stringify(target));
fs.writeFileSync(path.join(OUT, "env.json"), JSON.stringify({ RUN_ID, size: SIZE, files: target.filePaths.length, node: process.version, cpu: os.cpus()[0].model, mem: os.totalmem(), startedAt: new Date().toISOString(), variants }, null, 2));
const WARMUP = 3, RUNS = 15;
for (const sc of SCEN.split(",")) {
  for (let block = 0; block < 2; block++) {
    const order = variants.map((_, i) => variants[(i + block * 2 + sc.length) % variants.length]);
    for (const [label, v, mode] of order) {
      const t = Date.now();
      const r = spawnSync(process.execPath, ["--expose-gc", path.join(__dirname, "worker-p9.cjs"), tjson, mode, sc, String(sc === "cold-start" ? 0 : WARMUP), String(sc === "cold-start" ? 1 : RUNS)], { env: { ...process.env, COGIC_REPO: path.join(V, v), P6_SPAWN_EPOCH_MS: String(t) }, encoding: "utf8", maxBuffer: 256 << 20 });
      let p = null; try { p = JSON.parse(r.stdout); } catch {}
      const rec = { label, variant: v, mode, scenario: sc, block, at: new Date(t).toISOString(), wallMs: Date.now() - t, exit: r.status, ...(p ?? { error: (r.stderr || "").slice(-1500) }) };
      fs.appendFileSync(path.join(OUT, "raw.jsonl"), JSON.stringify(rec) + "\n");
      console.log(`${rec.at} ${SIZE} ${sc} ${label} b${block} exit=${r.status} wall=${rec.wallMs}`);
    }
  }
}
fs.writeFileSync(path.join(OUT, "DONE"), new Date().toISOString());
