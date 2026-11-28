// P14-E AI review intake helpers: the fence derivative only inserts lines; the strict CSV check flags
// what lenient parsers accept. Synthetic inputs only (no review response is stored in the repository).
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FORMS, parseResponse } from "../../../p14d-semantic-contract/tools/ai-review.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const tools = path.join(here, "..", "ai-results");
const forms = path.join(here, "../../../p14c-protocol/human-review/packet-template/forms");
const head = (f) => fs.readFileSync(path.join(forms, `${f}.csv`), "utf8").trim();
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), "p14e-air-"));

test("fence-derive: bare tables become parseable; removing the inserted fences gives the raw bytes", () => {
  for (const eol of ["\n", "\r\n"]) {
    const d = dir();
    const body = ["intro text", "csv relations", head("relations"), "x,B01,1,calls,a.ts,1,f,b.ts,2,g,,,determinate,,a.ts:1,high,n", "", ...FORMS.slice(1).flatMap((f) => [head(f), ""]), "closing text"].join(eol);
    fs.writeFileSync(path.join(d, "raw.txt"), body);
    execFileSync(process.execPath, [path.join(tools, "fence-derive.mjs"), path.join(d, "raw.txt"), path.join(d, "derived.txt")]);
    const derived = fs.readFileSync(path.join(d, "derived.txt"), "utf8");
    assert.deepEqual(parseResponse(body).missing, FORMS);
    const { rows, missing } = parseResponse(derived);
    assert.deepEqual(missing, []);
    assert.equal(rows.relations.split(/\r?\n/).length, 2);
    assert.equal(derived.split(eol).filter((l) => !/^```/.test(l)).join(eol), body);
    assert.throws(() => execFileSync(process.execPath, [path.join(tools, "fence-derive.mjs"), path.join(d, "derived.txt"), path.join(d, "again.txt")], { stdio: "pipe" }));
  }
});

test("csv-check: column count and RFC 4180 quote errors; valid quoting passes", () => {
  const d = dir();
  for (const f of FORMS) fs.writeFileSync(path.join(d, `${f}.csv`), `${head(f)}\n`);
  const n = head("negatives").split(",").length;
  const ok = ["r", "B01", "1", ...Array(n - 4).fill(""), '"a, ""quoted"" b"'];
  const comma = ["r", "B01", "2", ...Array(n - 4).fill(""), "a, b"];
  const backslash = ["r", "B01", "3", ...Array(n - 4).fill(""), '"say \\"x\\" here"'];
  fs.writeFileSync(path.join(d, "negatives.csv"), `${head("negatives")}\n${[ok, comma, backslash].map((r) => r.join(",")).join("\n")}\n`);
  const res = JSON.parse(execFileSync(process.execPath, [path.join(tools, "csv-check.mjs"), d], { encoding: "utf8" }));
  assert.deepEqual(res.map((r) => r.no), ["2", "3"]);
  assert.equal(res[1].error, "text after closing quote");
});
