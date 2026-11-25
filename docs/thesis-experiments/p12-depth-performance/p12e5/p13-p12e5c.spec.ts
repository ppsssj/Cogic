import { test, expect } from "@playwright/test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { launchVSCode, closeVSCode, quickOpenFile, waitTsReady, waitTsServerIdle } from "./lib/vscode";
import { openCogicPanel, waitGraphStable } from "./lib/cogic";

const out = process.env.P12C2_OUTPUT!, log = process.env.COGIC_PIPELINE_PROFILE!;
const rows = () => fs.existsSync(log) ? fs.readFileSync(log, "utf8").split(/\r?\n/).filter(Boolean).flatMap(s => { try { return [JSON.parse(s)]; } catch { return []; } }) : [];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
test("P12-E2 interaction profiling", async () => {
  test.setTimeout(1_200_000);
  const before = Math.round(os.freemem()/1048576); let minimum = before, aborted = false, session: Awaited<ReturnType<typeof launchVSCode>> | undefined;
  if (before < 2200) throw Error(`preflight free memory ${before} MiB is below 2200 MiB`);
  const monitor = setInterval(() => { const free = Math.round(os.freemem()/1048576); minimum = Math.min(minimum, free); if (free < 800 && !aborted) { aborted = true; fs.writeFileSync(path.join(out, "memory-abort"), String(free)); if (session) void session.app.close(); } }, 250);
  const check = () => { if (aborted) throw Error("memory guard fired"); };
  try {
    session = await launchVSCode({ profile: process.env.RUN_ID!, extensions: ["cogic"], extraSettings: { "cogic.analysisCache.enabled": process.env.P12C2_CACHE !== "off" } });
    if (aborted) throw Error("memory guard fired during startup");
    await quickOpenFile(session.page, process.env.P12C2_FILE ?? "src/main.ts");
    if (process.env.P12E2_NO_TS !== "1") { await waitTsReady(session.page, 120_000); await waitTsServerIdle(session.page, 180_000); }
    const frame = await openCogicPanel(session.page);
    await frame.evaluate(() => { (window as any).__p12c2Results = {}; window.addEventListener("message", e => { if (e.data?.type === "analysisResult" && e.data.request?.lane === "active" && e.data.payload?.graph) (window as any).__p12c2Results[e.data.request.requestId] = e.data.payload.graph; }); });
    await expect(frame.locator(".projectPicker")).toContainText(process.env.P12E5_PICKER ?? (process.env.P12E2_FIXTURE === "1" ? "main.ts" : "index.ts"), { timeout: 60_000 });
    // Selecting Depth itself starts analysis. Keep it separate from the later Generate.
    const priorDepth = rows().filter(r => r.event === "pipeline.request.sent" && String(r.webview?.origin).includes("graphDepth.change")).length;
    await frame.locator('select[aria-label="Graph depth"]').selectOption("2");
    await expect.poll(() => rows().filter(r => r.event === "pipeline.request.sent" && String(r.webview?.origin).includes("graphDepth.change")).length, { timeout: 30_000 }).toBeGreaterThan(priorDepth);
    const preparation = rows().filter(r => r.event === "pipeline.request.sent" && String(r.webview?.origin).includes("graphDepth.change")).at(-1).requestId;
    console.log(JSON.stringify({phase: "preparation", preparation, before}));
    await expect.poll(() => { check(); return rows().some(r => r.requestId === preparation && ["postMessage.call", "request.cancelled", "request.failed", "request.dropped"].includes(r.event)); }, { timeout: 900_000, intervals: [1000] }).toBeTruthy();
    if (aborted) throw Error("memory guard fired during preparation");
    if (!rows().some(r => r.requestId === preparation && r.event === "postMessage.call")) throw Error("Depth 2 request did not complete");
    await expect.poll(() => { check(); return rows().some(r => r.requestId === preparation && r.event === "pipeline.canvas.twoAnimationFrames"); }, { timeout: 900_000, intervals: [1000] }).toBeTruthy();
    const prepGraph = await frame.evaluate(key => (window as any).__p12c2Results[key], preparation);
    if (!prepGraph) throw Error("Depth 2 result graph missing");
    const prepRoot = process.env.STUDY_WORKSPACE!.replace(/\\/g, "/").toLowerCase();
    const prepRx = new RegExp(prepRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    const prepNorm = (v: any): any => typeof v === "string" ? v.replace(/\\/g, "/").replace(prepRx, "<fixture>") : Array.isArray(v) ? v.map(prepNorm) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k,x]) => [k,prepNorm(x)])) : v;
    const prepNormalized = JSON.stringify(prepNorm(prepGraph));
    fs.writeFileSync(path.join(out, "preparation-graph.normalized.json"), prepNormalized);
    const prepInspector = (await frame.locator(".inspectorBody").innerText()).replace(/\s+/g, " ").slice(0, 1600);
    const prepSummary = {id: preparation, nodes: prepGraph.nodes.length, edges: prepGraph.edges.length, sha256: crypto.createHash("sha256").update(prepNormalized).digest("hex"), picker: await frame.locator(".projectPicker").innerText(), inspector: prepInspector, before, minimum};
    fs.writeFileSync(path.join(out, "preparation-summary.json"), JSON.stringify(prepSummary, null, 2));
    console.log(JSON.stringify({phase: "preparation-complete", ...prepSummary}));
    const expected=process.env.P12E5_EXPECT_SHA256;
    if (expected) { if (!/^[a-f0-9]{64}$/.test(expected)) throw Error("invalid P12E5_EXPECT_SHA256"); expect(prepSummary.sha256).toBe(expected); }
    else if (process.env.P12E4_GRAPH_ONLY !== "1") throw Error("P12E5_EXPECT_SHA256 is required before interaction measurement");
    if(process.env.P12E4_GRAPH_ONLY === "1") return;
    await sleep(1500);
    const variant=process.env.P12E2_VARIANT ?? "baseline";
    if(variant === "animation-off") await frame.addStyleTag({content: ".react-flow__edge-path { animation: none !important; }"});
    const setup = await frame.evaluate(() => {
      const w=window as any;
      w.__p12e2 = {frames:[], longtasks:[], loaf:[], active:false, samples:[], selections:[], start:0, pointer:[]}; document.addEventListener('pointermove', e => { if(w.__p12e2.active && w.__p12e2.phase==='pan') w.__p12e2.pointer.push({x:e.clientX,y:e.clientY,t:performance.now()}); },true);
      const r=w.__p12e2;
      const support=PerformanceObserver.supportedEntryTypes ?? [];
      if (support.includes('longtask')) { const o=new PerformanceObserver(l=>{for(const e of l.getEntries()) if(r.active) r.longtasks.push({start:e.startTime,duration:e.duration});});o.observe({type:'longtask',buffered:false}); }
      if (support.includes('long-animation-frame')) {const o=new PerformanceObserver(l=>{for(const e of l.getEntries() as any[]) if(r.active) r.loaf.push({start:e.startTime,duration:e.duration,blockingDuration:e.blockingDuration,scripts:(e.scripts??[]).map((s:any)=>({duration:s.duration,sourceURL:s.sourceURL,sourceFunctionName:s.sourceFunctionName,forcedStyleAndLayoutDuration:s.forcedStyleAndLayoutDuration}))});});o.observe({type:'long-animation-frame',buffered:false});}
      r.mounts=0;r.unmounts=0;new MutationObserver(records=>{if(!r.active || r.phase!=='pan')return;for(const m of records){for(const [list,key] of [[m.addedNodes,'mounts'],[m.removedNodes,'unmounts']] as const)for(const n of list){if(n instanceof Element)r[key]+=(n.matches('.react-flow__node')?1:0)+n.querySelectorAll('.react-flow__node').length;}}}).observe(document.querySelector('.react-flow')!,{childList:true,subtree:true});
      const tick=(t:number)=>{if(r.active)r.frames.push(t);requestAnimationFrame(tick)};requestAnimationFrame(tick);
      return {support,visibility:document.visibilityState, dpr:devicePixelRatio};
    });
    const begin = async (phase:string) => { await frame.evaluate(phase=>{ const r=(window as any).__p12e2;r.phase=phase;r.frames=[];r.longtasks=[];r.loaf=[];r.pointer=[];r.mounts=0;r.unmounts=0;r.start=performance.now();r.active=true; },phase); };
    const finish = async (phase:string) => { await sleep(150); return frame.evaluate(phase=>{const r=(window as any).__p12e2;r.active=false;return {phase,start:r.start,end:performance.now(),frames:r.frames,longtasks:r.longtasks,loaf:r.loaf,pointer:r.pointer,mounts:r.mounts,unmounts:r.unmounts,domNodes:document.querySelectorAll('.react-flow__node').length,domEdges:document.querySelectorAll('.react-flow__edge').length,viewport:document.querySelector('.react-flow__viewport')?.getAttribute('style')};},phase); };
    const animationState=await frame.evaluate(()=>{const paths=[...document.querySelectorAll('.react-flow__edge-path')];const names:Record<string,number>={};for(const p of paths){const v=getComputedStyle(p).animationName;names[v]=(names[v]??0)+1;}return {pathCount:paths.length,names};});
    const result:any = {setup,variant,animationState,graph:prepSummary,phases:[]};
    const e5cInitial=await frame.evaluate(()=>({nodes:[...document.querySelectorAll('.react-flow__node')].map(e=>({id:(e as HTMLElement).dataset.id,text:(e.textContent??'').trim().slice(0,160),html:e.outerHTML.slice(0,500)})),buttons:[...document.querySelectorAll('button[title*=group]')].map(e=>({title:e.getAttribute('title'),text:e.textContent,id:(e.closest('.react-flow__node') as HTMLElement|null)?.dataset.id}))}));
    fs.writeFileSync(path.join(out,'e5c-initial.json'),JSON.stringify(e5cInitial,null,2));
    // E5B: Every measurement has an explicit validity result. Mouse coordinates
    // come only from an in-pane elementFromPoint hit test, never DOM dispatch.
    const pane=frame.locator('.react-flow__pane');
    const errors:string[]=[];
    const save=()=>fs.writeFileSync(path.join(out,'interaction-partial.json'),JSON.stringify(result,null,2));
    async function hit(selector:string, groupId?:string):Promise<any>{
      return frame.evaluate(({selector,groupId})=>{
        const pane=document.querySelector('.react-flow__pane')?.getBoundingClientRect();if(!pane)return null;
        for(const el of [...document.querySelectorAll(selector)]){
          const group=el.closest('.react-flow__node') as HTMLElement|null;
          if(groupId && group?.dataset.id!==groupId)continue;
          const r=el.getBoundingClientRect(),left=Math.max(r.left,pane.left),right=Math.min(r.right,pane.right),top=Math.max(r.top,pane.top),bottom=Math.min(r.bottom,pane.bottom);
          if(right-left<4||bottom-top<4)continue;
          for(let y=top+2;y<bottom-1;y+=5)for(let x=left+2;x<right-1;x+=5){const found=document.elementFromPoint(x,y);if(found&&(found===el||el.contains(found)))return {x,y,id:group?.dataset.id??null,text:(el.textContent??'').trim().slice(0,100),title:el.getAttribute('title')};}
        }return null;
      },{selector,groupId});
    }
    async function clickTarget(selector:string, groupId?:string){
      for(let n=0;n<12;n++){
        const target=await hit(selector,groupId);
        if(target){const outer=await frame.locator('.react-flow').boundingBox();const inner=await frame.locator('.react-flow').evaluate(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y};});if(!outer)throw Error('canvas unavailable');await session!.page.mouse.click(outer.x+target.x-inner.x,outer.y+target.y-inner.y,{delay:45});return target;}
        if(groupId && n>0){
          const data=await frame.evaluate(id=>{const b=(window as any).__p12e5c,inst=b?.instance(),node=inst?.getNodes().find((v:any)=>v.id===id),pane=document.querySelector('.react-flow__pane')?.getBoundingClientRect();if(!node||!pane||!node.positionAbsolute)return null;const v=inst.getViewport();return {dx:pane.width/2-(v.x+(node.positionAbsolute.x+Math.min(150,(node.width??300)/2))*v.zoom),dy:pane.height/2-(v.y+(node.positionAbsolute.y+25)*v.zoom)};},groupId);
          const box=await pane.boundingBox(); const blank=await pane.evaluate(el=>{const r=el.getBoundingClientRect();for(let y=25;y<r.height-25;y+=15)for(let x=25;x<r.width-25;x+=15)if(document.elementFromPoint(r.left+x,r.top+y)===el)return{x,y};return null;});
          if(data&&box&&blank){const dx=Math.max(-300,Math.min(300,data.dx)),dy=Math.max(-200,Math.min(200,data.dy));await session!.page.mouse.move(box.x+blank.x,box.y+blank.y);await session!.page.mouse.down();await session!.page.mouse.move(box.x+blank.x+dx,box.y+blank.y+dy,{steps:8});await session!.page.mouse.up();await sleep(500);continue;}
        }
        // Fit the graph first, then zoom out through the real toolbar. This can
        // bring collapsed, formerly offscreen headers back into the viewport.
        if(n===0)await frame.locator('button[title="Fit Graph"]').click();
        else await frame.locator('button[title="Zoom out"]').click();
        await sleep(300);
      }throw Error('no hit-testable target: '+selector+' group='+groupId);
    }
    let waitLayoutStable:()=>Promise<any>;
    async function phase(name:string, fn:()=>Promise<any>){
      try{await begin(name);const detail=await fn();const stability=(name.includes('collapse')||name.includes('expand'))?await waitLayoutStable():null;await sleep(250);const data=await finish(name);result.phases.push({...data,valid:true,...detail,stability});}
      catch(e){await frame.evaluate(()=>{(window as any).__p12e2.active=false;}).catch(()=>{});result.phases.push({phase:name,valid:false,error:String(e)});errors.push(name+': '+String(e));}
      save();
    }
    const desired=process.env.P12E5C_STATE??'collapsed';
    if(!['collapsed','single','multiple'].includes(desired))throw Error('invalid E5C state');
    const workspace=process.env.STUDY_WORKSPACE!.replace(/\\/g,'/').toLowerCase();
    const idFor=(kind:string,suffix:string)=>kind+':'+workspace+'/src/'+suffix;
    async function toggleIfNeeded(id:string, expand:string, collapse:string){
      let state=await frame.evaluate(({id,expand,collapse})=>{const el=[...document.querySelectorAll('.react-flow__node')].find(x=>(x as HTMLElement).dataset.id===id);return el?.querySelector(expand)?'collapsed':el?.querySelector(collapse)?'expanded':'missing';},{id,expand,collapse});
      if(state==='missing'){state=await frame.evaluate(id=>{const n=(window as any).__p12e5c?.nodes.find((v:any)=>v.id===id);return n?(n.data?.collapsed?'collapsed':'expanded'):'missing';},id);}
      if(state==='collapsed'){await clickTarget(expand,id);await expect.poll(()=>frame.evaluate(id=>(window as any).__p12e5c?.nodes.find((n:any)=>n.id===id)?.data?.collapsed,id),{timeout:10000}).toBe(false);await sleep(600);}
      else if(state!=='expanded')throw Error('group not available '+id);
    }
    const expandFolder='button[title="Expand folder group"]',collapseFolder='button[title="Collapse folder group"]';
    const expandFile='button[title="Select and expand file group"]',collapseFile='button[title="Select and collapse file group"]';
    if(desired!=='collapsed'){
      await toggleIfNeeded(idFor('folder','alpha'),expandFolder,collapseFolder);
      await toggleIfNeeded(idFor('file','alpha/a.ts:0'),expandFile,collapseFile);
      if(desired==='multiple'){
        await toggleIfNeeded(idFor('folder','beta'),expandFolder,collapseFolder);
        await toggleIfNeeded(idFor('file','beta/b.ts:0'),expandFile,collapseFile);
      }
    }
    const snapshot=async()=>frame.evaluate(()=>{
      const b=(window as any).__p12e5c;if(!b?.instance())throw Error('E5C bridge missing');
      const inst=b.instance(),pane=document.querySelector('.react-flow__pane')!.getBoundingClientRect();
      return {time:performance.now(),graphNodes:b.graph.nodes.length,graphEdges:b.graph.edges.length,flowNodes:b.nodes.length,flowEdges:b.edges.length,domNodes:document.querySelectorAll('.react-flow__node').length,domEdges:document.querySelectorAll('.react-flow__edge').length,pane:{width:pane.width,height:pane.height},viewport:inst.getViewport(),nodes:b.nodes.map((n:any)=>({id:n.id,type:n.type,parentNode:n.parentNode,position:n.position,width:n.width,height:n.height,style:n.style,collapsed:n.data?.collapsed,count:n.data?.count})),instanceNodes:inst.getNodes().map((n:any)=>({id:n.id,parentNode:n.parentNode,position:n.position,positionAbsolute:n.positionAbsolute,width:n.width,height:n.height,measured:n.measured})),flowEdgeIds:b.edges.map((e:any)=>e.id)};
    });
    waitLayoutStable=async()=>{const start=performance.now();let previous='',same=0;for(let i=0;i<30;i++){const x=await snapshot();const signature=JSON.stringify(x.instanceNodes.map((n:any)=>[n.id,n.positionAbsolute,n.width,n.height]));same=signature===previous?same+1:0;previous=signature;if(same>=3)return {durationMs:performance.now()-start,consecutive:4,method:'250ms matching instance positions and dimensions'};await sleep(250);}throw Error('layout did not stabilize within 7.5s');};
    await frame.locator('button[title="Fit Graph"]').click();await sleep(1100);
    const setupStability=await waitLayoutStable();const beforeState=await snapshot();
    fs.writeFileSync(path.join(out,'e5c-before.json'),JSON.stringify({desired,...beforeState},null,2));
    const alpha=beforeState.nodes.filter((n:any)=>n.id.startsWith('function:'+workspace+'/src/alpha/a.ts:')).length;
    const beta=beforeState.nodes.filter((n:any)=>n.id.startsWith('function:'+workspace+'/src/beta/b.ts:')).length;
    if(desired==='single' && alpha!==60)throw Error('single group did not expose 60 functions: '+alpha);
    if(desired==='multiple' && (alpha!==60||beta!==60))throw Error('multiple groups not exposed: '+alpha+'/'+beta);
    if(desired==='collapsed' && (alpha||beta))throw Error('collapsed state includes child functions');
    const fitBounds=(v:any)=>{const usable=v.instanceNodes.filter((n:any)=>n.positionAbsolute && Number.isFinite(n.width) && Number.isFinite(n.height));if(usable.length!==v.instanceNodes.length)return {valid:false,reason:'missing measured node bounds',measured:usable.length,total:v.instanceNodes.length};const minX=Math.min(...usable.map((n:any)=>n.positionAbsolute.x)),maxX=Math.max(...usable.map((n:any)=>n.positionAbsolute.x+n.width)),minY=Math.min(...usable.map((n:any)=>n.positionAbsolute.y)),maxY=Math.max(...usable.map((n:any)=>n.positionAbsolute.y+n.height));const q=v.viewport;const screen={left:q.x+q.zoom*minX,right:q.x+q.zoom*maxX,top:q.y+q.zoom*minY,bottom:q.y+q.zoom*maxY};const tolerance=2;return {valid:screen.left>=-tolerance&&screen.top>=-tolerance&&screen.right<=v.pane.width+tolerance&&screen.bottom<=v.pane.height+tolerance,screen,world:{minX,maxX,minY,maxY},pane:v.pane,viewport:q};};
    result.e5c={desired,alpha,beta,setupStability,before:beforeState,fitBefore:fitBounds(beforeState)};
    if(!result.e5c.fitBefore.valid)errors.push('initial Fit Graph does not contain all measured node bounds');
    await phase('pan',async()=>{
      const box=await pane.boundingBox();if(!box)throw Error('pane missing');
      const p=await pane.evaluate(el=>{const r=el.getBoundingClientRect();for(let y=25;y<r.height-100;y+=20)for(let x=25;x<r.width-120;x+=20)if(document.elementFromPoint(r.left+x,r.top+y)===el && document.elementFromPoint(r.left+x+80,r.top+y+55)===el)return{x,y};return null;});
      if(!p)throw Error('no unobstructed pan point');const before=await frame.locator('.react-flow__viewport').getAttribute('style');
      const x=box.x+p.x,y=box.y+p.y;await session!.page.mouse.move(x,y);await session!.page.mouse.down();const start=performance.now();let intermediate='';
      for(let i=1;i<=80;i++){await session!.page.mouse.move(x+80*Math.sin(i*Math.PI/20),y+55*Math.sin(i*Math.PI/20));if(i===10)intermediate=await frame.locator('.react-flow__viewport').getAttribute('style')??'';await sleep(Math.max(0,start+i*62.5-performance.now()));}await session!.page.mouse.up();if(intermediate===before)throw Error('viewport did not move');return {before,intermediate};
    });
    result.e5c.afterPan=await snapshot();
    if(JSON.stringify(result.e5c.afterPan.nodes.map((n:any)=>n.id).sort())!==JSON.stringify(beforeState.nodes.map((n:any)=>n.id).sort())||JSON.stringify([...result.e5c.afterPan.flowEdgeIds].sort())!==JSON.stringify([...beforeState.flowEdgeIds].sort()))errors.push('flow topology changed during pan');
    await phase('zoom',async()=>{const before=await frame.locator('.react-flow__viewport').getAttribute('style');await frame.locator('button[title="Zoom in"]').click();await sleep(350);const after=await frame.locator('.react-flow__viewport').getAttribute('style');if(before===after)throw Error('zoom did not change viewport');await frame.locator('button[title="Zoom out"]').click();return {before,after};});
    await phase('selection',async()=>{
      await frame.evaluate(()=>{const r=(window as any).__p12e2;const el=document.querySelector('.inspectorBody');if(!el)throw Error('inspector missing');const section=()=>el.textContent?.split('SELECTED NODE')[1]?.split('SELECTION')[0]??'';const prev=section();r.selectionPending={prev,click:0};const handler=(e:Event)=>{if((e.target as Element).closest('.cgChildNode--interactive, .cgNode')){r.selectionPending.click=performance.now();document.removeEventListener('click',handler,true);}};document.addEventListener('click',handler,true);const ob=new MutationObserver(()=>{const p=r.selectionPending;if(p?.click&&section()!==p.prev){r.selections.push({click:p.click,inspector:performance.now(),deltaMs:performance.now()-p.click,text:section().trim().slice(0,200)});ob.disconnect();}});ob.observe(el,{subtree:true,childList:true,characterData:true});setTimeout(()=>ob.disconnect(),6000);});
      const target=await clickTarget('.cgChildNode--interactive, .cgNode');await expect.poll(()=>frame.evaluate(()=>(window as any).__p12e2.selections.length),{timeout:5000}).toBeGreaterThan(0);const sample=await frame.evaluate(()=>(window as any).__p12e2.selections.at(-1));const name=target.text.split(/\(|\s/)[0];if(!name || !sample.text.includes(name))throw Error('Inspector does not match selected node '+name);return {target,selection:sample};
    });
    for(const type of ['file','folder']){
      const collapse=type==='file'?'button[title="Select and collapse file group"]':'button[title="Collapse folder group"]';
      const expand=type==='file'?'button[title="Select and expand file group"]':'button[title="Expand folder group"]';
      let groupId:string|undefined;
      await phase(type+'-collapse',async()=>{const target=await clickTarget(collapse);if(!target.id)throw Error('group ID absent');groupId=target.id;await expect.poll(()=>frame.evaluate(id=>(window as any).__p12e5c?.nodes.find((n:any)=>n.id===id)?.data?.collapsed,groupId),{timeout:5000}).toBe(true);return {target,groupId};});
      await phase(type+'-expand',async()=>{if(!groupId)throw Error('collapse did not identify group');const target=await clickTarget(expand,groupId);await expect.poll(()=>frame.evaluate(id=>(window as any).__p12e5c?.nodes.find((n:any)=>n.id===id)?.data?.collapsed,groupId),{timeout:5000}).toBe(false);return {target,groupId};});
    }
    await frame.locator('button[title="Zoom in"]').click();await sleep(300);
    await phase('fit',async()=>{const before=await frame.locator('.react-flow__viewport').getAttribute('style');await frame.locator('button[title="Fit Graph"]').click();await sleep(350);const after=await frame.locator('.react-flow__viewport').getAttribute('style');if(!after)throw Error('viewport absent');return {before,after};});
    result.e5c.final=await snapshot();if(JSON.stringify(result.e5c.final.nodes.map((n:any)=>n.id).sort())!==JSON.stringify(beforeState.nodes.map((n:any)=>n.id).sort())||JSON.stringify([...result.e5c.final.flowEdgeIds].sort())!==JSON.stringify([...beforeState.flowEdgeIds].sort()))errors.push('final flow topology did not return to initial state');result.e5c.fitAfter=fitBounds(result.e5c.final);if(!result.e5c.fitAfter.valid)errors.push('final Fit Graph does not contain all measured node bounds');
    result.valid=errors.length===0;result.errors=errors;
    result.panelDebug=await frame.evaluate(()=>((window as any).__CODEGRAPH_WEBVIEW_DEBUG__?.entries??[]).slice(-200));
    result.reactProfile=await frame.evaluate(()=>({commits:(window as any).__p12e2React??null,conversions:(window as any).__p12e2Conversions??null,state:(window as any).__p12e3State??null,selections:(window as any).__p12e2.selections}));
    fs.writeFileSync(path.join(out,'interaction.json'),JSON.stringify(result,null,2));
    console.log(JSON.stringify({phase:'interaction-complete',results:result.phases.map((p:any)=>({phase:p.phase,frames:p.frames?.length,longtasks:p.longtasks?.length,domNodes:p.domNodes,domEdges:p.domEdges,latencies:p.latencies?.slice(-1),unavailable:p.unavailable})),minimum}));
    expect(aborted).toBe(false);
    expect(errors, 'invalid interaction phases').toEqual([]);
  } finally {
    clearInterval(monitor); fs.writeFileSync(path.join(out, "memory-summary.json"), JSON.stringify({before,minimum,aborted}, null, 2));
    if (session) await closeVSCode(session);
    if (aborted) throw Error("Stopped: available physical memory below 800 MiB");
  }
});
