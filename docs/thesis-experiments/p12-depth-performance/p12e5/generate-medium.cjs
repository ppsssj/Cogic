// Generate only into a fresh, explicitly supplied directory.
const fs=require('node:fs'),path=require('node:path');
const dest=process.argv[2], count=Number(process.argv[3]||'200');
if(!dest||!Number.isInteger(count)||count<10||count>500)throw Error('usage: node generate-medium.cjs <new-directory> [10..500]');
fs.mkdirSync(dest,{recursive:false});fs.mkdirSync(path.join(dest,'src'));
let s='// Deterministic synthetic project; no Vite files.\n';
for(let i=0;i<count;i++)s+=`export function fn${i}(x: number): number { return ${i?`fn${i-1}(x)`: 'x'} + ${i}; }\n`;
fs.writeFileSync(path.join(dest,'src','entry.ts'),s);
fs.writeFileSync(path.join(dest,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2022',module:'commonjs',strict:true},include:['src/**/*.ts']},null,2)+'\n');
console.log(JSON.stringify({dest:path.resolve(dest),count}));
