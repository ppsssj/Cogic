const fs=require('node:fs'), assert=require('node:assert/strict');
const [a,b,flag]=process.argv.slice(2);if(!b)throw Error('usage: node compare-manifests.cjs <baseline.json> <candidate.json> [--require-vite]');
const x=JSON.parse(fs.readFileSync(a,'utf8')),y=JSON.parse(fs.readFileSync(b,'utf8'));
const required=['schema','workspace','vscodeVersion','typescriptLanguageFeatures','graph.sha256','graph.nodes','graph.edges','analyzer.originalCompiledSha256','analyzer.instrumentedCompiledSha256','analyzer.typescript.version','analyzer.hostCwd','analyzer.compilerOptions','analyzer.rootNames','analyzer.rootFileHashes','analyzer.resolvedNodeDeclarations','cacheLookup','programSession'];
if(flag==='--require-vite')required.push('workspaceGitSha','lockSha256','workspaceTypesNode.version','workspaceTypesNode.packageJsonSha256','workspaceTypescript.version');
const get=(o,k)=>k.split('.').reduce((v,p)=>v?.[p],o);const differences=[];
for(const k of required){const left=get(x,k),right=get(y,k);if(left==null||right==null){differences.push({field:k,error:'missing'});continue;}try{assert.deepStrictEqual(left,right)}catch{differences.push({field:k,left,right});}}
if(x.analyzer.rootFileHashes.some(v=>!v.sha256)||y.analyzer.rootFileHashes.some(v=>!v.sha256))differences.push({field:'rootFileHashes',error:'missing hash'});
if(x.analyzer.resolvedNodeDeclarations.some(v=>!v.sha256)||y.analyzer.resolvedNodeDeclarations.some(v=>!v.sha256))differences.push({field:'resolvedNodeDeclarations',error:'missing hash'});
if(!x.webviewBundles.length||!y.webviewBundles.length)differences.push({field:'webviewBundles',error:'missing'});
console.log(JSON.stringify({match:differences.length===0,comparedFields:required,differences,webviewBundlesBaseline:x.webviewBundles,webviewBundlesCandidate:y.webviewBundles,limitation:'Equal manifests and graph do not establish equal unrecorded environment, dependency bytes, or verify the intended single code change.'},null,2));if(differences.length)process.exitCode=1;
