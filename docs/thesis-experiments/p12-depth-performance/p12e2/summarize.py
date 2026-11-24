"""Summarize P12-E2 rAF callbacks and correlated P12-C events (no cross-clock subtraction)."""
import argparse
import json
import math
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('interaction', type=Path)
parser.add_argument('pipeline', type=Path)
args = parser.parse_args()
interaction = json.loads(args.interaction.read_text(encoding='utf-8-sig'))
rows = [json.loads(s) for s in args.pipeline.read_text(encoding='utf-8-sig').splitlines() if s.strip()]
output = []
for phase in interaction['phases']:
    times = phase.get('frames', [])
    intervals = sorted(b-a for a,b in zip(times, times[1:]))
    def quantile(p):
        return intervals[math.floor((len(intervals)-1)*p)] if intervals else None
    points = phase.get('pointer', [])
    pointer_distance = sum(math.hypot(a['x']-b['x'], a['y']-b['y']) for a,b in zip(points, points[1:]))
    commits = [r['webview'] for r in rows if r['event']=='pipeline.canvas.commit' and phase.get('start',0)<=r.get('webview',{}).get('monotonicMs',-1)<=phase.get('end',0)]
    output.append(dict(phase=phase['phase'], intervalCount=len(intervals), callbackFps=(1000*len(intervals)/sum(intervals) if intervals else None), p50Ms=quantile(.50), p95Ms=quantile(.95), p99Ms=quantile(.99), maxGapMs=max(intervals) if intervals else None, gapsOver16_7Ms=sum(d>16.7 for d in intervals), longTasks=phase.get('longtasks',[]), pointerEvents=len(points), pointerPathCssPx=pointer_distance, domNodes=phase.get('domNodes'), domEdges=phase.get('domEdges'), latencies=phase.get('latencies',[])[-1:], canvasCommits=commits, unavailable=phase.get('unavailable')))
print(json.dumps(dict(variant=interaction.get('variant','baseline'),setup=interaction['setup'],phases=output),ensure_ascii=False,indent=2))
