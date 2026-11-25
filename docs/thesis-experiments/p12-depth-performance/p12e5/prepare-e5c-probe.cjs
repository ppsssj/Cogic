// Test-only bridge for observing exactly the arrays passed to React Flow.
const fs=require('node:fs'),path=require('node:path');const dir=path.resolve(process.argv[2]||''),f=path.join(dir,'webview-ui/src/components/CanvasPane.tsx'),s=fs.readFileSync(f,'utf8').replace(/\r\n/g,'\n');
const anchor='  useEffect(() => {\n    if (!pipelineEnabled || !profileRequestId || !graph) return;\n    profileWebview("canvas.commit", profileRequestId, {';
if(s.split(anchor).length!==2)throw Error('unique hook anchor not found');
const add='  useEffect(() => { (window as any).__p12e5c = { nodes, edges, graph, instance: () => rfRef.current }; }, [nodes, edges, graph]);\n\n';
fs.writeFileSync(f,s.replace(anchor,add+anchor));
