# P12-C2: actual VS Code Depth 2 measurement

The initial Vite run was aborted by the memory guard. After closing Chrome normally, four subsequent fresh-host Depth 2 requests and warm Generate requests completed. See [resumed results](resumed-results.md) for timings, graph hashes, memory and UI limitations; the original aborted run remains documented. [Results](results.md) and [method and reproduction](measurement-method.md) distinguish the completed small-fixture smoke from the incomplete Vite attempt. This is a draft measurement report, not an optimization.

Raw logs: [fixture pipeline](fixture.jsonl), [fixture process memory](fixture-memory.jsonl), [fixture harness](fixture-harness.txt); [aborted Vite pipeline](vite-aborted.jsonl), [Vite process memory](vite-aborted-memory.jsonl), [guard value](vite-aborted-abort.txt), [Vite harness](vite-aborted-harness.txt). Sources can contain local paths.
