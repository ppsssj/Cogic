// Analyze one E5H pan (derived from analyze-e5e-trace.cjs, which is kept unchanged). usage: node analyze-e5h-pan.cjs <run-dir> <pan label>; writes analysis-<label>.json
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');const dir=process.argv[2];
const label=process.argv[3],tf=path.join(dir,'trace-'+label+'.json');const raw=fs.existsSync(tf)?fs.readFileSync(tf):zlib.gunzipSync(fs.readFileSync(tf+'.gz'));
const ev=JSON.parse(raw).traceEvents,run=JSON.parse(fs.readFileSync(path.join(dir,'interaction.json'))),T=run.e5h.pans.find(p=>p.label===label);
const r1=v=>v==null?null:Math.round(v*10)/10,q=(a,p)=>[...a].sort((x,y)=>x-y)[Math.floor((a.length-1)*p)];
const pn={},tn={};for(const e of ev)if(e.ph==='M'){if(e.name==='process_name')pn[e.pid]=e.args.name;if(e.name==='thread_name')tn[e.pid+'/'+e.tid]=e.args.name}
const mark=n=>ev.find(e=>e.name===n&&/user_timing/.test(e.cat));const s=mark('e5e-pan-start'),f=mark('e5e-pan-end');if(!s||!f)throw Error('pan marks missing');
// Clock alignment: webview performance.now -> trace us (marks); node -> webview (min RTT exchange).
const off=[...T.anchorsPre.list,...T.anchorsPost.list].map(a=>{const m=mark(a.mark);return m?m.ts-a.w*1000:null}).filter(v=>v!=null);const w2t=q(off,.5),web=ms=>ms*1000+w2t;
const nodeOff=(T.anchorsPre.offsetWebMinusNode+T.anchorsPost.offsetWebMinusNode)/2,node=ms=>web(ms+nodeOff);
const clock={marks:off.length,webToTraceSpreadMs:r1((Math.max(...off)-Math.min(...off))/1000),nodeUncertaintyMs:r1(Math.max(T.anchorsPre.uncertaintyMs,T.anchorsPost.uncertaintyMs)),nodeDriftMs:r1(T.anchorsPost.offsetWebMinusNode-T.anchorsPre.offsetWebMinusNode)};
const A=s.ts,B=f.ts;
function thread(pid,tid){const X=[],st=[];for(const e of ev){if(e.pid!==pid||e.tid!==tid||e.ts==null)continue;if(e.ph==='X')X.push({...e});else if(e.ph==='B')st.push(e);else if(e.ph==='E'){const b=st.pop();if(b)X.push({...b,dur:e.ts-b.ts,tdur:e.tts!=null&&b.tts!=null?e.tts-b.tts:0})}}
 X.sort((a,b)=>a.ts-b.ts||b.dur-a.dur);const k=[];for(const e of X){e.kids=0;e.kc=0;while(k.length&&k.at(-1).ts+k.at(-1).dur<=e.ts)k.pop();const p=k.at(-1);if(p){p.kids+=e.dur;p.kc+=e.tdur||0}k.push(e)}return X.filter(e=>e.ts+e.dur>A&&e.ts<B)}
