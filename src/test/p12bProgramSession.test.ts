import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  analyzeWorkspaceActive,
  analyzeWorkspaceDepth,
  clearAnalyzerCaches,
  createAnalysisSession,
  invalidateAnalyzerFileCaches,
} from "../analyzer";

type ProgramEvent = {
  activeFile: string;
  oldProgram: boolean;
  structureReuse: string;
  reusedSourceFiles: number;
  session: boolean;
  sessionStopReason: string | null;
};

const FILES: Record<string, string> = {
  "main.ts": [
    'import { parse } from "./parser";',
    'import { Store } from "./store";',
    'import { format } from "./util";',
    "export function run(input: string): string {",
    "  const value = parse(input);",
    "  const store = new Store();",
    "  store.add(value);",
    '  return format(store.total(), "pt");',
    "}",
    "",
  ].join("\n"),
  "parser.ts": [
    'import { trim } from "./util";',
    "export function parse(text: string): number {",
    "  return Number(trim(text));",
    "}",
    "",
  ].join("\n"),
  "store.ts": [
    "class Logger {",
    "  log(value: number): void { console.log(value); }",
    "}",
    "export class Store {",
    "  private items: number[] = [];",
    "  private readonly logger: Logger = new Logger();",
    "  add(value: number): void {",
    "    this.push(value);",
    "    this.logger.log(value);",
    "  }",
    "  private push(value: number): void { this.items.push(value); }",
    "  total(): number { return this.items.reduce((a, b) => a + b, 0); }",
    "}",
    "",
  ].join("\n"),
  "util.ts": [
    "export function trim(text: string): string { return text.trim(); }",
    "export function format(value: number, unit: string): string { return `${value}${unit}`; }",
    "",
  ].join("\n"),
};

function makeWorkspace(withTsconfig: boolean) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cogic-p12b-"));
  for (const [name, text] of Object.entries(FILES)) {
    fs.writeFileSync(path.join(root, name), text);
  }
  if (withTsconfig) {
    fs.writeFileSync(
      path.join(root, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { target: "ES2022", module: "commonjs", strict: true }, include: ["*.ts"] }),
    );
  }
  const filePaths = Object.keys(FILES).map((name) => path.join(root, name));
  return { root, filePaths, file: (name: string) => path.join(root, name) };
}

type Workspace = ReturnType<typeof makeWorkspace>;

function collectEvents() {
  const programs: ProgramEvent[] = [];
  const debug = (event: string, detail?: Record<string, unknown>) => {
    if (event === "analyzer.program.created") {programs.push(detail as unknown as ProgramEvent);}
  };
  return { programs, debug };
}

async function depth(
  ws: Workspace,
  options: { programSession: boolean; code?: string; graphDepth?: number; cacheEnabled?: boolean; readFile?: (f: string) => Promise<string> },
) {
  const events = collectEvents();
  const main = ws.file("main.ts");
  const result = await analyzeWorkspaceDepth({
    code: options.code ?? fs.readFileSync(main, "utf8"),
    fileName: main,
    languageId: "typescript",
    traceMode: false,
    graphDepth: options.graphDepth ?? 2,
    traceScope: "current-depth",
    workspaceRoot: ws.root,
    filePaths: ws.filePaths,
    cacheEnabled: options.cacheEnabled ?? true,
    readFile: options.readFile ?? (async (f) => fs.readFileSync(f, "utf8")),
    debug: events.debug,
    programSession: options.programSession,
  });
  return { result, programs: events.programs };
}

function analyzeOne(ws: Workspace, name: string, session?: ReturnType<typeof createAnalysisSession>, cacheEnabled = true) {
  const events = collectEvents();
  const fileName = ws.file(name);
  const result = analyzeWorkspaceActive({
    active: { code: fs.readFileSync(fileName, "utf8"), fileName, languageId: "typescript" },
    workspaceRoot: ws.root,
    filePaths: ws.filePaths,
    cacheEnabled,
    debug: events.debug,
    session,
  });
  return { result, program: events.programs[0] };
}

const graphJson = (r: { graph?: unknown }) => JSON.stringify(r.graph);

