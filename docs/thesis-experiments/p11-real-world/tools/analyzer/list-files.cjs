// Replicates CodeGraphPanel.getWorkspaceFilePaths (v0.0.6): findFiles("**/*.{ts,tsx,js,jsx}", "**/{node_modules,dist,build,out,.next}/**", 4000).
// Assumption: explicit exclude replaces files.exclude, so dot-folders are searched (.git skipped: never contains sources).
const fs = require("node:fs"), path = require("node:path");
const EXCL = new Set(["node_modules", "dist", "build", "out", ".next", ".git"]);
function listFiles(root, cap = 4000) {
  const out = [];
  const visit = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const f = path.join(d, e.name); if (e.isDirectory()) { if (!EXCL.has(e.name)) visit(f); } else if (e.isFile() && /\.(ts|tsx|js|jsx)$/.test(e.name)) out.push(f); } };
  visit(root);
  return { all: out.length, files: out.slice(0, cap), capped: out.length > cap };
}
module.exports = { listFiles };
if (require.main === module) { const r = listFiles(process.argv[2]); console.log(JSON.stringify({ all: r.all, capped: r.capped })); }
