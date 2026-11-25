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
    const wc=()=>frame.evaluate(()=>Object.fromEntries(['renderer','viewport','edges','nodes'].map(k=>{const e=document.querySelector('.react-flow__'+k);const c=e?getComputedStyle(e):null;return [k,c?{willChange:c.willChange,transform:c.transform,backface:c.backfaceVisibility}:null];})));
    const earlyStyle=await wc();
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
    // E5D separates Fit classification from interaction validity.
    await frame.evaluate(()=>{(window as any).__e5dClicks=[];document.addEventListener('click',e=>{const t=e.target as Element;(window as any).__e5dClicks.push({time:performance.now(),trusted:e.isTrusted,tag:t.tagName,button:t.closest('button')?.getAttribute('title')??null,group:(t.closest('.react-flow__node') as HTMLElement|null)?.dataset.id??null});},true);});
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
          for(let y=top+2;y<bottom-1;y+=5)for(let x=left+2;x<right-1;x+=5){const found=document.elementFromPoint(x,y);if(found&&(found===el||el.contains(found)))return {x,y,relative:{x:x-r.left,y:y-r.top},id:group?.dataset.id??null,text:(el.textContent??'').trim().slice(0,100),title:el.getAttribute('title')};}
        }return null;
      },{selector,groupId});
    }
    async function clickTarget(selector:string, groupId?:string){
      for(let n=0;n<16;n++){
        const target=await hit(selector,groupId);
        if(target){await sleep(200);const again=await hit(selector,groupId);if(!again || again.id!==target.id || Math.abs(again.x-target.x)>2 || Math.abs(again.y-target.y)>2){await sleep(150);continue;}const outer=await frame.locator('.react-flow').boundingBox();const inner=await frame.locator('.react-flow').evaluate(e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y};});if(!outer)throw Error('canvas unavailable');const beforeClicks=await frame.evaluate(()=>(window as any).__e5dClicks.length);result.e5dClickTrace??=[];result.e5dClickTrace.push({attempt:again,beforeClicks});await session!.page.mouse.click(outer.x+again.x-inner.x,outer.y+again.y-inner.y,{delay:45});const actual=await frame.evaluate(n=>(window as any).__e5dClicks.slice(n),beforeClicks);result.e5dClickTrace.push({target:again,actual});if(!actual.some((v:any)=>v.trusted && v.group===again.id && v.button===again.title)){await sleep(350);continue;}return {...again,actual};}
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
      catch(e){await frame.evaluate(()=>{(window as any).__p12e2.active=false;}).catch(()=>{});result.phases.push({phase:name,valid:false,error:String(e),clickTrace:await frame.evaluate(()=>(window as any).__e5dClicks).catch(()=>null),diagnostic:await frame.evaluate(id=>{const b=(window as any).__p12e5c,n=b?.nodes.find((q:any)=>q.id===id),dom=[...document.querySelectorAll('.react-flow__node')].find(q=>(q as HTMLElement).dataset.id===id),button=dom?.querySelector('button'),r=button?.getBoundingClientRect(),pane=document.querySelector('.react-flow__pane')?.getBoundingClientRect(),at=r?document.elementFromPoint(r.x+r.width/2,r.y+r.height/2):null;return {id,modelFound:!!n,collapsed:n?.data?.collapsed??null,domMounted:!!dom,buttonPresent:!!button,buttonTitle:button?.title??null,rect:r?{x:r.x,y:r.y,width:r.width,height:r.height}:null,pane:pane?{x:pane.x,y:pane.y,width:pane.width,height:pane.height}:null,centerHit:at?.outerHTML.slice(0,500)??null,activeAnimations:document.getAnimations().filter(a=>a.playState==='running').length,viewport:b?.instance()?.getViewport()??null};},result.e5dActiveGroup??null).catch(()=>null)});errors.push(name+': '+String(e));}
      save();
    }
    // Scheduled gap between pan inputs; identical in both arms. 125 is the recorded Single protocol.
    const panStepMs=Number(process.env.P12E5D_PAN_STEP_MS??125);if(!(panStepMs>=50&&panStepMs<=2000))throw Error('invalid P12E5D_PAN_STEP_MS');
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
    const waitViewportStable=async()=>{const start=performance.now(),samples:any[]=[];let prev='',same=0;for(let i=0;i<40;i++){const v=await frame.evaluate(()=>(window as any).__p12e5c?.instance()?.getViewport());const sig=JSON.stringify(v);samples.push({elapsed:performance.now()-start,viewport:v});same=sig===prev?same+1:0;prev=sig;if(same>=3)return {durationMs:performance.now()-start,consecutive:4,samples};await sleep(150);}throw Error('viewport did not stabilize after Fit within 6s');};
    const e5dBeforeFit=await snapshot();await frame.locator('button[title="Fit Graph"]').click();const initialFitStability=await waitViewportStable();
    const setupStability=await waitLayoutStable();const beforeState=await snapshot();
    fs.writeFileSync(path.join(out,'e5c-before.json'),JSON.stringify({desired,...beforeState},null,2));
    const alpha=beforeState.nodes.filter((n:any)=>n.id.startsWith('function:'+workspace+'/src/alpha/a.ts:')).length;
    const beta=beforeState.nodes.filter((n:any)=>n.id.startsWith('function:'+workspace+'/src/beta/b.ts:')).length;
    if(desired==='single' && alpha!==60)throw Error('single group did not expose 60 functions: '+alpha);
    if(desired==='multiple' && (alpha!==60||beta!==60))throw Error('multiple groups not exposed: '+alpha+'/'+beta);
    if(desired==='collapsed' && (alpha||beta))throw Error('collapsed state includes child functions');
    const fitBounds=(v:any)=>{const usable=v.instanceNodes.filter((n:any)=>n.positionAbsolute && Number.isFinite(n.width) && Number.isFinite(n.height));if(usable.length!==v.instanceNodes.length)return {valid:false,reason:'missing measured node bounds',measured:usable.length,total:v.instanceNodes.length};const minX=Math.min(...usable.map((n:any)=>n.positionAbsolute.x)),maxX=Math.max(...usable.map((n:any)=>n.positionAbsolute.x+n.width)),minY=Math.min(...usable.map((n:any)=>n.positionAbsolute.y)),maxY=Math.max(...usable.map((n:any)=>n.positionAbsolute.y+n.height));const q=v.viewport;const screen={left:q.x+q.zoom*minX,right:q.x+q.zoom*maxX,top:q.y+q.zoom*minY,bottom:q.y+q.zoom*maxY};const tolerance=2;return {valid:screen.left>=-tolerance&&screen.top>=-tolerance&&screen.right<=v.pane.width+tolerance&&screen.bottom<=v.pane.height+tolerance,screen,world:{minX,maxX,minY,maxY},pane:v.pane,viewport:q};};
    const classifyFit=(bounds:any)=>{if(bounds.valid)return 'FIT_CONTAINS_ALL';if(!bounds.world)return 'FIT_MEASUREMENTS_MISSING';const w=bounds.world.maxX-bounds.world.minX,h=bounds.world.maxY-bounds.world.minY;const maxFullZoom=Math.min(bounds.pane.width/w,bounds.pane.height/h);return bounds.viewport.zoom<=0.10001 && maxFullZoom<0.1?'FIT_CLAMPED_BY_MIN_ZOOM':'FIT_OUT_OF_BOUNDS_UNCLASSIFIED';};
    result.e5c={desired,alpha,beta,setupStability,initialFitStability,before:beforeState,viewportBeforeFit:e5dBeforeFit.viewport,fitBefore:fitBounds(beforeState)};
    result.e5c.fitBefore.classification=classifyFit(result.e5c.fitBefore);if(result.e5c.fitBefore.world)result.e5c.fitBefore.maxFullZoom=Math.min(beforeState.pane.width/(result.e5c.fitBefore.world.maxX-result.e5c.fitBefore.world.minX),beforeState.pane.height/(result.e5c.fitBefore.world.maxY-result.e5c.fitBefore.world.minY));
    if(!result.e5c.fitBefore.world)errors.push('fit bounds unavailable');
    // Identical warm-up across arms; avoid comparing a cold first drag against a warm one.
    const cond=process.env.P12E6_COND??'';if(!cond)throw Error('P12E6_COND');const expectWc=JSON.parse(process.env.P12E6_EXPECT_WC??'null');if(!expectWc)throw Error('P12E6_EXPECT_WC');
    await sleep(2500);result.e6Setup={cond,earlyStyle,style:await wc()};
    for(const k of Object.keys(expectWc)){const c=(result.e6Setup.style as any)[k];if(c?.willChange!==expectWc[k]||c.backface!=='hidden')throw Error('unexpected computed style '+k+' '+JSON.stringify(c));}
    const warmBox=await pane.boundingBox();if(!warmBox)throw Error('warm-up pane missing');
    const warmPoint=await pane.evaluate(el=>{const r=el.getBoundingClientRect();for(let y=25;y<r.height-100;y+=20)for(let x=25;x<r.width-120;x+=20)if(document.elementFromPoint(r.left+x,r.top+y)===el)return{x,y};return null;});
    if(!warmPoint)throw Error('no warm-up hit-testable pane');
    const warmBefore=await frame.locator('.react-flow__viewport').getAttribute('style');await session!.page.mouse.move(warmBox.x+warmPoint.x,warmBox.y+warmPoint.y);await session!.page.mouse.down();await session!.page.mouse.move(warmBox.x+warmPoint.x+260,warmBox.y+warmPoint.y,{steps:8});await session!.page.mouse.move(warmBox.x+warmPoint.x,warmBox.y+warmPoint.y,{steps:8});await session!.page.mouse.up();await sleep(700);
    const warmAfter=await frame.locator('.react-flow__viewport').getAttribute('style');result.e5c.warmup={before:warmBefore,after:warmAfter};if(warmBefore!==warmAfter)throw Error('warm-up did not restore starting viewport');
    // ---- E5E: node<->webview clock anchors. Offset estimate = midpoint of the minimum-RTT exchange.
    const anchors=async(label:string)=>{const list:any[]=[];for(let i=0;i<15;i++){const n0=performance.now();const w=await frame.evaluate(m=>{const t=performance.now();performance.mark(m);return t;},'e5e-'+label+'-'+i);const n1=performance.now();list.push({n0,w,n1,mark:'e5e-'+label+'-'+i});await sleep(20);}const best=[...list].sort((a,b)=>(a.n1-a.n0)-(b.n1-b.n0))[0];return {list,offsetWebMinusNode:best.w-(best.n0+best.n1)/2,uncertaintyMs:(best.n1-best.n0)/2,bestMark:best.mark};};
    await frame.evaluate(()=>{const w=window as any;const l=w.__e5e={on:false,ev:[],style:[],dom:[],raf:[]};
      for(const type of ['pointermove','mousemove','mouseup'])window.addEventListener(type,(e:any)=>{if(l.on)l.ev.push({type,ts:e.timeStamp,now:performance.now(),x:e.clientX,y:e.clientY,coalesced:e.getCoalescedEvents?.().length??null,target:(e.target as Element).className?.toString().slice(0,40)});},true);
      new MutationObserver(()=>{if(l.on)l.style.push({now:performance.now(),style:document.querySelector('.react-flow__viewport')!.getAttribute('style')});}).observe(document.querySelector('.react-flow__viewport')!,{attributes:true,attributeFilter:['style']});
      new MutationObserver(rs=>{if(!l.on)return;let an=0,rn=0,ae=0,re=0;for(const m of rs)for(const [list,add] of [[m.addedNodes,true],[m.removedNodes,false]] as const)for(const n of list)if(n instanceof Element){const a=(n.matches('.react-flow__node')?1:0)+n.querySelectorAll('.react-flow__node').length,b=(n.matches('.react-flow__edge')?1:0)+n.querySelectorAll('.react-flow__edge').length;if(add){an+=a;ae+=b;}else{rn+=a;re+=b;}}if(an||rn||ae||re)l.dom.push({now:performance.now(),an,rn,ae,re});}).observe(document.querySelector('.react-flow')!,{childList:true,subtree:true});
      const tick=(t:number)=>{if(l.on)l.raf.push({t,now:performance.now()});requestAnimationFrame(tick);};requestAnimationFrame(tick);});
    const cpuTimes=()=>os.cpus().reduce((a,c)=>{const t=Object.values(c.times).reduce((x,y)=>x+y,0);return{total:a.total+t,idle:a.idle+c.times.idle};},{total:0,idle:0});
    const metrics=()=>session!.app.evaluate(({app})=>app.getAppMetrics().map(m=>({pid:m.pid,type:m.type,name:m.name,cpuSeconds:(m.cpu as any).cumulativeCPUUsage??null,percent:m.cpu.percentCPUUsage})));
    // E5F path: same +-280/+-55 CSS px sine as E5D/E5E, but the press point is moved so every move stays inside the iframe.
    const pathPoint=await pane.evaluate(el=>{const r=el.getBoundingClientRect();const c:any[]=[];for(let y=70;y<r.height-70;y+=6)for(let x=4;x<r.width-4;x+=6){const cx=r.left+x,cy=r.top+y;if(cx-280<6||cx+280>innerWidth-6||cy-55<6||cy+55>innerHeight-6)continue;if(document.elementFromPoint(cx,cy)===el)c.push({x,y,cx,cy,d:Math.abs(cx-innerWidth/2)});}c.sort((a,b)=>a.d-b.d||a.y-b.y);return c[0]?{...c[0],innerWidth,innerHeight}:null;});
    if(!pathPoint)throw Error('no in-frame pan point for E5F path');
        const edgeState=()=>frame.evaluate(()=>({style:!!document.getElementById('e5g-suppress'),svgs:document.querySelectorAll('.react-flow__edges').length,groups:document.querySelectorAll('.react-flow__edge').length,visiblePaths:[...document.querySelectorAll('.react-flow__edges path')].filter(p=>getComputedStyle(p).visibility!=='hidden').length,edgeLabels:document.querySelectorAll('.react-flow__edgelabel-renderer > *').length,domNodes:[...document.querySelectorAll('.react-flow__node')].map(e=>(e as HTMLElement).dataset.id).sort(),visibleNodeDescendants:[...document.querySelectorAll('.react-flow__nodes *')].filter(p=>getComputedStyle(p).visibility!=='hidden').length,nodesHidden:[...document.querySelectorAll('.react-flow__node')].filter(p=>getComputedStyle(p).visibility==='hidden').length}));
    const categories=['toplevel','toplevel.flow','base','ipc','mojom','blink','blink.user_timing','blink_gc','cc','viz','gpu','gpu.angle','input','benchmark','latencyInfo','loading','renderer.scheduler','sequence_manager','scheduler','ui','v8','views','devtools.timeline','devtools.timeline.frame','devtools.timeline.invalidationTracking','disabled-by-default-devtools.timeline','disabled-by-default-devtools.timeline.frame','disabled-by-default-gpu.service','disabled-by-default-cc.debug.scheduler'];
    // LayerTree is enabled only outside traced pans. Walk up to the frame that owns the CDP target (OOPIF root).
    async function layerMap(label:string){
      const tried:string[]=[];let target:any=frame;
      while(target){try{const cdp=await session!.page.context().newCDPSession(target);let layers:any[]=[];cdp.on('LayerTree.layerTreeDidChange',(e:any)=>{if(e.layers)layers=e.layers;});await cdp.send('DOM.enable');await cdp.send('DOM.getDocument',{depth:0});await cdp.send('LayerTree.enable');
        // Force one commit without touching graph content so the event fires.
        await frame.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(0)))));for(let i=0;i<20&&!layers.length;i++)await sleep(100);
        const rows:any[]=[];for(const l of layers){let node:any=null,reasons:any=null;if(l.backendNodeId){try{const d:any=await cdp.send('DOM.describeNode',{backendNodeId:l.backendNodeId});const a=d.node.attributes??[];const at=(n:string)=>{const i=a.indexOf(n);return i%2===0?a[i+1]:null;};node={name:d.node.nodeName,class:at('class'),id:at('id'),dataId:at('data-id')};}catch(e){node={error:String(e).slice(0,80)};}}
          try{reasons=((await cdp.send('LayerTree.compositingReasons',{layerId:l.layerId})) as any).compositingReasonIds;}catch{}
          rows.push({layerId:l.layerId,parent:l.parentLayerId??null,w:l.width,h:l.height,drawsContent:l.drawsContent,paintCount:l.paintCount,node,reasons});}
        await cdp.send('LayerTree.disable');await cdp.send('DOM.disable');await cdp.detach();if(rows.length)return {label,frameUrl:target.url().slice(0,60),tried,layers:rows};tried.push('empty '+target.url().slice(0,40));}catch(e){tried.push(String(e).slice(0,120));}
        target=target.parentFrame?.();}
      return {label,tried,layers:[]};
    }
    async function e5fPan(index:number,cond:string){
      const label='p'+index+cond;
      await sleep(2500);const snapBefore=await snapshot();const edgesBefore=await edgeState();
      const tracePath=path.join(out,'trace-'+label+'.json');const free0=Math.round(os.freemem()/1048576);
      await session!.app.evaluate(async({contentTracing},cats)=>{await contentTracing.startRecording({recording_mode:'record-until-full',trace_buffer_size_in_kb:300*1024,included_categories:cats,excluded_categories:['*'],enable_argument_filter:false} as any);},categories);
      await sleep(1500);check();
      const box=await pane.boundingBox();if(!box)throw Error('pane missing');const x=box.x+pathPoint!.x,y=box.y+pathPoint!.y;const before=await frame.locator('.react-flow__viewport').getAttribute('style');
      const a0=await anchors(label+'-pre');const m0=await metrics(),c0=cpuTimes();
      await session!.page.mouse.move(x,y);await session!.page.mouse.down();await frame.evaluate(()=>{const l=(window as any).__e5e;l.on=true;l.ev=[];l.style=[];l.dom=[];l.raf=[];performance.mark('e5e-pan-start');});
      const start=performance.now();const steps:any[]=[];
      for(let i=1;i<=40;i++){const callStart=performance.now();const px=x+280*Math.sin(i*Math.PI/10),py=y+55*Math.sin(i*Math.PI/10);await session!.page.mouse.move(px,py);steps.push({i,scheduled:start+(i-1)*panStepMs,callStart,callEnd:performance.now(),px,py});await sleep(Math.max(0,start+i*panStepMs-performance.now()));}
      const end=performance.now();await session!.page.mouse.up();
      const web=await frame.evaluate(()=>{performance.mark('e5e-pan-end');const l=(window as any).__e5e;l.on=false;return {end:performance.now(),ev:l.ev,style:l.style,dom:l.dom,raf:l.raf};});
      const c1=cpuTimes(),m1=await metrics();const a1=await anchors(label+'-post');
      const bufferUsage=await session!.app.evaluate(({contentTracing})=>contentTracing.getTraceBufferUsage());
      await session!.app.evaluate(async({contentTracing},f)=>contentTracing.stopRecording(f),tracePath);const free1=Math.round(os.freemem()/1048576);check();
      await sleep(700);const after=await frame.locator('.react-flow__viewport').getAttribute('style');const edgesAfter=await edgeState();
      await sleep(1500);const snapAfter=await snapshot();const edgesRestored=await edgeState();
      const ids=(v:any)=>JSON.stringify([v.nodes.map((n:any)=>[n.id,n.collapsed]).sort(),[...v.flowEdgeIds].sort(),v.graphNodes,v.graphEdges]);
      const checks={viewportRestored:before===after,topologySame:ids(snapBefore)===ids(snapAfter),topologyIsStart:ids(snapBefore)===ids(beforeState),startViewport:snapBefore.viewport,allDelivered:web.ev.filter((e:any)=>e.type==='pointermove').length===40,suppressed:edgesBefore.nodesHidden===edgesBefore.domNodes.length&&edgesBefore.visibleNodeDescendants===0,edgesVisible:edgesBefore.visiblePaths>0,nodesRestored:edgesRestored.nodesHidden===0,noneHiddenInA:edgesBefore.nodesHidden===0,edgeVisibleAfterRestore:edgesRestored.visiblePaths,edgesBefore:{...edgesBefore,domNodes:edgesBefore.domNodes.length},domNodesSame:JSON.stringify(edgesBefore.domNodes)===JSON.stringify(edgesAfter.domNodes)&&JSON.stringify(edgesBefore.domNodes)===JSON.stringify(edgesRestored.domNodes),startDomNodes:edgesBefore.domNodes};
      if(!checks.viewportRestored||!checks.topologySame||!checks.topologyIsStart||!checks.allDelivered||!checks.domNodesSame||!checks.edgesVisible||!checks.nodesRestored||!checks.noneHiddenInA||checks.suppressed||!(checks.edgeVisibleAfterRestore>0))errors.push('E6 check failed '+label+' '+JSON.stringify({...checks,startDomNodes:undefined}));
      return {label,index,cond,panStepMs,pathPoint,box,start,end,steps,web,anchorsPre:a0,anchorsPost:a1,before,after,checks,bufferUsage,free:[free0,free1],cpu:{busyFraction:1-(c1.idle-c0.idle)/(c1.total-c0.total)},metricsBefore:m0,metricsAfter:m1};
    }
    await phase('pan',async()=>{
      const box=await pane.boundingBox();if(!box)throw Error('pane missing');
      const p=await pane.evaluate(el=>{const r=el.getBoundingClientRect();for(let y=25;y<r.height-100;y+=20)for(let x=25;x<r.width-120;x+=20)if(document.elementFromPoint(r.left+x,r.top+y)===el && document.elementFromPoint(r.left+x+80,r.top+y+55)===el)return{x,y};return null;});
      if(!p)throw Error('no unobstructed pan point');const before=await frame.locator('.react-flow__viewport').getAttribute('style');
      const x=box.x+p.x,y=box.y+p.y;await session!.page.mouse.move(x,y);await session!.page.mouse.down();const start=performance.now();let intermediate='';const viewportSamples:any[]=[];
      for(let i=1;i<=40;i++){await session!.page.mouse.move(x+280*Math.sin(i*Math.PI/10),y+55*Math.sin(i*Math.PI/10));if(i%5===0){const v=await frame.locator('.react-flow__viewport').getAttribute('style')??'';viewportSamples.push({step:i,elapsed:performance.now()-start,style:v});if(i===5)intermediate=v;}await sleep(Math.max(0,start+i*panStepMs-performance.now()));}await session!.page.mouse.up();if(intermediate===before)throw Error('viewport did not move');return {before,intermediate,viewportSamples,panStepMs,expectedDisplacementCssPx:280};
    });
    result.e5h={cond,setup:result.e6Setup,pathPoint,pans:[await e5fPan(1,cond)]};save();
    // ---- Zoom block: wheel and toolbar zoom from the Fit viewport, in one separate trace.
    const instVp=()=>frame.evaluate(()=>(window as any).__p12e5c.instance().getViewport());
    const zoomTrace=path.join(out,'trace-zoom.json');
    await session.app.evaluate(async({contentTracing},cats)=>{await contentTracing.startRecording({recording_mode:'record-until-full',trace_buffer_size_in_kb:300*1024,included_categories:cats,excluded_categories:['*'],enable_argument_filter:false} as any);},categories);await sleep(1200);check();
    const pbz=await pane.boundingBox();if(!pbz)throw Error('zoom pane');await session.page.mouse.move(pbz.x+pathPoint.x,pbz.y+pathPoint.y);await sleep(200);
    const wheelRun=async(dir:number)=>{const before=await instVp();await frame.evaluate(d=>performance.mark('e6-'+d+'-start'),dir<0?'wheelin':'wheelout');const t0=performance.now();const late:number[]=[];for(let i=0;i<26;i++){late.push(performance.now()-t0-i*60);await session!.page.mouse.wheel(0,dir*100);await sleep(Math.max(0,t0+(i+1)*60-performance.now()));}const sent=performance.now()-t0;await sleep(700);await frame.evaluate(d=>performance.mark('e6-'+d+'-end'),dir<0?'wheelin':'wheelout');return {before,after:await instVp(),sentMs:sent,plannedMs:26*60,lateMax:Math.max(...late)};};
    await phase('wheel-in',()=>wheelRun(-1));await phase('wheel-out',()=>wheelRun(1));
    await frame.evaluate(v=>(window as any).__p12e5c.instance().setViewport(v,{duration:0}),beforeState.viewport);await sleep(1500);
    await phase('button-zoom',async()=>{const before=await instVp();await frame.evaluate(()=>performance.mark('e6-button-start'));const t0=performance.now();for(let i=0;i<8;i++){await frame.locator('button[title="Zoom in"]').click({delay:30});await sleep(Math.max(0,t0+(i+1)*300-performance.now()));}const peak=await instVp();for(let i=0;i<8;i++){await frame.locator('button[title="Zoom out"]').click({delay:30});await sleep(Math.max(0,t0+(9+i)*300-performance.now()));}const sentMs=performance.now()-t0;await sleep(600);await frame.evaluate(()=>performance.mark('e6-button-end'));return {before,peak,after:await instVp(),sentMs,plannedMs:4800};});
    await frame.evaluate(()=>{const i=(window as any).__p12e5c.instance();i.setViewport({x:0,y:0,zoom:1},{duration:0});});await sleep(800);
    await phase('animated-fit',async()=>{const before=await instVp();await frame.evaluate(()=>performance.mark('e6-fit-start'));await frame.locator('button[title="Fit Graph"]').click({delay:45});const st=await waitViewportStable();await frame.evaluate(()=>performance.mark('e6-fit-end'));return {before,after:await instVp(),stableMs:st.durationMs};});
    await session.app.evaluate(async({contentTracing},f)=>contentTracing.stopRecording(f),zoomTrace);check();
    await frame.evaluate(v=>(window as any).__p12e5c.instance().setViewport(v,{duration:0}),beforeState.viewport);await sleep(1500);
    // Screenshots for sharpness at 0.1 (whole canvas), 1 and 2 (one fixed node).
    const shots:any[]=[];const target=idFor('function','alpha/a.ts:1452');await session.page.mouse.move(5,5);
    for(const z of [0.1,1,2]){await frame.evaluate(({id,z,v})=>{const inst=(window as any).__p12e5c.instance();if(z<0.5){inst.setViewport(v,{duration:0});return;}const n=inst.getNodes().find((q:any)=>q.id===id),p=document.querySelector('.react-flow__pane')!.getBoundingClientRect();inst.setViewport({x:p.width/2-(n.positionAbsolute.x+n.width/2)*z,y:p.height/2-(n.positionAbsolute.y+n.height/2)*z,zoom:z},{duration:0});},{id:target,z,v:beforeState.viewport});
      const pb=await pane.boundingBox();const t0=performance.now();for(const wait of [300,2000]){await sleep(Math.max(0,t0+wait-performance.now()));const file='zoom'+z+'-'+wait+'ms.png';await session.page.screenshot({path:path.join(out,file),clip:{x:pb!.x,y:pb!.y,width:pb!.width,height:pb!.height}});shots.push({z,wait,file,viewport:await instVp()});}}
    await frame.evaluate(v=>(window as any).__p12e5c.instance().setViewport(v,{duration:0}),beforeState.viewport);await sleep(1500);
    result.e5h.shots=shots;result.e5h.layersAfter=await layerMap('post');result.e5h.styleFinal=await wc();save();
    result.e5c.afterPan=await snapshot();
    if(JSON.stringify(result.e5c.afterPan.nodes.map((n:any)=>n.id).sort())!==JSON.stringify(beforeState.nodes.map((n:any)=>n.id).sort())||JSON.stringify([...result.e5c.afterPan.flowEdgeIds].sort())!==JSON.stringify([...beforeState.flowEdgeIds].sort()))errors.push('flow topology changed during pan');
    await phase('zoom',async()=>{const before=await frame.locator('.react-flow__viewport').getAttribute('style');await frame.locator('button[title="Zoom in"]').click();await sleep(350);const after=await frame.locator('.react-flow__viewport').getAttribute('style');if(before===after)throw Error('zoom did not change viewport');await frame.locator('button[title="Zoom out"]').click();return {before,after};});
    await phase('selection',async()=>{
      await frame.evaluate(()=>{const r=(window as any).__p12e2;const el=document.querySelector('.inspectorBody');if(!el)throw Error('inspector missing');const section=()=>el.textContent?.split('SELECTED NODE')[1]?.split('SELECTION')[0]??'';const prev=section();r.selectionPending={prev,click:0};const handler=(e:Event)=>{if((e.target as Element).closest('.cgChildNode--interactive, .cgNode')){r.selectionPending.click=performance.now();document.removeEventListener('click',handler,true);}};document.addEventListener('click',handler,true);const ob=new MutationObserver(()=>{const p=r.selectionPending;if(p?.click&&section()!==p.prev){r.selections.push({click:p.click,inspector:performance.now(),deltaMs:performance.now()-p.click,text:section().trim().slice(0,200)});ob.disconnect();}});ob.observe(el,{subtree:true,childList:true,characterData:true});setTimeout(()=>ob.disconnect(),6000);});
      const target=await clickTarget('.cgChildNode--interactive, .cgNode');await expect.poll(()=>frame.evaluate(()=>(window as any).__p12e2.selections.length),{timeout:5000}).toBeGreaterThan(0);const sample=await frame.evaluate(()=>(window as any).__p12e2.selections.at(-1));const name=target.text.split(/\(|\s/)[0];if(!name || !sample.text.includes(name))throw Error('Inspector does not match selected node '+name);return {target,selection:sample};
    });
    await frame.locator('button[title="Fit Graph"]').click();result.e5c.beforeGroupsFitStability=await waitViewportStable();await sleep(350);
    for(const type of ['file','folder']){
      const collapse=type==='file'?'button[title="Select and collapse file group"]':'button[title="Collapse folder group"]';
      const expand=type==='file'?'button[title="Select and expand file group"]':'button[title="Expand folder group"]';
      let groupId:string|undefined;
      await phase(type+'-collapse',async()=>{const intended=desired==='single'||desired==='multiple'?(type==='file'?idFor('file','alpha/a.ts:0'):idFor('folder','alpha')):undefined;const target=await clickTarget(collapse,intended);if(!target.id)throw Error('group ID absent');groupId=target.id;result.e5dActiveGroup=groupId;await expect.poll(()=>frame.evaluate(id=>(window as any).__p12e5c?.nodes.find((n:any)=>n.id===id)?.data?.collapsed,groupId),{timeout:5000}).toBe(true);return {target,groupId};});
      await phase(type+'-expand',async()=>{if(!groupId)throw Error('collapse did not identify group');const target=await clickTarget(expand,groupId);await expect.poll(()=>frame.evaluate(id=>(window as any).__p12e5c?.nodes.find((n:any)=>n.id===id)?.data?.collapsed,groupId),{timeout:5000}).toBe(false);return {target,groupId};});
    }
    await frame.locator('button[title="Zoom in"]').click();await sleep(300);
    await phase('fit',async()=>{const before=await frame.locator('.react-flow__viewport').getAttribute('style');await frame.locator('button[title="Fit Graph"]').click();const fitStability=await waitViewportStable();const after=await frame.locator('.react-flow__viewport').getAttribute('style');if(!after)throw Error('viewport absent');return {before,after,fitStability};});
    result.e5c.final=await snapshot();if(JSON.stringify(result.e5c.final.nodes.map((n:any)=>n.id).sort())!==JSON.stringify(beforeState.nodes.map((n:any)=>n.id).sort())||JSON.stringify([...result.e5c.final.flowEdgeIds].sort())!==JSON.stringify([...beforeState.flowEdgeIds].sort()))errors.push('final flow topology did not return to initial state');result.e5c.fitAfter=fitBounds(result.e5c.final);result.e5c.fitAfter.classification=classifyFit(result.e5c.fitAfter);if(!result.e5c.fitAfter.world)errors.push('final fit bounds unavailable');
    result.fitCorrectness={before:result.e5c.fitBefore,after:result.e5c.fitAfter};
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
