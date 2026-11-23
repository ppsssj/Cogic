import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { analyzeTypeScriptWithTypes, analyzeWithWorkspace, clearAnalyzerCaches } from "../analyzer/analyze";

suite("P14 call ownership", function () {
  this.timeout(20_000);

  function edges(code: string) {
    const result = analyzeTypeScriptWithTypes({ code, fileName: "p14.ts", languageId: "typescript", cacheEnabled: false });
    const nodes = new Map(result.graph.nodes.map((n) => [n.id, n]));
    return {
      result,
      rows: result.graph.edges.map((e) => ({ kind: e.kind, from: nodes.get(e.source)?.name, to: nodes.get(e.target)?.name, label: e.label ?? "", id: e.id })),
    };
  }

  test("resolves typed fields and distinct private owners without inventing reference calls", () => {
    const { result, rows } = edges(`
function target(x: number) { return x; }
class A {
  fetch: (x: number) => number = (x) => this.#dispatch(x);
  request = (x: number) => this.fetch(x);
  #dispatch(x: number) { return target(x); }
  static #twice(x: number) { return target(x); }
  static run(x: number) { return A.#twice(x); }
  optional?: (x: number) => number = (x) => x;
  optionalRun() { return this.optional?.(1); }
  value = 1;
  invalid() { return this.value(); }
  reference() { return this.fetch; }
}
class B { #dispatch(x: number) { return target(x); } run(x: number) { return this.#dispatch(x); } }
`);
    const has = (kind: string, from: string, to: string) => rows.some((e) => e.kind === kind && e.from === from && e.to === to);
    for (const [from, to] of [["A.request", "A.fetch"], ["A.fetch", "A.#dispatch"], ["A.#dispatch", "target"], ["A.run", "A.#twice"], ["A.#twice", "target"], ["B.run", "B.#dispatch"], ["B.#dispatch", "target"]]) {
      assert.ok(has("calls", from, to), `${from} -> ${to}`);
      assert.ok(has("dataflow", from, to), `dataflow ${from} -> ${to}`);
    }
    assert.ok(!has("calls", "A.reference", "A.fetch"));
    assert.ok(has("calls", "A.optionalRun", "A.optional"));
    assert.ok(!rows.some((e) => e.kind === "calls" && e.from === "A.invalid"));
    assert.ok(!has("calls", "p14.ts", "target"));
    assert.equal(result.graph.nodes.filter((n) => n.name === "A.#dispatch").length, 1);
    assert.equal(result.graph.nodes.filter((n) => n.name === "B.#dispatch").length, 1);
    assert.equal(new Set(result.graph.edges.map((e) => e.id)).size, result.graph.edges.length);
  });

  test("keeps selected parameter names, indices and excludes uncertain spread positions", () => {
    const { rows } = edges(`
class Example {
  fetch: (x: number, optional?: number, third?: number) => number = (x, optional = 2, third = 3) => x + optional + third;
  normal = (x: number) => this.fetch(x, 4);
  spread = (tail: number[]) => this.fetch(1, ...tail);
  only = (tail: number[]) => this.fetch(...tail);
  tuple = (pair: [number, number]) => this.fetch(...pair);
  uncertainTuple = (pair: [number, number?]) => this.fetch(...pair);
  rest = (...values: number[]) => values.length;
  invoke = () => this.rest(1, 2, 3);
  forward = (values: number[]) => this.rest(...values);
}
`);
    const flows = (from: string, to: string) => rows.filter((e) => e.kind === "dataflow" && e.from === from && e.to === to);
    const normal = flows("Example.normal", "Example.fetch");
    assert.deepStrictEqual(normal.map((e) => [e.label, /arg#(\d+)$/.exec(e.id)?.[1]]).sort(), [["optional <- 4", "1"], ["x <- x", "0"]]);
    assert.deepStrictEqual(flows("Example.spread", "Example.fetch").map((e) => e.label), ["x <- 1"]);
    assert.equal(flows("Example.only", "Example.fetch").length, 0);
    assert.deepStrictEqual(flows("Example.tuple", "Example.fetch").map((e) => [e.label, /arg#(\d+)$/.exec(e.id)?.[1]]).sort(), [["optional <- pair[1]", "1"], ["x <- pair[0]", "0"]]);
    assert.equal(flows("Example.uncertainTuple", "Example.fetch").length, 0);
    assert.deepStrictEqual(flows("Example.invoke", "Example.rest").map((e) => e.label), ["...values <- 1"]);
    assert.deepStrictEqual(flows("Example.forward", "Example.rest").map((e) => e.label), ["...values <- ...values"]);
  });

  test("preserves ordinary methods, super calls, overloads and rejects non-function fields", () => {
    const { rows } = edges(`
function f(x: number): number;
function f(x: string): string;
function f(x: number | string) { return x; }
class Base { method(x: number) { return f(x); } }
class Child extends Base { method(x: number) { return super.method(x); } value = 2; run() { return this.method(1); } }
`);
    const calls = rows.filter((e) => e.kind === "calls");
    assert.ok(calls.some((e) => e.from === "Child.method" && e.to === "Base.method"));
    assert.ok(calls.some((e) => e.from === "Child.run" && e.to === "Child.method"));
    assert.ok(!calls.some((e) => e.to === "Child.value"));
  });

  test("workspace imports remain external and cache on/off graphs match", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "p14-owner-"));
    try {
      const active = path.join(root, "main.ts"), other = path.join(root, "other.ts");
      const code = `import { helper } from './other'; class A { f: (n:number)=>number = n => helper(n); g = (n:number) => this.f(n); }`;
      fs.writeFileSync(active, code); fs.writeFileSync(other, "export function helper(n: number) { return n; }");
      const args = { active: { code, fileName: active, languageId: "typescript" }, workspaceRoot: root, filePaths: [active, other] };
      clearAnalyzerCaches(); const off = analyzeWithWorkspace({ ...args, cacheEnabled: false });
      clearAnalyzerCaches(); const cold = analyzeWithWorkspace({ ...args, cacheEnabled: true });
      const warm = analyzeWithWorkspace({ ...args, cacheEnabled: true });
      const canonical = (r: typeof off) => JSON.stringify({ nodes: [...r.graph.nodes].sort((a, b) => a.id.localeCompare(b.id)), edges: [...r.graph.edges].sort((a, b) => a.id.localeCompare(b.id)) });
      assert.equal(canonical(off), canonical(cold)); assert.equal(canonical(cold), canonical(warm));
      assert.ok(off.graph.nodes.some((n) => n.kind === "external" && /helper/.test(n.name) && normalize(n.file) === normalize(other)));
      assert.ok(!off.graph.nodes.some((n) => n.kind === "function" && normalize(n.file) === normalize(other)));
    } finally { clearAnalyzerCaches(); fs.rmSync(root, { recursive: true, force: true }); }
  });
});

function normalize(file: string | undefined) { return (file ?? "").replace(/\\/g, "/").toLowerCase(); }
