const fs=require('fs');const [file,sm,em]=process.argv.slice(2);
const j=JSON.parse(fs.readFileSync(file,'utf8'));const ev=Array.isArray(j)?j:j.traceEvents;
const mk=ev.filter(e=>String(e.name).startsWith('p8f:'));const pid=mk[0].pid;const t0=mk.find(e=>e.name===sm).ts;const t1=em.startsWith('+')?t0+Number(em.slice(1))*1000:mk.find(e=>e.name===em).ts;
const r=ev.filter(e=>e.pid===pid&&e.name==='PipelineReporter'&&e.ph==='b'&&e.ts>=t0&&e.ts<=t1&&!e.args?.frame_reporter?.frame_type).map(e=>e.args.frame_reporter);
const c=(k)=>r.filter(x=>x[k]).length;
const raster=ev.filter(e=>e.pid===pid&&e.name==='RasterTask'&&e.ts>=t0&&e.ts<=t1);
console.log(JSON.stringify({file:file.split(/[\/]/).slice(-3)[0]+'/'+file.split(/[\/]/).pop(),window:[sm,em],frames:r.length,checkerboardedNeedsRaster:c('checkerboarded_needs_raster'),checkerboardedNeedsRecord:c('checkerboarded_needs_record'),hasMissingContent:c('has_missing_content'),highLatency:c('has_high_latency'),dropped:r.filter(x=>/DROPPED/.test(x.state)).length,rendererRasterTasks:raster.length,rendererRasterMs:+(raster.reduce((s,e)=>s+(e.dur||0),0)/1000).toFixed(1)}));
