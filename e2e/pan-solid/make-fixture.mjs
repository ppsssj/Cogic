// Deterministic benchmark project (from P15-Z0, PR #52). src/main.ts imports one hub per folder, each hub
// imports the leaf files of its folder, and every leaf function calls two functions in other
// folders. From main.ts every file is within depth 2.
import fs from "node:fs";
import path from "node:path";

export const SHAPE = { folders: 8, leaves: 6, functions: 6 };

const fn = (f, l, k) => `f${f}_l${l}_${k}`;

export function makeFixture(root, shape = SHAPE) {
  const { folders: F, leaves: L, functions: K } = shape;
  const write = (rel, text) => {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  write("tsconfig.json", JSON.stringify({ compilerOptions: { target: "ES2020", module: "commonjs", strict: true } }, null, 2));
  for (let f = 0; f < F; f++) {
    for (let l = 0; l < L; l++) {
      const imports = new Map();
      const body = [];
      for (let k = 0; k < K; k++) {
        const calls = [1, 2].map((d) => {
          const tf = (f + d + k) % F === f ? (f + 1) % F : (f + d + k) % F;
          const tl = (l + d) % L;
          const tk = (k + d) % K;
          const target = fn(tf, tl, tk);
          const from = `../f${tf}/l${tl}`;
          if (!imports.has(from)) imports.set(from, new Set());
          imports.get(from).add(target);
          return target;
        });
        body.push(`export function ${fn(f, l, k)}(value${k}: number): number { return ${calls[0]}(value${k}) + ${calls[1]}(value${k} + 1); }`);
      }
      const head = [...imports].map(([from, names]) => `import { ${[...names].sort().join(", ")} } from "${from}";`);
      write(`src/f${f}/l${l}.ts`, [...head, ...body, ""].join("\n"));
    }
    const hubImports = Array.from({ length: L }, (_, l) => `import { ${fn(f, l, 0)} } from "./l${l}";`);
    const hubCalls = Array.from({ length: L }, (_, l) => `${fn(f, l, 0)}(input)`).join(" + ");
    write(`src/f${f}/hub.ts`, [...hubImports, `export function hub${f}(input: number): number { return ${hubCalls}; }`, ""].join("\n"));
  }
  const mainImports = Array.from({ length: F }, (_, f) => `import { hub${f} } from "./f${f}/hub";`);
  const mainCalls = Array.from({ length: F }, (_, f) => `hub${f}(n)`).join(" + ");
  write("src/main.ts", [...mainImports, `export function main(n: number): number { return ${mainCalls}; }`, "main(1);", ""].join("\n"));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))) {
  makeFixture(process.argv[2] ?? "fixture-out");
}
