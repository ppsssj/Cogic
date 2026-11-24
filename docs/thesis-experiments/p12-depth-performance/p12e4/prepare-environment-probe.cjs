// Apply only to a disposable copy of the compiled extension.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(process.argv[2]||'');
const f=path.join(root,'out/analyzer/analyze.js'),s=fs.readFileSync(f,'utf8');
const anchor='    debug?.("analyzer.program.created", {';
if(s.split(anchor).length!==2)throw Error('expected one program event');
const inject=`    if (!global.__p12e4Probe) {
        global.__p12e4Probe = true;
        const typeResolution = ts.resolveTypeReferenceDirective('node', undefined, options, host).resolvedTypeReferenceDirective;
        const moduleResolution = ts.resolveModuleName('node:fs', activeFile, options, host).resolvedModule;
        debug?.('depth.p12e4.environment', { cwd: process.cwd(), tsCurrentDirectory: ts.sys.getCurrentDirectory(), hostCurrentDirectory: host.getCurrentDirectory(), typeRoots: ts.getEffectiveTypeRoots(options,host), compilerOptions: options, typeResolution, moduleResolution: moduleResolution ?? null, nodeDeclarationFiles: program.getSourceFiles().map(x=>x.fileName).filter(x=>/[\\\\/]@types[\\\\/]node[\\\\/]/i.test(x)), tsVersion:ts.version });
    }
`;
fs.writeFileSync(f,s.replace(anchor,inject+anchor));
