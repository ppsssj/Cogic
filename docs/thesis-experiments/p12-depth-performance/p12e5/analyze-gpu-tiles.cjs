// Post-hoc: cc tile count (graph renderer) and GPU client memory (GPUTask used_bytes) during the marked pan, for saved traces.
// usage: node analyze-gpu-tiles.cjs <out.json> <trace.json[.gz]>...
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');const [out,...files]=process.argv.slice(2);const rows=[];
const med=a=>{const s=[...a].sort((x,y)=>x-y);return s.length?s[Math.floor((s.length-1)/2)]:null};
for(const f of files){let b=fs.readFileSync(f);if(f.endsWith('.gz'))b=zlib.gunzipSync(b);const ev=JSON.parse(b).traceEvents;const s=ev.find(e=>e.name==='e5e-pan-start'),t=ev.find(e=>e.name==='e5e-pan-end');const W=ev.filter(e=>e.ts>=s.ts&&e.ts<t.ts);
 const tc=W.filter(e=>e.pid===s.pid&&e.name==='TileManager::PrepareTiles'||e.pid===s.pid&&e.args?.state?.tile_count!=null).map(e=>e.args?.state?.tile_count).filter(v=>v!=null);
 const ub=W.filter(e=>e.name==='GPUTask'&&e.args?.data?.used_bytes!=null);const per={};for(const e of ub){const k=e.args.data.renderer_pid??'?';(per[k]??=[]).push(e.args.data.used_bytes/1048576)}
 const P=W.filter(e=>e.name==='DXGISwapChainImageBacking::Present');
 rows.push({trace:path.basename(path.dirname(f))+'/'+path.basename(f),panMs:Math.round((t.ts-s.ts)/1000),presentWallMs:Math.round(P.reduce((x,e)=>x+e.dur,0)/1000),presentOver50:P.filter(e=>e.dur>50000).length,tileCountMedian:med(tc),tileCountMax:tc.length?Math.max(...tc):null,gpuMiBGraphRenderer:per[s.pid]?{median:Math.round(med(per[s.pid])),max:Math.round(Math.max(...per[s.pid]))}:null,gpuMiBMaxAnyClient:ub.length?Math.round(Math.max(...Object.values(per).flat())):null});}
fs.writeFileSync(path.join(__dirname,out),JSON.stringify(rows,null,1)+'\n');for(const r of rows)console.log(r.trace,r.panMs,'present',r.presentWallMs,r.presentOver50,'tiles',r.tileCountMedian,r.tileCountMax,'gpu',JSON.stringify(r.gpuMiBGraphRenderer),r.gpuMiBMaxAnyClient);
