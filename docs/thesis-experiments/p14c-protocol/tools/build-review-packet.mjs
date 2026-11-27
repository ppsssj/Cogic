#!/usr/bin/env node
// P14-C: builds the independent human-review packet for Corpus A (44 cases) and Corpus B (20).
//
//   node docs/thesis-experiments/p14c-protocol/tools/build-review-packet.mjs --out <new folder outside the repo>
//        [--corpus-a-commit <sha>] [--corpus-b-commit <sha>] [--seed 20261127]
//
// It reads every input from git objects at pinned commits (no checkout, nothing in the work tree is
// read for the corpora), so the packet is reproducible from the repository alone.
//
// Into the packet (<out>/packet/, the only folder a reviewer receives):
//   - per case, under a neutral blind ID (A01..A44, B01..B20 in seeded order): the source files,
//     tsconfig, shims, the active file name; for Corpus B the upstream provenance and licence;
//   - the reviewer guide, the relation criteria, the declaration and the empty forms.
// Never into the packet: expected*.json (GT), case.json (titles, descriptions, authoring notes),
// catalog.csv (pattern IDs, support classes, analyzer code locations), original case IDs, analyzer
// output, scores, the Corpus B import-edge table and review modules.
// Researcher-only (<out>/researcher/, never given to a reviewer): the blind-ID key and the build
// report. The leak check runs on the packet and the build fails if it finds anything.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, "../../../..");
export const GENERATOR = "p14c-review-packet/1";
export const DEFAULTS = {
  // Corpus A: the fixtures as of main 6ee7784 (tree unchanged since GT v1 r2, see versions-and-integrity.md).
  corpusACommit: "6ee778418e189d02ba11089de7550231c75292ac",
  corpusAPath: "docs/thesis-experiments/fixtures/exp-01",
  // Corpus B: only on the P1-K/P1-L branches (PR #15 / #19). Same fixtures tree at b4a5ff5 and 4c5a3e2.
  corpusBCommit: "4c5a3e234f930057b15e3f0a608939839c0dc62a",
  corpusBPath: "docs/thesis-experiments/corpus-b/fixtures",
  guideCommit: "6ee778418e189d02ba11089de7550231c75292ac",
  guidePath: "docs/thesis-experiments/fixtures/exp-01/ANNOTATION_GUIDE.md",
  seed: 20261127,
};
const CASE_DIR_DEPTH = 2; // <category>/<caseId>/...
const NEVER_COPY = [/^expected(\.v\d+)?\.json$/, /^case\.json$/];
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|vue|d\.ts)$/;

const git = (args) => execFileSync("git", args, { cwd: REPO, encoding: "buffer", maxBuffer: 1 << 28 });
const gitText = (args) => git(args).toString("utf8");
export const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const lf = (buf) => Buffer.from(buf.toString("utf8").replace(/\r\n/g, "\n"), "utf8");

function listTree(commit, dir) {
  return gitText(["ls-tree", "-r", "--name-only", commit, dir]).split("\n").filter(Boolean);
}
const show = (commit, file) => git(["show", `${commit}:${file}`]);

