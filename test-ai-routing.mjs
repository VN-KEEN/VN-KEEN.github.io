import assert from 'node:assert/strict';
let id=0;
const fresh=()=>import('./ai-router.mjs?test='+id++);
const response=(status,data)=>new Response(JSON.stringify(data),{status});
const answer={candidates:[{content:{parts:[{text:'Xin chào'}]}}]};
const contents=[{role:'user',parts:[{text:'Chào'}]}];
{
 const {routeChat}=await fresh(); let calls=[];
 const mock=async(url)=>{calls.push(url);return response(calls.length===1?429:200,calls.length===1?{}:answer);};
 assert.equal((await routeChat('test',contents,'Support',mock)).ok,true);
 assert.equal(calls.length,2);
 const failed=calls[0]; calls=[];
 await routeChat('test',contents,'Support',mock);
 assert.ok(!calls.includes(failed));
}
{
 const {routeChat}=await fresh();let count=0;
 const result=await routeChat('test',contents,'Support',async()=>{count++;return response(403,{error:{message:'Invalid key'}});});
 assert.equal(count,1);assert.equal(result.ok,false);
}
{
 const {routeChat}=await fresh();let count=0;
 const result=await routeChat('test',contents,'Support',async()=>{count++;return response(400,{error:{message:'User location is not supported'}});});
 assert.equal(count,1);assert.equal(result.geo_blocked,true);
}
{
 const {routeChat}=await fresh();let count=0;
 const result=await routeChat('test',contents,'Support',async()=>{count++;return response(503,{});});
 assert.equal(count,9);assert.equal(result.ok,false);
}
{
 const {routeChat}=await fresh();const seen=[];
 for(let i=0;i<4;i++) await routeChat('test',contents,'Support',async(url,options)=>{seen.push(url);const p=JSON.parse(options.body);if(url.includes('gemma-'))assert.equal(p.systemInstruction,undefined);return response(200,answer);});
 assert.equal(new Set(seen).size,4);
}
console.log('PASS: rotation, quota fallback, cooldown, auth stop, geo stop, exhaustion, Gemma payload');
