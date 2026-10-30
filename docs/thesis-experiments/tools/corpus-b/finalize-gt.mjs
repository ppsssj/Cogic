// Corpus B (P1-K1): apply the reviewer's decisions to an annotate-assist draft and write expected.json.
// Each case has a review module (corpus-b/review/<caseId>.mjs) that exports `apply(gt, h)`; the
// review modules are the auditable record of every change made to the machine draft.
import fs from "node:fs";
import path from "node:path";

export function helpers(gt) {
  // An item is selected by "kind source target[#argIndex]" (stable across draft re-generation) or by id.
  const rel = (sel) => {
    let r;
    if (/\s/.test(sel)) {
      const [kind, source, targetSpec = ""] = sel.split(/\s+/);
      const [target, arg] = targetSpec.split("#");
      const hits = [...gt.relations, ...gt.negatives].filter((x) => x.kind === kind && x.source === source && (x.target ?? "") === target && (arg === undefined || String(x.argIndex) === arg));
      if (hits.length > 1) throw new Error(`${gt.caseId}: selector "${sel}" is ambiguous`);
      r = hits[0];
    } else {
      r = gt.relations.find((x) => x.id === sel) ?? gt.negatives.find((x) => x.id === sel);
    }
    if (!r) throw new Error(`${gt.caseId}: no item ${sel}`);
    return r;
  };
  let nextR = Math.max(0, ...gt.relations.filter((r) => r.id.startsWith("R")).map((r) => Number(r.id.slice(1)))) + 1;
  let nextI = Math.max(0, ...gt.relations.filter((r) => r.id.startsWith("I")).map((r) => Number(r.id.slice(1)))) + 1;
  let nextN = Math.max(0, ...gt.negatives.map((r) => Number(r.id.slice(1)))) + 1;
  const pad = (n) => String(n).padStart(2, "0");
  const f = gt.activeFile;
  return {
    ev: (...lines) => lines.map((l) => `${f}:${l}`),
    rel,
    set(id, fields) {
      Object.assign(rel(id), fields);
    },
    note(id, text) {
      rel(id).note = text;
    },
    drop(sel, why) {
      const r = rel(sel);
      gt.relations.splice(gt.relations.indexOf(r), 1);
      (gt.reviewLog ??= []).push(`dropped draft ${r.id} (${sel}): ${why}`);
    },
    node(n) {
      if (!gt.nodes.some((x) => x.id === n.id)) gt.nodes.push(n);
      return n.id;
    },
    setNode(id, fields) {
      Object.assign(gt.nodes.find((x) => x.id === id), fields);
    },
    add(r) {
      const id = r.gtStatus === "indeterminate" ? `I${pad(nextI++)}` : `R${pad(nextR++)}`;
      gt.relations.push({ id, ...r });
      return id;
    },
    neg(r) {
      const id = `N${pad(nextN++)}`;
      gt.negatives.push({ id, ...r });
      return id;
    },
    exclude(line, reason) {
      gt.excludedSites.push({ site: `${f}:${line}`, reason });
    },
    unexclude(line) {
      gt.excludedSites = gt.excludedSites.filter((s) => s.site !== `${f}:${line}`);
    },
  };
}

export function finalize(draft, review) {
  const gt = JSON.parse(JSON.stringify(draft));
  review.apply(gt, helpers(gt));
  // excludedSites only for lines that no relation / negative cites
  const cited = new Set([...gt.relations, ...gt.negatives].flatMap((r) => r.evidence ?? []));
  gt.excludedSites = gt.excludedSites.filter((s, i, all) => !cited.has(s.site) && all.findIndex((x) => x.site === s.site) === i);
  // drop nodes no item uses (keep the file node)
  const used = new Set(["file"]);
  for (const r of [...gt.relations, ...gt.negatives]) {
    used.add(r.source);
    if (r.target) used.add(r.target);
    for (const c of Array.isArray(r.candidates) ? r.candidates : []) used.add(c.target);
  }
  gt.nodes = gt.nodes.filter((n) => used.has(n.id));
  const { reviewLog, ...out } = gt;
  return { gt: out, reviewLog: reviewLog ?? [] };
}

export async function finalizeCase(caseDir, draftPath, reviewPath) {
  const draft = JSON.parse(fs.readFileSync(draftPath, "utf8"));
  const review = await import(new URL(`file:///${path.resolve(reviewPath).replace(/\\/g, "/")}`).href);
  const { gt, reviewLog } = finalize(draft, review);
  fs.writeFileSync(path.join(caseDir, "expected.json"), `${JSON.stringify(gt, null, 2)}\n`);
  return { gt, reviewLog };
}