function seededShuffle(items, seed) {
  let s = seed >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function casesOf(commit, root) {
  const files = listTree(commit, root);
  const cases = new Map();
  for (const f of files) {
    const rel = f.slice(root.length + 1).split("/");
    if (rel.length <= CASE_DIR_DEPTH) continue; // catalog.csv, README, manifests ...
    if (rel[0] === "review") continue;
    const id = rel[1];
    if (!cases.has(id)) cases.set(id, { id, category: rel[0], dir: `${root}/${rel[0]}/${id}`, files: [] });
    cases.get(id).files.push(rel.slice(CASE_DIR_DEPTH).join("/"));
  }
  return [...cases.values()].filter((c) => c.files.includes("expected.json")).sort((a, b) => (a.id < b.id ? -1 : 1));
}

// The relation definitions of ANNOTATION_GUIDE v1 (sections 2-5 and 6.2), with the sentences that
// name the analyzer's support scope removed. The removals are listed in the build report.
export const GUIDE_REMOVALS = [
  ["(`external`/`lib` 대상, §6.1 분류상 unsupported-by-design)", "(`external`/`lib` 대상)"],
  [" 작성자가 Cogic adapter 목록을 읽었다는 점은 §1.6에 밝혔다.", ""],
  ["- 결정성은 GT 작성 시 blind로 부여하며, 예측을 본 뒤 바꾸지 않는다(§10).\n", ""],
  ["\"Cogic이 처리하기 어렵다\"는 기준이 아니다.", "\"도구가 처리하기 어렵다\"는 기준이 아니다."],
  // pattern IDs of the catalog (they name the GT's patterns); the rule text stays
  ["references`한다(`FW-REACT-REDUCER-BINDING`).", "references`한다."],
  ["위 항목에 대한 부정 사례(`NEG-USEREF`, `NEG-USECONTEXT`, `NEG-CUSTOM-HOOK`)는", "위 항목(useRef·useContext·사용자 정의 hook)에 대한 부정 사례는"],
  ["- `.vue` SFC는 정량 평가에서 제외한다(카탈로그 `VUE-SFC`).", "- `.vue` SFC는 이 검토에 없다."],
  // examples that point at an existing GT case and its relation IDs
  ["§4의 정의대로 정답(positive)이다. 예: `h03` R10–R15.", "§4의 정의대로 정답(positive)이다."],
  ["그 자체로 상태 source다(예: `h03` R03).", "그 자체로 상태 source다."],
];
export function blindGuide(text) {
  const t = text.replace(/\r\n/g, "\n");
  const sections = [];
  const grab = (start, end) => {
    const i = t.indexOf(start);
    const j = end ? t.indexOf(end, i + 1) : t.length;
    if (i < 0 || j < 0) throw new Error(`guide section not found: ${start}`);
    sections.push(t.slice(i, j).trimEnd());
  };
  grab("## 2. 노드(그래프 모델)", "## 6. 지원 분류와 결정성");
  grab("### 6.2 결정성 (`gtStatus`)", "### 6.3 평가 집합");
  let body = sections.join("\n\n");
  const applied = [];
  for (const [from, to] of GUIDE_REMOVALS) {
    if (body.includes(from)) {
      body = body.split(from).join(to);
      applied.push(from);
    }
  }
  body = body.replace("### 6.2 결정성 (`gtStatus`)", "### 결정성 (determinate / indeterminate)");
  return {
    text: `# 관계 정의 (EXP-01 ANNOTATION_GUIDE v1 §2–§5, §6.2 발췌)\n\n이 문서는 원 지침의 관계 정의 부분이다. 원 지침의 지원 범위 분류(§6.1, §6.3, §6.4), 파일 형식(§9), 버전 관리(§10)는 검토와 무관하여 넣지 않았다. 절 번호는 원 지침의 번호다.\n\n${body}\n`,
    applied,
  };
}

// Words and identifiers that must not appear anywhere in the packet.
export function leakPatterns({ originalCaseIds, patternIds }) {
  const words = [
    "expected.json", "gtStatus", "gtVersion", "unsupported-by-design", "\\bsupported\\b", "analyze\\.ts",
    "precision", "recall", "\\bF1\\b", "EXCLUDED-INDETERMINATE", "humanReviewed", "cogicOutputUsed",
    "exp01-gt/", "exp01-raw/", "analyzerOutput", "matchedBy",
  ];
  // short case IDs (c05, h03, br02 ...) and GT item IDs (R03, N01, I02), as the guide cites them
  const shortIds = [...new Set(originalCaseIds.map((id) => id.split("-")[0]))];
  return [
    ...words.map((w) => ({ kind: "word", re: new RegExp(w, "i"), label: w })),
    ...shortIds.map((id) => ({ kind: "shortCaseId", re: new RegExp(`\\b${id}\\b`), label: id })),
    { kind: "gtItemId", re: /\b[RNI]\d{2}\b/, label: "R/N/I + two digits" },
    ...originalCaseIds.map((id) => ({ kind: "caseId", re: new RegExp(`\\b${id.replace(/[-]/g, "\\-")}\\b`), label: id })),
    ...patternIds.map((p) => ({ kind: "patternId", re: new RegExp(`\\b${p.replace(/[-]/g, "\\-")}\\b`), label: p })),
  ];
}
export function scanForLeaks(dir, patterns) {
  const hits = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        const rel = path.relative(dir, p).split(path.sep).join("/");
        if (/expected|case\.json$|catalog/i.test(e.name)) hits.push({ file: rel, label: "forbidden file name" });
        const text = fs.readFileSync(p, "utf8");
        for (const pat of patterns) if (pat.re.test(text) || pat.re.test(rel)) hits.push({ file: rel, label: `${pat.kind}:${pat.label}` });
      }
    }
  };
  walk(dir);
  return hits;
}

function writeFile(root, rel, buf, manifest) {
  const p = path.join(root, ...rel.split("/"));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, buf);
  manifest.push({ path: rel, sha256: sha256(lf(buf)), bytes: buf.length });
}

