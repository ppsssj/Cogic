// EXP-01 Ground Truth / scoring core library (P1-A).
//
// Pure functions only: no TypeScript dependency, no analyzer import.
// Rules implemented here are specified in
//   docs/thesis-experiments/fixtures/exp-01/ANNOTATION_GUIDE.md
//   docs/thesis-experiments/experiments/exp-01-accuracy.md (§6, §6.5)

import fs from "node:fs";
import path from "node:path";

export const GT_SCHEMA = "exp01-gt/1";
export const CASE_SCHEMA = "exp01-case/1";
export const PRED_SCHEMA = "exp01-pred/1";
// 1.0 = P1-A pre-registration (41bbe19). 1.1 = P1-A-R1: 1:1 maximum matching, fail-closed diagnostics.
// 1.2 = P1-G post-hoc amendment (after the first EXP-01 run): same-line external declarations are told
//       apart by range containment instead of blocking the case (resolveExternalCollision).
export const SCORER_VERSION = "exp01-scorer/1.2";

export const EDGE_KINDS = ["calls", "constructs", "references", "dataflow", "updates"];
export const RELATION_KINDS = [...EDGE_KINDS, "owner"];
export const STRUCTURAL_KINDS = new Set(["calls", "constructs", "references", "updates"]);
export const NODE_TYPES = ["file", "module", "lib", "external", "synthetic", "callable", "class", "typeLike"];
export const SUPPORT_LEVELS = ["supported", "unsupported-by-design", "ambiguous"];
export const FRAMEWORKS = ["react", "vue", "express", "nest"];
export const SYNTHETIC_ROLES = ["callback-owner", "state-source", "route-owner"];

export const CATEGORY_BY_FRAMEWORK = {
  react: "react-hook-owner",
  vue: "vue-hook-owner",
  express: "express-route-owner",
  nest: "nest-route-owner",
};

export const CATEGORIES = [
  "calls",
  "constructs",
  "references",
  "dataflow",
  "updates",
  "react-hook-owner",
  "vue-hook-owner",
  "express-route-owner",
  "nest-route-owner",
];

// Allowed target node types per relation kind (GT side).
const TARGET_TYPES = {
  calls: new Set(["callable", "external", "module", "lib"]),
  constructs: new Set(["class", "external", "lib"]),
  references: new Set(["callable", "class", "typeLike", "synthetic", "external", "lib"]),
  dataflow: new Set(["callable", "class", "external", "lib"]),
  updates: new Set(["synthetic"]),
};
const SOURCE_TYPES = new Set(["file", "callable", "class", "typeLike", "synthetic"]);

const REACT_HOOKS = new Set([
  "useState",
  "useReducer",
  "useEffect",
  "useLayoutEffect",
  "useInsertionEffect",
  "useMemo",
  "useCallback",
]);
const VUE_HOOKS = new Set([
  "ref",
  "shallowRef",
  "customRef",
  "reactive",
  "computed",
  "watch",
  "watchEffect",
  "watchPostEffect",
  "watchSyncEffect",
]);

// ---------------------------------------------------------------------------
// Keys

export function nodeKey(node) {
  switch (node.type) {
    case "file":
      return `F|${node.file}`;
    case "module":
      return `M|${node.file}`;
    case "lib":
      return `L|${node.symbol}`;
    case "external":
      return `X|${node.file}|${node.line}`;
    case "synthetic":
      return `S|${node.file}|${node.line}`;
    case "callable":
    case "class":
    case "typeLike":
      return `D|${node.file}|${node.line}|${node.type}`;
    default:
      throw new Error(`unknown node type: ${node.type}`);
  }
}

export function relationKey(kind, src, tgt, argIndex) {
  if (kind === "owner") {
    return `owner|${src}`;
  }
  if (kind === "dataflow") {
    return `dataflow|${src}|${tgt}|${argIndex}`;
  }
  return `${kind}|${src}|${tgt}`;
}

// Lenient key: structural kinds collapse to endpoints; dataflow/owner stay strict.
export function lenientKey(kind, src, tgt, argIndex) {
  if (STRUCTURAL_KINDS.has(kind)) {
    return `edge|${src}|${tgt}`;
  }
  return relationKey(kind, src, tgt, argIndex);
}

export function isSyntheticKey(key) {
  return typeof key === "string" && key.startsWith("S|");
}

export function categoryFor(kind, sourceFramework) {
  if (kind === "owner") {
    return CATEGORY_BY_FRAMEWORK[sourceFramework] ?? "framework-unknown";
  }
  if (kind === "updates") {
    return "updates";
  }
  if (sourceFramework) {
    return CATEGORY_BY_FRAMEWORK[sourceFramework] ?? "framework-unknown";
  }
  return kind;
}

// ---------------------------------------------------------------------------
// CSV

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") {
        i++;
      }
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") {
        rows.push(row);
      }
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  if (rows.length === 0) {
    return [];
  }
  const [header, ...body] = rows;
  return body.map((cells) => Object.fromEntries(header.map((h, idx) => [h, cells[idx] ?? ""])));
}

