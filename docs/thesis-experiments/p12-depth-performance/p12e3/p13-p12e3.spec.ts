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
    await expect(frame.locator(".projectPicker")).toContainText(process.env.P12E2_FIXTURE === "1" ? "main.ts" : "index.ts", { timeout: 60_000 });
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
    const fixture=process.env.P12E2_FIXTURE === "1";
    expect(prepSummary.nodes).toBe(fixture ? 10 : 1078); expect(prepSummary.edges).toBe(fixture ? 11 : 3755);
    expect(prepSummary.sha256).toBe(fixture ? "56f6e1fea2c0579ace421c4c358e3fd3b2ae491ce37fad5a13918ec1b38b6af2" : "baf0b1c591a5ad4af4f0fb5c1a947b3124d220acd1fded6e50d00e6ee9117049");
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
      const tick=(t:number)=>{if(r.active)r.frames.push(t);requestAnimationFrame(tick)};requestAnimationFrame(tick);
      return {support,visibility:document.visibilityState, dpr:devicePixelRatio};
    });
    const begin = async (phase:string) => { await frame.evaluate(phase=>{ const r=(window as any).__p12e2;r.phase=phase;r.frames=[];r.longtasks=[];r.loaf=[];r.pointer=[];r.start=performance.now();r.active=true; },phase); };
    const finish = async (phase:string) => { await sleep(150); return frame.evaluate(phase=>{const r=(window as any).__p12e2;r.active=false;return {phase,start:r.start,end:performance.now(),frames:r.frames,longtasks:r.longtasks,loaf:r.loaf,pointer:r.pointer,domNodes:document.querySelectorAll('.react-flow__node').length,domEdges:document.querySelectorAll('.react-flow__edge').length,viewport:document.querySelector('.react-flow__viewport')?.getAttribute('style')};},phase); };
    const animationState=await frame.evaluate(()=>{const paths=[...document.querySelectorAll('.react-flow__edge-path')];const names:Record<string,number>={};for(const p of paths){const v=getComputedStyle(p).animationName;names[v]=(names[v]??0)+1;}return {pathCount:paths.length,names};});
    const result:any = {setup,variant,animationState,graph:prepSummary,phases:[]};
    if(process.env.P12E2_REACT_ONLY === "1"){
      for(let i=0;i<3;i++){
        const item=frame.locator('.cgChildNode--interactive:visible').nth(i);if(!await item.count())break;
        await frame.evaluate(()=>{ const r=(window as any).__p12e2;const el=document.querySelector('.inspectorBody')!;const section=()=>el.textContent?.split('SELECTED NODE')[1]?.split('SELECTION')[0]??'';const prev=section();const handler=(e:Event)=>{if((e.target as Element).closest('.cgChildNode--interactive')){const click=performance.now();document.removeEventListener('click',handler,true);const ob=new MutationObserver(()=>{if(section()!==prev){r.selections.push({click,inspector:performance.now(),deltaMs:performance.now()-click});ob.disconnect();}});ob.observe(el,{subtree:true,childList:true,characterData:true});setTimeout(()=>ob.disconnect(),5000);}};document.addEventListener('click',handler,true);});
        await begin('selection-'+i); const t=await frame.evaluate(()=>performance.now());await item.click({delay:80,timeout:10000});await sleep(450);
        result.phases.push({...await finish('selection-'+i),automationClickStart:t});
      }
      result.reactProfile=await frame.evaluate(()=>({commits:(window as any).__p12e2React??null,conversions:(window as any).__p12e2Conversions??null,state:(window as any).__p12e3State??null,selections:(window as any).__p12e2.selections}));
      fs.writeFileSync(path.join(out,'interaction.json'),JSON.stringify(result,null,2));
      console.log(JSON.stringify({phase:'react-only-complete',selections:result.phases.length,reactCommits:result.reactProfile.commits?.length,conversions:result.reactProfile.conversions?.length,minimum}));
      expect(aborted).toBe(false);return;
    }

    const pane=frame.locator('.react-flow__pane'); const box=await pane.boundingBox(); if(!box)throw Error('no pane');
    const pt=await pane.evaluate(el=>{const r=el.getBoundingClientRect();for(let y=25;y<r.height-100;y+=20)for(let x=25;x<r.width-120;x+=20)if(document.elementFromPoint(r.left+x,r.top+y)===el && document.elementFromPoint(r.left+x+80,r.top+y+55)===el)return{x,y};return null;});
    if(!pt)throw Error('no unobstructed pan point');
    const point={x:box.x+pt.x,y:box.y+pt.y};
    const beforePan=await frame.locator('.react-flow__viewport').getAttribute('style');
    await begin('pan'); await session.page.mouse.move(point.x,point.y); await session.page.mouse.down();
    const panStart=performance.now(); for(let i=1;i<=80;i++){const target=panStart+i*62.5;await session.page.mouse.move(point.x+80*Math.sin(i*Math.PI/20),point.y+55*Math.sin(i*Math.PI/20));await sleep(Math.max(0,target-performance.now()));} await session.page.mouse.up();
    const pan=await finish('pan');result.phases.push({...pan,beforePan,expectedInputPath:'four oscillations; synthetic Playwright mouse'});
    fs.writeFileSync(path.join(out,'interaction-partial.json'),JSON.stringify(result,null,2));
    await sleep(700);
    await begin('zoom');
    const zoomCounts:any[]=[]; for(let i=0;i<8;i++){await frame.locator(`button[title="${i%2===0?'Zoom in':'Zoom out'}"]`).click({delay:40});await sleep(120);zoomCounts.push(await frame.evaluate(()=>({nodes:document.querySelectorAll('.react-flow__node').length,edges:document.querySelectorAll('.react-flow__edge').length,animations:document.getAnimations().filter(a=>(a.effect as KeyframeEffect)?.target instanceof Element && ((a.effect as KeyframeEffect).target as Element).classList.contains('react-flow__edge-path')).length})));}
    result.phases.push({...await finish('zoom'),zoomCounts}); await sleep(700);
    const selectionResults:any[]=[];
    for(let i=0;i<4;i++){
      const item=frame.locator('.cgChildNode--interactive:visible').nth(i); if(!await item.count())break;
      const name=(await item.innerText()).replace(/\s+/g,' ').slice(0,100);
      await frame.evaluate(()=>{ const w=window as any;const r=w.__p12e2;const el=document.querySelector('.inspectorBody')!; const section=()=>el.textContent?.split('SELECTED NODE')[1]?.split('SELECTION')[0]??''; const prev=section();r.selectionPending={prev,click:0};const handler=(e:Event)=>{if((e.target as Element).closest('.cgChildNode--interactive')){r.selectionPending.click=performance.now();document.removeEventListener('click',handler,true);}};document.addEventListener('click',handler,true);const ob=new MutationObserver(()=>{const p=r.selectionPending;if(p?.click && section()!==p.prev){r.selections.push({click:p.click,inspector:performance.now(),deltaMs:performance.now()-p.click});ob.disconnect();}});ob.observe(el,{subtree:true,childList:true,characterData:true});setTimeout(()=>ob.disconnect(),5000);});
      await begin('selection-'+i); await item.click({delay:80,timeout:10000}); await sleep(450); const measure=await finish('selection-'+i); selectionResults.push({...measure,name,latencies:await frame.evaluate(()=> (window as any).__p12e2.selections)});
    }
    result.phases.push(...selectionResults); fs.writeFileSync(path.join(out,'interaction-partial.json'),JSON.stringify(result,null,2)); await sleep(500);
    await frame.locator('button[title="Fit Graph"]').click({delay:80}); await sleep(800);
    for(const type of ['file','folder']){
      const selector=type==='file'?'button[title="Select and collapse file group"]':'button[title="Collapse folder group"]';
      const target=await frame.evaluate(selector=>{
        const pane=document.querySelector('.react-flow__pane')!.getBoundingClientRect();
        for(const [i,el] of [...document.querySelectorAll(selector)].entries()){
          const r=el.getBoundingClientRect(); const left=Math.max(r.left,pane.left),right=Math.min(r.right,pane.right),top=Math.max(r.top,pane.top),bottom=Math.min(r.bottom,pane.bottom);
          if(right-left<4 || bottom-top<4)continue;
          for(let y=top+2;y<bottom-2;y+=8)for(let x=left+2;x<right-2;x+=8)if(document.elementFromPoint(x,y)?.closest('button')===el)return {i,x:x-pane.left,y:y-pane.top};
        }return null;
      },selector);
      if(!target){result.phases.push({phase:type+'-collapse',unavailable:'no unobstructed header point'});continue;}
      try {
        await begin(type+'-collapse');const t=performance.now();await session.page.mouse.click(box.x+target.x,box.y+target.y,{delay:80});await sleep(1200);const phase=await finish(type+'-collapse');result.phases.push({...phase,automationElapsedMs:performance.now()-t,target});
        const expand=frame.locator(type==='file'?'button[title="Select and expand file group"]':'button[title="Expand folder group"]').nth(target.i);
        if(await expand.count()){await begin(type+'-expand');const t2=performance.now();await expand.click({delay:80,timeout:3000});await sleep(1200);result.phases.push({...await finish(type+'-expand'),automationElapsedMs:performance.now()-t2});}
      } catch(e) { result.phases.push({phase:type+'-collapse-error',error:String(e)}); await frame.evaluate(()=>{(window as any).__p12e2.active=false;}); }
    }
    await begin('fit'); const fitBefore=await frame.locator('.react-flow__viewport').getAttribute('style');await frame.locator('button[title="Fit Graph"]').click({delay:80});await sleep(700);const fit=await finish('fit');result.phases.push({...fit,fitBefore});
    result.panelDebug=await frame.evaluate(()=>((window as any).__CODEGRAPH_WEBVIEW_DEBUG__?.entries??[]).slice(-200));
    result.reactProfile=await frame.evaluate(()=>({commits:(window as any).__p12e2React??null,conversions:(window as any).__p12e2Conversions??null,state:(window as any).__p12e3State??null,selections:(window as any).__p12e2.selections}));
    fs.writeFileSync(path.join(out,'interaction.json'),JSON.stringify(result,null,2));
    console.log(JSON.stringify({phase:'interaction-complete',results:result.phases.map((p:any)=>({phase:p.phase,frames:p.frames?.length,longtasks:p.longtasks?.length,domNodes:p.domNodes,domEdges:p.domEdges,latencies:p.latencies?.slice(-1),unavailable:p.unavailable})),minimum}));
    expect(aborted).toBe(false);
  } finally {
    clearInterval(monitor); fs.writeFileSync(path.join(out, "memory-summary.json"), JSON.stringify({before,minimum,aborted}, null, 2));
    if (session) await closeVSCode(session);
    if (aborted) throw Error("Stopped: available physical memory below 800 MiB");
  }
});
