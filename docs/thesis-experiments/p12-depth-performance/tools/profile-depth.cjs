// P12-A: diagnostic Node reproduction of CodeGraphPanel depth traversal, not an extension-host timer.
// Run with --instrument 1 to instrument a private in-memory copy of compiled analyze.js.
"use strict";
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), crypto = require("node:crypto"), Module = require("node:module"), cp = require("node:child_process");
const opts = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, xs) => { if (i % 2 === 0) a.push([x.replace(/^--/, ""), xs[i+1]]); return a; }, []));
if (!opts.root || !opts.file || !opts.out || !["0","1","2"].includes(opts.depth) || !["off","cold","warm"].includes(opts.cache)) throw Error("--root <project> --file <relative> --depth 0|1|2 --cache off|cold|warm --instrument 0|1 --out <new.json> [--min-free-mb 500] [--max-ms 600000]");
if (fs.existsSync(opts.out)) throw Error("Output already exists");
const root = path.resolve(opts.root), file = path.resolve(root, opts.file), repo = path.resolve(__dirname, "../../../.."), instrument = opts.instrument === "1";
if (!file.startsWith(root + path.sep)) throw Error("Active file must be inside root");
const revision = cp.execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const { listFiles } = require(path.join(repo, "docs/thesis-experiments/p11-real-world/tools/analyzer/list-files.cjs"));
const listing = listFiles(root), norm = x => path.resolve(x).replace(/\\/g,"/").toLowerCase(), roots = new Set(listing.files.map(norm));
const rel = x => path.relative(root,x).replace(/\\/g,"/");
const now = () => performance.now(), totals = {}, events = {}, calls = []; let active = "", heapSampleMax = 0;
function sample() { heapSampleMax = Math.max(heapSampleMax, process.memoryUsage().heapUsed); }
function measured(name, fn) { const s=now(); try{return fn();} finally {const t=totals[name]??={count:0,ms:0}; t.count++; t.ms+=now()-s;} }
const apiNames = ["getResolvedSignature","getSymbolAtLocation","getAliasedSymbol","getTypeAtLocation","getTypeOfSymbolAtLocation"];
globalThis.__p12 = {
  measured,
  createProgram(ts, ...args) { const start=now(), p=ts.createProgram(...args), ms=now()-start; calls.push({file:active,roots:args[0].length,sourceFiles:p.getSourceFiles().length,createProgramMs:ms}); return p; },
  checker(program) { const c=measured("checkerAcquisition",()=>program.getTypeChecker()); for (const name of apiNames) { const fn=c[name]; if (typeof fn === "function") c[name]=function(...a) { return measured(`checker.${name}`,()=>fn.apply(c,a)); }; } return c; },
};
if (instrument) {
  const target = path.join(repo,"out/analyzer/analyze.js"), original = Module._extensions[".js"];
  Module._extensions[".js"] = function(mod, filename) {
    if (path.resolve(filename)!==path.resolve(target)) return original(mod,filename);
    let text=fs.readFileSync(filename,"utf8");
    function replace(old, replacement, expected) { const parts=text.split(old); if(parts.length-1!==expected) throw Error(`Instrumentation anchor mismatch: ${old} count=${parts.length-1}`); text=parts.join(replacement); }
    replace("const program = ts.createProgram(rootNames, options, host);", "const program = globalThis.__p12.createProgram(ts, rootNames, options, host);", 1);
    replace("const checker = program.getTypeChecker();", "const checker = globalThis.__p12.checker(program);", 2);
    replace("const calls = extractCallsResolved(sf, checker, resolveModuleLocation);", "const calls = globalThis.__p12.measured('extractCalls', () => extractCallsResolved(sf, checker, resolveModuleLocation));", 2);
    replace("const diagnostics = collectDiagnostics(program, sf);", "const diagnostics = globalThis.__p12.measured('diagnostics', () => collectDiagnostics(program, sf));", 2);
    replace("const { graph, trace } = buildActiveFileGraph(sf, checker, resolveModuleLocation, adapters);", "const { graph, trace } = globalThis.__p12.measured('graphExtraction', () => buildActiveFileGraph(sf, checker, resolveModuleLocation, adapters));", 2);
    mod._compile(text,filename);
  };
}
const analyzer = require(path.join(repo,"out/analyzer/index.js"));
const cpu0=process.cpuUsage(), start=now(), maxMs=Number(opts["max-ms"]||600000), minFree=Number(opts["min-free-mb"]||500), meta={ revision, project:path.basename(root), activeFile:rel(file), depth:Number(opts.depth), cache:opts.cache, instrumented:instrument, node:process.version, typescript:require("typescript/package.json").version, fileCount:listing.files.length, fileCountTotal:listing.all, capped:listing.capped };
const records=[]; let currentState=null;
function save(status, extra={}) { fs.writeFileSync(opts.out,JSON.stringify({meta,status,records,...extra},null,2)); }
function check() { if (os.freemem()/1048576 < minFree) throw Error(`ABORT_LOW_MEMORY:${Math.round(os.freemem()/1048576)}MB`); if(now()-start>maxMs) throw Error("ABORT_TIME_LIMIT"); }
function merge(prev,next) { const before={nodes:prev.nodes.length,edges:prev.edges.length}, s=now(); const ns=new Map(prev.nodes.map(n=>[String(n.id),n])); for(const n of next.nodes)ns.set(String(n.id),n); const es=new Map(prev.edges.map(e=>[String(e.id),e]));for(const e of next.edges)es.set(String(e.id),e);const graph={nodes:[...ns.values()],edges:[...es.values()]};return {graph,stats:{before,next:{nodes:next.nodes.length,edges:next.edges.length},after:{nodes:graph.nodes.length,edges:graph.edges.length},ms:now()-s}}; }
function frontier(graph,seen) { const found=new Set(); for(const n of graph.nodes) if(n.kind==="external" && !seen.has(norm(n.file)) && roots.has(norm(n.file)) && !norm(n.file).endsWith(".d.ts")) found.add(n.file);return [...found]; }
function run(label, enabled) {
  const t0=now(), localEvents={}, runCalls=[], merges=[], seen=new Set([norm(file)]); let programOffset=calls.length;
  currentState={ label, analyses:runCalls, merges, programs:[], cacheEvents:localEvents, frontierCount:null };
  const debug = (name) => { if(name.startsWith('analyzer.sourceFileCache.')) { const k=name.slice('analyzer.sourceFileCache.'.length);events[k]=(events[k]||0)+1;localEvents[k]=(localEvents[k]||0)+1; } };
  function analyze(f) { check(); active=rel(f); const code=fs.readFileSync(f,"utf8"), s=now(); const r=analyzer.analyzeWorkspaceActive({active:{code,fileName:f,languageId:f.endsWith('.tsx')?'typescriptreact':f.endsWith('.jsx')?'javascriptreact':f.endsWith('.js')?'javascript':'typescript'},workspaceRoot:root,filePaths:listing.files,cacheEnabled:enabled,debug}); runCalls.push({file:active,ms:now()-s,nodes:r.graph.nodes.length,edges:r.graph.edges.length,cache:analyzer.getAnalyzerCacheStats()}); currentState.programs=calls.slice(programOffset);sample(); save('running',{partial:currentState,elapsedMs:now()-start,freeMB:Math.round(os.freemem()/1048576)});return r; }
  let base=analyze(file), graph=base.graph; const f0=frontier(graph,seen), frontierCount=f0.length; currentState.frontierCount=frontierCount;
  if(meta.depth===0) {const ns=graph.nodes.filter(n=>norm(n.file)===norm(file)), ids=new Set(ns.map(n=>n.id)); graph={nodes:ns,edges:graph.edges.filter(e=>ids.has(e.source)&&ids.has(e.target))};}
  if(meta.depth===2) for(const target of f0) {check(); seen.add(norm(target));const r=analyze(target), m=merge(graph,r.graph);graph=m.graph;merges.push({file:rel(target),...m.stats});}
  const serializationStart=now(), serialized=JSON.stringify(graph), serializationMs=now()-serializationStart;
  const record={label,totalMs:now()-t0,frontierCount,expandedFileCount:runCalls.length-1,analyses:runCalls,programs:calls.slice(programOffset),cacheEvents:localEvents,merges,serializationMs,nodeCount:graph.nodes.length,edgeCount:graph.edges.length,graphHash:crypto.createHash('sha256').update(serialized).digest('hex'),freeMB:Math.round(os.freemem()/1048576),heapSampleMaxMB:heapSampleMax/1048576,peakRSSMB:process.resourceUsage().maxRSS/1024}; records.push(record);return record;
}
try {
  analyzer.clearAnalyzerCaches();
  if(opts.cache==='warm') run('warmup',true);
  const result=run('measured',opts.cache!=='off');
  const cpu=process.cpuUsage(cpu0);save('completed',{totals,cpuMs:{user:cpu.user/1000,system:cpu.system/1000},elapsedMs:now()-start});
  console.log(JSON.stringify({meta,status:'completed',totalMs:result.totalMs,frontier:result.frontierCount,expanded:result.expandedFileCount,programs:result.programs.length,nodes:result.nodeCount,edges:result.edgeCount,events:result.cacheEvents,programMs:result.programs.reduce((a,p)=>a+p.createProgramMs,0),peakRSSMB:result.peakRSSMB}));
} catch(e) { if(currentState)currentState.programs=calls.slice(-currentState.analyses.length); save('aborted',{error:e.message,partial:currentState,totals,elapsedMs:now()-start}); console.error(e.message);process.exitCode=1; }