export function buildPacket({ out, corpusACommit = DEFAULTS.corpusACommit, corpusBCommit = DEFAULTS.corpusBCommit, seed = DEFAULTS.seed, templates = path.join(here, "..", "human-review", "packet-template") }) {
  if (fs.existsSync(out)) throw new Error(`output exists: ${out} (use a new folder)`);
  const rel = path.relative(REPO, path.resolve(out));
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) throw new Error("build the packet outside the repository: reviewers must not get the repository, which holds the GT");
  const packet = path.join(out, "packet");
  const researcher = path.join(out, "researcher");
  const manifest = [];
  const report = { generator: GENERATOR, inputs: { corpusACommit, corpusBCommit, guideCommit: DEFAULTS.guideCommit, seed }, trees: {}, excludedPerCase: [...NEVER_COPY.map(String), "catalog.csv", "upstream.json: caseId, importEdges, thirdPartyModules"], guideRemovals: [], cases: [] };
  report.trees.corpusA = gitText(["rev-parse", `${corpusACommit}:${DEFAULTS.corpusAPath}`]).trim();
  report.trees.corpusB = gitText(["rev-parse", `${corpusBCommit}:${DEFAULTS.corpusBPath}`]).trim();

  const corpora = [
    { label: "A", commit: corpusACommit, root: DEFAULTS.corpusAPath },
    { label: "B", commit: corpusBCommit, root: DEFAULTS.corpusBPath },
  ];
  const originalCaseIds = [];
  const patternIds = new Set();
  for (const c of corpora) {
    const catalog = show(c.commit, `${c.root}/catalog.csv`).toString("utf8").split(/\r?\n/).slice(1);
    for (const line of catalog) if (line.trim()) patternIds.add(line.split(",")[0]);
    const cases = casesOf(c.commit, c.root);
    const order = seededShuffle(cases, seed + (c.label === "A" ? 0 : 1));
    order.forEach((cs, i) => {
      const blindId = `${c.label}${String(i + 1).padStart(2, "0")}`;
      originalCaseIds.push(cs.id);
      const caseJson = JSON.parse(show(c.commit, `${cs.dir}/case.json`).toString("utf8"));
      const info = { blindId, corpus: c.label, activeFile: caseJson.activeFile, files: [] };
      for (const f of cs.files) {
        const name = f.split("/").pop();
        if (NEVER_COPY.some((re) => re.test(name))) continue;
        let buf = show(c.commit, `${cs.dir}/${f}`);
        if (name === "upstream.json") {
          const u = JSON.parse(buf.toString("utf8"));
          const keep = { repo: u.repo, url: u.url, commit: u.commit, license: u.license, licenseFile: u.licenseFile, activeFile: u.activeFile, upstreamActiveFile: u.upstreamActiveFile, files: u.files, tsconfig: u.tsconfig };
          writeFile(packet, `cases/${blindId}/provenance.json`, Buffer.from(`${JSON.stringify(keep, null, 2)}\n`), manifest);
          info.provenance = "provenance.json";
          continue;
        }
        if (name === "LICENSE.upstream") {
          writeFile(packet, `cases/${blindId}/LICENSE.upstream`, buf, manifest);
          continue;
        }
        writeFile(packet, `cases/${blindId}/source/${f}`, buf, manifest);
        info.files.push(f);
      }
      if (!info.files.includes(info.activeFile)) throw new Error(`${cs.id}: active file missing`);
      writeFile(packet, `cases/${blindId}/case-info.json`, Buffer.from(`${JSON.stringify(info, null, 2)}\n`), manifest);
      report.cases.push({ blindId, corpus: c.label, caseId: cs.id, category: cs.category, files: info.files.length, activeFile: info.activeFile });
    });
  }
  const guide = blindGuide(show(DEFAULTS.guideCommit, DEFAULTS.guidePath).toString("utf8"));
  report.guideRemovals = guide.applied;
  writeFile(packet, "RELATION_DEFINITIONS.md", Buffer.from(guide.text), manifest);
  for (const f of fs.readdirSync(templates, { recursive: true })) {
    const src = path.join(templates, f);
    if (fs.statSync(src).isFile()) writeFile(packet, f.split(path.sep).join("/"), fs.readFileSync(src), manifest);
  }
  const leaks = scanForLeaks(packet, leakPatterns({ originalCaseIds, patternIds: [...patternIds] }));
  report.leakCheck = { patterns: leakPatterns({ originalCaseIds, patternIds: [...patternIds] }).length, hits: leaks };
  manifest.sort((a, b) => (a.path < b.path ? -1 : 1));
  const packetSha256 = sha256(Buffer.from(manifest.map((m) => `${m.sha256}  ${m.path}`).join("\n")));
  const packetManifest = { schema: "p14c-review-packet-manifest/1", generator: GENERATOR, inputs: report.inputs, trees: report.trees, fileCount: manifest.length, packetSha256, files: manifest };
  fs.mkdirSync(researcher, { recursive: true });
  fs.writeFileSync(path.join(researcher, "blind-key.json"), `${JSON.stringify(report.cases, null, 2)}\n`);
  fs.writeFileSync(path.join(researcher, "build-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(researcher, "packet-manifest.json"), `${JSON.stringify(packetManifest, null, 2)}\n`);
  if (leaks.length) throw new Error(`leak check failed: ${JSON.stringify(leaks.slice(0, 10))}`);
  return { packetSha256, fileCount: manifest.length, cases: report.cases.length, report };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
  if (!opt("--out")) {
    console.error("usage: build-review-packet.mjs --out <new folder outside the repo>");
    process.exit(2);
  }
  const r = buildPacket({ out: path.resolve(opt("--out")), corpusACommit: opt("--corpus-a-commit"), corpusBCommit: opt("--corpus-b-commit"), seed: opt("--seed") ? Number(opt("--seed")) : undefined });
  console.log(`${r.cases} cases, ${r.fileCount} files, packet sha256 ${r.packetSha256}; leak check: 0 hits`);
}
