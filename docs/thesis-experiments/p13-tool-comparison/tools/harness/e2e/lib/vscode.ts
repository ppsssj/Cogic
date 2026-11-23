/**
 * Launch helper for driving the real VS Code Desktop UI with Playwright Electron.
 *
 * Isolation:
 *  - Every run uses its own --user-data-dir and --extensions-dir under .e2e-profiles/<profile>.
 *  - Extensions under test are COPIED (read-only source) from the user's ~/.vscode/extensions.
 *    The user's own profile/settings/extensions are never written.
 */
import { _electron as electron, ElectronApplication, Page, Frame } from "@playwright/test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

/** Harness root (this folder). Kept OUTSIDE the analyzed workspace so tools do not index it. */
export const HARNESS_ROOT = path.resolve(__dirname, "..", "..");
/** Workspace under test: the unmodified study project. */
export const PROJECT_ROOT = path.resolve(
  process.env.STUDY_WORKSPACE ?? path.join(HARNESS_ROOT, "..", "Cogic_Workflow_Comparison_Study"),
);
export const PROFILES_ROOT = path.join(HARNESS_ROOT, ".e2e-profiles");

export const EXTENSIONS = {
  cogic: "ppsssj.cogic",
  trace: "sudopanda.trace-function-flow",
  contextGraph: "context-graph.context-graph",
} as const;
export type ExtensionKey = keyof typeof EXTENSIONS;

/** VS Code build used for tests. Same version/commit as the user's install. */
export const VSCODE_TEST_VERSION = process.env.VSCODE_TEST_VERSION ?? "1.146.0";
export const VSCODE_TEST_CACHE = path.join(HARNESS_ROOT, ".vscode-test");

/**
 * Prefers an isolated archive build downloaded by @vscode/test-electron (.vscode-test/).
 * Reason: the user's Inno-Setup install refuses to start a second instance while a
 * background update is pending ("Code is currently being updated"), and we must not
 * touch the user's installation.
 */
export function resolveCodeExe(): string {
  const env = process.env.VSCODE_EXE;
  if (env && fs.existsSync(env)) return env;
  const isolated = path.join(VSCODE_TEST_CACHE, `vscode-win32-x64-archive-${VSCODE_TEST_VERSION}`, "Code.exe");
  if (fs.existsSync(isolated)) return isolated;
  const candidates = [
    path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Microsoft VS Code", "Code.exe"),
    "C:\\Program Files\\Microsoft VS Code\\Code.exe",
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error("VS Code (Code.exe) not found. Set VSCODE_EXE.");
}

export function codeCliVersion(): string {
  // Read product.json of the build actually launched (CLI may be blocked by a pending update).
  const root = path.dirname(resolveCodeExe());
  for (const d of fs.readdirSync(root)) {
    const p = path.join(root, d, "resources", "app", "product.json");
    const p2 = path.join(root, "resources", "app", "product.json");
    for (const f of [p, p2]) {
      if (fs.existsSync(f)) {
        const prod = JSON.parse(fs.readFileSync(f, "utf8"));
        const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(f), "package.json"), "utf8"));
        return `${pkg.version} (commit ${prod.commit}, ${prod.date}) exe=${resolveCodeExe()}`;
      }
    }
  }
  try {
    const cli = path.join(root, "bin", "code.cmd");
    return execFileSync("cmd.exe", ["/c", cli, "--version"], { encoding: "utf8" }).trim().split(/\r?\n/).join(" ");
  } catch {
    return "unknown";
  }
}

function userExtensionsDir(): string {
  return process.env.P4_EXTENSIONS_DIR ?? path.join(os.homedir(), ".vscode", "extensions");
}

/** Finds the installed folder for an extension id (highest version). */
export function findInstalledExtension(id: string): { dir: string; version: string } | undefined {
  const root = userExtensionsDir();
  if (!fs.existsSync(root)) return undefined;
  const matches = fs
    .readdirSync(root)
    .filter((d) => d.toLowerCase().startsWith(id.toLowerCase() + "-"))
    .map((d) => {
      const pkg = JSON.parse(fs.readFileSync(path.join(root, d, "package.json"), "utf8"));
      return { dir: path.join(root, d), version: String(pkg.version) };
    })
    .sort((a, b) => (a.version < b.version ? 1 : -1));
  return matches[0];
}

