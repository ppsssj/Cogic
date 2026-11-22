import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { analyzeWorkspaceActive, clearAnalyzerCaches, getAnalyzerCacheStats } from "../analyzer";

/** Workspace with an entry file importing `count` modules (more than the 800-entry base capacity). */
function makeWorkspace(count: number) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cogic-sfcache-"));
  const imports: string[] = [];
  const calls: string[] = [];
  for (let i = 0; i < count; i++) {
    fs.writeFileSync(path.join(root, `m${i}.ts`), `export function f${i}(x: number): number { return x + ${i}; }\n`);
    imports.push(`import { f${i} } from "./m${i}";`);
    calls.push(`  t += f${i}(${i});`);
  }
  const entry = path.join(root, "entry.ts");
  const code = `${imports.join("\n")}\nexport function run(): number {\n  let t = 0;\n${calls.join("\n")}\n  return t;\n}\n`;
  fs.writeFileSync(entry, code);
  const filePaths = [...Array(count).keys()].map((i) => path.join(root, `m${i}.ts`)).concat(entry);
  return { root, entry, code, filePaths };
}

function analyze(ws: ReturnType<typeof makeWorkspace>, code: string, cacheEnabled: boolean) {
  const events: Record<string, number> = {};
  const result = analyzeWorkspaceActive({
    active: { code, fileName: ws.entry, languageId: "typescript" },
    workspaceRoot: ws.root,
    filePaths: ws.filePaths,
    cacheEnabled,
    debug: (event) => { events[event] = (events[event] ?? 0) + 1; },
  });
  return { result, events };
}

const graphKey = (r: ReturnType<typeof analyzeWorkspaceActive>) =>
  JSON.stringify({
    n: (r.graph?.nodes ?? []).map((n) => n.id).sort(),
    e: (r.graph?.edges ?? []).map((e) => `${e.source}>${e.target}:${e.kind}`).sort(),
  });

suite("Analyzer SourceFile cache policy", function () {
  this.timeout(120_000);
  const ws = makeWorkspace(900);
  suiteTeardown(() => fs.rmSync(ws.root, { recursive: true, force: true }));
  setup(() => clearAnalyzerCaches());

  test("a working set larger than 800 files is reused on the next edit (no LRU thrash)", () => {
    analyze(ws, ws.code, true);
    const second = analyze(ws, `${ws.code}\nexport const edited = 1;\n`, true);
    assert.strictEqual(second.events["analyzer.sourceFileCache.miss"] ?? 0, 0);
    assert.ok((second.events["analyzer.sourceFileCache.hit"] ?? 0) >= 900);
    assert.ok(getAnalyzerCacheStats().capacity >= 900 + 1);
  });

  test("cached analysis produces the same graph as uncached analysis", () => {
    const edited = `${ws.code}\nexport const edited = 2;\n`;
    const off = analyze(ws, edited, false).result;
    analyze(ws, ws.code, true);
    const on = analyze(ws, edited, true).result;
    assert.strictEqual(graphKey(on), graphKey(off));
  });

  test("a changed file on disk is not served from the cache", () => {
    analyze(ws, ws.code, true);
    const target = path.join(ws.root, "m0.ts");
    const original = fs.readFileSync(target, "utf8");
    try {
      fs.writeFileSync(target, `${original}export function extra0(): number { return 0; }\n`);
      const later = new Date(Date.now() + 5_000);
      fs.utimesSync(target, later, later);
      const { events } = analyze(ws, ws.code, true);
      assert.ok((events["analyzer.sourceFileCache.stale"] ?? 0) >= 1);
    } finally {
      fs.writeFileSync(target, original);
    }
  });
});
