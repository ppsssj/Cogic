const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { pipelineProfile } = require('../../../../out/panel/pipelineProfile.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p12c-overhead-'));
const output = path.join(dir, 'events.jsonl');
const rows = [];
try {
  for (const enabled of [false, true, true, false]) {
    if (enabled) process.env.COGIC_PIPELINE_PROFILE = output;
    else delete process.env.COGIC_PIPELINE_PROFILE;
    const start = performance.now();
    for (let i = 0; i < 1000; i++) pipelineProfile('benchmark', 'fixture', { value: i });
    rows.push({ enabled, events: 1000, elapsedMs: performance.now() - start });
  }
  console.log(JSON.stringify({ node: process.version, platform: process.platform, rows }, null, 2));
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
