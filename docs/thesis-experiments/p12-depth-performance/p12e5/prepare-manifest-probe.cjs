const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(process.argv[2]||''),f=path.join(root,'out/analyzer/analyze.js'),s=fs.readFileSync(f,'utf8');
const anchor='    debug?.("analyzer.program.created", {';
if(s.split(anchor).length!==2)throw Error('expected unmodified compiled analyzer');
const patch=`    if (!global.__p12e5Probe) {
      global.__p12e5Probe = true;
      const crypto = require('node:crypto');
      const declarations = program.getSourceFiles().map(x=>x.fileName).filter(x=>/[\\\\/]@types[\\\\/]node[\\\\/]/i.test(x)).map(file=>{try{return {file,sha256:crypto.createHash('sha256').update(require('node:fs').readFileSync(file)).digest('hex')};}catch(e){return {file,error:String(e)};}});
      debug?.('depth.p12e5.environment', {cwd:process.cwd(),tsCurrentDirectory:ts.sys.getCurrentDirectory(),hostCurrentDirectory:host.getCurrentDirectory(),compilerOptions:options,rootNames,tsVersion:ts.version,nodeDeclarations:declarations});
    }
`;
fs.writeFileSync(f,s.replace(anchor,patch+anchor));
