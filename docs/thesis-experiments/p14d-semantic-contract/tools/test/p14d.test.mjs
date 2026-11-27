// P14-D: AI review tooling and the decorator probe's key observations.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { FORMS, buildAiPacket, compare, extract, intake, parseResponse } from "../ai-review.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "p14d-"));
const header = (f) => fs.readFileSync(path.resolve(here, "../../../p14c-protocol/human-review/packet-template/forms", `${f}.csv`), "utf8").trim();
const response = (rels) => FORMS.map((f) => `\`\`\`csv ${f}\n${header(f)}\n${f === "relations" ? rels.join("\n") : ""}\n\`\`\``).join("\n\nsome reasoning\n\n");

test("the AI packet is Corpus B only, blind, and has the prompt and response format", () => {
  const out = path.join(tmp(), "out");
  const r = buildAiPacket(out);
  assert.equal(r.cases, 20);
  const files = fs.readdirSync(path.join(out, "packet"));
  for (const f of ["README.md", "AI_REVIEW_PROMPT.md", "RESPONSE_FORMAT.md", "RELATION_DEFINITIONS.md", "REVIEW_CRITERIA.md", "CORPUS_B_ENVIRONMENT.md"]) assert.ok(files.includes(f), f);
  assert.ok(!files.includes("DECLARATION.md"));
  assert.deepEqual(fs.readdirSync(path.join(out, "packet", "cases")).filter((c) => !/^B\d\d$/.test(c)), []);
  assert.deepEqual(r.report.leakCheck.hits, []);
});

test("intake keeps the raw bytes with their hash and refuses to overwrite", () => {
  const ev = tmp();
  const raw = path.join(tmp(), "resp.md");
  fs.writeFileSync(raw, "raw answer\r\nwith CRLF");
  const meta = intake({ evidence: ev, model: "model-x", version: "v1", iface: "web", date: "2026-11-27", caseId: "B01", file: raw });
  const kept = fs.readFileSync(path.join(ev, "model-x", "B01", meta.rawFile));
  assert.deepEqual(kept, fs.readFileSync(raw));
  assert.throws(() => intake({ evidence: ev, model: "model-x", version: "v1", iface: "web", date: "2026-11-27", caseId: "B01", file: raw }), /already preserved/);
  assert.throws(() => intake({ evidence: ev, model: "model-x", version: "v1", iface: "web", date: "2026-11-27", caseId: "S037", file: raw }), /blind ID/);
});

test("responses are parsed by named CSV blocks; a wrong header is reported, not repaired", () => {
  const ok = parseResponse(response(["m,B01,1,calls,src/a.ts,3,f,src/b.ts,1,g,,,determinate,,src/a.ts:3,high,"]));
  assert.deepEqual(ok.missing, []);
  const bad = parseResponse("```csv relations\nwrong,header\n```");
  assert.ok(bad.missing.includes("relations (header differs)"));
  assert.ok(bad.missing.includes("negatives"));
});

test("extract refuses a raw file changed after intake", () => {
  const ev = tmp();
  const raw = path.join(tmp(), "r.md");
  fs.writeFileSync(raw, response([]));
  const meta = intake({ evidence: ev, model: "m", version: "1", iface: "api", date: "2026-11-27", caseId: "B02", file: raw });
  fs.appendFileSync(path.join(ev, "m", "B02", meta.rawFile), "edited");
  assert.throws(() => extract({ evidence: ev, model: "m", out: path.join(tmp(), "forms") }), /changed since intake/);
});

test("compare: two reviewers, agreement and both one-sided outcomes", () => {
  const mk = (rels) => {
    const ev = tmp();
    const raw = path.join(tmp(), "r.md");
    fs.writeFileSync(raw, response(rels));
    intake({ evidence: ev, model: "m", version: "1", iface: "api", date: "2026-11-27", caseId: "B03", file: raw });
    const out = path.join(tmp(), "forms");
    extract({ evidence: ev, model: "m", out });
    return out;
  };
  const row = (n, tgtLine) => `m,B03,${n},calls,src/a.ts,3,f,src/b.ts,${tgtLine},g,,,determinate,,src/a.ts:3,high,`;
  const a = mk([row(1, 1), row(2, 9)]);
  const b = mk([row(1, 1), row(2, 20)]);
  const { rows, summary } = compare({ a, b });
  assert.deepEqual(rows.map((r) => r.outcome).sort(), ["AGREE", "A_ONLY", "B_ONLY"]);
  assert.equal(summary.B03.both, 1);
});

test("decorator probe: evaluation site depends on the decorator mode; the call hierarchy is not symmetric", () => {
  const repo = path.resolve(here, "../../../../..");
  const out = path.join(tmp(), "probe.json");
  execFileSync(process.execPath, [path.resolve(here, "../../decorator-probe/probe.cjs"), "--out", out], { cwd: repo });
  const r = JSON.parse(fs.readFileSync(out, "utf8"));
  const legacy = r.fixtures.legacy;
  const standard = r.fixtures.standard;
  const scope = (f, name, form = "called") => f.emit.filter((s) => s.name === name && s.form === form).map((s) => s.scope.kind);
  // experimentalDecorators: factories of a top-level class run at module top level
  assert.deepEqual([...new Set(scope(legacy, "Method"))].sort(), ["MethodDeclaration", "SourceFile"]); // the nested class runs inside run()
  assert.deepEqual(scope(legacy, "ClassDeco"), ["SourceFile"]);
  // standard decorators: inside a class static block / the class IIFE, not module top level
  assert.deepEqual(scope(standard, "Method"), ["ClassStaticBlock"]);
  // Language Service: Method's caller is the decorated method, but the method's outgoing calls do
  // not include Method; the class's outgoing calls do.
  const callers = legacy.languageService.incoming.Method.map((c) => c.from.name);
  assert.ok(callers.includes("method"));
  assert.ok(!legacy.languageService.outgoing["Sample.method"].some((c) => c.to.name === "Method"));
  assert.ok(legacy.languageService.outgoing["class Sample"].some((c) => c.to.name === "Method"));
  // Cogic: class/property/parameter decorator factories as calls from the file; no method decorator
  // factory call; plain decorators as references from the decorated declaration
  const edges = legacy.cogic.edges.map((e) => `${e.kind} ${e.source.split("@")[0]} -> ${e.target.split("@")[0]}`);
  assert.ok(edges.includes("calls file:main.ts -> function:ClassDeco"));
  assert.ok(!edges.some((e) => e.startsWith("calls") && e.endsWith("function:Method")));
  assert.ok(edges.includes("references method:Sample.method -> function:PlainMethod"));
});
