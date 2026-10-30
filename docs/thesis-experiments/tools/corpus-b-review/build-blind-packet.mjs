#!/usr/bin/env node
// P1-K3: build the blind review packet for Corpus B. The packet holds source code, the annotation
// guide, the redacted addendum, a reduced catalog, syntax-only worksheets and empty forms. It never
// holds expected.json, review modules, GT conclusions, analyzer output or accuracy figures; a leak scan
// runs after the build and fails the build if any GT-specific string is found.
// Usage: node build-blind-packet.mjs --out <new dir> [--manifest <file>]   (refuses to overwrite)
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CHECKLIST, CHECKLIST_COLUMNS } from "./checklist-data.mjs";
import { REVIEW_TOOL_VERSION, corpusDir, inventory, listCases, parseCsv, readJson, repoRoot, toCsv } from "./review-lib.mjs";

const prep = path.join(repoRoot, "docs/thesis-experiments/corpus-b/review-preparation");
export const RELATION_FORM_COLUMNS = ["caseId", "reviewerItemId", "kind", "source", "target", "argIndex", "gtStatus", "candidates", "pattern", "anchor", "evidenceLines", "siteIds", "guideClauses", "confidence", "note"];
export const SITE_FORM_COLUMNS = ["caseId", "siteId", "line", "col", "siteKind", "expression", "args", "disposition", "relationItemIds", "reason", "guideClauses"];
export const NEGATIVE_FORM_COLUMNS = ["caseId", "reviewerItemId", "kind", "source", "target", "pattern", "anchor", "evidenceLines", "rationale", "guideClauses"];
export const QUESTION_LOG_COLUMNS = ["questionId", "date", "caseId", "question", "answer", "answeredBy"];
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

function copyTree(src, dst, filter = () => true) {
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (!filter(s, e)) continue;
    if (e.isDirectory()) {
      fs.mkdirSync(d, { recursive: true });
      copyTree(s, d, filter);
    } else fs.copyFileSync(s, d);
  }
}

export function blindChecklistRows() {
  return CHECKLIST.filter((c) => c.phase === "BLIND").map((c) => ({ ...c, status: "OPEN", reviewerDecision: "", sourceCodeEvidence: "", guideClauseCited: "", rationale: "" }));
}

function worksheet(inv, info, checks) {
  const width = String(inv.text.split(/\r?\n/).length).length;
  const listing = inv.text.split(/\r?\n/).map((l, i) => `${String(i + 1).padStart(width, " ")}  ${l}`).join("\n");
  const esc = (s) => String(s).replace(/\|/g, "\\|");
  return [
    `# ${inv.caseId} 검토 worksheet`,
    "",
    `- framework: ${inv.framework}`,
    `- upstream: ${info.url} @ \`${info.commit}\` (${info.license})`,
    `- active file: \`${inv.activeFile}\`(upstream \`${info.upstreamActiveFile}\`)`,
    `- 검토 범위: active file 1–${inv.text.split(/\r?\n/).length}행. owner가 이 파일 안에 있는 관계 전부(blind-review-guide.md §3)`,
    "- 이 worksheet는 TypeScript parser·컴파일러로 만든 구문 정보다. §2 노드 여부와 관계는 적혀 있지 않다.",
    "",
    "## 1. active file",
    "",
    "```ts",
    listing,
    "```",
    "",
    "## 2. import 해석표",
    "",
    "| 줄 | specifier | 가져오는 이름 | type-only | 해석되는 곳 |",
    "|---|---|---|---|---|",
    ...inv.imports.map((i) => `| ${i.line} | \`${esc(i.specifier)}\` | ${esc(i.names)} | ${i.typeOnly ? "yes" : ""} | ${esc(i.resolvesTo)} |`),
    "",
    "## 3. active file 선언 목록",
    "",
    "함수·메서드·생성자·접근자·클래스·인터페이스·type alias·enum·변수, 그리고 함수형 초기값을 가진 속성이다. 마지막 열은 검토자가 판단한다.",
    "",
    "| 줄 | 이름 | 종류 | 형태 | §2 노드?(검토자) |",
    "|---|---|---|---|---|",
    ...inv.declarations.map((d) => `| ${d.line} | \`${esc(d.name)}\` | ${d.kind} | ${d.shape} | |`),
    "",
    "## 4. 호출 지점 목록",
    "",
    "호출·new·JSX 요소·데코레이터·tagged template 지점이다. sites-form.csv에 같은 목록이 있다. references·dataflow·owner·updates는 이 목록에 없으므로 코드를 읽고 찾는다.",
    "",
    "| siteId | 줄:열 | 종류 | 식 | 인자 수 |",
    "|---|---|---|---|---|",
    ...inv.sites.map((s) => `| ${s.siteId} | ${s.line}:${s.col} | ${s.siteKind} | \`${esc(s.expression)}\` | ${s.args} |`),
    "",
    "## 5. 이 사례의 체크리스트 항목",
    "",
    checks.length ? checks.map((c) => `- **${c.checkId}** (${c.location}) ${c.question}`).join("\n") : "- 사례별 항목 없음. 전역 항목 G-01–G-06을 적용한다.",
    "",
  ].join("\n");
}