const find=(pid,name)=>{const k=Object.keys(tn).find(k=>k.startsWith(pid+'/')&&tn[k]===name);return k?thread(pid,+k.split('/')[1]):[]};
const gpuPid=+Object.keys(pn).find(p=>pn[p]==='GPU Process'),main=thread(s.pid,s.tid),comp=find(s.pid,'Compositor'),gpu=find(gpuPid,'CrGpuMain'),viz=find(gpuPid,'VizCompositorThread');
const union=(L,a,b)=>{let t=0,e=a;for(const [x,y] of L.filter(v=>v[1]>a&&v[0]<b).sort((p,r)=>p[0]-r[0])){const u=Math.max(x,e),v=Math.min(y,b);if(v>u){t+=v-u;e=v}}return t/1000};
const iv=(X,f)=>X.filter(f).map(e=>[e.ts,e.ts+e.dur]);const task=e=>e.name==='RunTask';
const kinds={script:/^(FunctionCall|EvaluateScript|EventDispatch|FireAnimationFrame|TimerFire|RunMicrotasks|v8\.|V8\.)/,styleLayout:/^(UpdateLayoutTree|Layout|RecalculateStyles|Document::updateStyle|LocalFrameView::performLayout|StyleEngine)/,paint:/^(PrePaint|Paint|Layerize|Commit|UpdateLayer|PaintArtifactCompositor)/,gc:/GC/};
const pickNames=['EventDispatch','FunctionCall','FireAnimationFrame','TimerFire','RunMicrotasks','UpdateLayoutTree','Layout','PrePaint','Paint','Layerize','Commit','ParseHTML','MinorGC','MajorGC'];
const presents=gpu.filter(e=>e.name==='DXGISwapChainImageBacking::Present'),rasters=gpu.filter(e=>e.name==='RasterDecoderImpl::DoRasterCHROMIUM');
const L={main:iv(main,task),compositor:iv(comp,task),gpuTask:iv(gpu,task),viz:iv(viz,task),present:presents.map(e=>[e.ts,e.ts+e.dur]),...Object.fromEntries(Object.entries(kinds).map(([k,x])=>[k,iv(main,e=>x.test(e.name))]))};
const workers=[];for(const k of Object.keys(tn))if(k.startsWith(s.pid+'/')&&/ThreadPoolForegroundWorker|CompositorTileWorker/.test(tn[k]))workers.push(...iv(thread(s.pid,+k.split('/')[1]),e=>/RunTask/.test(e.name)));L.rasterWorkers=workers;
const call=T.steps.map(v=>[node(v.callStart),node(v.callEnd)]);
const raf=T.web.raf,gaps=raf.slice(1).map((v,i)=>({a:web(raf[i].now),b:web(v.now),t:v.t-raf[i].t})).filter(g=>g.b-g.a>50000);
const gapRows=gaps.map(g=>{const o={startMs:r1((g.a-A)/1000),ms:r1((g.b-g.a)/1000)};for(const k of ['main','script','styleLayout','paint','gc','compositor','rasterWorkers','viz','gpuTask','present'])o[k]=r1(union(L[k],g.a,g.b));o.presentCpu=r1(presents.filter(e=>e.ts<g.b&&e.ts+e.dur>g.a).reduce((x,e)=>x+(e.tdur||0),0)/1000);o.inputCallInFlight=r1(union(call,g.a,g.b));
 o.gpuRasters=rasters.filter(e=>e.ts>=g.a-20000&&e.ts<g.b).length;o.attachDetach=T.web.dom.filter(d=>web(d.now)>=g.a-20000&&web(d.now)<g.b).reduce((x,d)=>x+d.an+d.rn,0);o.presentShare=r1(o.present/o.ms*100);return o});
