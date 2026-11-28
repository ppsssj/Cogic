// P14-E pilot: selection, blind packets, deterministic delivery ZIPs, earlier packets unchanged.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AI_MODELS, FRAMEWORKS, buildPilot, selectPilot } from "../pilot.mjs";
import { buildPacket } from "../../../p14c-protocol/tools/build-review-packet.mjs";
import { buildAiPacket } from "../../../p14d-semantic-contract/tools/ai-review.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "p14e-")), "out");
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

const a = tmp();
const b = tmp();
const ra = buildPilot({ out: a });
const rb = buildPilot({ out: b });

test("selection: one case per framework, from blind IDs and framework folders only", () => {
  const key = JSON.parse(fs.readFileSync(path.join(a, "selection", "full-b-packet", "researcher", "blind-key.json"), "utf8"));
  assert.equal(ra.cases.length, FRAMEWORKS.length);
  for (const fw of FRAMEWORKS) assert.equal(key.find((k) => k.blindId === ra.selection.perFramework[fw].chosen).category, fw);
  // only blindId and category are read: other fields and the order of the key do not matter
  const minimal = key.map((k) => ({ blindId: k.blindId, category: k.category })).reverse();
  assert.deepEqual(selectPilot(minimal).cases, ra.cases);
});

test("packets: the four cases under the full-packet blind IDs, C1 included, no leak", () => {
  for (const side of ["ai", "human"]) {
    const rep = JSON.parse(fs.readFileSync(path.join(a, side, "researcher", "build-report.json"), "utf8"));
    assert.deepEqual(rep.cases.map((c) => c.blindId).sort(), ra.cases);
    assert.equal(rep.leakCheck.hits.length, 0);
    const full = JSON.parse(fs.readFileSync(path.join(a, "selection", "full-b-packet", "researcher", "blind-key.json"), "utf8"));
    for (const c of rep.cases) assert.equal(full.find((f) => f.blindId === c.blindId).caseId, c.caseId);
    const pkt = path.join(a, side, "packet");
    assert.deepEqual(fs.readdirSync(path.join(pkt, "cases")).sort(), ra.cases);
    assert.equal(fs.readFileSync(path.join(pkt, "SEMANTIC_CONTRACT_C1.md"), "utf8"), fs.readFileSync(path.join(here, "..", "..", "contract", "SEMANTIC_CONTRACT_C1.md"), "utf8"));
  }
  const ai = path.join(a, "ai", "packet");
  const human = path.join(a, "human", "packet");
  assert.ok(fs.existsSync(path.join(ai, "AI_REVIEW_PROMPT.md")) && !fs.existsSync(path.join(ai, "DECLARATION.md")));
  assert.ok(fs.existsSync(path.join(human, "DECLARATION.md")) && fs.existsSync(path.join(human, "forms", "pilot-feedback.csv")) && fs.existsSync(path.join(human, "forms", "time-log.csv")));
  assert.ok(!fs.existsSync(path.join(human, "AI_REVIEW_PROMPT.md")));
  assert.match(fs.readFileSync(path.join(human, "README.md"), "utf8"), /파일럿/);
});

test("delivery: the three AI ZIPs are byte-identical; rebuilding gives the same bytes", () => {
  const ai = ra.zips.filter((z) => AI_MODELS.includes(z.for));
  assert.equal(new Set(ai.map((z) => z.sha256)).size, 1);
  assert.deepEqual(ra.zips.map((z) => z.sha256), rb.zips.map((z) => z.sha256));
  assert.equal(ra.ai.packetSha256, rb.ai.packetSha256);
  assert.equal(ra.human.packetSha256, rb.human.packetSha256);
  for (const z of ra.zips) assert.equal(sha256(fs.readFileSync(path.join(a, "deliver", z.zip))), z.sha256);
});

test("delivery: each ZIP entry is the packet file, byte for byte (stored, CRC checked)", () => {
  const zip = fs.readFileSync(path.join(a, "deliver", "p14e-pilot-human.zip"));
  let off = 0;
  let n = 0;
  while (zip.readUInt32LE(off) === 0x04034b50) {
    const size = zip.readUInt32LE(off + 18);
    const nameLen = zip.readUInt16LE(off + 26);
    const name = zip.subarray(off + 30, off + 30 + nameLen).toString("utf8");
    const data = zip.subarray(off + 30 + nameLen, off + 30 + nameLen + size);
    const rel = name.replace(/^p14e-pilot-human\//, "");
    assert.ok(data.equals(fs.readFileSync(path.join(a, "human", "packet", ...rel.split("/")))), rel);
    off += 30 + nameLen + size;
    n++;
  }
  assert.equal(n, ra.human.fileCount);
});

test("earlier packets are unchanged by the blind-ID subset option", () => {
  assert.equal(buildPacket({ out: tmp() }).packetSha256, "b44d15c167616fc9d0e2db1f3e0588cd6da81022dc84bedec1428a2ab9ff2efd");
  assert.equal(buildAiPacket(tmp()).packetSha256, "f3cfc92c3267948a4d5a25d88d23b9679e71a8cd48384cdfc147e72692d6febe");
});
