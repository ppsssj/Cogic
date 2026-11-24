// Instrument an isolated, compiled extension copy only; no product file is modified.
const fs = require('node:fs');
const file = process.argv[2];
if (!file || !fs.existsSync(file)) throw Error('Pass isolated out/analyzer/analyze.js');
let source = fs.readFileSync(file, 'utf8');
function replaceOnce(anchor, replacement) {
  if (source.split(anchor).length !== 2) throw Error('Missing or repeated anchor: ' + anchor.slice(0, 120));
  source = source.replace(anchor, replacement);
}
replaceOnce('const ts = require("typescript");', `const ts = require("typescript");
const p12pOut = process.env.P12C2_PROGRAM_PROFILE;
let p12pCurrent;
if (p12pOut) ts.performance.enable();
const p12pStat = (name) => { if (!p12pCurrent) return fs.statSync(name); const t = performance.now(); try { p12pCurrent.statCalls++; return fs.statSync(name); } finally { p12pCurrent.statMs += performance.now()-t; } };
const p12pMeasures = () => Object.fromEntries(['Parse','Program','ResolveModule','ResolveTypeReference','Bind','Check'].map(k => [k, ts.performance.getDuration(k)]));
const p12pDiff = (a,b) => Object.fromEntries(Object.keys(a).map(k => [k,b[k]-a[k]]));`);
replaceOnce('    const { rootNames, options, usedTsconfig, projectRoot } = buildWorkspaceRoots({', '    const p12pAnalysisStart = performance.now();\n    const p12pRootsStart = performance.now();\n    const { rootNames, options, usedTsconfig, projectRoot } = buildWorkspaceRoots({');
replaceOnce('    const scriptKind = pickScriptKind(active.fileName, active.languageId);\n    // P12-B session:', '    const p12pRootsMs = performance.now() - p12pRootsStart;\n    const scriptKind = pickScriptKind(active.fileName, active.languageId);\n    // P12-B session:');
replaceOnce('function normalizeCachePath(fileName) {\n    const normalized = path.resolve(fileName);\n    return process.platform === "win32" ? normalized.toLowerCase() : normalized;\n}', `function normalizeCachePath(fileName) {
    if (!p12pCurrent) { const normalized = path.resolve(fileName); return process.platform === "win32" ? normalized.toLowerCase() : normalized; }
    const t = performance.now(); try { p12pCurrent.normalizeCalls++; const normalized = path.resolve(fileName); return process.platform === "win32" ? normalized.toLowerCase() : normalized; } finally { p12pCurrent.normalizeMs += performance.now() - t; }
}`);
replaceOnce('exports.AnalysisSession = AnalysisSession;', `exports.AnalysisSession = AnalysisSession;
if (p12pOut) { const reuse = AnalysisSession.prototype.reuseSourceFile; AnalysisSession.prototype.reuseSourceFile = function (...a) { if (!p12pCurrent) return reuse.apply(this,a); const t=performance.now(); try { p12pCurrent.reuseCalls++; return reuse.apply(this,a); } finally { p12pCurrent.reuseMs += performance.now()-t; } }; }`);
if (source.split('stat = fs.statSync(requested);').length !== 3) throw Error('stat anchor count');
source = source.replaceAll('stat = fs.statSync(requested);', 'stat = p12pStat(requested);');
replaceOnce('    beginSourceFileCachePass(rootNames.length);\n    const programStart = performance.now();', `    if (p12pOut) {
        p12pCurrent = { sourceRequests: 0, sourceMs: 0, normalizeCalls: 0, normalizeMs: 0, statCalls: 0, statMs: 0, reuseCalls: 0, reuseMs: 0, readCalls: 0, readMs: 0, readBytes: 0, fileExistsCalls: 0, fileExistsMs: 0, hits: 0, misses: 0, stale: 0, bypass: 0, disabled: 0 };
        const read = defaultHost.readFile.bind(defaultHost);
        defaultHost.readFile = (...a) => { const t=performance.now(); try { const v=read(...a); p12pCurrent.readCalls++; p12pCurrent.readBytes += typeof v === 'string' ? Buffer.byteLength(v) : 0; return v; } finally { p12pCurrent.readMs += performance.now()-t; } };
        const exists = host.fileExists.bind(host);
        host.fileExists = (...a) => { const t=performance.now(); try { p12pCurrent.fileExistsCalls++; return exists(...a); } finally { p12pCurrent.fileExistsMs += performance.now()-t; } };
        const get = host.getSourceFile.bind(host);
        host.getSourceFile = (...a) => { const t=performance.now(); try { p12pCurrent.sourceRequests++; return get(...a); } finally { p12pCurrent.sourceMs += performance.now()-t; } };
    }
    const p12pBefore = p12pOut ? p12pMeasures() : undefined;
    const p12pFreeBefore = p12pOut ? require('os').freemem() : 0;
    const p12pCacheBefore = p12pOut ? getAnalyzerCacheStats() : undefined;
    beginSourceFileCachePass(rootNames.length);
    const programStart = performance.now();`);
replaceOnce('    const checker = program.getTypeChecker();\n    const sf = program.getSourceFile(activeFile);', `    const p12pAfterProgram = p12pOut ? p12pMeasures() : undefined;
    const p12pHostAfterProgram = p12pOut ? {...p12pCurrent} : undefined;
    const p12pCheckerStart = performance.now();
    const checker = program.getTypeChecker();
    const p12pCheckerMs = performance.now() - p12pCheckerStart;
    const sf = program.getSourceFile(activeFile);`);
replaceOnce('    // workspace graph (external nodes enabled)\n    const { graph, trace } = buildActiveFileGraph(sf, checker, resolveModuleLocation, adapters);\n    return {', `    // workspace graph (external nodes enabled)\n    const { graph, trace } = buildActiveFileGraph(sf, checker, resolveModuleLocation, adapters);
    if (p12pOut) { try { fs.appendFileSync(p12pOut, JSON.stringify({file: activeFile, rootsMs:p12pRootsMs, rootFiles:rootNames.length, sourceFiles:program.getSourceFiles().length, usedTsconfig, oldProgram:Boolean(oldProgram), session:Boolean(session), reusedSourceFiles, createProgramMs, checkerMs:p12pCheckerMs, afterCheckerToGraphMs:performance.now()-p12pCheckerStart-p12pCheckerMs, analysisMs:performance.now()-p12pAnalysisStart, measures:p12pDiff(p12pBefore,p12pAfterProgram), hostDuringProgram:p12pHostAfterProgram, hostThroughGraph:p12pCurrent, cacheBefore:p12pCacheBefore, cacheAfter:getAnalyzerCacheStats(), rss:process.memoryUsage().rss, freeBefore:p12pFreeBefore, freeAfter:require('os').freemem()})+'\\n'); } catch {} }
    return {`);
for (const [event,field] of [['hit','hits'],['bypass','bypass'],['disabled','disabled']]) {
  const anchor = `debug?.("analyzer.sourceFileCache.${event}", {`;
  if (source.split(anchor).length !== 2) throw Error('cache anchor ' + event);
  source = source.replace(anchor, `if (p12pCurrent) p12pCurrent.${field}++;\n        ${anchor}`);
}
replaceOnce('    debug?.(cached ? "analyzer.sourceFileCache.stale" : "analyzer.sourceFileCache.miss", {', '    if (p12pCurrent) p12pCurrent[cached ? "stale" : "misses"]++;\n    debug?.(cached ? "analyzer.sourceFileCache.stale" : "analyzer.sourceFileCache.miss", {');
fs.writeFileSync(file, source);
