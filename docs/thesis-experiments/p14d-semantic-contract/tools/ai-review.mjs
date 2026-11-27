#!/usr/bin/env node
// P14-D: tooling for an independent multi-AI review of Corpus B. Does not call any AI.
//
//   build    --out <new folder outside the repo>
//            The P14-C blind packet restricted to Corpus B (B01-B20), with the AI prompt and response
//            format added and the human-only files (declaration, questions, time log) left out.
//   intake   --evidence <folder> --model <name> --version <model version> --interface <web|api|...>
//            --date <YYYY-MM-DD> --case <Bxx> --file <raw response file> [--settings <text>]
//            Copies the raw response byte for byte into <evidence>/<model>/<case>/ with its SHA-256 and
//            the metadata. Refuses to overwrite. The raw file is never edited afterwards.
//   extract  --evidence <folder> --model <name> --out <forms folder>
//            Parses the CSV blocks of every preserved raw response of one model into forms/*.csv.
//            Responses that do not parse are listed, not repaired.
//   compare  --a <forms folder> --b <forms folder> --out <file.csv>
//            Case-by-case disagreements between two reviewers (AI or human), with the P14-C
//            reconciliation codes. Neither side is treated as correct.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPacket } from "../../p14c-protocol/tools/build-review-packet.mjs";
import { agreement, compareCase, parseCsv, reviewerItems } from "../../p14c-protocol/tools/reconcile.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
export const FORMS = ["relations", "negatives", "sites", "ambiguities", "outside-definitions"];
const HEADERS = Object.fromEntries(FORMS.map((f) => [f, fs.readFileSync(path.join(here, "../../p14c-protocol/human-review/packet-template/forms", `${f}.csv`), "utf8").trim()]));

export function buildAiPacket(out) {
  return buildPacket({
    out,
    only: ["B"],
    extraTemplates: [path.join(here, "..", "ai-review", "packet-template")],
    skipTemplates: ["README.md", "DECLARATION.md", "forms/questions.csv", "forms/time-log.csv"],
  });
}

export function intake({ evidence, model, version, iface, date, caseId, file, settings = "" }) {
  if (!/^B\d\d$/.test(caseId)) throw new Error("case must be a blind ID B01-B20");
  const dir = path.join(evidence, model.replace(/[^\w.-]/g, "_"), caseId);
  if (fs.existsSync(dir)) throw new Error(`already preserved: ${dir}`);
  fs.mkdirSync(dir, { recursive: true });
  const buf = fs.readFileSync(file);
  const ext = path.extname(file) || ".txt";
  fs.writeFileSync(path.join(dir, `raw${ext}`), buf, { flag: "wx" });
  const meta = { schema: "p14d-ai-response/1", model, modelVersion: version, interface: iface, date, caseId, settings, rawFile: `raw${ext}`, rawSha256: sha256(buf), bytes: buf.length, preservedAt: new Date().toISOString(), note: "raw bytes as received; never edited" };
  fs.writeFileSync(path.join(dir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`, { flag: "wx" });
  return meta;
}

/** CSV blocks named after the forms: ```csv relations ... ``` */
export function parseResponse(text) {
  const blocks = {};
  const re = /```csv[ \t]+([a-z-]+)[^\n]*\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(text))) blocks[m[1]] = m[2];
  const missing = FORMS.filter((f) => !(f in blocks));
  const rows = {};
  for (const f of FORMS) {
    if (!(f in blocks)) continue;
    const head = blocks[f].trim().split(/\r?\n/)[0].trim();
    if (head !== HEADERS[f]) {
      missing.push(`${f} (header differs)`);
      continue;
    }
    rows[f] = blocks[f].trim();
  }
  return { rows, missing };
}

