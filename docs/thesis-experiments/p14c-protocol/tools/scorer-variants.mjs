// P14-C: scorer variants for the lenient-matching audit. Audit tool only.
//
// It does NOT change the scorer: tools/exp01/lib.mjs (exp01-scorer/1.2) stays the reference, and
// none of the candidate rules below is adopted. With every option at its default, scoreCaseVariant
// reproduces lib.mjs scoreCase row for row; lenient-audit.mjs checks that on real predictions.
//
// Options (each is a candidate rule, see ../lenient-scorer-audit.md):
//   matching: "kuhn"     (current) maximum matching, predictions processed in key order; the
//                        kind preference only orders each prediction's own GT list.
//             "mincost"  (candidate L1) maximum matching of minimum total cost: same kind and
//                        primary target 0, same kind alternative 1, other structural kind 2 / 3.
//   indeterminateBeforeExtra: false (current) a prediction that lost its GT to another prediction
//                        is an FP ("EXTRA-*") and is never compared with indeterminate entries.
//                        true (candidate L2) it is checked against indeterminate entries first.
//   lenientNegatives: "lenientKey" (current) a lenient negative is violated by any structural kind
//                        on the same endpoints. "sameKind" (candidate L3) only by its own kind.
//   lenientCollapse: false (current) every distinct (kind, endpoints) prediction counts once, also
//                        in lenient mode. true (candidate L4) lenient mode counts one prediction per
//                        lenient key (endpoints); the others are rows with verdict "COLLAPSED",
//                        which no metric counts. Kept: the one whose kind matches a determinate GT
//                        relation of that key, else one matching an indeterminate entry by kind,
//                        else the smallest key.
import {
  STRUCTURAL_KINDS,
  categoryFor,
  maximumMatching,
  scoringBlockers,
} from "../../tools/exp01/lib.mjs";

const byString = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function matchesIndeterminate(p, entry, mode) {
  // Same rule as lib.mjs (not exported there).
  if (entry.srcKey !== p.srcKey) return false;
  if (mode === "strict") {
    if (entry.kind !== p.kind) return false;
    if (entry.candidates === "unbounded") return true;
    return entry.candidates.some((c) => c.key === p.key);
  }
  const bothStructural = STRUCTURAL_KINDS.has(entry.kind) && STRUCTURAL_KINDS.has(p.kind);
  if (!bothStructural && entry.kind !== p.kind) return false;
  if (entry.candidates === "unbounded") return true;
  return entry.candidates.some((c) => c.lenientKey === p.lenientKey);
}

// Maximum-cardinality matching of minimum total cost (successive shortest paths, Bellman-Ford).
// edges[p] = [{ g, cost }] in a fixed order, so the result is deterministic.
export function minCostMaximumMatching(edges, gtCount) {
  const P = edges.length;
  const predToGt = new Array(P).fill(-1);
  const gtToPred = new Array(gtCount).fill(-1);
  for (;;) {
    // nodes: preds 0..P-1, gts P..P+G-1; source -> free preds (0), pred -> gt (cost) if not matched
    // that way, gt -> its pred (-cost) on matched pairs, free gt -> sink.
    const dist = new Array(P + gtCount).fill(Infinity);
    const prev = new Array(P + gtCount).fill(-1);
    for (let p = 0; p < P; p++) if (predToGt[p] === -1) dist[p] = 0;
    for (let iter = 0; iter < P + gtCount; iter++) {
      let changed = false;
      for (let p = 0; p < P; p++) {
        if (dist[p] === Infinity) continue;
        for (const { g, cost } of edges[p]) {
          if (predToGt[p] === g) continue;
          const d = dist[p] + cost;
          if (d < dist[P + g]) {
            dist[P + g] = d;
            prev[P + g] = p;
            changed = true;
          }
        }
      }
      for (let g = 0; g < gtCount; g++) {
        const p = gtToPred[g];
        if (p === -1 || dist[P + g] === Infinity) continue;
        const back = edges[p].find((e) => e.g === g).cost;
        const d = dist[P + g] - back;
        if (d < dist[p]) {
          dist[p] = d;
          prev[p] = P + g;
          changed = true;
        }
      }
      if (!changed) break;
    }
    let best = -1;
    for (let g = 0; g < gtCount; g++) {
      if (gtToPred[g] !== -1 || dist[P + g] === Infinity) continue;
      if (best === -1 || dist[P + g] < dist[P + best]) best = g;
    }
    if (best === -1) break;
    // augment along prev
    let g = best;
    for (;;) {
      const p = prev[P + g];
      const prevG = predToGt[p];
      predToGt[p] = g;
      gtToPred[g] = p;
      if (prev[p] === -1 || prevG === -1) break;
      g = prevG;
    }
  }
  return { predToGt, gtToPred };
}

