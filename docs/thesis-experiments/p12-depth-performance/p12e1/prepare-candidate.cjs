// Experimental A only: retain the already computed key alongside its validated entry.
// Apply only to a disposable compiled extension copy.
const fs = require('node:fs');
const file = process.argv[2];
if (!file || !fs.existsSync(file)) throw Error('isolated analyze.js required');
let source = fs.readFileSync(file, 'utf8');
const from = `        return entry;\n    }\n    /** Records the Program just built`;
const to = `        return [key, entry];\n    }\n    /** Records the Program just built`;
if (source.split(from).length !== 2) throw Error('reuse return anchor');
source = source.replace(from, to);
const before = `                    served.set(normalizeCachePath(requested), reused);\n                    return reused.sourceFile;`;
const after = `                    served.set(reused[0], reused[1]);\n                    return reused[1].sourceFile;`;
if (source.split(before).length !== 2) throw Error('reuse caller anchor');
source = source.replace(before, after);
fs.writeFileSync(file, source);
