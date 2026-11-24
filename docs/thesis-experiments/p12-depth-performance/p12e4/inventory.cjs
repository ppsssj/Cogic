const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const vite=process.argv[2]||'C:/dev/p11/projects/vite', cogic=process.argv[3]||'C:/dev/Cogic-P4-restored', ext=process.argv[4]||'C:/dev/p13/p12c2-extensions/ppsssj.cogic-0.0.6';
function info(p) {try {const st=fs.lstatSync(p),r=fs.realpathSync(p),pkg=JSON.parse(fs.readFileSync(path.join(p,'package.json'),'utf8'));return {requested:p,realpath:r,symlink:st.isSymbolicLink(),name:pkg.name,version:pkg.version,packageJsonSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(p,'package.json'))).digest('hex')};} catch(e){return {requested:p,error:String(e)};}}
function hash(p){try{return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')}catch{return null}}
const store=path.join(vite,'node_modules/.pnpm');
const o={utc:new Date().toISOString(),node:process.version,cwd:process.cwd(),viteTypes:info(path.join(vite,'node_modules/@types/node')),viteTypeScript:info(path.join(vite,'node_modules/typescript')),cogicTypes:info(path.join(cogic,'node_modules/@types/node')),extensionTypeScript:info(path.join(ext,'node_modules/typescript')),viteLockSha256:hash(path.join(vite,'pnpm-lock.yaml')),cogicLockSha256:hash(path.join(cogic,'package-lock.json')),vitePnpmDirectories:fs.existsSync(store)?fs.readdirSync(store).sort():null};
console.log(JSON.stringify(o,null,2));