const appliesTo = (c, caseId, framework) => {
  if (c.cases === "ALL") return false;
  const prefix = caseId.slice(0, 2);
  return c.cases.split(/;\s*/).some((x) => x === caseId || (x.includes("–") && x.slice(0, 2) === prefix) || (x === "ALL"));
};

export function build(out) {
  if (fs.existsSync(out)) throw new Error(`${out} exists; refusing to overwrite`);
  fs.mkdirSync(path.join(out, "common"), { recursive: true });
  // common material
  fs.copyFileSync(path.join(repoRoot, "docs/thesis-experiments/fixtures/exp-01/ANNOTATION_GUIDE.md"), path.join(out, "common/ANNOTATION_GUIDE.md"));
  for (const f of ["blind-addendum.md", "reviewer-instructions.md", "blind-review-guide.md"]) fs.copyFileSync(path.join(prep, f), path.join(out, "common", f));
  const catalog = parseCsv(fs.readFileSync(path.join(corpusDir, "catalog.csv"), "utf8"));
  fs.writeFileSync(path.join(out, "common/catalog.blind.csv"), toCsv(catalog, ["patternId", "category", "kind", "polarity", "support", "description"]));
  fs.writeFileSync(path.join(out, "common/review-checklist.csv"), toCsv(blindChecklistRows(), CHECKLIST_COLUMNS));
  fs.writeFileSync(path.join(out, "common/questions-log.csv"), toCsv([], QUESTION_LOG_COLUMNS));
  const stats = [];
  for (const c of listCases()) {
    const dst = path.join(out, "cases", c.framework, c.caseId);
    fs.mkdirSync(path.join(dst, "source"), { recursive: true });
    // workspace without GT: everything except expected.json, case.json (authoring/review notes) and upstream.json (re-emitted)
    copyTree(c.caseDir, path.join(dst, "source"), (s, e) => !(e.isFile() && ["expected.json", "case.json", "upstream.json", "LICENSE.upstream"].includes(e.name)));
    fs.copyFileSync(path.join(c.caseDir, "LICENSE.upstream"), path.join(dst, "LICENSE.upstream"));
    const up = readJson(path.join(c.caseDir, "upstream.json"));
    const info = { caseId: c.caseId, framework: c.framework, repo: up.repo, url: up.url, commit: up.commit, license: up.license, activeFile: up.activeFile, upstreamActiveFile: up.upstreamActiveFile, files: up.files, thirdPartyModules: up.thirdPartyModules, tsconfig: { upstream: up.tsconfig.upstream, derivedOptions: up.tsconfig.derivedOptions } };
    fs.writeFileSync(path.join(dst, "case-info.json"), `${JSON.stringify(info, null, 2)}\n`);
    const inv = inventory(c);
    const checks = CHECKLIST.filter((k) => k.phase === "BLIND" && appliesTo(k, c.caseId, c.framework));
    fs.writeFileSync(path.join(dst, "worksheet.md"), worksheet(inv, info, checks));
    fs.writeFileSync(path.join(dst, "sites-form.csv"), toCsv(inv.sites.map((s) => ({ caseId: c.caseId, ...s })), SITE_FORM_COLUMNS));
    fs.writeFileSync(path.join(dst, "relations-form.csv"), toCsv([], RELATION_FORM_COLUMNS));
    fs.writeFileSync(path.join(dst, "negatives-form.csv"), toCsv([], NEGATIVE_FORM_COLUMNS));
    stats.push({ caseId: c.caseId, framework: c.framework, activeLines: inv.text.split(/\r?\n/).length, sites: inv.sites.length, declarations: inv.declarations.length, imports: inv.imports.length, checklistItems: checks.map((k) => k.checkId) });
  }
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else files.push(p);
    }
  };
  walk(out);
  const entries = files.map((f) => ({ path: path.relative(out, f).split(path.sep).join("/"), sha256: sha(fs.readFileSync(f)) })).sort((a, b) => (a.path < b.path ? -1 : 1));
  const sourceCommit = execFileSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const packetSha256 = sha(entries.map((e) => `${e.sha256}  ${e.path}\n`).join(""));
  const manifest = { schema: "corpus-b-blind-packet/1", generator: REVIEW_TOOL_VERSION, sourceCommit, packetSha256, fileCount: entries.length, cases: stats, files: entries };
  fs.writeFileSync(path.join(out, "PACKET_MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

// Strings that would reveal the existing GT or analyzer results.
export function leakScan(out) {
  // content markers (a mention of a file name is not a leak; its content is)
  const forbidden = new Set(['"schema": "exp01-gt/1"', '"gtStatus": "determinate"', '"gtStatus": "indeterminate"', "exp01-raw/1", "exp01-pred/1", "analyzerOutput", "gtItemId", "export function apply(gt", "h.drop(", "h.set(", "precisionSensitivity", "recallInScope"]);
  for (const c of listCases()) {
    const gt = readJson(path.join(c.caseDir, "expected.json"));
    for (const n of gt.nodes) if (n.id !== "file") forbidden.add(n.id);
    for (const r of [...gt.relations, ...gt.negatives]) for (const s of [r.note, r.reason, r.rationale]) if (s && s.length >= 25) forbidden.add(s);
    for (const s of gt.excludedSites) if (s.reason.length >= 25) forbidden.add(s.reason.replace(/^[A-Z_]+: /, ""));
  }
  const hits = [];
  const bad = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        if (e.name === "expected.json" || e.name.endsWith(".mjs") || /expected\.v\d+\.json$/.test(e.name)) bad.push(path.relative(out, p));
        if (path.basename(p) === "PACKET_MANIFEST.json") continue;
        const text = fs.readFileSync(p, "utf8");
        for (const f of forbidden) if (text.includes(f)) hits.push({ file: path.relative(out, p).split(path.sep).join("/"), string: f.slice(0, 60) });
      }
    }
  };
  walk(out);
  return { forbiddenStrings: forbidden.size, forbiddenFiles: bad, hits };
}

function main() {
  const arg = (n) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : null);
  const out = path.resolve(arg("--out"));
  const manifest = build(out);
  const leak = leakScan(out);
  console.log(JSON.stringify({ packetSha256: manifest.packetSha256, fileCount: manifest.fileCount, cases: manifest.cases.length, sites: manifest.cases.reduce((a, c) => a + c.sites, 0), declarations: manifest.cases.reduce((a, c) => a + c.declarations, 0), activeLines: manifest.cases.reduce((a, c) => a + c.activeLines, 0), leak: { forbiddenStrings: leak.forbiddenStrings, forbiddenFiles: leak.forbiddenFiles.length, hits: leak.hits.length } }, null, 1));
  if (leak.forbiddenFiles.length || leak.hits.length) {
    console.error(JSON.stringify(leak, null, 1));
    process.exitCode = 1;
  }
  const m = arg("--manifest");
  if (m) {
    if (fs.existsSync(m)) throw new Error(`${m} exists; refusing to overwrite`);
    fs.writeFileSync(m, `${JSON.stringify({ ...manifest, leakScan: { forbiddenStrings: leak.forbiddenStrings, forbiddenFiles: leak.forbiddenFiles, hits: leak.hits } }, null, 2)}\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
