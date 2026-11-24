// Only a new disposable checkout: instrument React Flow reconciliation and selection lifecycle.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const dir=path.resolve(process.argv[2]??'');
if(!fs.existsSync(path.join(dir,'webview-ui/src/App.tsx')))throw Error('isolated checkout required');
cp.execFileSync(process.execPath,[path.join(__dirname,'../p12e2/prepare-react-profile.cjs'),dir],{stdio:'inherit'});
function edit(rel,fn){const f=path.join(dir,rel),s=fs.readFileSync(f,'utf8'),n=fn(s);if(s===n)throw Error('no change');fs.writeFileSync(f,n);}
function once(s,a,b){if(s.split(a).length!==2)throw Error('anchor '+a);return s.replace(a,b);}
edit('webview-ui/src/App.tsx',s=>{
 s=once(s,'  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);',`  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  useEffect(() => { const w=window as any; (w.__p12e3State ??= []).push({event:'selected-ids-effect',time:performance.now(),count:selectedNodeIds.length}); }, [selectedNodeIds]);`);
 s=once(s,'      pushWebviewDebugEvent("canvas.selection.request", {',`      { const w=window as any; (w.__p12e3State ??= []).push({event:'selection-handler',time:performance.now(),nodeId}); }
      pushWebviewDebugEvent("canvas.selection.request", {`);
 s=once(s,'      replaceSelectedNodes(nodeId);\n    },\n    [replaceSelectedNodes, toggleSelectedNode]', `      replaceSelectedNodes(nodeId);\n      { const w=window as any; (w.__p12e3State ??= []).push({event:'selection-handler-return',time:performance.now(),nodeId}); }\n    },\n    [replaceSelectedNodes, toggleSelectedNode]`);
 return s;
});
edit('webview-ui/src/components/CanvasPane.tsx',s=>{
 s=once(s,'  memo,','  Profiler,\n  memo,');
 s=once(s,'type InterfaceSubkind =',`const p12e3FlowRender: import("react").ProfilerOnRenderCallback = (id, phase, actualDuration, baseDuration, startTime, commitTime) => { const w=window as any; (w.__p12e2React ??= []).push({id,phase,actualDuration,baseDuration,startTime,commitTime}); };\ntype InterfaceSubkind =`);
 s=once(s,'            <ReactFlow\n','            <Profiler id="ReactFlow" onRender={p12e3FlowRender}>\n            <ReactFlow\n');
 s=once(s,'            </ReactFlow>\n          </ReactFlowProvider>','            </ReactFlow>\n            </Profiler>\n          </ReactFlowProvider>');
 return s;
});
