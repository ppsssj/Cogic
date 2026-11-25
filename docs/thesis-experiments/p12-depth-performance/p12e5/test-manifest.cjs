const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),cp=require('node:child_process');
const dir=__dirname,a=path.join(dir,'medium-on-1/manifest.json'),b=path.join(dir,'medium-off-1/manifest.json'),checker=path.join(dir,'compare-manifests.cjs');
function run(x,y,extra=[]){return cp.spawnSync(process.execPath,[checker,x,y,...extra],{encoding:'utf8'});}
assert.equal(run(a,b).status,0,'matching synthetic manifests must pass');
assert.equal(run(a,b,['--require-vite']).status,1,'missing Vite fields must fail');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'p12e5-check-'));
try{const x=JSON.parse(fs.readFileSync(b));x.graph.sha256='0'.repeat(64);const f=path.join(tmp,'bad.json');fs.writeFileSync(f,JSON.stringify(x));assert.equal(run(a,f).status,1,'different graph must fail');x.graph.sha256=JSON.parse(fs.readFileSync(a)).graph.sha256;x.analyzer.rootNames=null;fs.writeFileSync(f,JSON.stringify(x));assert.equal(run(a,f).status,1,'missing roots must fail');}finally{fs.rmSync(tmp,{recursive:true,force:true});}
console.log('4 manifest checks passed');
