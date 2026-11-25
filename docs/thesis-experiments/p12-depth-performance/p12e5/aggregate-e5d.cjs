// Aggregate E5D Single and Multiple series. Lists are fixed here; every attempt is reported, gates decide validity.
// multiple-125 r6 is a declared supplement pair: OFF r3 failed in the harness (no hit-testable target) and stays invalid.
// "attach/detach" counts .react-flow__node DOM additions/removals during pan; they are not React mount/unmount.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const D=d=>path.join(__dirname,d),read=f=>JSON.parse(fs.readFileSync(f,'utf8').replace(/^﻿/,''));
const gate=(s,a,b,f)=>{const r=cp.spawnSync(process.execPath,[D(s),path.join(D(a),f),path.join(D(b),f)],{encoding:'utf8'});try{const j=JSON.parse(r.stdout);return{match:r.status===0,errors:j.errors??j.differences}}catch{return{match:false,errors:[r.stderr.slice(0,200)]}}};
const seq=(n,k=5)=>Array.from({length:k},(_,i)=>i+1).map(n);
const series={
 'single-125':{reference:'e5d-single-on-pilot-6',on:['e5d-single-on-pilot-6',...[2,3,4,5].map(n=>'e5d-single-on-r'+n)],off:['e5d-single-off-pilot-2',...[2,3,4,5].map(n=>'e5d-single-off-r'+n)]},
 'multiple-125':{reference:'e5d-multiple-off-p125-r1',on:seq(n=>'e5d-multiple-on-p125-r'+n,6),off:seq(n=>'e5d-multiple-off-p125-r'+n,6)},
 'multiple-500':{reference:'e5d-multiple-off-p500-r1',on:seq(n=>'e5d-multiple-on-p500-r'+n),off:seq(n=>'e5d-multiple-off-p500-r'+n)}};
const names=['pan','zoom','selection','file-collapse','file-expand','folder-collapse','folder-expand','fit'];
const pct=(a,p)=>a.length?a[Math.floor((a.length-1)*p)]:null;
function run(dir,ref){
 const x=read(path.join(D(dir),'interaction.json')),m=read(path.join(D(dir),'manifest.json')),mem=read(path.join(D(dir),'memory-summary.json'));
 const ws=fs.readFileSync(path.join(D(dir),'process-memory.jsonl'),'utf8').replace(/^﻿/,'').split(/\r?\n/).filter(Boolean).flatMap(s=>{try{return[JSON.parse(s).processes]}catch{return[]}});
 const total=ws.map(p=>p.reduce((s,v)=>s+v.workingSetBytes,0)/1048576),rend=ws.map(p=>p.filter(v=>v.role==='renderer').reduce((s,v)=>s+v.workingSetBytes,0)/1048576);
 const phases={};for(const n of names){const p=x.phases.find(v=>v.phase===n);if(!p?.valid){phases[n]={valid:false,error:p?.error?.slice(0,160)};continue}
  const raw=p.frames.slice(1).map((v,i)=>v-p.frames[i]),a=[...raw].sort((q,r)=>q-r),span=p.frames.at(-1)-p.frames[0],gaps=raw.filter(v=>v>50);
  phases[n]={valid:true,p50:pct(a,.5),p95:pct(a,.95),p99:pct(a,.99),max:a.at(-1)??null,callbacksPerSec:span?raw.length/span*1000:null,gapsOver50:gaps.length,gapTimeOver50Ms:gaps.reduce((s,v)=>s+v,0),longTasks:p.longtasks.length,longTaskMs:p.longtasks.reduce((s,v)=>s+v.duration,0),longTaskMax:Math.max(0,...p.longtasks.map(v=>v.duration)),domNodes:p.domNodes,domEdges:p.domEdges,phaseMs:p.end-p.start,clickToStable:p.stability?.durationMs??null};
  if(n==='pan')Object.assign(phases[n],{attach:p.mounts,detach:p.unmounts,pointer:p.pointer.length,inputMs:p.viewportSamples[7].elapsed,stepMs:p.panStepMs??125});if(n==='selection')Object.assign(phases[n],{selectMs:p.selection.deltaMs,target:p.target.id});}
 const mg=gate('compare-manifests.cjs',ref,dir,'manifest.json'),sg=gate('compare-e5d.cjs',ref,dir,'interaction.json');
 return {dir,functional:x.valid,functionalErrors:x.errors,matched:mg.match&&sg.match&&x.valid&&!mem.aborted,manifest:mg.match,state:sg,graphSha:m.graph.sha256,flow:[x.e5c.before.flowNodes,x.e5c.before.flowEdges],dom:[x.e5c.before.domNodes,x.e5c.before.domEdges],startViewport:x.e5c.before.viewport,fit:[x.e5c.fitBefore.classification,x.e5c.fitAfter?.classification],restored:x.valid,memory:{before:mem.before,minimum:mem.minimum,aborted:mem.aborted,peakTreeWsMiB:Math.max(0,...total),peakRendererWsMiB:Math.max(0,...rend)},phases};
}
const med=a=>{const s=a.filter(v=>v!=null).sort((x,y)=>x-y);const k=s.length;return k?{n:k,median:k%2?s[(k-1)/2]:(s[k/2-1]+s[k/2])/2,min:s[0],max:s[k-1]}:null};
const out={method:'rAF callback intervals (floor-rank percentiles). Not display FPS, INP or paint. Gap = rAF interval > 50 ms. functional = harness phases and restoration valid; matched = also manifest/state/pan-speed gate.',series:{}};
for(const [k,s] of Object.entries(series)){const o=out.series[k]={reference:s.reference,runs:{},summary:{}};for(const arm of ['on','off']){const r=s[arm].map(d=>run(d,s.reference));o.runs[arm]=r;const g=o.summary[arm]={attempts:r.length,functional:r.filter(v=>v.functional).length,matched:r.filter(v=>v.matched).length,minimumMiB:med(r.map(v=>v.memory.minimum)),peakTreeWsMiB:med(r.map(v=>v.memory.peakTreeWsMiB)),peakRendererWsMiB:med(r.map(v=>v.memory.peakRendererWsMiB)),phases:{}};
 for(const n of names){const ps=r.filter(v=>v.functional).map(v=>v.phases[n]);g.phases[n]={};for(const key of Object.keys(ps[0]).filter(q=>typeof ps[0][q]==='number'))g.phases[n][key]=med(ps.map(v=>v[key]))}
 g.nonPanLongTaskRuns=Object.fromEntries(names.map(n=>[n,r.filter(v=>v.functional&&v.phases[n].longTasks>0).length]));}}
