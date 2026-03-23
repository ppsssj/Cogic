# CodeGraph

<p align="center">
  <img src="assets/logo1.svg" alt="CodeGraph Logo" width="220" />
</p>

<p align="center">
  VS Code extension + React webview for exploring TypeScript/JavaScript code as a graph.
</p>

---

## Overview

CodeGraph analyzes the active file in your workspace and renders:

- file, function, method, class, interface, type, enum, and external nodes
- call edges, reference edges, and parameter/data-flow edges
- inspector details, diagnostics, trace mode playback, and runtime debug overlays

It is split into two parts:

- `src/`: VS Code extension host, workspace access, analysis, save dialogs
- `webview-ui/`: React + Vite graph UI rendered inside a VS Code webview

---

## Demo

![Demo](assets/demo5.png)

## Node Click Walkthrough

![Node Click Walkthrough](assets/NodeClick_demo.gif)

## Trace Walkthrough

![Trace Walkthrough](assets/Trace_demo.gif)

## Runtime Debug Walkthrough

![Runtime Debug Walkthrough](assets/debug_demo.gif)

The intended flow is:

1. open the sample workspace
2. generate the graph once
3. start a VS Code debug session
4. step through code while CodeGraph follows the active frame

## Error Demo

![Error Demo](assets/error_demo.png)

---

## Key Features

- Analyze the active TypeScript/JavaScript file and render an interactive graph
- Canvas node interactions split selection and navigation for more stable graph rendering
- Trace mode to step through graph construction events
- Debug mode to follow the currently paused runtime frame from the VS Code debugger
- Inspector panel with diagnostics, graph metadata, and node details
- Workspace file picker and graph search from the top bar
- Canvas controls for zoom, focus-selection, and fit-graph actions
- Export menu in the top bar with:
  - `JSON export`: saves graph data, active file info, analysis metadata, and current UI state
  - `JPG snapshot`: saves a JPEG image of the current graph canvas

---

## Interaction Model

- `Single click` on a canvas node selects it and zooms the canvas toward that node
- `Double click` on a canvas node opens the corresponding source location
- Inspector actions continue to open code locations directly
- External nodes can still be expanded into the current graph

## Trace Mode

- Trace playback steps through graph construction events one step at a time
- Newly introduced trace nodes are visually focused in the canvas
- Parameter-flow trace steps highlight the edge and surface the active flow in the inspector panel

## Debug Mode

- Debug mode listens to VS Code debug sessions and reads the active paused stack frame
- The current frame `file/line` is mapped onto the existing graph and the matched node is highlighted
- Stepping with `Step Over` / `Step Into` updates the graph focus as the active frame changes
- The inspector surfaces the current runtime frame and a compact preview of key variables

### Recommended flow

1. open the target file
2. click `Generate` to build the graph
3. start a normal VS Code debug session with breakpoints
4. when execution pauses, let CodeGraph follow the active frame
5. continue stepping to watch the graph move across functions and methods

### Current MVP scope

- built around file-backed TypeScript/JavaScript debug flows
- best experience when the graph has already been generated for the active file
- focused on paused-frame tracking rather than full execution tracing while the program is running

## Trace Mode vs Debug Mode

| Mode | What it shows | Source of truth | Best for |
| --- | --- | --- | --- |
| `Trace Mode` | how the graph is constructed step by step | static analyzer trace events | understanding graph generation order and data-flow construction |
| `Debug Mode` | where the paused program is currently executing | VS Code debug adapter + active stack frame | following real runtime execution while stepping through code |

In short:

- `Trace Mode` is offline and analyzer-driven
- `Debug Mode` is live and debugger-driven
- `Trace Mode` explains how CodeGraph built the graph
- `Debug Mode` explains where your program is stopped right now

---

## Export Formats

### JSON export

The JSON export is saved with a schema like:

```json
{
  "schema": "codegraph.flow.v1",
  "exportedAt": "2026-03-20T06:27:10.416Z",
  "ui": {
    "activeFilter": "all",
    "searchQuery": "",
    "rootNodeId": null,
    "selectedNodeId": null,
    "inspector": {
      "open": true,
      "placement": "right",
      "effectivePlacement": "right",
      "width": 370,
      "height": 396
    }
  },
  "activeFile": {
    "uri": "file:///path/to/file.ts",
    "fileName": "file.ts",
    "languageId": "typescript"
  },
  "analysisMeta": {
    "mode": "workspace"
  },
  "graph": {
    "nodes": [],
    "edges": []
  }
}
```

Use this when you want structured graph data for inspection, debugging, or future import/export workflows.

### JPG snapshot

The JPG export captures the current graph canvas as an image. This is useful for sharing the current graph view in docs, chat, or issues.

Notes:

- the export currently captures the graph canvas as rendered in the webview
- overlay controls such as zoom buttons and notices are filtered out from the snapshot
- this is a snapshot export, not a structured graph format

---

## Architecture

```mermaid
flowchart LR
  subgraph VSCode[VS Code]
    EH["Extension Host"]
    WV["Webview UI"]
  end

  EH <-->|postMessage| WV
  EH -->|read| AE["Active Editor / Workspace"]
  EH -->|analyze| AST["Analyzer"]
  AST --> EH
  EH -->|results / notices| WV
```

---

## Message Protocol

### Webview -> Extension

| Type | Description |
| --- | --- |
| `requestActiveFile` | Request current active editor info |
| `requestWorkspaceFiles` | Request workspace file list |
| `requestSelection` | Request current editor selection |
| `analyzeActiveFile` | Analyze active file |
| `selectWorkspaceFile` | Open a file from the workspace picker |
| `expandNode` | Analyze and merge graph data for an external file |
| `openLocation` | Reveal a code location in the editor |
| `saveExportFile` | Save a JSON or JPG export via VS Code save dialog |

### Extension -> Webview

| Type | Description |
| --- | --- |
| `activeFile` | Active editor payload |
| `workspaceFiles` | Workspace root and file list |
| `selection` | Current selection payload |
| `analysisResult` | Graph, diagnostics, trace, and metadata |
| `runtimeDebug` | Current runtime debug session/frame/variable snapshot |
| `uiNotice` | Toast/canvas/inspector notice |
| `flowExportResult` | Result of JSON/JPG export save |

---

## Requirements

- Node.js 18+
- VS Code 1.108+

---

## Install

```bash
npm install
cd webview-ui
npm install
```

---

## Development

### Webview UI

```bash
cd webview-ui
npm run dev
```

### Build webview

```bash
cd webview-ui
npm run build
```

### Run extension

Open the repo in VS Code and press `F5` to launch an Extension Development Host.

---

## Build

Build everything from the repo root:

```bash
npm run build:all
```

This runs:

1. webview build
2. copy webview output into `media/webview`
3. extension TypeScript compile

---

## Repo Structure

```text
.
├─ src/                # VS Code extension source
├─ webview-ui/         # React + Vite webview UI
├─ media/webview/      # generated webview build output
├─ scripts/            # helper scripts
├─ assets/             # logos / demo images
├─ package.json
└─ README.md
```

---

## Current Graph Model

The analyzer currently emits a graph with:

```ts
type GraphPayload = {
  nodes: Array<{
    id: string;
    kind: "file" | "function" | "method" | "class" | "interface" | "external";
    name: string;
    file: string;
    parentId?: string;
    range: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
    signature?: string;
    sig?: {
      params: Array<{ name: string; type: string; optional?: boolean }>;
      returnType?: string;
    };
    subkind?: "interface" | "type" | "enum";
  }>;
  edges: Array<{
    id: string;
    kind: "calls" | "constructs" | "dataflow" | "references" | "updates";
    source: string;
    target: string;
    label?: string;
  }>;
};
```

---

## Roadmap

- [ ] export full graph bounds as an image, not only the current rendered canvas region
- [ ] add import support for previously exported JSON graph files
- [ ] improve analyzer precision for call graph and external references
- [ ] incremental analysis for larger workspaces
- [ ] optional PNG/SVG export presets