const TEST_SETTINGS = {
  "workbench.startupEditor": "none",
  "workbench.tips.enabled": false,
  "workbench.enableExperiments": false,
  "workbench.welcomePage.walkthroughs.openOnInstall": false,
  "telemetry.telemetryLevel": "off",
  "update.mode": "none",
  "extensions.autoUpdate": false,
  "extensions.autoCheckUpdates": false,
  "extensions.ignoreRecommendations": true,
  "security.workspace.trust.enabled": false,
  "window.restoreWindows": "none",
  "window.newWindowDimensions": "default",
  "window.commandCenter": false,
  "workbench.secondarySideBar.defaultVisibility": "hidden",
  "git.enabled": false,
  "chat.disableAIFeatures": true,
  "chat.commandCenter.enabled": false,
  "editor.minimap.enabled": false,
  "editor.codeLens": true,
  "files.hotExit": "off",
  "debug.openDebug": "openOnDebugBreak",
  "debug.toolBarLocation": "docked",
  "typescript.tsserver.log": "off",
  "terminal.integrated.defaultProfile.windows": "Command Prompt",
  // Context Graph: keep behavior manual/deterministic.
  "contextGraph.autoOpenPanel": false,
  "contextGraph.autoGenerateOnWorkspaceOpen": false,
  "contextGraph.autoRegenerateOnChange": false,
  // Cogic: avoid cache effects between runs (fresh profile anyway).
  "cogic.analysisCache.enabled": false,
};

export interface LaunchOptions {
  profile: string;
  extensions: ExtensionKey[];
  freshProfile?: boolean;
  extraSettings?: Record<string, unknown>;
  /** Window content size used for every tool so screenshots are comparable. */
  windowSize?: { width: number; height: number };
}

export interface VSCodeSession {
  app: ElectronApplication;
  page: Page;
  profileDir: string;
  extensionVersions: Record<string, string>;
}

export async function launchVSCode(opts: LaunchOptions): Promise<VSCodeSession> {
  const profileDir = path.join(PROFILES_ROOT, opts.profile);
  if (opts.freshProfile !== false && fs.existsSync(profileDir)) {
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
  const userDataDir = path.join(profileDir, "user-data");
  const extensionsDir = path.join(profileDir, "extensions");
  fs.mkdirSync(path.join(userDataDir, "User"), { recursive: true });
  fs.mkdirSync(extensionsDir, { recursive: true });
  fs.writeFileSync(
    path.join(userDataDir, "User", "settings.json"),
    JSON.stringify({ ...TEST_SETTINGS, ...(opts.extraSettings ?? {}) }, null, 2),
  );

  // The study's debug build output (.debug-dist, gitignored) is removed so every tool starts
  // from the same workspace state (Cogic's own exclude list does not cover ".debug-dist").
  const debugDist = path.join(PROJECT_ROOT, ".debug-dist");
  if (fs.existsSync(debugDist)) fs.rmSync(debugDist, { recursive: true, force: true });

  const extensionVersions: Record<string, string> = {};
  for (const key of opts.extensions) {
    const id = EXTENSIONS[key];
    const found = findInstalledExtension(id);
    if (!found) throw new Error(`Extension ${id} not installed in ~/.vscode/extensions`);
    const target = path.join(extensionsDir, path.basename(found.dir));
    if (!fs.existsSync(target)) fs.cpSync(found.dir, target, { recursive: true });
    extensionVersions[id] = found.version;
  }

  const app = await electron.launch({
    executablePath: resolveCodeExe(),
    args: [
      PROJECT_ROOT,
      `--user-data-dir=${userDataDir}`,
      `--extensions-dir=${extensionsDir}`,
      "--disable-workspace-trust",
      "--skip-welcome",
      "--skip-release-notes",
      "--disable-telemetry",
      "--disable-updates",
      "--new-window",
    ],
    env: { ...process.env, VSCODE_SKIP_PRELAUNCH: "1" },
    timeout: 60_000,
  });
  const page = await app.firstWindow({ timeout: 60_000 });
  await page.waitForSelector(".monaco-workbench", { timeout: 60_000 });
  // Wait for the explorer to show the workspace (window is fully restored).
  await page.waitForSelector(".explorer-folders-view, .explorer-viewlet", { timeout: 60_000 }).catch(() => {});
  const size = opts.windowSize ?? { width: 1600, height: 960 };
  await app.evaluate(({ BrowserWindow }, sz) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w.isMaximized()) w.unmaximize();
    w.setBounds({ x: 0, y: 0, width: sz.width, height: sz.height });
  }, size);
  await page.waitForTimeout(800);
  return { app, page, profileDir, extensionVersions };
}

