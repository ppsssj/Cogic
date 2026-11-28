// Strict CSV check of extracted forms (RFC 4180): wrong column count, or text right after a closing
// quote (e.g. a backslash-escaped quote \" inside a quoted field). Reports rows; changes nothing.
//   node csv-check.mjs <forms folder>
import fs from "node:fs";
import path from "node:path";
const dir = process.argv[2];
const out = [];
for (const f of ["relations", "negatives", "sites", "ambiguities", "outside-definitions"]) {
  const t = fs.readFileSync(path.join(dir, `${f}.csv`), "utf8").replace(/\r\n/g, "\n");
  const rows = [];
  let row = [], cell = "", q = false, bad = false, closed = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"' && t[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') { q = false; closed = true; } else cell += c;
      continue;
    }
    if (c === "," || c === "\n") {
      row.push(cell); cell = ""; closed = false;
      if (c === "\n") { rows.push({ row, bad }); row = []; bad = false; }
    } else if (c === '"' && cell === "") q = true;
    else { if (closed || c === '"') bad = true; cell += c; }
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push({ row, bad }); }
  const [head, ...body] = rows.filter((r) => r.row.some((x) => x.trim()));
  for (const { row: r, bad: b } of body) {
    if (r.length !== head.row.length || b) out.push({ form: f, blindId: r[1], no: r[2], columns: r.length, expected: head.row.length, ...(b ? { error: "text after closing quote" } : {}) });
  }
}
console.log(JSON.stringify(out, null, 1));