const sum=k=>r1(gapRows.reduce((x,g)=>x+g[k],0));
// Each Present against the raster work issued since the previous Present.
const pr=presents.filter(e=>e.ts>=A).map((e,i,a)=>{const from=i?a[i-1].ts+a[i-1].dur:A;return{startMs:r1((e.ts-A)/1000),ms:r1(e.dur/1000),cpuMs:r1((e.tdur||0)/1000),rasters:rasters.filter(v=>v.ts>=from&&v.ts<e.ts).length,attachDetach:T.web.dom.filter(d=>web(d.now)>=from-30000&&web(d.now)<e.ts).reduce((x,d)=>x+d.an+d.rn,0),dirty:e.args?.dirty_rect}});
const rank=a=>{const s=a.map((v,i)=>[v,i]).sort((x,y)=>x[0]-y[0]);const o=[];for(let i=0;i<s.length;){let j=i;while(j<s.length&&s[j][0]===s[i][0])j++;for(let k=i;k<j;k++)o[s[k][1]]=(i+j-1)/2;i=j}return o};
const corr=(x,y)=>{const a=rank(x),b=rank(y),ma=a.reduce((p,c)=>p+c,0)/a.length,mb=b.reduce((p,c)=>p+c,0)/b.length;let n=0,u=0,w=0;a.forEach((v,i)=>{n+=(v-ma)*(b[i]-mb);u+=(v-ma)**2;w+=(b[i]-mb)**2});return u&&w?Math.round(n/Math.sqrt(u*w)*100)/100:null};
// Input chain per step. Events are matched in send order by expected CSS x (moves left of the iframe never arrive).
const pm=T.web.ev.filter(e=>e.type==='pointermove');let idx=0;const boxShift=pm.length?pm[0].x-T.steps[0].px:0;
const steps=T.steps.map(v=>{const m=idx<pm.length&&Math.abs(pm[idx].x-(v.px+boxShift))<2?pm[idx++]:null;const st=m?T.web.style.find(z=>z.now>=m.now-0.2):null;const rf=m?raf.find(z=>z.now>=m.now):null;const n=ms=>r1((ms-T.start));const wn=ms=>r1(ms-nodeOff-T.start);
 return{i:v.i,scheduled:n(v.scheduled),callStart:n(v.callStart),callEnd:n(v.callEnd),eventTimeStamp:m?wn(m.ts):null,handlerAt:m?wn(m.now):null,styleAt:st?wn(st.now):null,nextRafAt:rf?wn(rf.now):null,delivered:!!m}});
