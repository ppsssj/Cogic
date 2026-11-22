// JS/style/layout/paint time and DOM-churn indicators on the webview main thread within a marks window.
const fs=require('fs');const [file,sm,em]=process.argv.slice(2);
const j=JSON.parse(fs.readFileSync(file,'utf8'));const ev=Array.isArray(j)?j:j.traceEvents;
const mk=ev.filter(e=>String(e.name).startsWith('p8f:'));const pid=mk[0].pid;const t0=mk.find(e=>e.name===sm).ts;const t1=em.startsWith('+')?t0+Number(em.slice(1))*1000:mk.find(e=>e.name===em).ts;
const tn={};for(const e of ev)if(e.ph==='M'&&e.name==='thread_name')tn[e.pid+':'+e.tid]=e.args.name;
const tid=Number(Object.entries(tn).find(([k,v])=>k.startsWith(pid+':')&&v==='CrRendererMain')[0].split(':')[1]);
const M=ev.filter(e=>e.pid===pid&&e.tid===tid&&e.ph==='X'&&e.ts>=t0&&e.ts<=t1);
const u=(re)=>{const iv=M.filter(e=>re.test(e.name)).map(e=>[e.ts,e.ts+(e.dur||0)]).sort((a,b)=>a[0]-b[0]);let tot=0,cs=-1,ce=-1;for(const[a,b]of iv){if(a>ce){if(ce>cs)tot+=ce-cs;cs=a;ce=b}else ce=Math.max(ce,b)}if(ce>cs)tot+=ce-cs;return +(tot/1000).toFixed(1)};
const frames=M.filter(e=>e.name==='ProxyMain::BeginMainFrame').length;
const layouts=M.filter(e=>e.name==='Layout');const paints=M.filter(e=>e.name==='Paint');
console.log(JSON.stringify({file:file.split(/[\/]/).slice(-3)[0],windowMs:+((t1-t0)/1000).toFixed(0),mainFrames:frames,jsMs:u(/^(FunctionCall|EventDispatch|TimerFire|FireAnimationFrame|RunMicrotasks)$/),styleMs:u(/^(UpdateLayoutTree)$/),layoutMs:u(/^Layout$/),layoutCount:layouts.length,dirtyObjects:layouts.reduce((s,e)=>s+(e.args?.beginData?.dirtyObjects||0),0),paintMs:u(/^Paint$/),paintCount:paints.filter(p=>/react-flow__(nodes|edges)/.test(p.args?.data?.nodeName||'')).length,prePaintMs:u(/^PrePaint$/),layerizeCommitMs:u(/^(Layerize|Commit)$/)}));
