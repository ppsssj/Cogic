const fs=require('fs');const f=process.argv[2];
let j=JSON.parse(fs.readFileSync(f,'utf8'));const ev=Array.isArray(j)?j:j.traceEvents;
const pname={},tname={};for(const e of ev){if(e.ph==='M'&&e.name==='process_name')pname[e.pid]=e.args.name;if(e.ph==='M'&&e.name==='thread_name')tname[e.pid+':'+e.tid]=e.args.name;}
const marks=ev.filter(e=>String(e.name).startsWith('p8:'));
console.log('marks',marks.map(m=>[m.name,m.ph,m.pid,m.tid,m.ts,JSON.stringify(m.args).slice(0,150)]));
const want=/^(Paint|PaintImage|Layout|UpdateLayerTree|PrePaint|Layerize|Commit|BeginMainFrame|BeginFrame|DrawFrame|ActivateLayerTree|PipelineReporter|Graphics\.Pipeline|Display::DrawAndSwap|SwapBuffers|Swap|Presentation|SubmitCompositorFrame|ReceiveCompositorFrame|SurfaceAggregation|DisplayScheduler::DrawAndSwap|ProxyMain::BeginMainFrame|ScheduledActionDraw|Scheduler::BeginImplFrame|CompositorFrameSinkSupport::SubmitCompositorFrame|Viz::DisplayFrame|FrameStartTime|RasterTask|AnimationFrame|FireAnimationFrame)/;
const cnt={};for(const e of ev){if(!want.test(e.name))continue;const k=(pname[e.pid]||e.pid)+' | '+(tname[e.pid+':'+e.tid]||e.tid)+' | '+e.name+' | '+e.ph;cnt[k]=(cnt[k]||0)+1;}
for(const [k,v] of Object.entries(cnt).sort())console.log(v,k);
console.log('processes',JSON.stringify(pname));
