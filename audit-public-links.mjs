import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'public');let checked=0;const missing=[];
function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,entry.name);if(entry.isDirectory())walk(p);else if(/\.(html|css)$/.test(p)){
 const body=fs.readFileSync(p,'utf8');const refs=p.endsWith('.html')?[...body.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/g)].map(m=>m[1]):[];
 if(p.endsWith('.css'))refs.push(...[...body.matchAll(/url\(\s*["']?([^\s)'"\n]+)["']?\s*\)/g)].map(m=>m[1]));
 for(const ref of refs){if(!ref||ref.startsWith('#')||ref.startsWith('//')||/^[a-z][a-z0-9+.-]*:/i.test(ref)||ref.includes('${')||ref.includes('<'))continue;
 const relative=decodeURIComponent(ref.split(/[?#]/)[0]);if(!relative||relative.startsWith('/api/')||relative.startsWith('/cdn-cgi/'))continue;
 const target=relative.startsWith('/')?path.join(root,relative):path.resolve(path.dirname(p),relative);checked++;
 if(!fs.existsSync(target)&&!fs.existsSync(target+'.html'))missing.push({file:path.relative(root,p),ref});
 }
}}}
walk(root);console.log(JSON.stringify({checked,missing},null,2));if(missing.length)process.exitCode=1;
