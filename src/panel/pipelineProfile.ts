import * as fs from "fs";

/** Opt-in JSONL diagnostic output. A failed diagnostic write must not affect analysis. */
export function pipelineProfile(event: string, requestId: string, detail: Record<string, unknown> = {}) {
  const destination = process.env.COGIC_PIPELINE_PROFILE;
  if (!destination) {return;}
  try {
    fs.appendFileSync(destination, `${JSON.stringify({ source: "extension", event, requestId, monotonicMs: performance.now(), wallTime: new Date().toISOString(), ...detail })}\n`);
  } catch {
    // Diagnostics are deliberately non-fatal.
  }
}

export function pipelineProfileEnabled() {
  return Boolean(process.env.COGIC_PIPELINE_PROFILE);
}
