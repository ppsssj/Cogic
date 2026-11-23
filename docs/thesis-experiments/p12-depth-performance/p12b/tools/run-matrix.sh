#!/usr/bin/env bash
# P12-B measurement matrix. Run from the Cogic checkout root (cwd matters for automatic @types resolution).
# Usage: bash docs/thesis-experiments/p12-depth-performance/p12b/tools/run-matrix.sh <baseline-checkout> <projects-dir> <graph-dump-dir>
# Runs are strictly sequential; conditions are interleaved within each repeat. A run whose free-memory precondition
# is not met is recorded as skipped in data/runs/<name>.skipped.json instead of being forced.
set -u
BASE="$1"; PROJECTS="$2"; DUMPS="$3"
HERE="$(cd "$(dirname "$0")" && pwd)"; DATA="$HERE/../data/runs"; T="$HERE/profile-depth-product.cjs"
mkdir -p "$DATA" "$DUMPS"
H="--root $PROJECTS/hono --file src/helper/cookie/index.ts"
V="--root $PROJECTS/vite --file packages/vite/src/node/server/index.ts"

free_mb() { node -e 'console.log(Math.round(require("os").freemem()/1048576))'; }

# run <name> <need-free-MB> <args...>
run() {
  local name="$1" need="$2"; shift 2
  local out="$DATA/$name.json"
  if [ -e "$out" ] || [ -e "$DATA/$name.skipped.json" ]; then echo "exists: $name"; return; fi
  local free; free=$(free_mb)
  if [ "$free" -lt "$need" ]; then
    printf '{"name":"%s","status":"skipped","reason":"free %s MB < required %s MB"}\n' "$name" "$free" "$need" > "$DATA/$name.skipped.json"
    echo "SKIP $name (free $free MB)"; return
  fi
  node --max-old-space-size=768 "$T" "$@" --out "$out" --dump-graph "$DUMPS/$name.graph.json" --min-free-mb 400 || echo "FAILED $name"
}

for d in 0 1; do
  run "hono-d$d-base-r1" 900 --cogic "$BASE" $H --depth $d
  run "hono-d$d-off-r1"  900 --cogic . $H --depth $d --session 0
  run "hono-d$d-on-r1"   900 --cogic . $H --depth $d --session 1
done
for r in 1 2 3; do
  run "hono-d2-base-r$r" 1000 --cogic "$BASE" $H --depth 2
  run "hono-d2-off-r$r"  1000 --cogic . $H --depth 2 --session 0
  run "hono-d2-on-r$r"   1000 --cogic . $H --depth 2 --session 1
done
for d in 0 1; do
  run "vite-d$d-base-r1" 1100 --cogic "$BASE" $V --depth $d
  run "vite-d$d-on-r1"   1100 --cogic . $V --depth $d --session 1
done
run "vite-d2-base-r1" 1300 --cogic "$BASE" $V --depth 2
run "vite-d2-on-r1"   1300 --cogic . $V --depth 2 --session 1
run "vite-d2-off-r1"  1300 --cogic . $V --depth 2 --session 0
run "vite-d2-on-r2"   1300 --cogic . $V --depth 2 --session 1
run "vite-d2-base-r2" 1300 --cogic "$BASE" $V --depth 2
run "vite-d2-on-r3"   1300 --cogic . $V --depth 2 --session 1