const del=steps.filter(v=>v.delivered),lat=(a,b)=>{const d=del.filter(v=>v[a]!=null&&v[b]!=null).map(v=>v[b]-v[a]);return{n:d.length,median:r1(q(d,.5)),p95:r1(q(d,.95)),max:r1(Math.max(...d))}};
const totals={};for(const n of pickNames){const x=main.filter(e=>e.name===n&&e.ts>=A);if(x.length)totals[n]={n:x.length,ms:r1(x.reduce((p,e)=>p+e.dur,0)/1000),max:r1(Math.max(...x.map(e=>e.dur))/1000)}}
const thr={};for(const [k,X] of Object.entries({rendererMain:main,rendererCompositor:comp,gpuMain:gpu,vizCompositor:viz})){const x=X.filter(task);thr[k]={tasks:x.length,wallMs:r1(x.reduce((p,e)=>p+e.dur,0)/1000),cpuMs:r1(x.reduce((p,e)=>p+(e.tdur||0),0)/1000),maxMs:r1(Math.max(...x.map(e=>e.dur))/1000)}}
const grp=(X,f)=>{const o={};for(const e of X){const k=f(e);const g=o[k]??={n:0,wallMs:0,cpuMs:0,maxMs:0};g.n++;g.wallMs+=e.dur/1000;g.cpuMs+=(e.tdur||0)/1000;g.maxMs=Math.max(g.maxMs,e.dur/1000)}for(const g of Object.values(o))for(const k of ['wallMs','cpuMs','maxMs'])g[k]=r1(g[k]);return o};
const pan=t=>{const w=t.web.raf,g=w.slice(1).map((v,i)=>v.t-w[i].t);return{inputLoopMs:r1(t.end-t.start),callSumMs:r1(t.steps.reduce((x,v)=>x+v.callEnd-v.callStart,0)),callMaxMs:r1(Math.max(...t.steps.map(v=>v.callEnd-v.callStart))),gaps:g.filter(v=>v>50).length,gapMs:r1(g.filter(v=>v>50).reduce((x,v)=>x+v,0)),p99:r1(q(g,.99)),max:r1(Math.max(...g)),systemBusy:r1(t.cpu.busyFraction*100)}};
const out={dir:path.basename(dir),variant:run.variant,panMs:r1((B-A)/1000),clock,traced:{processes:Object.entries(pn).map(([p,n])=>({pid:+p,name:n,threads:Object.keys(tn).filter(k=>k.startsWith(p+'/')).map(k=>tn[k])})),graphWebview:{pid:s.pid,thread:tn[s.pid+'/'+s.tid]},bufferUsage:T.bufferUsage.percentage,events:ev.length,bytes:raw.length},
 cond:T.cond,index:T.index,checks:{...T.checks,startDomNodes:undefined},free:T.free,raf:(({inputLoopMs,callSumMs,callMaxMs,gaps,gapMs,p99,max,systemBusy})=>({inputLoopMs,callSumMs,callMaxMs,gaps,gapMs,p99,max,systemBusy}))(pan(T)),latenessEndMs:r1(T.steps.at(-1).callStart-T.steps.at(-1).scheduled),threads:thr,rendererMainEvents:totals,
 gpuEvents:grp(gpu.filter(e=>e.ts>=A&&/DXGISwapChainImageBacking::Present|DoRasterCHROMIUM$|DoEndRasterCHROMIUM$|FinishPaintRenderPass|SwapBuffers$/.test(e.name)),e=>e.name),
 rasterTasks:ev.filter(e=>e.ph==='X'&&e.pid===s.pid&&e.ts>=A&&e.ts<B&&e.name==='RasterTask').length,
 paintByNodeMs:main.filter(e=>e.ts>=A&&e.name==='Paint').reduce((o,e)=>{const k=String(e.args?.data?.nodeName??'?').slice(0,70);o[k]=r1((o[k]??0)+e.dur/1000);return o},{}),
 domSteps:T.web.dom.map(d=>[d.an,d.rn,d.ae,d.re]),
 viewports:T.web.style.map(v=>v.style),
 rasterTasksByLayer:ev.filter(e=>e.ph==='X'&&e.pid===s.pid&&e.ts>=A&&e.ts<B&&e.name==='RasterTask').reduce((o,e)=>{const k=e.args?.tileData?.layerId??'?';o[k]=(o[k]??0)+1;return o},{}),
 paintByNode:main.filter(e=>e.ts>=A&&e.name==='Paint').reduce((o,e)=>{const k=String(e.args?.data?.nodeName??'?').slice(0,70);o[k]=(o[k]??0)+1;return o},{}),
 gaps:{count:gapRows.length,totalMs:sum('ms'),overlap:Object.fromEntries(['main','script','styleLayout','paint','gc','compositor','rasterWorkers','viz','gpuTask','present','presentCpu','inputCallInFlight'].map(k=>[k,sum(k)])),rows:gapRows},
 presents:{count:pr.length,wallMs:r1(pr.reduce((x,v)=>x+v.ms,0)),cpuMs:r1(pr.reduce((x,v)=>x+v.cpuMs,0)),over50:pr.filter(v=>v.ms>50).length,spearmanWithRasters:corr(pr.map(v=>v.ms),pr.map(v=>v.rasters)),spearmanWithAttachDetach:corr(pr.map(v=>v.ms),pr.map(v=>v.attachDetach)),rows:run.variant.endsWith('on')?pr:undefined},
 input:{steps,delivered:del.length,coalescedMax:Math.max(...pm.map(e=>e.coalesced??0)),latency:{callStart_to_eventTimeStamp:lat('callStart','eventTimeStamp'),eventTimeStamp_to_handler:lat('eventTimeStamp','handlerAt'),handler_to_style:lat('handlerAt','styleAt'),handler_to_nextRaf:lat('handlerAt','nextRafAt'),handler_to_callEnd:lat('handlerAt','callEnd'),scheduled_to_callStart:lat('scheduled','callStart')},dom:T.web.dom.reduce((a,d)=>({batches:a.batches+1,nodeAttach:a.nodeAttach+d.an,nodeDetach:a.nodeDetach+d.rn,edgeAttach:a.edgeAttach+d.ae,edgeDetach:a.edgeDetach+d.re}),{batches:0,nodeAttach:0,nodeDetach:0,edgeAttach:0,edgeDetach:0})}};
fs.writeFileSync(path.join(dir,'analysis-'+label+'.json'),JSON.stringify(out,null,1)+'\n');