function collapseLenient(resolvedGt, relations) {
  const groups = new Map();
  for (const p of [...relations].sort((x, y) => byString(x.key, y.key))) {
    if (!groups.has(p.lenientKey)) groups.set(p.lenientKey, []);
    groups.get(p.lenientKey).push(p);
  }
  const kept = [];
  const collapsed = [];
  for (const members of groups.values()) {
    const gtKind = (p) => resolvedGt.determinate.some((g) => g.kind === p.kind && g.lenientKeys.includes(p.lenientKey));
    const indKind = (p) => resolvedGt.indeterminate.some((e) => e.kind === p.kind && e.srcKey === p.srcKey);
    const keep = members.find(gtKind) ?? members.find(indKind) ?? members[0];
    kept.push(keep);
    for (const m of members) if (m !== keep) collapsed.push({ p: m, into: keep.key });
  }
  return { kept, collapsed };
}

export function scoreCaseVariant(resolvedGt, normalizedPred, mode = "strict", options = {}) {
  if (options.lenientCollapse && mode === "lenient") {
    const { kept, collapsed } = collapseLenient(resolvedGt, normalizedPred.relations);
    const r = scoreCaseVariant(resolvedGt, { ...normalizedPred, relations: kept }, mode, { ...options, lenientCollapse: false });
    for (const { p, into } of collapsed) {
      r.predRows.push({ caseId: resolvedGt.caseId, mode, side: "pred", key: p.key, kind: p.kind, category: categoryFor(p.kind, p.sourceFramework), verdict: "COLLAPSED", note: `COLLAPSED-INTO:${into}`, occurrences: p.occurrences, caseStatus: r.status });
    }
    // negatives are judged on every prediction, as without collapsing
    const all = scoreCaseVariant(resolvedGt, normalizedPred, mode, { ...options, lenientCollapse: false });
    r.negativeRows = all.negativeRows;
    return r;
  }
  const { matching = "kuhn", indeterminateBeforeExtra = false, lenientNegatives = "lenientKey" } = options;
  const useLenient = mode === "lenient";
  const blockers = scoringBlockers(normalizedPred);
  const gtRows = resolvedGt.determinate.map((g) => ({
    caseId: resolvedGt.caseId, mode, side: "gt", id: g.id, kind: g.kind, key: g.keys[0],
    category: g.category, pattern: g.pattern, support: g.support, matchedBy: "",
  }));
  const gtByKey = new Map();
  resolvedGt.determinate.forEach((g, idx) => {
    (useLenient ? g.lenientKeys : g.keys).forEach((k, pos) => {
      if (!gtByKey.has(k)) gtByKey.set(k, []);
      gtByKey.get(k).push({ idx, pos });
    });
  });
  const preds = [...normalizedPred.relations].sort((x, y) => byString(x.key, y.key));
  const rank = (p, hit) => (resolvedGt.determinate[hit.idx].kind === p.kind ? 0 : 2) + (hit.pos === 0 ? 0 : 1);
  const ranked = preds.map((p) => {
    const best = new Map();
    for (const h of gtByKey.get(useLenient ? p.lenientKey : p.key) ?? []) {
      const r = rank(p, h);
      if (!best.has(h.idx) || r < best.get(h.idx)) best.set(h.idx, r);
    }
    return [...best.entries()].sort((x, y) => x[1] - y[1] || byString(resolvedGt.determinate[x[0]].id, resolvedGt.determinate[y[0]].id));
  });
  const adjacency = ranked.map((list) => list.map(([idx]) => idx));
  const { predToGt } = matching === "mincost"
    ? minCostMaximumMatching(ranked.map((list) => list.map(([g, cost]) => ({ g, cost }))), gtRows.length)
    : maximumMatching(adjacency, gtRows.length);

  const indeterminateRows = resolvedGt.indeterminate.map((e) => ({
    caseId: resolvedGt.caseId, mode, id: e.id, kind: e.kind, srcKey: e.srcKey, category: e.category,
    pattern: e.pattern, support: e.support,
    candidates: e.candidates === "unbounded" ? "unbounded" : e.candidates.map((c) => c.key).join(" ; "),
    reason: e.reason, excludedPredictions: [],
  }));
  const predRows = [];
  preds.forEach((p, pi) => {
    let verdict = "FP";
    let note = "";
    let category = categoryFor(p.kind, p.sourceFramework);
    const g = predToGt[pi];
    if (g >= 0) {
      verdict = "TP";
      category = gtRows[g].category;
      gtRows[g].matchedBy = p.key;
    } else if (adjacency[pi].length > 0) {
      note = useLenient ? "EXTRA-LENIENT" : "EXTRA-ALTERNATIVE";
    }
    if (verdict === "FP" && (note === "" || indeterminateBeforeExtra)) {
      const entryIdx = resolvedGt.indeterminate.findIndex((e) => matchesIndeterminate(p, e, mode));
      if (entryIdx >= 0) {
        verdict = "EXCLUDED";
        note = `EXCLUDED-INDETERMINATE:${resolvedGt.indeterminate[entryIdx].id}`;
        category = resolvedGt.indeterminate[entryIdx].category;
        indeterminateRows[entryIdx].excludedPredictions.push(p.key);
      }
    }
    predRows.push({ caseId: resolvedGt.caseId, mode, side: "pred", key: p.key, kind: p.kind, category, verdict, note, occurrences: p.occurrences });
  });
  const violatedBy = (n) => {
    if (!useLenient) return normalizedPred.relations.some((p) => p.key === n.key);
    if (lenientNegatives === "sameKind") return normalizedPred.relations.some((p) => p.lenientKey === n.lenientKey && p.kind === n.kind);
    return normalizedPred.relations.some((p) => p.lenientKey === n.lenientKey);
  };
  const negativeRows = resolvedGt.negatives.map((n) => ({
    caseId: resolvedGt.caseId, mode, id: n.id, kind: n.kind, key: n.key, category: n.category, pattern: n.pattern, violated: violatedBy(n),
  }));
  for (const r of gtRows) r.verdict = r.matchedBy ? "TP" : "FN";
  for (const r of indeterminateRows) {
    r.excludedCount = r.excludedPredictions.length;
    r.excludedPredictions = r.excludedPredictions.join(" ; ");
  }
  const status = blockers.length > 0 ? "SCORING_BLOCKED" : "SCORED";
  for (const row of [...gtRows, ...predRows]) row.caseStatus = status;
  return {
    caseId: resolvedGt.caseId, mode, status, blockers, gtRows, predRows, indeterminateRows, negativeRows,
    collisions: normalizedPred.collisions ?? [], duplicates: normalizedPred.duplicates ?? [],
    malformed: normalizedPred.malformed ?? [], unknownNodes: normalizedPred.unknownNodes ?? [],
  };
}

/** The verdict of every row, for comparing two scorings of the same case. */
export function verdictMap(result) {
  const m = new Map();
  for (const r of result.gtRows) m.set(`gt|${r.id}`, `${r.verdict}|${r.matchedBy}`);
  for (const r of result.predRows) m.set(`pred|${r.key}`, `${r.verdict}|${r.note}|${r.category}`);
  for (const r of result.negativeRows) m.set(`neg|${r.id}`, String(r.violated));
  for (const r of result.indeterminateRows) m.set(`ind|${r.id}`, r.excludedPredictions);
  return m;
}

export function diffVerdicts(a, b) {
  const ma = verdictMap(a);
  const mb = verdictMap(b);
  const out = [];
  for (const k of new Set([...ma.keys(), ...mb.keys()])) if (ma.get(k) !== mb.get(k)) out.push({ row: k, from: ma.get(k) ?? null, to: mb.get(k) ?? null });
  return out;
}
