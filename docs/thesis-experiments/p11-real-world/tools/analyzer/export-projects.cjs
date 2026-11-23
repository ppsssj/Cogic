// Path-free project table for the paper/repo. node export-projects.cjs <summaryDir> <out.csv>
"use strict";
const fs = require("node:fs"), path = require("node:path"), { execFileSync } = require("node:child_process");
const [sum, outF] = process.argv.slice(2);
const P11 = path.resolve(__dirname, "..");
const meta = {
  hono: { repo: "https://github.com/honojs/hono", group: "S", type: "Web framework library (multi-runtime)", pm: "pnpm" },
  excalidraw: { repo: "https://github.com/excalidraw/excalidraw", group: "M", type: "React web application (yarn workspaces monorepo)", pm: "yarn 1" },
  vite: { repo: "https://github.com/vitejs/vite", group: "L", type: "Developer tool (pnpm monorepo, no root tsconfig)", pm: "pnpm" },
  typeorm: { repo: "https://github.com/typeorm/typeorm", group: "XL", type: "ORM library (pnpm monorepo, no root tsconfig)", pm: "pnpm 10" },
  query: { repo: "https://github.com/TanStack/query", group: "control", type: "Data-fetching library monorepo (root tsconfig lists 3 files)", pm: "pnpm" },
};
const rows = fs.readFileSync(path.join(sum, "p11-conditions.csv"), "utf8").trim().split("\n").map((l) => l.split(","));
const h = rows[0];
const cell = (p, k) => { const r = rows.find((x) => x[0] === p && x[1] === "active-edit" && x[2] === "adaptive"); return r[h.indexOf(k)]; };
const cols = ["project", "group", "repository", "commit", "commit_date", "license", "type", "package_manager", "panel_file_list", "root_mode", "root_files", "program_source_files", "graph_nodes", "graph_edges", "source_dir", "candidate_files", "active_file", "active_relative_imports", "cross_file"];
const out = [cols.join(",")];
for (const p of Object.keys(meta)) {
  const t = JSON.parse(fs.readFileSync(path.join(P11, "targets", `${p}.json`), "utf8"));
  const rel = (f) => (f ? path.relative(t.root, f).split(path.sep).join("/") : "");
  const proj = path.join(P11, "projects", p);
  const git = (...a) => execFileSync("git", ["-C", proj, ...a], { encoding: "utf8" }).trim();
  const roots = JSON.parse(execFileSync(process.execPath, [path.join(__dirname, "roots.cjs"), proj], { encoding: "utf8" }));
  const lic = fs.readdirSync(proj).find((f) => /^licen[cs]e/i.test(f));
  const licText = lic ? fs.readFileSync(path.join(proj, lic), "utf8").slice(0, 40) : "";
  const v = { project: p, group: meta[p].group, repository: meta[p].repo, commit: git("rev-parse", "HEAD"), commit_date: git("log", "-1", "--format=%cs"), license: /MIT/.test(licText) ? "MIT" : "see repo", type: meta[p].type, package_manager: meta[p].pm,
    panel_file_list: t.filePaths.length, root_mode: roots.mode, root_files: cell(p, "root_files"), program_source_files: cell(p, "program_source_files"), graph_nodes: cell(p, "nodes"), graph_edges: cell(p, "edges"),
    source_dir: t.srcDir, candidate_files: t.candidates, active_file: rel(t.activeFile), active_relative_imports: t.activeRelImports, cross_file: rel(t.crossFile) };
  out.push(cols.map((c) => String(v[c]).replace(/,/g, ";")).join(","));
}
fs.writeFileSync(outF, out.join("\n") + "\n");
console.log(out.join("\n"));
