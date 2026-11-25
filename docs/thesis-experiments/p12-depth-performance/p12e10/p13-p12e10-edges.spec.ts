// Functional check of low-detail edges on the synthetic fixture: thresholds, restore, real wheel/button/Fit zoom, export.
import { test, expect } from "@playwright/test";
import * as fs from "node:fs"; import * as os from "node:os"; import * as path from "node:path";
import { launchVSCode, closeVSCode, quickOpenFile } from "./lib/vscode"; import { openCogicPanel } from "./lib/cogic";
const out = process.env.P12C2_OUTPUT!, cond = process.env.P12E6_COND!; const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
test("P12-E10 low-detail edges", async () => {
  test.setTimeout(600_000); const before = Math.round(os.freemem() / 1048576); if (before < 2200) throw Error("preflight memory " + before);
  let minimum = before, aborted = false, session: any; const R: any = { cond, zooms: [], errors: [] };
  const mon = setInterval(() => { const f = Math.round(os.freemem() / 1048576); minimum = Math.min(minimum, f); if (f < 800 && !aborted) { aborted = true; if (session) void session.app.close(); } }, 250);
  try {
    session = await launchVSCode({ profile: process.env.RUN_ID!, extensions: ["cogic"], extraSettings: {} }); const page = session.page;
    await quickOpenFile(page, "src/main.ts"); const frame = await openCogicPanel(page); await expect(frame.locator(".projectPicker")).toContainText("main.ts", { timeout: 60_000 });
    await frame.locator('select[aria-label="Graph depth"]').selectOption("2"); await expect.poll(() => frame.locator(".react-flow__node").count(), { timeout: 120_000 }).toBeGreaterThan(2); await sleep(4000);
    await frame.evaluate(() => { const w = window as any; w.__toggles = 0; let p = document.querySelector(".canvasFlow")!.classList.contains("canvasFlow--lowDetailEdges"); new MutationObserver(() => { const n = document.querySelector(".canvasFlow")!.classList.contains("canvasFlow--lowDetailEdges"); if (n !== p) { w.__toggles++; p = n; } }).observe(document.querySelector(".canvasFlow")!, { attributes: true, attributeFilter: ["class"] }); });
    const st = () => frame.evaluate(() => { const P = [...document.querySelectorAll(".react-flow__edges .react-flow__edge-path")]; const d: any = {}; for (const p of P) { const k = getComputedStyle(p).strokeDasharray; d[k] = (d[k] ?? 0) + 1; } const i = (window as any).__p12e5c.instance(); return { zoom: i.getZoom(), low: document.querySelector(".canvasFlow")!.classList.contains("canvasFlow--lowDetailEdges"), paths: P.length, visible: P.filter(p => getComputedStyle(p).visibility !== "hidden").length, dash: d, animatedEdges: document.querySelectorAll(".react-flow__edge.animated").length, marker: P.filter(p => p.getAttribute("marker-end")).length, flowNodes: i.getNodes().length, flowEdges: i.getEdges().length, toggles: (window as any).__toggles }; });
    const set = (z: number) => frame.evaluate(z => { const i = (window as any).__p12e5c.instance(); const p = document.querySelector(".react-flow__pane")!.getBoundingClientRect(); const ns = i.getNodes(), n = ns.find((q: any) => /^function:/.test(q.id) && q.positionAbsolute) ?? ns[0]; i.setViewport({ x: p.width / 2 - (n.positionAbsolute.x + n.width / 2) * z, y: p.height / 2 - (n.positionAbsolute.y + n.height / 2) * z, zoom: z }, { duration: 0 }); }, z);
    // Threshold walk. Expected low-detail: enter <=0.2, leave >=0.25.
    const walk: [number, boolean][] = [[1, false], [0.3, false], [0.22, false], [0.2, true], [0.22, true], [0.249, true], [0.25, false], [0.22, false], [0.201, false], [0.1, true], [0.24, true], [1, false], [0.1, true]];
    for (const [z, low] of walk) { await set(z); await sleep(400); const s = await st(); R.zooms.push({ z, expect: low, ...s }); if (cond === "B" && s.low !== low) R.errors.push(`zoom ${z} low ${s.low}`); if (cond === "A" && s.low) R.errors.push("A low"); if (s.visible !== s.paths) R.errors.push("hidden edges at " + z); const dashed = s.paths - (s.dash["none"] ?? 0); if (cond === "B" && low && dashed) R.errors.push(`dashed at ${z}`); if (cond === "B" && !low && z >= 1 && !dashed) R.errors.push(`no dash at ${z}`); }
    // Hover around the boundary: must not flap.
    const t0 = (await st()).toggles; await set(0.1); for (let i = 0; i < 10; i++) { await set(i % 2 ? 0.199 : 0.24); await sleep(60); } R.hoverToggles = (await st()).toggles - t0; if (R.hoverToggles > 0) R.errors.push("flap " + R.hoverToggles);
    // Real controls.
    const wheel = async (dir: number, n: number) => { const b = await frame.locator(".react-flow__pane").boundingBox(); await page.mouse.move(b!.x + 260, b!.y + 200); for (let i = 0; i < n; i++) { await page.mouse.wheel(0, dir * 100); await sleep(60); } await sleep(500); };
    await set(1); await sleep(400); const w0 = (await st()).toggles; await wheel(1, 20); R.wheelOut = await st(); await wheel(-1, 20); R.wheelIn = await st(); R.wheelToggles = R.wheelIn.toggles - w0;
    for (let i = 0; i < 6; i++) { await frame.locator('button[title="Zoom out"]').click({ delay: 30 }); await sleep(250); } R.buttonOut = await st(); for (let i = 0; i < 4; i++) { await frame.locator('button[title="Zoom in"]').click({ delay: 30 }); await sleep(250); } R.buttonIn = await st();
    await frame.locator('button[title="Fit Graph"]').click({ delay: 60 }); await sleep(1500); R.fit = await st();
    for (const [n, s] of Object.entries({ wheelOut: R.wheelOut, wheelIn: R.wheelIn, buttonOut: R.buttonOut, buttonIn: R.buttonIn, fit: R.fit }) as any) if (cond === "B" && ((s.zoom <= 0.2 && !s.low) || (s.zoom >= 0.25 && s.low))) R.errors.push(`${n} ${s.zoom} low ${s.low}`);
    // SVG export while zoomed out.
    const file = path.join(out, "export.svg"); await session.app.evaluate(({ dialog }: any, f: string) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: f }); }, file);
    await set(0.1); await sleep(500); R.beforeExport = await st(); R.exportSeen = []; await frame.locator('button[title*="xport" i]').first().click({ delay: 60 }); await frame.locator(".exportMenuItem", { hasText: "SVG" }).click({ delay: 60 });
    for (let i = 0; i < 400 && !fs.existsSync(file); i++) await sleep(150); await sleep(2500); R.afterExport = await st();
    if (!fs.existsSync(file)) R.errors.push("no export file"); else { const t = fs.readFileSync(file, "utf8"); R.export = { bytes: t.length, dashed: (t.match(/stroke-dasharray:\s*\d/g) ?? []).length, d86: (t.match(/stroke-dasharray:\s*8px,?\s*6px/g) ?? []).length, d66: (t.match(/stroke-dasharray:\s*6px,?\s*6px/g) ?? []).length, edgePaths: (t.match(/react-flow__edge-path/g) ?? []).length }; if (!R.export.dashed) R.errors.push("export lost dashes"); }
    if (cond === "B" && !R.afterExport.low) R.errors.push("low detail not restored after export");
    await page.screenshot({ path: path.join(out, "end.png") });
  } finally { clearInterval(mon); R.memory = { before, minimum, aborted }; fs.writeFileSync(path.join(out, "edges.json"), JSON.stringify(R, null, 1)); if (session) await closeVSCode(session); }
  expect(R.errors).toEqual([]);
});
