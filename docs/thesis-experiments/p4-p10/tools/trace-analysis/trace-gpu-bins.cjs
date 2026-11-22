const fs=require('fs');const [file,sm,em,bin]=process.argv.slice(2);const B=Number(bin||100)*1000;
const j=JSON.parse(fs.readFileSync(file,'utf8'));const ev=Array.isArray(j)?j:j.traceEvents;
const mk=ev.filter(e=>String(e.name).startsWith('p8f:'));const wpid=mk[0].pid;const t0=mk.find(e=>e.name===sm).ts;const t1=mk.find(e=>e.name===em).ts;
const pn={},tn={};for(const e of ev){if(e.ph==='M'&&e.name==='process_name')pn[e.pid]=e.args.name;if(e.ph==='M'&&e.name==='thread_name')tn[e.pid+':'+e.tid]=e.args.name;}
const gpu=Number(Object.keys(pn).find(p=>pn[p]==='GPU Process'));const gtid=Number(Object.entries(tn).find(([k,v])=>k.startsWith(gpu+':')&&v==='CrGpuMain')[0].split(':')[1]);
const wtid=Number(Object.entries(tn).find(([k,v])=>k.startsWith(wpid+':')&&v==='CrRendererMain')[0].split(':')[1]);
const n=Math.ceil((t1-t0)/B);const g=new Array(n).fill(0),w=new Array(n).fill(0);
const add=(arr,s,e)=>{for(let i=Math.max(0,Math.floor((s-t0)/B));i<n&&t0+i*B<e;i++){const a=Math.max(s,t0+i*B),b=Math.min(e,t0+(i+1)*B);if(b>a)arr[i]+=b-a;}};
for(const e of ev){if(e.ph!=='X'||e.ts>t1||e.ts+(e.dur||0)<t0)continue;if(e.pid===gpu&&e.tid===gtid&&e.name==='GPUTask')add(g,e.ts,e.ts+e.dur);if(e.pid===wpid&&e.tid===wtid&&/^(ThreadControllerImpl::RunTask)$/.test(e.name))add(w,e.ts,e.ts+e.dur);}
const clicks=ev.filter(e=>e.pid===wpid&&e.name==='EventDispatch'&&e.args?.data?.type==='click'&&e.ts>=t0&&e.ts<=t1).map(e=>((e.ts-t0)/1000).toFixed(0));
console.log('clicks at ms',clicks.join(','));console.log('bin(ms) gpuTaskBusy% webviewMainBusy%');
for(let i=0;i<n;i++)console.log(String(i*B/1000).padStart(5),String((100*g[i]/B).toFixed(0)).padStart(4),String((100*w[i]/B).toFixed(0)).padStart(4));