export async function closeVSCode(s: VSCodeSession | undefined): Promise<void> {
  if (!s) return;
  try {
    await s.app.close();
  } catch {
    /* already closed */
  }
}

// ------------------------------------------------------------------ UI helpers

export async function runCommand(page: Page, label: string): Promise<void> {
  await page.keyboard.press("Control+Shift+P");
  const input = page.locator(".quick-input-widget input.input");
  await input.waitFor({ state: "visible" });
  await input.fill(">" + label);
  const row = page.locator(".quick-input-list .monaco-list-row").first();
  await row.waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForTimeout(300);
  await page.keyboard.press("Enter");
  await page.locator(".quick-input-widget").waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
}

export async function quickOpenFile(page: Page, relPath: string): Promise<void> {
  await page.keyboard.press("Control+P");
  const input = page.locator(".quick-input-widget input.input");
  await input.waitFor({ state: "visible" });
  await input.fill(relPath);
  const row = page.locator(".quick-input-list .monaco-list-row", { hasText: path.basename(relPath) }).first();
  await row.waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForTimeout(300);
  await page.keyboard.press("Enter");
  await waitActiveTab(page, path.basename(relPath));
}

export async function waitActiveTab(page: Page, name: string, timeout = 15_000): Promise<void> {
  await page
    .locator(".tabs-container .tab.active", { hasText: name })
    .first()
    .waitFor({ state: "visible", timeout });
}

export async function activeTabName(page: Page): Promise<string> {
  const t = page.locator(".editor-group-container.active .tabs-container .tab.active .label-name").first();
  if ((await t.count()) === 0) return "";
  return (await t.innerText()).trim();
}

/** Reads "Ln X, Col Y" from the status bar. */
export async function cursorPosition(page: Page): Promise<{ line: number; col: number } | undefined> {
  const item = page.locator("#status\\.editor\\.selection");
  if ((await item.count()) === 0) return undefined;
  const text = (await item.innerText()).trim();
  const m = /Ln\s*(\d+),\s*Col\s*(\d+)/.exec(text);
  return m ? { line: Number(m[1]), col: Number(m[2]) } : undefined;
}

export async function waitCursorLine(page: Page, line: number, timeout = 10_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const p = await cursorPosition(page);
    if (p?.line === line) return;
    await page.waitForTimeout(150);
  }
  throw new Error(`cursor did not reach line ${line}; now ${JSON.stringify(await cursorPosition(page))}`);
}

/** Go to symbol in editor (Ctrl+Shift+O) and accept the first match. */
export async function goToSymbol(page: Page, symbol: string): Promise<void> {
  await page.keyboard.press("Control+Shift+O");
  const input = page.locator(".quick-input-widget input.input");
  await input.waitFor({ state: "visible" });
  await input.fill("@" + symbol);
  const row = page.locator(".quick-input-list .monaco-list-row", { hasText: symbol }).first();
  await row.waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(300);
  await page.keyboard.press("Enter");
  await page.locator(".quick-input-widget").waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
}

