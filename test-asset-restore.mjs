import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const folder=await fs.mkdtemp(path.join(os.tmpdir(),'vnkeen-asset-restore-test-'));
assert.ok(path.resolve(folder).startsWith(path.resolve(os.tmpdir())+path.sep));
const originalFetch=globalThis.fetch;
try{
 const data=Buffer.from('verified-model-fixture');
 const manifest={schema:1,origin:'https://vn-keen.skin',fallbackOrigin:'https://0bee64a8.vn-keen.pages.dev',assets:[{path:'public/models/fixture.glb',size:data.length,sha256:createHash('sha256').update(data).digest('hex')}]};
 await fs.writeFile(path.join(folder,'public-assets.json'),JSON.stringify(manifest));
 await fs.copyFile(new URL('./restore-public-assets.mjs',import.meta.url),path.join(folder,'restore.mjs'));
 const calls=[];globalThis.fetch=async url=>{calls.push(url);return new Response(url.startsWith(manifest.origin)?'<html>missing</html>':data)};
 const module=pathToFileURL(path.join(folder,'restore.mjs')).href;
 await import(module);assert.equal(calls.length,2);assert.deepEqual(await fs.readFile(path.join(folder,'public/models/fixture.glb')),data);
 await fs.unlink(path.join(folder,'public/models/fixture.glb'));
 globalThis.fetch=async()=>new Response('<html>missing</html>');
 await assert.rejects(import(module+'?bad-hash'),/checksum|expected size/);
 manifest.assets[0].path='public/../escape.glb';await fs.writeFile(path.join(folder,'public-assets.json'),JSON.stringify(manifest));
 await assert.rejects(import(module+'?bad-path'),/Invalid asset entry/);
 console.log('PASS: SPA HTML rejected, pinned fallback restored verified bytes, bad hashes and path traversal rejected.');
}finally{globalThis.fetch=originalFetch;await fs.rm(folder,{recursive:true,force:true});}
