// Instrument only an isolated, disposable checkout, then build it separately.
const fs=require('node:fs'),path=require('node:path');
const dir=path.resolve(process.argv[2]??'');
if(!dir || !fs.existsSync(path.join(dir,'webview-ui','src','App.tsx'))) throw Error('isolated checkout required');
function edit(rel,cb){const f=path.join(dir,rel);const x=fs.readFileSync(f,'utf8').replace(/\r\n/g,'\n');const y=cb(x);if(x===y)throw Error('no change '+rel);fs.writeFileSync(f,y);}
function once(s,a,b){if(s.split(a).length!==2)throw Error('anchor: '+a);return s.replace(a,b);}
edit('webview-ui/vite.config.ts',s=>once(s,'  plugins: [react()],','  plugins: [react()],\n  resolve: { alias: [{ find: /^react-dom\\/client$/, replacement: "react-dom/profiling" }] },'));
edit('webview-ui/src/main.tsx',s=>once(s, "import { createRoot } from 'react-dom/client'", "// @ts-expect-error react-dom profiling entry lacks a declaration\nimport { createRoot } from 'react-dom/profiling'"));
edit('webview-ui/src/App.tsx',s=>{
 s=once(s,'  useCallback,','  Profiler,\n  useCallback,');
 s=once(s,'import { Topbar }',`const p12e2OnRender: import("react").ProfilerOnRenderCallback = (id, phase, actualDuration, baseDuration, startTime, commitTime) => { const w=window as any; (w.__p12e2React ??= []).push({id,phase,actualDuration,baseDuration,startTime,commitTime}); };\nimport { Topbar }`);
 s=once(s,'        <CanvasPane\n', '        <Profiler id="CanvasPane" onRender={p12e2OnRender}>\n        <CanvasPane\n');
 s=once(s,'        {inspectorOpen ? (','        </Profiler>\n        {inspectorOpen ? (');
 s=once(s,'        <Inspector\n', '        <Profiler id="Inspector" onRender={p12e2OnRender}>\n        <Inspector\n');
 s=once(s,'          onClearRoot={handleClearRoot}\n        />\n      </div>', '          onClearRoot={handleClearRoot}\n        />\n        </Profiler>\n      </div>');
 return s;
});
edit('webview-ui/src/components/CanvasPane.tsx',s=>{
 s=once(s,'(duration) => { profileTimes.current.nodesMs = duration; }', '(duration) => { profileTimes.current.nodesMs = duration; const w=window as any; (w.__p12e2Conversions ??= []).push({kind:"nodes",duration,time:performance.now()}); }');
 s=once(s,'(duration) => { profileTimes.current.edgesMs = duration; }', '(duration) => { profileTimes.current.edgesMs = duration; const w=window as any; (w.__p12e2Conversions ??= []).push({kind:"edges",duration,time:performance.now()}); }');
 return s;
});
