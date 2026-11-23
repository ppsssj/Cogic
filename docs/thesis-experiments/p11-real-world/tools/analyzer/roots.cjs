// Mirrors buildWorkspaceRoots (src/analyzer/analyze.ts @ v0.0.6) to report which rootNames the analyzer uses.
const ts = require("<COGIC_REPO>/node_modules/typescript"); const fs = require("fs"), path = require("path");
const { listFiles } = require("./list-files.cjs");
const root = path.resolve(process.argv[2]); const fp = listFiles(root).files; const tc = path.join(root, "tsconfig.json");
if (!fs.existsSync(tc)) { console.log(JSON.stringify({ usedTsconfig: false, roots: fp.length, mode: "filePaths+default options" })); process.exit(); }
const cfg = ts.readConfigFile(tc, ts.sys.readFile); const p = ts.parseJsonConfigFileContent(cfg.config ?? {}, ts.sys, path.dirname(tc), undefined, tc);
const resolved = p.fileNames.length > 0 || Object.keys(p.options).length > 0;
console.log(JSON.stringify({ usedTsconfig: true, tsconfigFiles: p.fileNames.length, optionKeys: Object.keys(p.options).length, references: (cfg.config.references || []).length, rootsUsed: p.fileNames.length ? p.fileNames.length : fp.length, mode: p.fileNames.length ? "tsconfig fileNames" : (resolved ? "filePaths + tsconfig options" : "references/filePaths"), errors: p.errors.length }));
