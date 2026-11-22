// Busy time (union of top-level X events) per thread for webview renderer + GPU process + browser, within marks window.
const fs=require('fs');const [file,sm,em]=process.argv.slice(2);
const j=JSON.parse(fs.readFileSync(file,'utf8'));const ev=Array.isArray(j)?j:j.traceEvents;
const mk=ev.filter(e=>String(e.name).startsWith('p8f:'));const wpid=mk[0].pid;const t0=mk.find(e=>e.name===sm).ts;const t1=em.startsWith('+')?t0+Number(em.slice(1))*1000:mk.find(e=>e.name===em).ts;
const pn={},tn={};for(const e of ev){if(e.ph==='M'&&e.name==='process_name')pn[e.pid]=e.args.name;if(e.ph==='M'&&e.name==='thread_name')tn[e.pid+':'+e.tid]=e.args.name;}
const by={};for(const e of ev){if(e.ph!=='X'||e.ts<t0||e.ts>t1)continue;const p=pn[e.pid];if(!(e.pid===wpid||p==='GPU Process'||p==='Browser'))continue;const k=(e.pid===wpid?'webview':p)+' | '+(tn[e.pid+':'+e.tid]||e.tid);(by[k]=by[k]||[]).push([e.ts,e.ts+(e.dur||0),e.name,e.dur||0]);}
const out=[];for(const [k,iv] of Object.entries(by)){iv.sort((a,b)=>a[0]-b[0]);let tot=0,cs=-1,ce=-1;for(const [a,b] of iv){if(a>ce){if(ce>cs)tot+=ce-cs;cs=a;ce=b;}else ce=Math.max(ce,b);}if(ce>cs)tot+=ce-cs;
 const names={};for(const x of iv)names[x[2]]=(names[x[2]]||0)+x[3];const topn=Object.entries(names).sort((a,b)=>b[1]-a[1]).slice(0,4).map(([n,d])=>n+':'+(d/1000).toFixed(0));out.push([tot/1000,k,topn.join(', ')]);}
out.sort((a,b)=>b[0]-a[0]);console.log('window ms',((t1-t0)/1000).toFixed(0));for(const o of out.slice(0,10))console.log(o[0].toFixed(0).padStart(6),o[1],'|',o[2]);