export function extract({ evidence, model, out }) {
  const root = path.join(evidence, model.replace(/[^\w.-]/g, "_"));
  if (fs.existsSync(out)) throw new Error(`output exists: ${out}`);
  fs.mkdirSync(out, { recursive: true });
  const collected = Object.fromEntries(FORMS.map((f) => [f, [HEADERS[f]]]));
  const report = { model, cases: [], unparsed: [] };
  for (const caseId of fs.readdirSync(root).sort()) {
    const meta = JSON.parse(fs.readFileSync(path.join(root, caseId, "meta.json"), "utf8"));
    const raw = fs.readFileSync(path.join(root, caseId, meta.rawFile));
    if (sha256(raw) !== meta.rawSha256) throw new Error(`${caseId}: raw file changed since intake`);
    const { rows, missing } = parseResponse(raw.toString("utf8"));
    if (missing.length) report.unparsed.push({ caseId, missing });
    for (const f of Object.keys(rows)) collected[f].push(...rows[f].split(/\r?\n/).slice(1).filter((l) => l.trim()));
    report.cases.push(caseId);
  }
  for (const f of FORMS) fs.writeFileSync(path.join(out, `${f}.csv`), `${collected[f].join("\n")}\n`);
  fs.writeFileSync(path.join(out, "extract-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

/** reviewer A's items in the shape compareCase expects on its first side */
const asReference = (items) => items.map((x) => ({ ...x, alternatives: [] }));
export function compare({ a, b }) {
  const read = (dir, f) => parseCsv(fs.readFileSync(path.join(dir, `${f}.csv`), "utf8"));
  const [ra, na, rb, nb] = [read(a, "relations"), read(a, "negatives"), read(b, "relations"), read(b, "negatives")];
  const ids = [...new Set([...ra, ...rb, ...na, ...nb].map((r) => r.blindId))].sort();
  const rows = [];
  const summary = {};
  for (const id of ids) {
    const A = asReference(reviewerItems(ra.filter((r) => r.blindId === id), na.filter((r) => r.blindId === id)));
    const B = reviewerItems(rb.filter((r) => r.blindId === id), nb.filter((r) => r.blindId === id));
    const res = compareCase(A, B);
    summary[id] = { ...agreement(res), outcomes: res.reduce((m, r) => ({ ...m, [r.outcome]: (m[r.outcome] ?? 0) + 1 }), {}) };
    for (const r of res) rows.push({ blindId: id, outcome: r.outcome.replace("GT_ONLY", "A_ONLY").replace("REVIEWER_ONLY", "B_ONLY"), kind: r.gt?.kind ?? r.rev?.kind, aItem: r.gt?.id, aSource: r.gt?.src, aTarget: r.gt?.tgt, aDeterminacy: r.gt?.determinacy, bItem: r.rev?.id, bSource: r.rev?.src, bTarget: r.rev?.tgt, bDeterminacy: r.rev?.determinacy });
  }
  return { rows, summary };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...args] = process.argv.slice(2);
  const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
  if (cmd === "build") {
    const r = buildAiPacket(path.resolve(opt("--out")));
    console.log(`${r.cases} cases, ${r.fileCount} files, packet sha256 ${r.packetSha256}; leak check: 0 hits`);
  } else if (cmd === "intake") {
    console.log(JSON.stringify(intake({ evidence: opt("--evidence"), model: opt("--model"), version: opt("--version"), iface: opt("--interface"), date: opt("--date"), caseId: opt("--case"), file: opt("--file"), settings: opt("--settings") ?? "" }), null, 2));
  } else if (cmd === "extract") {
    console.log(JSON.stringify(extract({ evidence: opt("--evidence"), model: opt("--model"), out: opt("--out") }), null, 2));
  } else if (cmd === "compare") {
    const { rows, summary } = compare({ a: opt("--a"), b: opt("--b") });
    const cols = Object.keys(rows[0] ?? { blindId: "" });
    const cell = (v) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    fs.writeFileSync(opt("--out"), `${[cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n")}\n`);
    fs.writeFileSync(`${opt("--out")}.summary.json`, `${JSON.stringify(summary, null, 1)}\n`);
    console.log(`${Object.keys(summary).length} cases; ${rows.length} rows -> ${opt("--out")}`);
  } else {
    console.error("usage: ai-review.mjs build|intake|extract|compare ...");
    process.exit(2);
  }
}
