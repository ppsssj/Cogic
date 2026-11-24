// Run against a selected baseline or disposable candidate compiled extension.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const analyzer = require(path.resolve(process.argv[2]));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p12e1-check-'));
const main = path.join(root, 'main.ts'), dep = path.join(root, 'dep.ts'), config = path.join(root, 'tsconfig.json');
const initial = 'export function target(value: number) { return value + 1; }\n';
const files = [main, dep];
const code = 'import { target } from "./dep"; export function main() { return target(1); }\n';
function writeFixture() { fs.writeFileSync(main, code); fs.writeFileSync(dep, initial); fs.writeFileSync(config, JSON.stringify({compilerOptions:{target:'ES2022',module:'commonjs'},include:['*.ts']})); }
function analyze(session, text = code, cacheEnabled = true) { return analyzer.analyzeWorkspaceActive({active:{code:text,fileName:main,languageId:'typescript'},workspaceRoot:root,filePaths:files,session,cacheEnabled}); }
function compare(session, text = code) { const actual=analyze(session,text); const expected=analyze(undefined,text,false); assert.deepEqual(actual.graph,expected.graph); assert.deepEqual(actual.calls,expected.calls); assert.deepEqual(actual.diagnostics,expected.diagnostics); }
const cases = [];
try {
 for (const scenario of ['same-size-changed-mtime','same-size-restored-mtime-invalidated','deleted-invalidated','new-file-invalidated','tsconfig-invalidated','unsaved-buffer']) {
  analyzer.clearAnalyzerCaches(); writeFixture(); const session=analyzer.createAnalysisSession();
  try {
   analyze(session);
   if (scenario.startsWith('same-size')) {
    const fixed=new Date(Date.UTC(2025,0,1)); fs.utimesSync(dep,fixed,fixed); analyzer.invalidateAnalyzerFileCaches([dep]); analyze(session);
    const modified=initial.replace('value + 1','value + 2'); assert.equal(modified.length,initial.length); fs.writeFileSync(dep,modified);
    if (scenario==='same-size-restored-mtime-invalidated') { fs.utimesSync(dep,fixed,fixed); analyzer.invalidateAnalyzerFileCaches([dep]); }
    else { const later=new Date(fixed.getTime()+5000); fs.utimesSync(dep,later,later); }
   } else if (scenario==='deleted-invalidated') { fs.unlinkSync(dep); analyzer.invalidateAnalyzerFileCaches([dep]); }
   else if (scenario==='new-file-invalidated') { const extra=path.join(root,'extra.ts'); fs.writeFileSync(extra,'export const extra = 1;\n'); analyzer.invalidateAnalyzerFileCaches([extra]); assert.equal(session.isReusable,false); }
   else if (scenario==='tsconfig-invalidated') { fs.writeFileSync(config,JSON.stringify({compilerOptions:{target:'ES2020',module:'commonjs'},include:['*.ts']})); analyzer.invalidateAnalyzerFileCaches([config]); assert.equal(session.isReusable,false); }
   const actualCode=scenario==='unsaved-buffer' ? code+'export const fromUnsaved = 1;\n' : code;
   compare(session,actualCode); cases.push(scenario);
  } finally { session.dispose(); if (fs.existsSync(path.join(root,'extra.ts'))) fs.unlinkSync(path.join(root,'extra.ts')); }
 }
 console.log(JSON.stringify({status:'pass',cases}));
} finally { fs.rmSync(root,{recursive:true,force:true}); }