for (const withTsconfig of [false, true]) {
  suite(`P12-B Program session (${withTsconfig ? "tsconfig" : "no tsconfig"})`, function () {
    this.timeout(120_000);
    let ws: Workspace;
    setup(() => {
      clearAnalyzerCaches();
      ws = makeWorkspace(withTsconfig);
    });
    teardown(() => fs.rmSync(ws.root, { recursive: true, force: true }));

    test("Depth 2 with a session builds the same graph as without one, and reuses Program structure", async () => {
      const off = await depth(ws, { programSession: false });
      clearAnalyzerCaches();
      const on = await depth(ws, { programSession: true });

      assert.ok((off.result.graph?.nodes.length ?? 0) > 0);
      assert.strictEqual(graphJson(on.result), graphJson(off.result));
      assert.deepStrictEqual(on.result.calls, off.result.calls);
      assert.deepStrictEqual(on.result.diagnostics, off.result.diagnostics);

      // main + three frontier files (parser, store, util)
      assert.strictEqual(on.programs.length, 4);
      assert.ok(off.programs.every((p) => !p.session && !p.oldProgram));
      assert.strictEqual(on.programs[0].oldProgram, false);
      for (const program of on.programs.slice(1)) {
        assert.strictEqual(program.oldProgram, true);
        assert.ok(["completely", "safeModules"].includes(program.structureReuse), program.structureReuse);
        assert.ok(program.reusedSourceFiles > 0);
      }
    });

    test("cross-file calls, arguments and class member ownership survive the session", async () => {
      const on = await depth(ws, { programSession: true });
      const edges = on.result.graph?.edges ?? [];
      const has = (fragment: RegExp) => edges.some((e) => fragment.test(`${e.source} -> ${e.target} ${e.label ?? ""}`));
      assert.ok(has(/main\.ts.*-> .*parser\.ts/i), "run -> parse");
      assert.ok(has(/parser\.ts.*-> .*util\.ts/i), "parse -> trim (expanded file)");
      assert.ok(has(/store\.ts.*-> .*store\.ts/i), "Store.add -> Store.push / Logger.log (expanded file)");
      assert.ok(edges.some((e) => e.kind === "dataflow"), "argument dataflow edges");
    });

    test("an unsaved active buffer is analyzed, and the session result equals the non-session result", async () => {
      const code = `${FILES["main.ts"]}export function extra(): string { return format(1, "u"); }\n`;
      const off = await depth(ws, { programSession: false, code });
      const on = await depth(ws, { programSession: true, code });
      assert.strictEqual(graphJson(on.result), graphJson(off.result));
      assert.ok((on.result.graph?.nodes ?? []).some((n) => n.name.startsWith("extra")));
      assert.ok(!fs.readFileSync(ws.file("main.ts"), "utf8").includes("extra"));
    });

    test("Depth 0 and 1 do not create a session", async () => {
      for (const graphDepth of [0, 1]) {
        const off = await depth(ws, { programSession: false, graphDepth });
        const on = await depth(ws, { programSession: true, graphDepth });
        assert.strictEqual(graphJson(on.result), graphJson(off.result));
        assert.ok(on.programs.every((p) => !p.session));
      }
    });

    test("the analysis cache setting off disables the session", async () => {
      const off = await depth(ws, { programSession: false, cacheEnabled: false });
      const on = await depth(ws, { programSession: true, cacheEnabled: false });
      assert.strictEqual(graphJson(on.result), graphJson(off.result));
      assert.ok(on.programs.every((p) => !p.session && !p.oldProgram));
    });

    test("an unreadable expansion target is skipped the same way with and without a session", async () => {
      const readFile = async (f: string) => {
        if (f.endsWith("store.ts")) {throw new Error("EACCES");}
        return fs.readFileSync(f, "utf8");
      };
      const off = await depth(ws, { programSession: false, readFile });
      const on = await depth(ws, { programSession: true, readFile });
      assert.strictEqual(graphJson(on.result), graphJson(off.result));
      // a later run still works and still reuses structure
      const again = await depth(ws, { programSession: true });
      assert.ok(again.programs.slice(1).every((p) => p.oldProgram));
    });

    test("a same-size edit that keeps the mtime is not reused once the file is invalidated", () => {
      const util = ws.file("util.ts");
      const pinned = new Date(Date.UTC(2026, 0, 1)); // whole seconds, so the mtime can be restored exactly
      fs.utimesSync(util, pinned, pinned);
      const session = createAnalysisSession();
      try {
        analyzeOne(ws, "main.ts", session);
        const before = fs.statSync(util);
        const edited = FILES["util.ts"].replace(
          "trim(text: string): string { return text.trim(); }",
          "trim(texx: string): string { return texx.trim(); }",
        );
        assert.notStrictEqual(edited, FILES["util.ts"]);
        assert.strictEqual(edited.length, FILES["util.ts"].length);
        fs.writeFileSync(util, edited);
        fs.utimesSync(util, pinned, pinned);
        assert.strictEqual(fs.statSync(util).mtimeMs, before.mtimeMs);
        assert.strictEqual(fs.statSync(util).size, before.size);

        invalidateAnalyzerFileCaches([util]); // what the panel's watcher / save handler does
        const withSession = analyzeOne(ws, "parser.ts", session);
        const fresh = analyzeOne(ws, "parser.ts", undefined, false);
        assert.strictEqual(graphJson(withSession.result), graphJson(fresh.result));
        assert.ok(graphJson(withSession.result).includes("texx"), "the edited signature is visible");
        assert.strictEqual(withSession.program.oldProgram, true);
        assert.strictEqual(session.isReusable, true, "a served file's invalidation only excludes that file");
      } finally {
        session.dispose();
      }
    });

    test("a size change is detected without an invalidation event", () => {
      const session = createAnalysisSession();
      try {
        analyzeOne(ws, "main.ts", session);
        fs.appendFileSync(ws.file("util.ts"), "export function shout(text: string): string { return text.toUpperCase(); }\n");
        fs.appendFileSync(ws.file("parser.ts"), 'import { shout } from "./util";\nexport const loud = shout("a");\n');
        const withSession = analyzeOne(ws, "parser.ts", session);
        const fresh = analyzeOne(ws, "parser.ts", undefined, false);
        assert.strictEqual(graphJson(withSession.result), graphJson(fresh.result));
        assert.ok((withSession.result.graph?.nodes ?? []).some((n) => /shout/.test(n.name)));
      } finally {
        session.dispose();
      }
    });

    test("a created source file stops structure reuse for the rest of the session", () => {
      const session = createAnalysisSession();
      try {
        analyzeOne(ws, "main.ts", session);
        const created = ws.file("added.ts");
        fs.writeFileSync(created, "export const added = 1;\n");
        invalidateAnalyzerFileCaches([created]);
        assert.strictEqual(session.isReusable, false);
        assert.strictEqual(session.stopReason, "unknown-file-invalidated");
        const next = analyzeOne(ws, "parser.ts", session);
        assert.strictEqual(next.program.oldProgram, false);
        assert.strictEqual(graphJson(next.result), graphJson(analyzeOne(ws, "parser.ts", undefined, false).result));
      } finally {
        session.dispose();
      }
    });

    test("changed root names or compiler options are never reused", () => {
      const session = createAnalysisSession();
      try {
        analyzeOne(ws, "main.ts", session);
        if (withTsconfig) {
          fs.writeFileSync(
            ws.file("tsconfig.json"),
            JSON.stringify({ compilerOptions: { target: "ES2022", module: "commonjs", strict: false }, include: ["*.ts"] }),
          );
        } else {
          fs.writeFileSync(ws.file("extra.ts"), "export const extra = 1;\n");
          ws.filePaths.push(ws.file("extra.ts"));
        }
        const next = analyzeOne(ws, "parser.ts", session);
        assert.strictEqual(next.program.oldProgram, false);
        assert.strictEqual(graphJson(next.result), graphJson(analyzeOne(ws, "parser.ts", undefined, false).result));
      } finally {
        session.dispose();
      }
    });

    test("clearAnalyzerCaches and dispose end reuse; a disposed session falls back safely", () => {
      const session = createAnalysisSession();
      analyzeOne(ws, "main.ts", session);
      clearAnalyzerCaches();
      assert.strictEqual(session.stopReason, "caches-cleared");
      assert.strictEqual(analyzeOne(ws, "parser.ts", session).program.oldProgram, false);

      const second = createAnalysisSession();
      analyzeOne(ws, "main.ts", second);
      second.dispose();
      assert.strictEqual(second.isReusable, false);
      const after = analyzeOne(ws, "parser.ts", second);
      assert.strictEqual(after.program.oldProgram, false);
      assert.strictEqual(graphJson(after.result), graphJson(analyzeOne(ws, "parser.ts", undefined, false).result));
      session.dispose();
    });

    test("switching to another project inside one session does not reuse the other Program", () => {
      const other = makeWorkspace(withTsconfig);
      const session = createAnalysisSession();
      try {
        analyzeOne(ws, "main.ts", session);
        const switched = analyzeOne(other, "parser.ts", session);
        assert.strictEqual(switched.program.oldProgram, false);
        assert.strictEqual(graphJson(switched.result), graphJson(analyzeOne(other, "parser.ts", undefined, false).result));
      } finally {
        session.dispose();
        fs.rmSync(other.root, { recursive: true, force: true });
      }
    });
  });
}