fs.writeFileSync(D('e5d-aggregate.json'),JSON.stringify(out,null,1)+'\n');
const f=(v,d=1)=>v?`${v.median.toFixed(d)} [${v.min.toFixed(d)}..${v.max.toFixed(d)}]`:'-';
for(const [k,o] of Object.entries(out.series)){console.log('##',k);for(const arm of ['on','off']){const g=o.summary[arm],p=g.phases;console.log(arm,'attempt',g.attempts,'func',g.functional,'matched',g.matched,'minMiB',f(g.minimumMiB,0),'treeWS',f(g.peakTreeWsMiB,0),'rendWS',f(g.peakRendererWsMiB,0),'LTruns',JSON.stringify(g.nonPanLongTaskRuns));
 for(const q of ['p50','p95','p99','max','callbacksPerSec','gapsOver50','gapTimeOver50Ms','inputMs','pointer','attach','detach','domNodes','domEdges'])console.log('  pan',q,f(p.pan[q]));console.log('  select',f(p.selection.selectMs));
 for(const n of names.slice(1))console.log('  ',n,'LT',f(p[n].longTasks,0),'ms',f(p[n].longTaskMs,0),'p99',f(p[n].p99),'max',f(p[n].max),'gaps',f(p[n].gapsOver50,0),'gapms',f(p[n].gapTimeOver50Ms,0),'cb/s',f(p[n].callbacksPerSec,0));}
 const all=[...o.runs.on,...o.runs.off];console.log('sha',[...new Set(all.map(r=>r.graphSha))].length,'flow',JSON.stringify([...new Set(all.map(r=>r.flow.join('/')))]),'vp',[...new Set(all.map(r=>JSON.stringify(r.startViewport)))].length,'fit',JSON.stringify([...new Set(all.map(r=>r.fit.join('/')))]),'sel',JSON.stringify([...new Set(all.map(r=>r.phases.selection.target))]),'dom on',o.runs.on[0].dom,'off',o.runs.off[0].dom)}
