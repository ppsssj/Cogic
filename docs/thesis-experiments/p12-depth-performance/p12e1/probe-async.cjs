// Change a frontier file after the first Program but before its asynchronous read resolves.
const fs=require('node:fs'), os=require('node:os'), path=require('node:path'), assert=require('node:assert/strict');
const a=require(path.resolve(process.argv[2])); const root=fs.mkdtempSync(path.join(os.tmpdir(),'p12e1-async-'));
const main=path.join(root,'main.ts'), dep=path.join(root,'dep.ts');
const code='import { target } from "./dep"; export function run(x: number) { return target(x); }\n';
const before='export function target(x: number) { return x + 1; }\n';
const after='function helper(x: number) { return x + 2; }\nexport function target(x: number) { return helper(x); }\n';
fs.writeFileSync(main,code);fs.writeFileSync(dep,before);
const params={code,fileName:main,languageId:'typescript',workspaceRoot:root,filePaths:[main,dep],graphDepth:2,traceMode:false,traceScope:'current-depth',cacheEnabled:true};
(async()=>{
 try {
  async function run(programSession) {
   fs.writeFileSync(dep,before); a.clearAnalyzerCaches(); let edited=false;
   const result=await a.analyzeWorkspaceDepth({...params,programSession,readFile:async f=>{ if (!edited && path.resolve(f)===dep) { edited=true; await Promise.resolve(); fs.writeFileSync(dep,after); a.invalidateAnalyzerFileCaches([dep]); } return fs.promises.readFile(f,'utf8'); }});
   assert.ok(edited,'frontier read must occur'); return result;
  }
  const changed=await run(true); const sameSequenceWithoutSession=await run(false);
  assert.deepEqual(changed.graph,sameSequenceWithoutSession.graph); assert.ok(changed.graph.nodes.some(n=>n.name.includes('helper')));
  a.clearAnalyzerCaches();
  const freshAfterEdit=await a.analyzeWorkspaceDepth({...params,programSession:false,readFile:f=>fs.promises.readFile(f,'utf8')});
  assert.notDeepEqual(changed.graph,freshAfterEdit.graph,'mid-flight edit produces a mixed snapshot in this scenario');
  console.log(JSON.stringify({status:'pass',scenario:'frontier-file-edit-after-async-boundary'}));
 } finally { fs.rmSync(root,{recursive:true,force:true}); }
})().catch(e=>{console.error(e);process.exitCode=1;});
