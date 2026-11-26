// Independent check of a captured canvas. Does not import or call any product code.
//
//   node verify-graph.cjs <capture.json>
//
// capture.json: { workspaceRoot, steps: [{ name, graph, nodes: [{ id, collapsed }],
//                 edges: [{ id, kind, source, target, sourceHandle, targetHandle, members? }] }] }
//
// Rules, written from the specification of the canvas:
//  1. A relation end inside a collapsed folder is drawn at the outermost collapsed folder. A
//     folder contains files below it when it lies under the workspace root; a folder outside
//     the root contains only its direct files. Paths are compared as they are, case included.
//  2. Otherwise an end in a collapsed file is drawn at the file.
//  3. Otherwise a class member is drawn at its class, on a handle of its own.
//  4. A relation is not drawn if both ends are drawn at the same group, or are the same node.
//     Two different members of one class stay connected.
//  5. A relation of a file node is drawn only if an end is collapsed.
//  6. Relations are drawn as one edge if they agree in kind, both drawn ends and both handles,
//     and, when no end is collapsed, in their label.
//
// Each step is solved per drawn edge from its set of members, so a lost, foreign, doubled or
// misplaced relation is reported on its own.
"use strict";
const fs = require("node:fs");

const slash = (p) => p.replace(/\\/g, "/");
const parent = (p) => p.slice(0, p.lastIndexOf("/"));

function solve(step, workspaceRoot) {
  const root = workspaceRoot ? slash(workspaceRoot).replace(/\/+$/, "") : null;
  const nodes = new Map(step.graph.nodes.map((n) => [n.id, n]));
  const collapsed = new Set(step.nodes.filter((n) => n.collapsed).map((n) => n.id));
  const fileNode = new Map();
  for (const n of step.graph.nodes) if (n.kind === "file") fileNode.set(slash(n.file), n.id);

  const place = (id) => {
    const node = nodes.get(id);
    const file = slash(node.file);
    const folders = [];
    for (let dir = parent(file); dir; dir = parent(dir)) {
      folders.unshift(dir);
      if (!root || !dir.startsWith(`${root}/`)) break; // outside the root: the direct folder only
      if (parent(dir) === root) break;
    }
    const folder = folders.find((dir) => collapsed.has(`folder:${dir}`));
    if (folder) return { at: `folder:${folder}`, group: true, handle: null };
    const groupId = fileNode.get(file) ?? `file:${node.file}`;
    if (collapsed.has(groupId)) return { at: groupId, group: true, handle: null };
    if (node.parentId && nodes.has(node.parentId)) return { at: node.parentId, group: false, handle: id };
    return { at: id, group: false, handle: null };
  };

  const expected = new Map();
  const skipped = { sameGroup: 0, selfLoop: 0, fileNode: 0, dangling: 0 };
  for (const edge of step.graph.edges) {
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) { skipped.dangling++; continue; }
    const s = place(edge.source);
    const t = place(edge.target);
    const group = s.group || t.group;
    if (s.at === t.at && group) { skipped.sameGroup++; continue; }
    if (edge.source === edge.target) { skipped.selfLoop++; continue; }
    if (s.at === t.at && !(s.handle && t.handle)) { skipped.selfLoop++; continue; }
    const touchesFile = nodes.get(edge.source).kind === "file" || nodes.get(edge.target).kind === "file";
    if (touchesFile && !group) { skipped.fileNode++; continue; }
    const lane = edge.kind === "dataflow" ? "dataflow" : "control";
    const key = [
      edge.kind, s.at, t.at,
      s.handle ? `out-child-${s.handle}` : `out-${lane}`,
      t.handle ? `in-child-${t.handle}` : `in-${lane}`,
      group ? "" : edge.label ?? "",
    ];
    const text = JSON.stringify(key);
    if (!expected.has(text)) expected.set(text, new Set());
    expected.get(text).add(edge.id);
  }
  return { expected, skipped, nodes };
}

function verify(step, workspaceRoot) {
  const { expected, skipped } = solve(step, workspaceRoot);
  const relations = new Map(step.graph.edges.map((e) => [e.id, e]));
  const collapsedIds = new Set(step.nodes.filter((n) => n.collapsed).map((n) => n.id));
  const problems = [];
  const report = (type, detail) => problems.push({ type, detail });
  const seenEdges = new Set();
  const seenMembers = new Set();
  const matched = new Set();
  let aggregates = 0;
  let represented = 0;
  for (const edge of step.edges) {
    if (seenEdges.has(edge.id)) report("duplicate drawn edge", edge.id);
    seenEdges.add(edge.id);
    const members = edge.members ?? [edge.id];
    if (edge.members) aggregates++;
    represented += members.length;
    for (const id of members) {
      if (!relations.has(id)) report("foreign member", id);
      if (seenMembers.has(id)) report("relation on two edges", id);
      seenMembers.add(id);
    }
    const first = relations.get(members[0]);
    if (!first) continue;
    const group = collapsedIds.has(edge.source) || collapsedIds.has(edge.target);
    const key = JSON.stringify([
      edge.kind ?? first.kind, edge.source, edge.target, edge.sourceHandle, edge.targetHandle,
      group ? "" : first.label ?? "",
    ]);
    const want = expected.get(key);
    if (!want) { report("unexpected edge", key); continue; }
    matched.add(key);
    const lost = [...want].filter((id) => !members.includes(id));
    const extra = members.filter((id) => !want.has(id));
    if (lost.length) report("members missing", { key, lost });
    if (extra.length) report("members too many", { key, extra });
  }
  for (const key of expected.keys()) if (!matched.has(key)) report("edge missing", key);
  const drawable = [...expected.values()].reduce((n, set) => n + set.size, 0);
  const total = step.graph.edges.length;
  const skippedTotal = Object.values(skipped).reduce((a, b) => a + b, 0);
  if (drawable + skippedTotal !== total) report("accounting", { drawable, skipped, total });
  return { name: step.name, graphEdges: total, expectedEdges: expected.size, drawnEdges: step.edges.length, aggregates, represented, skipped, problems };
}

module.exports = { solve, verify };

if (require.main === module) {
  const capture = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  let bad = 0;
  for (const step of capture.steps) {
    const r = verify(step, capture.workspaceRoot);
    bad += r.problems.length;
    console.log(JSON.stringify({ ...r, problems: r.problems.length, sample: r.problems.slice(0, 5) }));
  }
  process.exitCode = bad ? 1 : 0;
}