function csvCell(value) {
  if (value === null || value === undefined) {
    return "";
  }
  const s = typeof value === "number" ? formatNumber(value) : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function formatNumber(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(6);
}

export function toCsv(rows, columns) {
  const lines = [columns.join(",")];
  for (const r of rows) {
    lines.push(columns.map((c) => csvCell(r[c])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Loading

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function loadCatalog(catalogPath) {
  const rows = parseCsv(fs.readFileSync(catalogPath, "utf8"));
  const byId = new Map();
  for (const r of rows) {
    byId.set(r.patternId, r);
  }
  return byId;
}

// Finds case directories (those containing case.json) under the corpus root.
export function listCaseDirs(corpusRoot) {
  const out = [];
  for (const category of fs.readdirSync(corpusRoot).sort()) {
    const catDir = path.join(corpusRoot, category);
    if (!fs.statSync(catDir).isDirectory()) {
      continue;
    }
    for (const c of fs.readdirSync(catDir).sort()) {
      const caseDir = path.join(catDir, c);
      if (fs.existsSync(path.join(caseDir, "case.json"))) {
        out.push(caseDir);
      }
    }
  }
  return out;
}

export function gtFileName(version) {
  return version === 1 ? "expected.json" : `expected.v${version}.json`;
}

// ---------------------------------------------------------------------------
// GT structure validation (no TypeScript needed)

export function validateGtStructure(gt, catalog) {
  const errors = [];
  const warnings = [];
  const err = (msg) => errors.push(msg);

  if (gt.schema !== GT_SCHEMA) {
    err(`schema must be ${GT_SCHEMA}`);
  }
  if (!gt.caseId) {
    err("caseId missing");
  }
  if (!Number.isInteger(gt.gtVersion) || gt.gtVersion < 1) {
    err("gtVersion must be a positive integer");
  }
  if (!gt.activeFile) {
    err("activeFile missing");
  }

  const nodes = new Map();
  const keys = new Map();
  for (const n of gt.nodes ?? []) {
    if (!n.id) {
      err("node without id");
      continue;
    }
    if (nodes.has(n.id)) {
      err(`duplicate node id ${n.id}`);
    }
    if (!NODE_TYPES.includes(n.type)) {
      err(`node ${n.id}: invalid type ${n.type}`);
      continue;
    }
    if (n.type !== "lib" && !n.file) {
      err(`node ${n.id}: file missing`);
    }
    if (n.type === "lib" && !n.symbol) {
      err(`node ${n.id}: lib node needs symbol`);
    }
    if (["external", "synthetic", "callable", "class", "typeLike"].includes(n.type)) {
      if (!Number.isInteger(n.line) || n.line < 1) {
        err(`node ${n.id}: line must be a 1-based integer`);
      }
    }
    if (["external", "callable", "class", "typeLike"].includes(n.type) && !n.name) {
      err(`node ${n.id}: name missing`);
    }
    if (n.type === "synthetic") {
      if (!FRAMEWORKS.includes(n.framework)) {
        err(`node ${n.id}: synthetic node needs framework`);
      }
      if (!SYNTHETIC_ROLES.includes(n.role)) {
        err(`node ${n.id}: synthetic node needs role`);
      }
      if (!n.anchor) {
        err(`node ${n.id}: synthetic node needs anchor`);
      }
    }
    if (["callable", "class", "typeLike", "synthetic", "file"].includes(n.type) && n.file !== gt.activeFile) {
      err(`node ${n.id}: local node types must live in activeFile (use external for other files)`);
    }
    nodes.set(n.id, n);
    let key;
    try {
      key = nodeKey(n);
    } catch (e) {
      err(`node ${n.id}: ${e.message}`);
      continue;
    }
    if (keys.has(key)) {
      err(`node key collision ${key}: ${keys.get(key)} and ${n.id}`);
    } else {
      keys.set(key, n.id);
    }
  }

  const ids = new Set();
  const relKeys = new Map();
  const checkCommon = (r, where) => {
    if (!r.id) {
      err(`${where}: id missing`);
    } else if (ids.has(r.id)) {
      err(`${where}: duplicate id ${r.id}`);
    } else {
      ids.add(r.id);
    }
    if (!RELATION_KINDS.includes(r.kind)) {
      err(`${where} ${r.id}: invalid kind ${r.kind}`);
    }
    const src = nodes.get(r.source);
    if (!src) {
      err(`${where} ${r.id}: unknown source ${r.source}`);
    } else if (!SOURCE_TYPES.has(src.type)) {
      err(`${where} ${r.id}: invalid source type ${src.type}`);
    }
    if (!Array.isArray(r.evidence) || r.evidence.length === 0) {
      err(`${where} ${r.id}: evidence must be a non-empty array of "file:line"`);
    } else {
      for (const e of r.evidence) {
        if (!/^[^:]+:\d+$/.test(e)) {
          err(`${where} ${r.id}: malformed evidence ${e}`);
        }
      }
    }
    return src;
  };
  const checkTarget = (r, where, targetId, argIndex) => {
    if (r.kind === "owner") {
      return;
    }
    const tgt = nodes.get(targetId);
    if (!tgt) {
      err(`${where} ${r.id}: unknown target ${targetId}`);
      return;
    }
    const allowed = TARGET_TYPES[r.kind];
    if (allowed && !allowed.has(tgt.type)) {
      err(`${where} ${r.id}: target type ${tgt.type} not allowed for ${r.kind}`);
    }
    if (r.kind === "updates" && tgt.role !== "state-source") {
      err(`${where} ${r.id}: updates target must be a state-source`);
    }
    if (r.kind === "references" && tgt.type === "synthetic" && tgt.role !== "state-source") {
      err(`${where} ${r.id}: references to synthetic nodes must target a state-source`);
    }
    if (r.kind === "dataflow") {
      if (!Number.isInteger(argIndex) || argIndex < 0) {
        err(`${where} ${r.id}: dataflow needs integer argIndex >= 0`);
      }
    } else if (argIndex !== undefined) {
      err(`${where} ${r.id}: argIndex only allowed for dataflow`);
    }
  };
  const checkPattern = (r, where) => {
    if (!r.pattern) {
      err(`${where} ${r.id}: pattern missing`);
      return null;
    }
    const p = catalog?.get(r.pattern);
    if (catalog && !p) {
      err(`${where} ${r.id}: pattern ${r.pattern} not in catalog`);
      return null;
    }
    return p ?? null;
  };

  for (const r of gt.relations ?? []) {
    const src = checkCommon(r, "relation");
    const p = checkPattern(r, "relation");
    if (p && p.polarity !== "positive") {
      err(`relation ${r.id}: pattern ${r.pattern} is not a positive pattern`);
    }
    if (r.gtStatus === "determinate") {
      if (r.candidates !== undefined) {
        err(`relation ${r.id}: determinate relation must not have candidates`);
      }
      if (r.kind === "owner") {
        if (r.target !== undefined) {
          err(`relation ${r.id}: owner relation has no target`);
        }
        if (src && src.type !== "synthetic") {
          err(`relation ${r.id}: owner relation source must be synthetic`);
        }
      } else {
        checkTarget(r, "relation", r.target, r.argIndex);
        for (const alt of r.targetAlternatives ?? []) {
          checkTarget(r, "relation(alt)", alt, r.argIndex);
        }
      }
      const tgtNode = r.kind === "owner" ? null : nodes.get(r.target);
      if (src && (r.kind === "owner" || tgtNode)) {
        const tgtKey = tgtNode ? nodeKey(tgtNode) : null;
        const k = relationKey(r.kind, nodeKey(src), tgtKey, r.argIndex);
        if (relKeys.has(k)) {
          err(`relation ${r.id}: duplicate relation key with ${relKeys.get(k)} (${k})`);
        } else {
          relKeys.set(k, r.id);
        }
      }
    } else if (r.gtStatus === "indeterminate") {
      if (r.target !== undefined) {
        err(`relation ${r.id}: indeterminate relation uses candidates, not target`);
      }
      if (!r.reason) {
        err(`relation ${r.id}: indeterminate relation needs reason`);
      }
      if (r.candidates === "unbounded") {
        // ok
      } else if (Array.isArray(r.candidates) && r.candidates.length > 0) {
        for (const c of r.candidates) {
          checkTarget(r, "relation(candidate)", c.target, c.argIndex);
        }
      } else {
        err(`relation ${r.id}: candidates must be a non-empty array or "unbounded"`);
      }
      if (r.kind === "owner") {
        err(`relation ${r.id}: owner relations cannot be indeterminate`);
      }
    } else {
      err(`relation ${r.id}: gtStatus must be determinate or indeterminate`);
    }
  }

  for (const n of gt.negatives ?? []) {
    checkCommon(n, "negative");
    const p = checkPattern(n, "negative");
    if (p && p.polarity !== "negative") {
      err(`negative ${n.id}: pattern ${n.pattern} is not a negative pattern`);
    }
    if (!n.rationale) {
      err(`negative ${n.id}: rationale missing`);
    }
    if (n.kind !== "owner") {
      checkTarget(n, "negative", n.target, n.argIndex);
    } else if (n.target !== undefined) {
      err(`negative ${n.id}: owner negative has no target`);
    }
    const src = nodes.get(n.source);
    if (src && (n.kind === "owner" || nodes.get(n.target))) {
      const k = relationKey(n.kind, nodeKey(src), n.kind === "owner" ? null : nodeKey(nodes.get(n.target)), n.argIndex);
      if (relKeys.has(k)) {
        err(`negative ${n.id}: same key as positive relation ${relKeys.get(k)} (${k})`);
      }
    }
  }

  for (const s of gt.excludedSites ?? []) {
    if (!/^[^:]+:\d+$/.test(s.site ?? "") || !s.reason) {
      err(`excludedSites entry needs site "file:line" and reason`);
    }
  }

  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// GT resolution: turn a GT document into keyed items used by the scorer.

export function resolveGt(gt, catalog) {
  const nodes = new Map((gt.nodes ?? []).map((n) => [n.id, n]));
  const keyOf = (id) => nodeKey(nodes.get(id));
  const frameworkOf = (id) => {
    const n = nodes.get(id);
    return n?.type === "synthetic" ? n.framework : null;
  };
  const supportOf = (pattern) => catalog?.get(pattern)?.support ?? "supported";

  const determinate = [];
  const indeterminate = [];
  for (const r of gt.relations ?? []) {
    const srcKey = keyOf(r.source);
    const category = categoryFor(r.kind, frameworkOf(r.source));
    if (r.gtStatus === "determinate") {
      const targets = r.kind === "owner" ? [null] : [r.target, ...(r.targetAlternatives ?? [])];
      const keys = targets.map((t) => relationKey(r.kind, srcKey, t === null ? null : keyOf(t), r.argIndex));
      const lkeys = targets.map((t) => lenientKey(r.kind, srcKey, t === null ? null : keyOf(t), r.argIndex));
      determinate.push({
        id: r.id,
        kind: r.kind,
        srcKey,
        keys,
        lenientKeys: lkeys,
        category,
        pattern: r.pattern,
        support: supportOf(r.pattern),
      });
    } else {
      const candidates =
        r.candidates === "unbounded"
          ? "unbounded"
          : r.candidates.map((c) => ({
              key: relationKey(r.kind, srcKey, keyOf(c.target), c.argIndex),
              lenientKey: lenientKey(r.kind, srcKey, keyOf(c.target), c.argIndex),
            }));
      indeterminate.push({
        id: r.id,
        kind: r.kind,
        srcKey,
        candidates,
        category,
        pattern: r.pattern,
        support: supportOf(r.pattern),
        reason: r.reason,
      });
    }
  }
  const negatives = (gt.negatives ?? []).map((n) => {
    const srcKey = keyOf(n.source);
    const tgtKey = n.kind === "owner" ? null : keyOf(n.target);
    return {
      id: n.id,
      kind: n.kind,
      key: relationKey(n.kind, srcKey, tgtKey, n.argIndex),
      lenientKey: lenientKey(n.kind, srcKey, tgtKey, n.argIndex),
      category: categoryFor(n.kind, frameworkOf(n.source)),
      pattern: n.pattern,
    };
  });
  return { caseId: gt.caseId, determinate, indeterminate, negatives };
}

// ---------------------------------------------------------------------------
// Prediction normalization (Cogic GraphPayload -> keyed relations)

export function normalizeFsPath(p) {
  let s = String(p).replace(/\\/g, "/");
  if (/^[A-Za-z]:\//.test(s)) {
    s = s[0].toLowerCase() + s.slice(1);
  }
  return s;
}

export function relativeFixturePath(file, fixtureRoot) {
  const f = normalizeFsPath(file);
  const root = normalizeFsPath(fixtureRoot).replace(/\/+$/, "");
  if (f.startsWith(`${root}/`)) {
    return f.slice(root.length + 1);
  }
  const base = f.split("/").pop();
  if (f.includes("/typescript/lib/")) {
    return `<tslib>/${base}`;
  }
  return `<outside>/${base}`;
}

export function inferSyntheticFramework(node, nodesById) {
  const name = node.name ?? "";
  if (name.includes(".route.")) {
    const parent = node.parentId ? nodesById.get(node.parentId) : null;
    return parent?.kind === "class" ? "nest" : "express";
  }
  const m = name.match(/\.([A-Za-z]+)#\d+$/);
  const hook = m?.[1];
  if (hook && REACT_HOOKS.has(hook)) {
    return "react";
  }
  if (hook && VUE_HOOKS.has(hook)) {
    return "vue";
  }
  return null;
}

export function isSyntheticCogicNode(node) {
  return node.kind === "function" && /#\d+$/.test(node.name ?? "");
}

export function cogicNodeKey(node, fixtureRoot) {
  const rel = relativeFixturePath(node.file, fixtureRoot);
  const line = (node.range?.start?.line ?? 0) + 1;
  if (node.kind === "file") {
    return `F|${rel}`;
  }
  if (node.kind === "external") {
    return /:-1$/.test(node.id) ? `M|${rel}` : `X|${rel}|${line}`;
  }
  if (isSyntheticCogicNode(node)) {
    return `S|${rel}|${line}`;
  }
  if (node.kind === "function" || node.kind === "method") {
    return `D|${rel}|${line}|callable`;
  }
  if (node.kind === "class") {
    return `D|${rel}|${line}|class`;
  }
  if (node.kind === "interface") {
    return `D|${rel}|${line}|typeLike`;
  }
  return `?|${rel}|${line}|${node.kind}`;
}

function rangeContains(outer, inner) {
  const before = (p, q) => p.line < q.line || (p.line === q.line && p.character <= q.character);
  return before(outer.start, inner.start) && before(inner.end, outer.end);
}

function hasRange(n) {
  const r = n?.range;
  return [r?.start?.line, r?.start?.character, r?.end?.line, r?.end?.character].every(Number.isInteger);
}

// Scorer 1.2 (P1-G). Cogic can emit two different external nodes on one declaration line, e.g. a
// .d.ts `useState` declaration and the setter function type inside its return tuple. Both normalize
// to X|file|line. GT external nodes are declaration start lines (guide §2), so the node whose range
// encloses every other node of the group keeps the key; the others get X|file|line|c<column>, which
// no GT node has. Returns null (the collision stays blocking) unless all of these hold:
//   - key is X|… and every node is a non-module external node with a full range
//   - exactly one node encloses all others (identical ranges give two candidates -> null)
//   - the new keys are distinct and not already used by another node
export function resolveExternalCollision(key, nodes, usedKeys) {
  if (!key.startsWith("X|") || nodes.length < 2) {
    return null;
  }
  if (!nodes.every((n) => n?.kind === "external" && !/:-1$/.test(n.id) && hasRange(n))) {
    return null;
  }
  const enclosing = nodes.filter((n) => nodes.every((m) => rangeContains(n.range, m.range)));
  if (enclosing.length !== 1) {
    return null;
  }
  const kept = enclosing[0];
  const rekeyed = nodes.filter((n) => n !== kept).map((n) => ({ id: n.id, key: `${key}|c${n.range.start.character}` }));
  const newKeys = new Set(rekeyed.map((r) => r.key));
  if (newKeys.size !== rekeyed.length || [...newKeys].some((k) => usedKeys.has(k))) {
    return null;
  }
  return { code: "external-same-line-resolved", key, kept: kept.id, rekeyed };
}

export function normalizeCogicGraph(graph, { fixtureRoot, caseId }) {
  const nodesById = new Map((graph.nodes ?? []).map((n) => [n.id, n]));
  const keyById = new Map();
  const frameworkByKey = new Map();
  const idsByKey = new Map();
  for (const n of graph.nodes ?? []) {
    const key = cogicNodeKey(n, fixtureRoot);
    keyById.set(n.id, key);
    if (!idsByKey.has(key)) {
      idsByKey.set(key, []);
    }
    idsByKey.get(key).push(n.id);
    if (isSyntheticCogicNode(n)) {
      frameworkByKey.set(key, inferSyntheticFramework(n, nodesById));
    }
  }
  // Scorer 1.2: resolve same-line external declarations; anything unresolved stays a collision below.
  const resolvedCollisions = [];
  for (const [key, ids] of [...idsByKey.entries()]) {
    if (ids.length < 2) {
      continue;
    }
    const plan = resolveExternalCollision(key, ids.map((id) => nodesById.get(id)), new Set(idsByKey.keys()));
    if (!plan) {
      continue;
    }
    idsByKey.set(key, [plan.kept]);
    for (const r of plan.rekeyed) {
      keyById.set(r.id, r.key);
      idsByKey.set(r.key, [r.id]);
    }
    resolvedCollisions.push(plan);
  }
  const collisions = [...idsByKey.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([key, ids]) => ({ code: "node-key-collision", key, ids }));
  const unknownNodes = (graph.nodes ?? [])
    .filter((n) => keyById.get(n.id).startsWith("?|"))
    .map((n) => ({ code: "unknown-node-kind", nodeId: n.id, kind: n.kind, raw: n }));

  const relations = new Map();
  const malformed = [];
  const add = (kind, src, tgt, argIndex, sourceId) => {
    const key = relationKey(kind, src, tgt, argIndex);
    const existing = relations.get(key);
    if (existing) {
      existing.occurrences += 1;
      existing.cogicIds.push(sourceId);
      return;
    }
    relations.set(key, {
      kind,
      srcKey: src,
      tgtKey: tgt,
      argIndex,
      key,
      lenientKey: lenientKey(kind, src, tgt, argIndex),
      sourceFramework: frameworkByKey.get(src) ?? null,
      occurrences: 1,
      cogicIds: [sourceId],
    });
  };

  for (const [key, fw] of frameworkByKey.entries()) {
    add("owner", key, null, undefined, idsByKey.get(key)[0]);
  }
  // Malformed edges are not scored; the raw edge is kept for manual review.
  for (const e of graph.edges ?? []) {
    const src = keyById.get(e.source);
    const tgt = keyById.get(e.target);
    if (!src || !tgt) {
      malformed.push({ code: "invalid-endpoint", edgeId: e.id, reason: "unknown endpoint", raw: e });
      continue;
    }
    if (!EDGE_KINDS.includes(e.kind)) {
      malformed.push({ code: "unknown-edge-kind", edgeId: e.id, reason: `unknown kind ${e.kind}`, raw: e });
      continue;
    }
    let argIndex;
    if (e.kind === "dataflow") {
      const m = String(e.id ?? "").match(/@@arg#(\d+)$/);
      if (!m) {
        malformed.push({ code: "unparsable-dataflow-index", edgeId: e.id, reason: "dataflow edge without arg#i", raw: e });
        continue;
      }
      argIndex = Number(m[1]);
    }
    add(e.kind, src, tgt, argIndex, e.id);
  }

  const all = [...relations.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const duplicates = all.filter((r) => r.occurrences > 1).map((r) => ({ key: r.key, occurrences: r.occurrences }));
  return { schema: PRED_SCHEMA, caseId, relations: all, collisions, resolvedCollisions, duplicates, malformed, unknownNodes };
}

// Fail-closed gate (P1-A-R1). Any of these makes the case SCORING_BLOCKED:
// it is still scored row by row for manual review, but excluded from confirmatory statistics.
export const BLOCKING_CODES = [
  "node-key-collision",
  "invalid-endpoint",
  "unparsable-dataflow-index",
  "unknown-edge-kind",
  "unknown-node-kind",
];

export function scoringBlockers(normalizedPred) {
  return [
    ...(normalizedPred.collisions ?? []),
    ...(normalizedPred.malformed ?? []),
    ...(normalizedPred.unknownNodes ?? []),
  ].map((d) => ({ code: d.code ?? "unclassified-diagnostic", detail: d.key ?? d.edgeId ?? d.nodeId ?? null }));
}

export function isConfirmatory(caseResult) {
  return caseResult.status === "SCORED";
}

// ---------------------------------------------------------------------------
// Scoring

function predCategory(p) {
  return categoryFor(p.kind, p.sourceFramework);
}

function matchesIndeterminate(p, entry, mode) {
  if (entry.srcKey !== p.srcKey) {
    return false;
  }
  if (mode === "strict") {
    if (entry.kind !== p.kind) {
      return false;
    }
    if (entry.candidates === "unbounded") {
      return true;
    }
    return entry.candidates.some((c) => c.key === p.key);
  }
  const bothStructural = STRUCTURAL_KINDS.has(entry.kind) && STRUCTURAL_KINDS.has(p.kind);
  if (!bothStructural && entry.kind !== p.kind) {
    return false;
  }
  if (entry.candidates === "unbounded") {
    return true;
  }
  return entry.candidates.some((c) => c.lenientKey === p.lenientKey);
}

// Deterministic maximum-cardinality bipartite matching (augmenting paths, Kuhn).
// adjacency[p] lists GT indices in preference order. Every prediction and every
// GT relation is matched at most once. With the same adjacency the result does not
// depend on input order because callers sort both sides before building it.
export function maximumMatching(adjacency, gtCount) {
  const gtToPred = new Array(gtCount).fill(-1);
  const predToGt = new Array(adjacency.length).fill(-1);
  const tryAugment = (p, seen) => {
    for (const g of adjacency[p]) {
      if (seen[g]) {
        continue;
      }
      seen[g] = true;
      if (gtToPred[g] === -1 || tryAugment(gtToPred[g], seen)) {
        gtToPred[g] = p;
        predToGt[p] = g;
        return true;
      }
    }
    return false;
  };
  for (let p = 0; p < adjacency.length; p++) {
    tryAugment(p, new Array(gtCount).fill(false));
  }
  return { predToGt, gtToPred };
}

const byString = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Scores one case in one mode ("strict" | "lenient").
// Returns row-level verdicts; aggregation happens in computeMetrics().
//
// Matching (P1-A-R1): predictions and determinate GT relations are paired 1:1 by
// maximum bipartite matching. strict: a pair needs an exact key (primary target or
// one of targetAlternatives). lenient: a pair needs an equal lenient key, so
// structural kinds may differ. Preference among candidate GT relations, used only
// to break ties deterministically: same kind and primary target, same kind and
// alternative target, different structural kind; then GT id. Predictions are
// processed in key order.
export function scoreCase(resolvedGt, normalizedPred, mode = "strict") {
  const useLenient = mode === "lenient";
  const blockers = scoringBlockers(normalizedPred);
  const gtRows = resolvedGt.determinate.map((g) => ({
    caseId: resolvedGt.caseId,
    mode,
    side: "gt",
    id: g.id,
    kind: g.kind,
    key: g.keys[0],
    category: g.category,
    pattern: g.pattern,
    support: g.support,
    matchedBy: "",
  }));
  const gtByKey = new Map();
  resolvedGt.determinate.forEach((g, idx) => {
    const ks = useLenient ? g.lenientKeys : g.keys;
    ks.forEach((k, pos) => {
      if (!gtByKey.has(k)) {
        gtByKey.set(k, []);
      }
      gtByKey.get(k).push({ idx, pos });
    });
  });

  const preds = [...normalizedPred.relations].sort((x, y) => byString(x.key, y.key));
  const rank = (p, hit) => {
    const g = resolvedGt.determinate[hit.idx];
    const sameKind = g.kind === p.kind ? 0 : 2;
    return sameKind + (hit.pos === 0 ? 0 : 1);
  };
  const adjacency = preds.map((p) => {
    const hits = gtByKey.get(useLenient ? p.lenientKey : p.key) ?? [];
    const best = new Map();
    for (const h of hits) {
      const r = rank(p, h);
      if (!best.has(h.idx) || r < best.get(h.idx)) {
        best.set(h.idx, r);
      }
    }
    return [...best.entries()]
      .sort((x, y) => x[1] - y[1] || byString(resolvedGt.determinate[x[0]].id, resolvedGt.determinate[y[0]].id))
      .map(([idx]) => idx);
  });
  const { predToGt } = maximumMatching(adjacency, gtRows.length);

  const indeterminateRows = resolvedGt.indeterminate.map((e) => ({
    caseId: resolvedGt.caseId,
    mode,
    id: e.id,
    kind: e.kind,
    srcKey: e.srcKey,
    category: e.category,
    pattern: e.pattern,
    support: e.support,
    candidates: e.candidates === "unbounded" ? "unbounded" : e.candidates.map((c) => c.key).join(" ; "),
    reason: e.reason,
    excludedPredictions: [],
  }));

  const predRows = [];
  preds.forEach((p, pi) => {
    let verdict = "FP";
    let note = "";
    let category = predCategory(p);
    const g = predToGt[pi];
    if (g >= 0) {
      verdict = "TP";
      category = gtRows[g].category;
      gtRows[g].matchedBy = p.key;
    } else if (adjacency[pi].length > 0) {
      // Matched a GT relation that another prediction already took.
      note = useLenient ? "EXTRA-LENIENT" : "EXTRA-ALTERNATIVE";
    }
    if (verdict === "FP" && note === "") {
      const entryIdx = resolvedGt.indeterminate.findIndex((e) => matchesIndeterminate(p, e, mode));
      if (entryIdx >= 0) {
        verdict = "EXCLUDED";
        note = `EXCLUDED-INDETERMINATE:${resolvedGt.indeterminate[entryIdx].id}`;
        category = resolvedGt.indeterminate[entryIdx].category;
        indeterminateRows[entryIdx].excludedPredictions.push(p.key);
      }
    }
    predRows.push({
      caseId: resolvedGt.caseId,
      mode,
      side: "pred",
      key: p.key,
      kind: p.kind,
      category,
      verdict,
      note,
      occurrences: p.occurrences,
    });
  });

  const predKeys = new Set(normalizedPred.relations.map((p) => (useLenient ? p.lenientKey : p.key)));
  const negativeRows = resolvedGt.negatives.map((n) => ({
    caseId: resolvedGt.caseId,
    mode,
    id: n.id,
    kind: n.kind,
    key: n.key,
    category: n.category,
    pattern: n.pattern,
    violated: predKeys.has(useLenient ? n.lenientKey : n.key),
  }));

  for (const g of gtRows) {
    g.verdict = g.matchedBy ? "TP" : "FN";
  }
  for (const r of indeterminateRows) {
    r.excludedCount = r.excludedPredictions.length;
    r.excludedPredictions = r.excludedPredictions.join(" ; ");
  }

  const status = blockers.length > 0 ? "SCORING_BLOCKED" : "SCORED";
  for (const row of [...gtRows, ...predRows]) {
    row.caseStatus = status;
  }
  return {
    caseId: resolvedGt.caseId,
    mode,
    status,
    blockers,
    gtRows,
    predRows,
    indeterminateRows,
    negativeRows,
    collisions: normalizedPred.collisions ?? [],
    duplicates: normalizedPred.duplicates ?? [],
    malformed: normalizedPred.malformed ?? [],
    unknownNodes: normalizedPred.unknownNodes ?? [],
  };
}

// ---------------------------------------------------------------------------
// Metrics

export function safeDiv(num, den) {
  return den === 0 ? null : num / den;
}

export function f1(p, r) {
  if (p === null || r === null) {
    return null;
  }
  if (p + r === 0) {
    return 0;
  }
  return (2 * p * r) / (p + r);
}

// Wilson score interval (95% by default). Returns null bounds when n = 0.
export function wilson(successes, n, z = 1.959963984540054) {
  if (n === 0) {
    return { low: null, high: null };
  }
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

function countsFrom(gtRows, predRows) {
  const tpPred = predRows.filter((r) => r.verdict === "TP").length;
  const fp = predRows.filter((r) => r.verdict === "FP").length;
  const excluded = predRows.filter((r) => r.verdict === "EXCLUDED").length;
  const inScope = gtRows.filter((r) => r.support === "supported");
  const tpInScope = inScope.filter((r) => r.verdict === "TP").length;
  const tpOverall = gtRows.filter((r) => r.verdict === "TP").length;
  return {
    tpPred,
    fp,
    excluded,
    gtInScope: inScope.length,
    tpInScope,
    fnInScope: inScope.length - tpInScope,
    gtOverall: gtRows.length,
    tpOverall,
    fnOverall: gtRows.length - tpOverall,
  };
}

export function metricsFromCounts(c) {
  const precision = safeDiv(c.tpPred, c.tpPred + c.fp);
  const recallInScope = safeDiv(c.tpInScope, c.gtInScope);
  const recallOverall = safeDiv(c.tpOverall, c.gtOverall);
  const pCi = wilson(c.tpPred, c.tpPred + c.fp);
  const rInCi = wilson(c.tpInScope, c.gtInScope);
  const rOvCi = wilson(c.tpOverall, c.gtOverall);
  return {
    ...c,
    precision,
    precisionLow: pCi.low,
    precisionHigh: pCi.high,
    precisionSensitivity: safeDiv(c.tpPred, c.tpPred + c.fp + c.excluded),
    recallInScope,
    recallInScopeLow: rInCi.low,
    recallInScopeHigh: rInCi.high,
    recallOverall,
    recallOverallLow: rOvCi.low,
    recallOverallHigh: rOvCi.high,
    f1InScope: f1(precision, recallInScope),
    f1Overall: f1(precision, recallOverall),
  };
}

// Confirmatory aggregation uses SCORED cases only; SCORING_BLOCKED cases are
// listed in blockedCases and never contribute counts (P1-A-R1 fail-closed rule).
export function computeMetrics(allCaseResults, { categories = CATEGORIES } = {}) {
  const caseResults = allCaseResults.filter(isConfirmatory);
  const blockedCases = allCaseResults.filter((r) => !isConfirmatory(r)).map((r) => r.caseId);
  const gtRows = caseResults.flatMap((r) => r.gtRows);
  const predRows = caseResults.flatMap((r) => r.predRows);
  const seen = new Set([...categories, ...gtRows.map((r) => r.category), ...predRows.map((r) => r.category)]);
  const byCategory = [];
  for (const category of seen) {
    const g = gtRows.filter((r) => r.category === category);
    const p = predRows.filter((r) => r.category === category);
    byCategory.push({ category, ...metricsFromCounts(countsFrom(g, p)) });
  }
  const micro = { category: "micro", ...metricsFromCounts(countsFrom(gtRows, predRows)) };
  const macroOf = (field) => {
    const vals = byCategory.map((m) => m[field]).filter((v) => v !== null);
    return {
      value: vals.length === 0 ? null : vals.reduce((a, b) => a + b, 0) / vals.length,
      includedCategories: byCategory.filter((m) => m[field] !== null).map((m) => m.category),
    };
  };
  return {
    scoredCases: caseResults.length,
    blockedCases,
    byCategory,
    micro,
    macro: {
      f1InScope: macroOf("f1InScope"),
      f1Overall: macroOf("f1Overall"),
    },
  };
}

export function metricsByPattern(caseResults) {
  const gtRows = caseResults.filter(isConfirmatory).flatMap((r) => r.gtRows);
  const groups = new Map();
  for (const r of gtRows) {
    const k = `${r.pattern}|${r.category}|${r.support}`;
    if (!groups.has(k)) {
      groups.set(k, { pattern: r.pattern, category: r.category, support: r.support, gt: 0, tp: 0 });
    }
    const g = groups.get(k);
    g.gt += 1;
    if (r.verdict === "TP") {
      g.tp += 1;
    }
  }
  return [...groups.values()]
    .map((g) => ({ ...g, fn: g.gt - g.tp, recall: safeDiv(g.tp, g.gt) }))
    .sort((a, b) => (a.pattern < b.pattern ? -1 : 1));
}

// Deterministic PRNG (mulberry32) for bootstrap.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function percentile(sorted, q) {
  if (sorted.length === 0) {
    return null;
  }
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

// Cluster bootstrap over cases for micro F1 (in-scope and overall).
export function bootstrapMicroF1(caseResults, { resamples = 10000, seed = 20261026 } = {}) {
  const rand = mulberry32(seed);
  const perCase = caseResults.filter(isConfirmatory).map((r) => countsFrom(r.gtRows, r.predRows));
  const n = perCase.length;
  const inScope = [];
  const overall = [];
  let undefinedDraws = 0;
  for (let b = 0; b < resamples; b++) {
    const agg = { tpPred: 0, fp: 0, gtInScope: 0, tpInScope: 0, gtOverall: 0, tpOverall: 0 };
    for (let i = 0; i < n; i++) {
      const c = perCase[Math.floor(rand() * n)];
      agg.tpPred += c.tpPred;
      agg.fp += c.fp;
      agg.gtInScope += c.gtInScope;
      agg.tpInScope += c.tpInScope;
      agg.gtOverall += c.gtOverall;
      agg.tpOverall += c.tpOverall;
    }
    const p = safeDiv(agg.tpPred, agg.tpPred + agg.fp);
    const fIn = f1(p, safeDiv(agg.tpInScope, agg.gtInScope));
    const fOv = f1(p, safeDiv(agg.tpOverall, agg.gtOverall));
    if (fIn === null || fOv === null) {
      undefinedDraws += 1;
      continue;
    }
    inScope.push(fIn);
    overall.push(fOv);
  }
  inScope.sort((a, b) => a - b);
  overall.sort((a, b) => a - b);
  return {
    resamples,
    seed,
    undefinedDraws,
    f1InScope: { low: percentile(inScope, 0.025), high: percentile(inScope, 0.975) },
    f1Overall: { low: percentile(overall, 0.025), high: percentile(overall, 0.975) },
  };
}

// Cohen's kappa for two label sequences of equal length.
// Returns { n, observed, expected, kappa } ; kappa is null when n = 0 or expected = 1.
export function cohenKappa(a, b) {
  if (a.length !== b.length) {
    throw new Error("label sequences must have equal length");
  }
  const n = a.length;
  if (n === 0) {
    return { n, observed: null, expected: null, kappa: null };
  }
  const labels = [...new Set([...a, ...b])];
  let agree = 0;
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) {
      agree += 1;
    }
  }
  const observed = agree / n;
  let expected = 0;
  for (const l of labels) {
    const pa = a.filter((x) => x === l).length / n;
    const pb = b.filter((x) => x === l).length / n;
    expected += pa * pb;
  }
  const kappa = expected === 1 ? null : (observed - expected) / (1 - expected);
  return { n, observed, expected, kappa };
}

// Seeded Fisher-Yates shuffle (returns a new array).
export function seededShuffle(items, seed) {
  const rand = mulberry32(seed);
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
