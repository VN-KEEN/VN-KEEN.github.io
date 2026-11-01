import jwk from '../operator-public-key.mjs';
import schema from '../cs2-session-schema.mjs';
import {processPolicyJob} from '../cs2-session-service.mjs';
export async function onRequest({request,env}){
 const reply=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
 if(request.method!=='POST')return reply({success:false},405);
 try{
  const text=await request.text();if(text.length>8192)return reply({success:false},403);
  const {payload,signature}=JSON.parse(text);if(typeof payload!=='string'||payload.length>1024)return reply({success:false},403);
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  const bytes=Uint8Array.from(atob(signature),c=>c.charCodeAt(0));
  if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,bytes,new TextEncoder().encode('VNKEEN-CS2-POLICY\n'+payload)))return reply({success:false},403);
  const cmd=JSON.parse(payload),now=Math.floor(Date.now()/1000);
  if(cmd.product!=='CS2'||!Number.isInteger(cmd.issuedAt)||!Number.isInteger(cmd.expiresAt)||cmd.issuedAt>now+30||cmd.expiresAt<now||cmd.expiresAt-cmd.issuedAt>600)return reply({success:false},403);
  const db=env.LICENSE_DB;if(!db||!env.LICENSEGATE_API_KEY)return reply({success:false,code:'NOT_CONFIGURED'},503);
  if(cmd.action==='initialize'){
   const statements=schema.split(';').map(s=>s.trim()).filter(Boolean);await db.batch(statements.map(s=>db.prepare(s)));
   const columns=await db.prepare('PRAGMA table_info(cs2_policy_items)').all();
   if(!columns.results.some(c=>c.name==='previous_policy'))await db.prepare('ALTER TABLE cs2_policy_items ADD COLUMN previous_policy TEXT').run();
  }else if(cmd.action==='migrate'){
   await db.prepare("INSERT OR IGNORE INTO cs2_policy_jobs(id) VALUES('cs2-single-session-v1')").run();
  }else if(cmd.action==='advance'){
   await processPolicyJob(env);
  }else if(cmd.action==='retry'){
   await db.batch([db.prepare("UPDATE cs2_policy_items SET status='PENDING' WHERE status='FAILED'"),db.prepare("UPDATE cs2_policy_jobs SET status='RUNNING',phase='MIGRATE',lease_until=0,error=NULL WHERE id='cs2-single-session-v1' AND status='FAILED'")]);
  }else if(cmd.action!=='status')return reply({success:false},400);
  const job=await db.prepare("SELECT id,status,phase,cursor,error FROM cs2_policy_jobs WHERE id='cs2-single-session-v1'").first();
  const counts=await db.prepare('SELECT status,count(*) AS count FROM cs2_policy_items GROUP BY status').all();
  const failed=await db.prepare("SELECT provider_id,error FROM cs2_policy_items WHERE status='FAILED' LIMIT 20").all();
  const failures=[];
  for(const row of failed.results||[]){
   const r=await fetch('https://api.licensegate.io/admin/licenses/'+row.provider_id,{headers:{Authorization:env.LICENSEGATE_API_KEY}});
   if(!r.ok){failures.push({id:row.provider_id,error:row.error});continue;}
   const l=await r.json();failures.push({id:row.provider_id,error:row.error,active:l.active,expired:l.expirationDate!=null&&Date.parse(l.expirationDate)<Date.now(),nullFields:['ipLimit','expirationDate','validationPoints','validationLimit','replenishAmount','replenishInterval'].filter(f=>l[f]==null)});
  }
  return reply({success:true,job,counts:counts.results,failures});
 }catch{return reply({success:false,code:'OPERATION_FAILED'},503);}
}
