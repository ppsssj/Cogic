/**
 * Records automation evidence: per-step wall time, scripted user-operation counts,
 * source-file switches, screenshots and a text log.
 *
 * NOTE: elapsed times here are AUTOMATION execution times. They are not human
 * comprehension times and must not be reported as such.
 */
import type { Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { HARNESS_ROOT, sourceEditorState } from "./vscode";

/** Each suite execution writes to e2e-results/runs/<RUN_ID>/ (RUN_ID set by run-all.ps1; default "dev"). */
export const RUN_ID = process.env.RUN_ID ?? "dev";
export const RESULTS_ROOT = path.join(HARNESS_ROOT, "e2e-results", "runs", RUN_ID);

export type Status = "pass" | "fail" | "partial" | "unverified" | "unsupported";
export type Evidence = "ui" | "ui+dom" | "internal-api" | "none";

export interface StepRecord {
  name: string;
  startedAt: string;
  ms: number;
  ok: boolean;
  error?: string;
  screenshot?: string;
}

export interface TaskRecord {
  tool: string;
  task: string;
  status: Status;
  evidence: Evidence;
  userOperations: number;
  fileSwitches: number;
  returnOperations: number | null;
  graphPanelPersists: string;
  startingFocusPersists: string;
  selectionPersists: string;
  staticCallsShown: string;
  dataflowShown: string;
  debugFrameMapped: string;
  automationMs: number;
  screenshots: string[];
  notes: string;
}

export class Recorder {
  readonly dir: string;
  readonly shotsDir: string;
  private logLines: string[] = [];
  steps: StepRecord[] = [];
  tasks: TaskRecord[] = [];
  meta: Record<string, unknown> = {};

  private ops = 0;
  private switches = 0;
  private lastTab = "";
  private shotIndex = 0;

  constructor(readonly runName: string, private page?: Page) {
    this.dir = path.join(RESULTS_ROOT, runName);
    this.shotsDir = path.join(this.dir, "screenshots");
    fs.rmSync(this.dir, { recursive: true, force: true });
    fs.mkdirSync(this.shotsDir, { recursive: true });
  }

  attach(page: Page) {
    this.page = page;
  }

  log(msg: string) {
    const line = `[${new Date().toISOString()}] ${msg}`;
    this.logLines.push(line);
    // eslint-disable-next-line no-console
    console.log(line);
  }

  /** Count one scripted user operation (keypress chord, click, typed query+enter). */
  op(description: string, n = 1) {
    this.ops += n;
    this.log(`  op(+${n}) ${description}`);
  }

  /** Call after any action that may change the active editor; counts SOURCE-file changes only
   *  (webview tabs such as a graph panel are not counted as file switches). */
  async trackTab(): Promise<string> {
    if (!this.page) return "";
    const name = (await sourceEditorState(this.page))?.file ?? "";
    if (name && this.lastTab && name !== this.lastTab) {
      this.switches++;
      this.log(`  file switch: ${this.lastTab} -> ${name}`);
    }
    if (name) this.lastTab = name;
    return name;
  }

  resetCounters() {
    const r = { ops: this.ops, switches: this.switches };
    this.ops = 0;
    this.switches = 0;
    return r;
  }

  counters() {
    return { ops: this.ops, switches: this.switches };
  }

  async shot(label: string): Promise<string> {
    if (!this.page) return "";
    const file = `${String(++this.shotIndex).padStart(2, "0")}-${label.replace(/[^a-zA-Z0-9_-]+/g, "_")}.png`;
    const full = path.join(this.shotsDir, file);
    await this.page.screenshot({ path: full });
    this.log(`  screenshot: ${file}`);
    return path.relative(RESULTS_ROOT, full).replace(/\\/g, "/");
  }

  async step<T>(name: string, fn: () => Promise<T>, opts: { screenshot?: boolean; soft?: boolean } = {}): Promise<T | undefined> {
    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    this.log(`STEP ${name}`);
    const rec: StepRecord = { name, startedAt, ms: 0, ok: false };
    try {
      const v = await fn();
      rec.ok = true;
      return v;
    } catch (e) {
      rec.error = e instanceof Error ? e.message.split("\n")[0] : String(e);
      this.log(`  FAILED: ${rec.error}`);
      if (!opts.soft) throw e;
      return undefined;
    } finally {
      rec.ms = Date.now() - t0;
      if (opts.screenshot !== false && this.page) {
        try {
          rec.screenshot = await this.shot(name + (rec.ok ? "" : "-FAILED"));
        } catch {
          /* page gone */
        }
      }
      this.steps.push(rec);
      this.log(`  -> ${rec.ok ? "ok" : "FAIL"} (${rec.ms} ms)`);
      this.flush();
    }
  }

  task(t: TaskRecord) {
    this.tasks.push(t);
    this.log(`TASK ${t.tool} ${t.task}: ${t.status} [${t.evidence}] ops=${t.userOperations} switches=${t.fileSwitches} return=${t.returnOperations}`);
    this.flush();
  }

  flush() {
    fs.writeFileSync(path.join(this.dir, "run.log"), this.logLines.join("\n") + "\n");
    fs.writeFileSync(
      path.join(this.dir, "result.json"),
      JSON.stringify({ run: this.runName, meta: this.meta, steps: this.steps, tasks: this.tasks }, null, 2),
    );
    if (this.tasks.length) {
      const cols: (keyof TaskRecord)[] = [
        "tool", "task", "status", "evidence", "userOperations", "fileSwitches", "returnOperations",
        "graphPanelPersists", "startingFocusPersists", "selectionPersists", "staticCallsShown",
        "dataflowShown", "debugFrameMapped", "automationMs", "screenshots", "notes",
      ];
      const esc = (v: unknown) => {
        const s = Array.isArray(v) ? v.join(" ") : v === null || v === undefined ? "" : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const csv = [cols.join(","), ...this.tasks.map((t) => cols.map((c) => esc(t[c])).join(","))].join("\n");
      fs.writeFileSync(path.join(this.dir, "tasks.csv"), "﻿" + csv + "\n");
    }
    if (this.steps.length) {
      const csv = ["step,ok,ms,error,screenshot", ...this.steps.map((s) =>
        [s.name, s.ok, s.ms, (s.error ?? "").replace(/[",\n]/g, " "), s.screenshot ?? ""].join(","))].join("\n");
      fs.writeFileSync(path.join(this.dir, "steps.csv"), "﻿" + csv + "\n");
    }
  }
}
