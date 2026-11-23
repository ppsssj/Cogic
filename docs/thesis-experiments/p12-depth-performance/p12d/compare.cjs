// Deterministic overlap simulation: run each mode in its own process for maxRSS.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { analyzeWorkspaceDepth, AnalysisCancelledError, clearAnalyzerCaches } = require('../../../../out/analyzer');
const mode = process.argv[2];
if (!['baseline', 'cancel'].includes(mode)) throw Error('expected baseline or cancel');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p12d-compare-'));
const a = path.join(root, 'a.ts'), b = path.join(root, 'b.ts');
fs.writeFileSync(a, 'import { b } from "./b"; export function a(x: number) { return b(x); }');
fs.writeFileSync(b, 'export function b(x: number) { return x + 1; }');
(async () => {
  const start = performance.now();
  let programs = 0, cancelled = false, release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { entered = resolve; });
  const args = { code: fs.readFileSync(a, 'utf8'), fileName: a, languageId: 'typescript', traceMode: false, graphDepth: 2, traceScope: 'single-file', workspaceRoot: root, filePaths: [a,b], cacheEnabled: true, debug: event => { if (event === 'analyzer.program.created') programs++; } };
  const old = analyzeWorkspaceDepth({ ...args, isCancelled: () => mode === 'cancel' && cancelled, readFile: async f => { entered(); await gate; return fs.promises.readFile(f, 'utf8'); } });
  await ready;
  cancelled = true;
  release();
  let oldCancelled = false;
  try { await old; } catch (e) { if (!(e instanceof AnalysisCancelledError)) throw e; oldCancelled = true; }
  const result = await analyzeWorkspaceDepth({ ...args, readFile: f => fs.promises.readFile(f, 'utf8') });
  const normalized = JSON.stringify(result.graph).split(root.replace(/\\/g, '/')).join('<fixture>').split(root).join('<fixture>');
  console.log(JSON.stringify({ mode, requests: 2, programs, cancelled: Number(oldCancelled), elapsedMs: performance.now() - start, maxRssKiB: process.resourceUsage().maxRSS, nodes: result.graph.nodes.length, edges: result.graph.edges.length, graphSha256: crypto.createHash('sha256').update(normalized).digest('hex') }));
})().finally(() => { clearAnalyzerCaches(); fs.rmSync(root, { recursive: true, force: true }); }).catch(e => { console.error(e); process.exitCode = 1; });
