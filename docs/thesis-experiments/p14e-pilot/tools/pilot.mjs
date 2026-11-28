#!/usr/bin/env node
// P14-E: the four-case review pilot (one Corpus B case per framework). Does not call any AI.
//
//   node docs/thesis-experiments/p14e-pilot/tools/pilot.mjs build --out <new folder outside the repo> [--seed 20261128]
//
// Steps, all reproducible from the repository alone:
//   1. selection: builds the full Corpus B blind packet once (P14-C generator, same blind IDs as the
//      human and P14-D AI packets) only to read its researcher key (blind ID -> framework folder).
//      Per framework, the blind ID with the smallest sha256("p14e-pilot/1|<seed>|<blindId>") is chosen.
//      Nothing else is read: no GT, no analyzer output, no score, no support class.
//   2. ai/:    blind packet of the 4 cases + Semantic Contract C1 + the AI prompt and response format.
//      human/: blind packet of the 4 cases + C1 + the human forms (declaration, time log, questions)
//              and the pilot feedback form.
//   3. deliver/: deterministic ZIPs (stored, fixed timestamps, sorted entries), one per AI model with
//      byte-identical content, one for the human reviewers, and SHA256SUMS.txt.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPacket } from "../../p14c-protocol/tools/build-review-packet.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const p14c = path.resolve(here, "../../p14c-protocol/human-review/packet-template");
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
export const SELECTION_RULE = "p14e-pilot/1";
export const DEFAULT_SEED = 20261128;
export const FRAMEWORKS = ["react", "vue", "express", "nest"];
export const AI_MODELS = ["claude", "gpt6", "gemini"];

export const selectionScore = (seed, blindId) => sha256(Buffer.from(`${SELECTION_RULE}|${seed}|${blindId}`));

/** key: [{ blindId, category }] from the full packet's researcher key. */
export function selectPilot(key, seed = DEFAULT_SEED) {
  const perFramework = {};
  for (const fw of FRAMEWORKS) {
    const pool = key.filter((k) => k.category === fw).map((k) => ({ blindId: k.blindId, score: selectionScore(seed, k.blindId) }));
    if (!pool.length) throw new Error(`no case for ${fw}`);
    pool.sort((a, b) => (a.score < b.score ? -1 : 1));
    perFramework[fw] = { chosen: pool[0].blindId, pool: pool.sort((a, b) => (a.blindId < b.blindId ? -1 : 1)) };
  }
  return { rule: `per framework, min sha256("${SELECTION_RULE}|<seed>|<blindId>")`, seed, perFramework, cases: FRAMEWORKS.map((fw) => perFramework[fw].chosen).sort() };
}

// --- deterministic ZIP (method 0 = stored) -------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function listFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(path.relative(dir, p).split(path.sep).join("/"));
    }
  };
  walk(dir);
  return out.sort();
}
/** Writes <dir>'s files under <prefix>/ into a stored ZIP with fixed 1980-01-01 timestamps. */
export function writeZip(dir, zipPath, prefix) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const DOS_TIME = 0;
  const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01
  for (const rel of listFiles(dir)) {
    const data = fs.readFileSync(path.join(dir, ...rel.split("/")));
    const name = Buffer.from(`${prefix}/${rel}`, "utf8");
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(DOS_TIME, 10); lh.writeUInt16LE(DOS_DATE, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, name, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(DOS_TIME, 12); ch.writeUInt16LE(DOS_DATE, 14); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += lh.length + name.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  const count = centrals.length / 2;
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  const zip = Buffer.concat([...locals, cd, end]);
  fs.writeFileSync(zipPath, zip, { flag: "wx" });
  return { zip: path.basename(zipPath), sha256: sha256(zip), bytes: zip.length, entries: count };
}

// --- build ---------------------------------------------------------------------------------------
const AI_SKIP = ["README.md", "DECLARATION.md", "forms/questions.csv", "forms/time-log.csv"];
const HUMAN_SKIP = ["README.md"];

export function buildPilot({ out, seed = DEFAULT_SEED }) {
  if (fs.existsSync(out)) throw new Error(`output exists: ${out} (use a new folder)`);
  fs.mkdirSync(out, { recursive: true });
  const full = buildPacket({ out: path.join(out, "selection", "full-b-packet"), only: ["B"] });
  const key = full.report.cases.map((c) => ({ blindId: c.blindId, category: c.category }));
  const selection = selectPilot(key, seed);
  fs.writeFileSync(path.join(out, "selection", "selection.json"), `${JSON.stringify({ ...selection, fullPacketSha256: full.packetSha256 }, null, 2)}\n`);
  const contract = path.join(root, "contract");
  const ai = buildPacket({ out: path.join(out, "ai"), only: ["B"], blindIds: selection.cases, extraTemplates: [contract, path.join(root, "templates", "ai")], skipTemplates: AI_SKIP });
  const human = buildPacket({ out: path.join(out, "human"), only: ["B"], blindIds: selection.cases, extraTemplates: [contract, path.join(root, "templates", "human")], skipTemplates: HUMAN_SKIP });
  const deliver = path.join(out, "deliver");
  fs.mkdirSync(deliver);
  const zips = [];
  for (const m of AI_MODELS) zips.push({ for: m, ...writeZip(path.join(out, "ai", "packet"), path.join(deliver, `p14e-pilot-ai-${m}.zip`), "p14e-pilot-ai") });
  zips.push({ for: "human", ...writeZip(path.join(out, "human", "packet"), path.join(deliver, "p14e-pilot-human.zip"), "p14e-pilot-human") });
  fs.writeFileSync(path.join(deliver, "SHA256SUMS.txt"), `${zips.map((z) => `${z.sha256}  ${z.zip}`).join("\n")}\n`);
  const result = {
    schema: "p14e-pilot-build/1",
    seed,
    cases: selection.cases,
    ai: { packetSha256: ai.packetSha256, fileCount: ai.fileCount, leakHits: ai.report.leakCheck.hits.length },
    human: { packetSha256: human.packetSha256, fileCount: human.fileCount, leakHits: human.report.leakCheck.hits.length },
    zips,
  };
  fs.writeFileSync(path.join(out, "build-result.json"), `${JSON.stringify(result, null, 2)}\n`);
  return { ...result, selection };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...args] = process.argv.slice(2);
  const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
  if (cmd !== "build" || !opt("--out")) {
    console.error("usage: pilot.mjs build --out <new folder outside the repo> [--seed N]");
    process.exit(2);
  }
  const r = buildPilot({ out: path.resolve(opt("--out")), seed: opt("--seed") ? Number(opt("--seed")) : undefined });
  console.log(JSON.stringify({ cases: r.cases, ai: r.ai, human: r.human, zips: r.zips }, null, 2));
}
