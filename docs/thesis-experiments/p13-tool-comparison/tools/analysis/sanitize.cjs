// Replaces local absolute paths in text files with placeholders (for the public repo). node sanitize.cjs <file...>
"use strict";
const fs = require("node:fs");
const SEP = String.raw`(?:\\\\|\\|/)+`;
const rules = [
  [new RegExp(String.raw`c:${SEP}dev${SEP}p11${SEP}work`, "gi"), "<WORK>"],
  [new RegExp(String.raw`c:${SEP}dev${SEP}p11`, "gi"), "<P11>"],
  [new RegExp(String.raw`c:${SEP}dev${SEP}p13`, "gi"), "<P13>"],
  [new RegExp(String.raw`c:${SEP}dev${SEP}Cogic-P4-e2e-restored`, "gi"), "<HARNESS_WORKDIR>"],
  [new RegExp(String.raw`c:${SEP}dev${SEP}Cogic-P4-restored`, "gi"), "<COGIC_REPO>"],
  [new RegExp(String.raw`c:${SEP}dev${SEP}research-results`, "gi"), "<RESULTS>"],
  [new RegExp(String.raw`c:${SEP}Users${SEP}[^\\/"' ]+`, "gi"), "<HOME>"],
];
let left = 0;
for (const f of process.argv.slice(2)) {
  let s = fs.readFileSync(f, "utf8");
  for (const [re, to] of rules) s = s.replace(re, to);
  fs.writeFileSync(f, s);
  const m = s.match(/[a-z]:[\\/]{1,2}(dev|users)/gi); if (m) { left += m.length; console.log(`${f}: ${m.length} unreplaced`); }
}
console.log(`sanitized ${process.argv.length - 2} files; unreplaced=${left}`);
