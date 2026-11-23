// Offline verification of archived P13 records; never writes to the archive.
"use strict";
const fs = require("node:fs"), path = require("node:path");
const data = path.resolve(__dirname, "../../data");
const read = (p) => fs.readFileSync(path.join(data, p), "utf8").replace(/^\uFEFF/, "");
const json = (p) => JSON.parse(read(p));
function csv(p) {
  const text = read(p), rows = []; let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c; }
    else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ""; }
    else if (c === '\n') { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (quoted) throw Error(`unclosed CSV quote: ${p}`);
  if (cell || row.length) { row.push(cell.replace(/\r$/, "")); rows.push(row); }
  const head = rows.shift(); return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}
const errors = [];
function check(ok, message) { if (!ok) errors.push(message); }
const same = (a, b, label) => check(JSON.stringify(a) === JSON.stringify(b), `${label}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const envs = fs.readdirSync(path.join(data, "runs-env")).filter(x => x.endsWith(".env.json")).map(x => json(`runs-env/${x}`));
const status = json("run-status.json"), ids = new Set();
for (const e of envs) { check(!ids.has(e.runId), `duplicate run: ${e.runId}`); ids.add(e.runId); }
const ea = envs.filter(e => e.runId.startsWith("p13a-")), eb = envs.filter(e => e.runId.startsWith("p13b-"));
same([ea.length, eb.length, envs.length], [12, 48, 60], "run counts");
same([ea.filter(e => e.exit === 0 && !e.skipped).length, eb.filter(e => e.exit === 0 && !e.skipped).length, eb.filter(e => e.exit === 1 && !e.skipped).length], [12, 45, 3], "exit counts");
same(status.stageA, ea.length, "status stage A"); same(status.stageB, eb.length, "status stage B");
same([...status.nonZeroOrSkipped.map(e => e.runId)].sort(), envs.filter(e => e.exit !== 0 || e.skipped).map(e => e.runId).sort(), "status nonzero IDs");
for (const s of status.nonZeroOrSkipped) { const e = envs.find(x => x.runId === s.runId); check(!!e && s.exit === e.exit && (s.skipped || "") === (e.skipped || ""), `status mismatch ${s.runId}`); }
for (const e of eb.filter(e => e.exit === 1)) check(e.task === "H2" && e.tool === "tff", `unexpected failed run ${e.runId}`);
for (const e of ea) check(ea.filter(x => x.tool === e.tool && x.run === e.run).length === 1, `duplicate A cell ${e.runId}`);
for (const e of eb) check(eb.filter(x => x.tool === e.tool && x.run === e.run && x.task === e.task).length === 1, `duplicate B cell ${e.runId}`);
for (const tool of ["vscode", "tff", "cg", "cogic"]) for (let run = 0; run < 3; run++) {
  check(ea.some(e => e.tool === tool && e.run === run), `missing A ${tool}/${run}`);
  for (const task of ["H1", "H2", "V1", "V2"]) check(eb.some(e => e.tool === tool && e.run === run && e.task === task), `missing B ${task}/${tool}/${run}`);
}
const mapA = (st, notes) => st === "pass" ? "SUPPORTED_AND_VERIFIED" : st === "partial" ? "PARTIALLY_SUPPORTED" : st === "unsupported" ? "UNSUPPORTED_BY_DESIGN" : st === "fail" ? "EXECUTION_FAILED" : /No usable worker runtime|worker unavailable/i.test(notes) || st === "unverified" ? "ENVIRONMENT_BLOCKED" : "NOT_TESTED";
const a = json("stage-a-per-run.json"), b = json("stage-b-per-run.json"), corrections = { C1: 0, C2: 0, C3: 0 };
same([a.length, b.length], [48, 144], "per-run rows");
for (const e of ea) same(a.filter(r => r.runId === e.runId).map(r => r.task).sort(), ["T1", "T2", "T3", "T4"], `A tasks ${e.runId}`);
for (const e of eb) same(b.filter(r => r.runId === e.runId).map(r => r.kind).sort(), ["R1", "R2", "R3"], `B tasks ${e.runId}`);
for (const r of a) {
  const e = ea.find(e => e.runId === r.runId); check(!!e, `unknown A run ${r.runId}`); if (!e) continue;
  const tasks = json(`runs/${r.runId}/result.json`).tasks, t = tasks.find(t => t.tool === r.tool && t.task === r.task);
  if (!t) { errors.push(`missing A task ${r.runId}/${r.task}`); continue; }
  same([r.run, r.raw, r.cls, r.ops, r.switches, r.returnOps ?? ""], [e.run, t.status, mapA(t.status, t.notes ?? ""), t.userOperations, t.fileSwitches, t.returnOperations ?? ""], `A ${r.runId}/${r.task}`);
}
for (const r of b) {
  const e = eb.find(e => e.runId === r.runId); check(!!e, `unknown B run ${r.runId}`); if (!e) continue;
  const dir = `runs/${r.runId}`, tasks = json(`${dir}/p13-tasks.json`), steps = csv(`${dir}/steps.csv`), t = tasks.find(t => t.task === `${e.task}-${r.kind}`);
  const failed = name => steps.some(s => s.step === name && s.ok === "false");
  let cls = t?.status, correction = "";
  if (e.tool === "tff" && r.kind === "R2" && t?.status === "UNSUPPORTED_BY_DESIGN" && failed("r2-select-target")) { cls = "EXECUTION_FAILED"; correction = "C1"; check(["V1", "V2"].includes(e.task), `unexpected C1 ${r.runId}`); }
  if (!t) { cls = "EXECUTION_FAILED"; correction = "C2"; check(e.task === "H2" && e.tool === "tff" && r.kind === "R3" && e.exit === 1 && failed("r3-dblclick-target"), `unexpected missing B task ${r.runId}/${r.kind}`); }
  if (e.tool === "vscode" && r.kind === "R3" && failed("r3-open-target-row")) { cls = "EXECUTION_FAILED"; correction = "C3"; check(e.task === "H2", `unexpected C3 ${r.runId}`); }
  if (correction) {
    corrections[correction]++;
    const name = { C1: "r2-select-target", C2: "r3-dblclick-target", C3: "r3-open-target-row" }[correction];
    const log = read(`correction-logs/${r.runId}.txt`), lines = log.split(/\r?\n/); let current = "", found = false;
    for (const line of lines) { const m = /\bSTEP (\S+)/.exec(line); if (m) current = m[1]; if (current === name && /FAILED:/.test(line)) found = true; }
    check(found, `missing failure in correction log ${r.runId}/${name}`);
  }
  same([r.run, r.task, r.toolKey, r.rawClass, r.cls, (r.correction ?? "").split(":")[0]], [e.run, e.task, e.tool, t?.status ?? "(not recorded)", cls, correction], `B ${r.runId}/${r.kind}`);
  if (t) same([r.ops, r.switches, r.returnOps], [t.userOperations, t.fileSwitches, t.returnOperations ?? ""], `B operations ${r.runId}/${r.kind}`);
}
same(corrections, { C1: 6, C2: 3, C3: 3 }, "correction counts");
function verifySummary(stage, rows, keys) {
  const summaries = csv(`stage-${stage}-summary.csv`), groups = new Map();
  for (const r of rows) { const key = keys.map(k => r[k]).join("|"); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(r); }
  same([summaries.length, groups.size], stage === "a" ? [16, 16] : [48, 48], `${stage} summary count`);
  const seen = new Set();
  for (const s of summaries) {
    const key = keys.map(k => s[k]).join("|"); check(!seen.has(key), `duplicate summary ${stage}/${key}`); seen.add(key);
    const rs = (groups.get(key) ?? []).sort((x, y) => x.run - y.run); if (!rs.length) { errors.push(`missing summary group ${stage}/${key}`); continue; }
    const classes = rs.map(r => r.cls), counts = new Map(); for (const c of classes) counts.set(c, (counts.get(c) ?? 0) + 1);
    const top = [...counts.entries()].sort((x, y) => y[1] - x[1])[0], representative = top[1] >= 2 ? top[0] : `MIXED(${classes.join("/")})`;
    same([s.runs, s.classes, s.representative, s.ops, s.switches, s.returnOps], [String(rs.length), classes.join("/"), representative, rs.map(r => r.ops ?? "").join("/"), rs.map(r => r.switches ?? "").join("/"), rs.map(r => r.returnOps ?? "").join("/")], `summary ${stage}/${key}`);
    if (stage === "b") {
      const nums = rs.map(r => r.ops).filter(x => typeof x === "number").sort((x, y) => x - y), m = nums.length >> 1, med = !nums.length ? "" : String(nums.length % 2 ? nums[m] : (nums[m-1] + nums[m])/2);
      same([s.rawClasses, s.corrections, s.opsMedian], [rs.map(r => r.rawClass).join("/"), [...new Set(rs.map(r => (r.correction ?? "").split(":")[0]).filter(Boolean))].join(" "), med], `summary B raw/corrections/median ${key}`);
    }
  }
}
verifySummary("a", a, ["tool", "task"]); verifySummary("b", b, ["task", "tool", "kind"]);
if (errors.length) { console.error(`FAIL: ${errors.length} mismatch(es)\n${errors.join("\n")}`); process.exitCode = 1; }
else console.log("PASS: A 12/12 exit 0; B 48 attempts, 45 exit 0, 3 exit 1; C1=6 C2=3 C3=3; raw verdicts, failure steps, 64 summary groups and operations match. No files written.");
