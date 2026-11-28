// Formatting-only derivative: wraps each bare CSV table of a raw AI response in the
// ```csv <form> fence that RESPONSE_FORMAT.md requires. Only fence lines are INSERTED;
// no raw line is changed, removed or reordered. Verified by removing the inserted lines.
//   node fence-derive.mjs <raw file> <new out file> [forms template dir]
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
const [raw, out, formsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../p14c-protocol/human-review/packet-template/forms")] = process.argv.slice(2);
const FORMS = ["relations", "negatives", "sites", "ambiguities", "outside-definitions"];
const HEAD = Object.fromEntries(FORMS.map((f) => [fs.readFileSync(path.join(formsDir, `${f}.csv`), "utf8").trim(), f]));
const text = fs.readFileSync(raw, "utf8");
const eol = text.includes("\r\n") ? "\r\n" : "\n";
const lines = text.split(eol);
if (lines.some((l) => /^```csv/.test(l))) throw new Error("already fenced; no derivative needed");
const res = [];
const inserted = new Set();
let open = null;
const close = () => { inserted.add(res.length); res.push("```"); open = null; };
for (const l of lines) {
  const form = HEAD[l.trim()];
  if (open && (l.trim() === "" || form)) close();
  if (form) { inserted.add(res.length); res.push(`\`\`\`csv ${form}`); open = form; }
  res.push(l);
}
if (open) { // trailing table at EOF: close before the final empty element if any
  if (res[res.length - 1] === "") { res.splice(res.length - 1, 0, "```"); inserted.add(res.length - 2); } else close();
}
const back = res.filter((_, i) => !inserted.has(i)).join(eol);
if (back !== text) throw new Error("reversibility check failed");
const derived = res.join(eol);
fs.writeFileSync(out, derived, { flag: "wx" });
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
console.log(JSON.stringify({ raw: path.basename(raw), rawSha256: sha(fs.readFileSync(raw)), derivedSha256: sha(fs.readFileSync(out)), fencesInserted: inserted.size, forms: res.filter((l) => /^```csv /.test(l)).map((l) => l.slice(7)) }));
