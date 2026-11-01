import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
const root=import.meta.dirname;
const manifest=JSON.parse(await fs.readFile(path.join(root,'public-assets.json'),'utf8'));
if(manifest.schema!==1||manifest.origin!=='https://vn-keen.skin')throw Error('Invalid asset manifest');
let restored=0,valid=0;
const queue=[...manifest.assets];
async function worker(){while(queue.length){const a=queue.shift();
 if(!/^public\/[a-zA-Z0-9_./-]+$/.test(a.path)||a.path.includes('..')||!Number.isInteger(a.size)||a.size<1||a.size>25*1024*1024||!/^[a-f0-9]{64}$/.test(a.sha256))throw Error('Invalid asset entry');
 const file=path.resolve(root,a.path);if(!file.startsWith(path.join(root,'public')+path.sep))throw Error('Asset path outside public');
 try{const data=await fs.readFile(file);if(data.length===a.size&&crypto.createHash('sha256').update(data).digest('hex')===a.sha256){valid++;continue;}}catch(error){if(error.code!=='ENOENT')throw error;}
 const url=manifest.origin+'/'+a.path.slice('public/'.length);const r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(120000)});if(!r.ok)throw Error('Download failed: '+a.path);
 const chunks=[];let size=0;for await(const c of r.body){size+=c.length;if(size>a.size)throw Error('Asset exceeds expected size');chunks.push(c);}const data=Buffer.concat(chunks);
 if(size!==a.size||crypto.createHash('sha256').update(data).digest('hex')!==a.sha256)throw Error('Asset checksum mismatch: '+a.path);
 await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file+'.download',data);await fs.rename(file+'.download',file);restored++;
}}
await Promise.all([worker(),worker()]);console.log(`Assets verified: ${valid}; restored: ${restored}.`);
