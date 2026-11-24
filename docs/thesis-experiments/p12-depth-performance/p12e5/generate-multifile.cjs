// Creates a new deterministic multi-file study workspace, never overwrites.
const fs=require('node:fs'),path=require('node:path');
const dest=process.argv[2];if(!dest)throw Error('usage: node generate-multifile.cjs <new-directory>');
fs.mkdirSync(dest,{recursive:false});for(const d of ['src','src/alpha','src/beta','src/beta/deep'])fs.mkdirSync(path.join(dest,d),{recursive:true});
for(const [file,prefix] of [['src/alpha/a.ts','alpha'],['src/beta/b.ts','beta'],['src/beta/deep/c.ts','gamma']]){let s='';for(let i=0;i<60;i++)s+=`export function ${prefix}${i}(x: number): number { return ${i?`${prefix}${i-1}(x)`:'x'} + ${i}; }\n`;fs.writeFileSync(path.join(dest,file),s);}
fs.writeFileSync(path.join(dest,'src/main.ts'),'import { alpha59 } from "./alpha/a";\nimport { beta59 } from "./beta/b";\nimport { gamma59 } from "./beta/deep/c";\nexport function main(x: number): number { return alpha59(x) + beta59(x) + gamma59(x); }\n');
fs.writeFileSync(path.join(dest,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2022',module:'commonjs',strict:true},include:['src/**/*.ts']},null,2)+'\n');console.log(JSON.stringify({workspace:path.resolve(dest),files:4,functions:181}));