export async function goToLine(page: Page, line: number, col = 1): Promise<void> {
  await page.keyboard.press("Control+G");
  const input = page.locator(".quick-input-widget input.input");
  await input.waitFor({ state: "visible" });
  await input.fill(`:${line}:${col}`);
  await page.waitForTimeout(200);
  await page.keyboard.press("Enter");
  await waitCursorLine(page, line);
}

/** Focuses the active editor text area. */
export async function focusEditor(page: Page): Promise<void> {
  await runCommand(page, "View: Focus Active Editor Group");
}

/** Waits until the TS language service is ready (hover/symbol provider responds). */
export async function waitTsReady(page: Page, timeout = 60_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    await page.keyboard.press("Control+Shift+O");
    const input = page.locator(".quick-input-widget input.input");
    await input.waitFor({ state: "visible" });
    const rows = page.locator(".quick-input-list .monaco-list-row");
    await page.waitForTimeout(800);
    const n = await rows.count();
    await page.keyboard.press("Escape");
    if (n > 0) return;
    await page.waitForTimeout(1000);
  }
  throw new Error("TypeScript language features did not become ready");
}

/** Waits until the TS server status-bar item no longer reports "Initializing"/loading. */
export async function waitTsServerIdle(page: Page, timeout = 90_000): Promise<void> {
  const start = Date.now();
  await page.waitForTimeout(500);
  while (Date.now() - start < timeout) {
    const txt = await page.locator(".statusbar").innerText().catch(() => "");
    if (!/Initializing|Loading|Starting/i.test(txt)) return;
    await page.waitForTimeout(500);
  }
  throw new Error("TS server still initializing");
}

/** Returns all frames whose URL looks like a VS Code webview content frame. */
export function webviewFrames(page: Page): Frame[] {
  return page.frames().filter((f) => f.url().includes("vscode-webview://") || f.name() === "active-frame");
}

export async function findWebviewFrame(
  page: Page,
  predicate: (f: Frame) => Promise<boolean>,
  timeout = 30_000,
): Promise<Frame> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    for (const f of page.frames()) {
      if (!f.url().startsWith("vscode-webview://")) continue;
      try {
        if (await predicate(f)) return f;
      } catch {
        /* detached */
      }
    }
    await page.waitForTimeout(500);
  }
  throw new Error("webview frame not found");
}

// ------------------------------------------------------------------ debugging helpers

/** Toggles a breakpoint with F9 at the given line of the active editor. */
export async function toggleBreakpointAt(page: Page, line: number): Promise<void> {
  await goToLine(page, line);
  await page.keyboard.press("F9");
  await page.locator(".codicon-debug-breakpoint").first().waitFor({ state: "visible", timeout: 10_000 });
}

/** Presses F5 and waits until the debugger is paused (top stack frame decoration shown). */
export async function startDebuggingAndWaitPause(page: Page, timeout = 120_000): Promise<void> {
  await page.keyboard.press("F5");
  await page.locator(".debug-top-stack-frame-line, .codicon-debug-stackframe").first().waitFor({ state: "attached", timeout });
}

export async function stopDebugging(page: Page): Promise<void> {
  await page.keyboard.press("Shift+F5");
  await page.locator(".debug-toolbar").waitFor({ state: "hidden", timeout: 15_000 }).catch(() => {});
}

/** Reads the visible Call Stack rows (Run and Debug view). */
export async function callStackRows(page: Page): Promise<string[]> {
  const rows = page.locator(".debug-call-stack .monaco-list-row");
  const n = await rows.count();
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push((await rows.nth(i).innerText()).replace(/\s+/g, " ").trim());
  return out;
}

// ------------------------------------------------------------------ source-editor state (works when a webview has focus)

const SOURCE_RE = /\.(ts|tsx|js|jsx)$/;

/**
 * Returns the source file + cursor line of the text editor the user would look at:
 * the active group if it shows a source file, otherwise the first group showing one.
 * Reads Monaco's rendered active line number, so it works while a webview is focused
 * (the status bar hides Ln/Col then).
 */
