const fs = require('node:fs');
const crypto = require('node:crypto');
const [beforeFile, afterFile, outFile] = process.argv.slice(2);
if (!outFile) throw Error('usage: node compare-graphs.cjs <before.json> <after.json> <output.json>');
const read = file => { const raw = fs.readFileSync(file); return { sha256: crypto.createHash('sha256').update(raw).digest('hex'), graph: JSON.parse(raw) }; };
const before=read(beforeFile), after=read(afterFile);
function compare(kind) {
 const left=new Map(before.graph[kind].map(x=>[x.id,x])), right=new Map(after.graph[kind].map(x=>[x.id,x]));
 if(left.size!==before.graph[kind].length||right.size!==after.graph[kind].length)throw Error('duplicate '+kind+' ID');
 const removed=[...left].filter(([id])=>!right.has(id)).map(([,v])=>v).sort((a,b)=>a.id.localeCompare(b.id));
 const added=[...right].filter(([id])=>!left.has(id)).map(([,v])=>v).sort((a,b)=>a.id.localeCompare(b.id));
 const changed=[...left].filter(([id,v])=>right.has(id)&&JSON.stringify(v)!==JSON.stringify(right.get(id))).map(([id,v])=>({id,before:v,after:right.get(id)}));
 const counts=a=>Object.entries(a.reduce((x,r)=>(x[r.kind]=(x[r.kind]??0)+1,x),{})).sort();
 return {beforeCount:left.size,afterCount:right.size,removedCount:removed.length,addedCount:added.length,changedCount:changed.length,removedByKind:counts(removed),addedByKind:counts(added),removed,added,changed};
}
const result={before:{file:beforeFile,sha256:before.sha256},after:{file:afterFile,sha256:after.sha256},nodes:compare('nodes'),edges:compare('edges')};
fs.writeFileSync(outFile,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({before:result.before,after:result.after,nodes:Object.fromEntries(Object.entries(result.nodes).filter(([k])=>!['removed','added','changed'].includes(k))),edges:Object.fromEntries(Object.entries(result.edges).filter(([k])=>!['removed','added','changed'].includes(k)))},null,2));
