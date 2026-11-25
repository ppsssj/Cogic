// Summarize only fully valid E5B runs with passing manifest comparison.
const fs=require('node:fs'),path=require('node:path');
const dirs=process.argv.slice(2);if(!dirs.length)throw Error('usage: node summarize-e5b.cjs <run-dir>...');
const phases=['pan','zoom','selection','file-collapse','file-expand','folder-collapse','folder-expand','fit'];
const read=f=>JSON.parse(fs.readFileSync(f,'utf8').replace(/^\uFEFF/,''));
function pct(a,p){return a[Math.floor((a.length-1)*p)];}
const results=dirs.map(dir=>{try{const x=read(path.join(dir,'interaction.json')),m=read(path.join(dir,'manifest.json')),c=read(path.join(dir,'manifest-comparison.json')),memory=read(path.join(dir,'memory-summary.json'));if(!x.valid||memory.aborted||!c.match)throw Error('phase/guard/manifest failure');
 const rows=phases.map(name=>{const p=x.phases.find(v=>v.phase===name);if(!p?.valid)throw Error('invalid '+name);const ints=(p.frames??[]).slice(1).map((v,i)=>v-p.frames[i]).sort((a,b)=>a-b);return {phase:name,frames:ints.length,p50:ints.length?pct(ints,.5):null,p95:ints.length?pct(ints,.95):null,p99:ints.length?pct(ints,.99):null,domNodes:p.domNodes,domEdges:p.domEdges,longtasks:p.longtasks?.length,selectionMs:p.selection?.deltaMs??null};});return {dir,valid:true,mode:m.mode,graph:m.graph.sha256,requestId:m.requestId,minimumMiB:memory.minimum,phases:rows};}catch(e){return {dir,valid:false,error:String(e)}}});
console.log(JSON.stringify({method:'rAF intervals during each interaction window; include scheduling and 250+150 ms waits; not physical presentation or settled latency',results},null,2));if(results.some(x=>!x.valid))process.exitCode=1;