export async function sourceEditorState(page: Page): Promise<{ file: string; line: number | null; group: number } | null> {
  return page.evaluate((reSrc) => {
    const re = new RegExp(reSrc);
    const groups = [...document.querySelectorAll(".editor-group-container")];
    const active = document.querySelector(".editor-group-container.active");
    const ordered = active ? [active, ...groups.filter((g) => g !== active)] : groups;
    for (const g of ordered) {
      const tab = g.querySelector(".tabs-container .tab.active .label-name");
      const name = (tab?.textContent ?? "").trim();
      if (!re.test(name)) continue;
      const ln = g.querySelector(".monaco-editor .line-numbers.active-line-number");
      return { file: name, line: ln ? Number((ln.textContent ?? "").trim()) : null, group: groups.indexOf(g) + 1 };
    }
    return null;
  }, SOURCE_RE.source);
}

export async function waitSourceEditor(page: Page, file: string, line?: number, timeout = 15_000) {
  const start = Date.now();
  let st = await sourceEditorState(page);
  while (Date.now() - start < timeout) {
    st = await sourceEditorState(page);
    if (st?.file === file && (line === undefined || st.line === line)) return st;
    await page.waitForTimeout(200);
  }
  throw new Error(`source editor not at ${file}:${line ?? "*"}; now ${JSON.stringify(st)}`);
}

// ------------------------------------------------------------------ CodeLens / tree / notifications

/**
 * Clicks (real mouse input) the CodeLens with `text` rendered directly above source line `line`
 * of the active editor. Geometry is computed from the rendered DOM.
 */
export async function clickCodeLensAbove(page: Page, text: string, line: number, timeout = 30_000): Promise<void> {
  const start = Date.now();
  let pt: { x: number; y: number } | null = null;
  while (Date.now() - start < timeout) {
    pt = await page.evaluate(({ text, line }) => {
      const ed = document.querySelector(".editor-group-container.active .monaco-editor");
      if (!ed) return null;
      const ln = [...ed.querySelectorAll(".line-numbers")].find((l) => (l.textContent ?? "").trim() === String(line));
      if (!ln) return null;
      const lineY = ln.getBoundingClientRect().y;
      let best: { el: Element; dy: number } | null = null;
      for (const a of ed.querySelectorAll(".codelens-decoration a")) {
        if (!(a.textContent ?? "").includes(text)) continue;
        const r = a.getBoundingClientRect();
        const dy = lineY - r.y;
        if (dy > 0 && dy < 40 && (!best || dy < best.dy)) best = { el: a, dy };
      }
      if (!best) return null;
      const r = best.el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, { text, line });
    if (pt) break;
    await page.waitForTimeout(500);
  }
  if (!pt) throw new Error(`no CodeLens "${text}" directly above line ${line}`);
  await page.mouse.click(pt.x, pt.y, { delay: 80 });
}

export interface TreeRow { text: string; level: number; expanded: string | null; selected: boolean }

/** Reads the visible rows of the tree in the sidebar (e.g. Call Hierarchy in the References view). */
export async function sidebarTreeRows(page: Page): Promise<TreeRow[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll(".part.sidebar .monaco-list-row")].map((r) => ({
      text: (r.textContent ?? "").replace(/\s+/g, " ").trim(),
      level: Number(r.getAttribute("aria-level") ?? 0),
      expanded: r.getAttribute("aria-expanded"),
      selected: r.classList.contains("selected") || r.getAttribute("aria-selected") === "true",
    })),
  );
}

export async function notificationsText(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll(".notification-list-item-message")].map((n) =>
      (n.textContent ?? "").replace(/\s+/g, " ").trim(),
    ),
  );
}

/** Generic React Flow snapshot of any webview frame (node texts + edge ids). */
export async function reactFlowSnapshot(f: Frame): Promise<{ nodes: { id: string; text: string }[]; edges: string[] }> {
  return f.evaluate(() => ({
    nodes: [...document.querySelectorAll(".react-flow__node")].map((n) => ({
      id: n.getAttribute("data-id") ?? "",
      text: (n.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 160),
    })),
    edges: [...document.querySelectorAll(".react-flow__edge")].map((e) => (e.getAttribute("data-testid") ?? "").replace(/^rf__edge-/, "")),
  }));
}
