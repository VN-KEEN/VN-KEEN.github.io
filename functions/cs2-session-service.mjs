export const CS2_SCOPE = 'VN-KEEN-SKIN-SESSION';
export const LEASE_SECONDS = 90;
export const HEARTBEAT_SECONDS = 15;
const LEGACY_SCOPE = 'VN-KEEN-SKIN';
const TOKEN = /^[a-f0-9]{64}$/;
const INSTANCE = /^[a-f0-9]{32}$/;
const ORIGINS = new Set(['https://vn-keen.skin']);
export async function hash(value) {
 const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
 return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('');
}
function reply(body, status = 200) {
 return new Response(JSON.stringify(body), {status, headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
}
function fail(code, status = 401) { throw Object.assign(new Error(code), {code, status}); }
export async function provider(env, path, options = {}) {
 const response = await fetch('https://api.licensegate.io/admin/licenses' + path, {
  ...options, headers:{Authorization:env.LICENSEGATE_API_KEY,'Content-Type':'application/json',Accept:'application/json'},
  signal:AbortSignal.timeout(8000)
 });
 if (!response.ok) {
  let fields='';if(options.method==='PATCH'&&response.status===422){try{const detail=await response.json();fields='_'+Object.keys(detail.fields||{}).map(s=>s.replace(/[^a-zA-Z0-9_.]/g,'').slice(0,60)).join('_');}catch{}}
  fail(response.status === 404 ? 'NOT_FOUND' : options.method==='PATCH'?'PROVIDER_PATCH_HTTP_'+response.status+fields:'PROVIDER_UNAVAILABLE', response.status === 404 ? 401 : 503);
 }
 return response.json();
}
function expiry(license, now) {
 if (license.expirationDate == null) return 4102444800;
 const date = Date.parse(license.expirationDate);
 if (!Number.isFinite(date)) fail('PROVIDER_UNAVAILABLE',503);
 if (date <= now * 1000) fail('EXPIRED');
 return Math.floor(date / 1000);
}
function validLicense(license, now, key) {
 if (!license || !Number.isInteger(license.id) || license.active !== true) fail('NOT_ACTIVE');
 if (![LEGACY_SCOPE, CS2_SCOPE].includes(license.licenseScope) || (key && license.licenseKey !== key)) fail('INVALID_KEY');
 return expiry(license, now);
}
export async function migrateLicense(env, license) {
 if (license.licenseScope === CS2_SCOPE && license.ipLimit === 10) return license;
 if (![LEGACY_SCOPE, CS2_SCOPE].includes(license.licenseScope)) fail('INVALID_KEY');
 // Hosted REST PATCH rejects nullable ipLimit (422). All new clients validate through
 // this IP-independent broker; scope rotation prevents legacy direct validators.
 const patch={licenseScope:CS2_SCOPE};
 // Hosted TSOA defaults omitted numeric/date properties to null, then rejects them.
 // Send their existing values unchanged; never invent replacement limits or expiry.
 for(const field of ['ipLimit','expirationDate','validationPoints','validationLimit','replenishAmount','replenishInterval'])patch[field]=license[field];
 const previous={licenseScope:license.licenseScope,ipLimit:license.ipLimit,expirationDate:license.expirationDate,validationPoints:license.validationPoints,validationLimit:license.validationLimit,replenishAmount:license.replenishAmount,replenishInterval:license.replenishInterval};
 if(env.LICENSE_DB){
  await env.LICENSE_DB.prepare(`INSERT OR IGNORE INTO cs2_policy_items(provider_id,previous_scope,previous_ip_limit,expiration_date) VALUES(?,?,?,?)`).bind(license.id,license.licenseScope,license.ipLimit,license.expirationDate).run();
  await env.LICENSE_DB.prepare('UPDATE cs2_policy_items SET previous_policy=COALESCE(previous_policy,?) WHERE provider_id=?').bind(JSON.stringify(previous),license.id).run();
 }
 // These vendor verification counters are never consumed by the new broker.
 // Normalize old null counters to the product defaults because hosted PATCH
 // cannot accept null. License identity, active state and expiry remain unchanged.
 const defaults={validationPoints:1000,validationLimit:1000,replenishAmount:1000,replenishInterval:'DAY'};
 for(const field of Object.keys(defaults))if(patch[field]==null)patch[field]=defaults[field];
 patch.ipLimit=10;
 const changed = await provider(env, '/' + license.id, {method:'PATCH',body:JSON.stringify(patch)});
 if (changed.id !== license.id || changed.licenseKey !== license.licenseKey || changed.active !== license.active ||
     changed.expirationDate !== license.expirationDate || changed.ipLimit !== 10 || changed.licenseScope !== CS2_SCOPE)
  fail('POLICY_UPDATE_FAILED',503);
 for(const field of ['validationPoints','validationLimit','replenishAmount','replenishInterval'])if(changed[field]!==patch[field])fail('POLICY_UPDATE_FAILED',503);
 return changed;
}
export async function handleSession(request, env, action, now = Math.floor(Date.now()/1000)) {
 const origin=request.headers.get('Origin');
 if (origin && !ORIGINS.has(origin)) return reply({success:false,code:'ORIGIN_NOT_ALLOWED'},403);
 if (request.method !== 'POST') return reply({success:false,code:'METHOD_NOT_ALLOWED'},405);
 if (!env.LICENSE_DB || !env.LICENSEGATE_API_KEY) return reply({success:false,code:'NOT_CONFIGURED'},503);
 try {
  if (!['verify','acquire','heartbeat','release'].includes(action)) fail('NOT_FOUND',404);
  const text=await request.text(); if(text.length>2048) fail('INVALID_REQUEST',400);
  let body;try{body=JSON.parse(text);}catch{fail('INVALID_REQUEST',400);}
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('INVALID_REQUEST',400);
  const db=env.LICENSE_DB;
  if (action === 'verify' || action === 'acquire') {
   const ip=request.headers.get('CF-Connecting-IP') || 'unknown';
   const bucket='cs2-auth:'+await hash(ip)+':'+Math.floor(now/60);
   const attempt=await db.prepare(`INSERT INTO wallet_auth_limits(bucket,attempts,expires_at) VALUES(?,1,?)
    ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1 RETURNING attempts`).bind(bucket,now+120).first();
   if (Number(attempt?.attempts)>120) fail('RATE_LIMITED',429);
   const key=typeof body.key==='string'?body.key.trim():'';
   if (key.length<3 || key.length>256 || /[\x00-\x20\x7f]/.test(key)) fail('INVALID_KEY',400);
   let license=await provider(env,'/key/'+encodeURIComponent(key));
   const licenseExpiry=validLicense(license,now,key);
   const lifetime=license.expirationDate==null || ['2036-12-31T16:59:59.000Z','2099-12-31T23:59:59.000Z'].includes(license.expirationDate);
   if(action==='verify')return reply({success:true,expiresAt:licenseExpiry,serverTime:now,lifetime});
   if(!TOKEN.test(body.token||'') || !INSTANCE.test(body.instanceId||''))fail('INVALID_REQUEST',400);
   license=await migrateLicense(env,license);
   const keyHash=await hash('cs2:'+key), tokenHash=await hash(body.token);
   const until=Math.min(now+LEASE_SECONDS,licenseExpiry);
   const row=await db.prepare(`INSERT INTO cs2_sessions
    (key_hash,token_hash,instance_id,provider_id,expires_at,license_expires_at,provider_checked_at,created_at)
    VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(key_hash) DO UPDATE SET
    token_hash=excluded.token_hash,instance_id=excluded.instance_id,provider_id=excluded.provider_id,
    expires_at=excluded.expires_at,license_expires_at=excluded.license_expires_at,provider_checked_at=excluded.provider_checked_at
    WHERE cs2_sessions.expires_at<=? OR (cs2_sessions.token_hash=? AND cs2_sessions.instance_id=?) RETURNING expires_at`)
    .bind(keyHash,tokenHash,body.instanceId,license.id,until,licenseExpiry,now,now,now,tokenHash,body.instanceId).first();
   if(!row)fail('SESSION_BUSY',409);
   return reply({success:true,expiresAt:row.expires_at,serverTime:now,heartbeatAfter:HEARTBEAT_SECONDS});
  }
  if(!TOKEN.test(body.token||'') || !INSTANCE.test(body.instanceId||''))fail('INVALID_SESSION',401);
  const tokenHash=await hash(body.token);
  if(action==='release'){
   await db.prepare('DELETE FROM cs2_sessions WHERE token_hash=? AND instance_id=?').bind(tokenHash,body.instanceId).run();
   return reply({success:true});
  }
  const session=await db.prepare('SELECT * FROM cs2_sessions WHERE token_hash=? AND instance_id=?').bind(tokenHash,body.instanceId).first();
  if(!session || session.expires_at<=now)fail('SESSION_EXPIRED');
  let licenseExpiry=session.license_expires_at, checked=session.provider_checked_at;
  if(now-checked>=30){
   try{const license=await provider(env,'/'+session.provider_id);licenseExpiry=validLicense(license,now);if(license.licenseScope!==CS2_SCOPE)fail('INVALID_KEY');checked=now;}
   catch(error){if(error.status!==503)await db.prepare('DELETE FROM cs2_sessions WHERE token_hash=?').bind(tokenHash).run();throw error;}
  }
  if(licenseExpiry<=now)fail('EXPIRED');
  const until=Math.min(now+LEASE_SECONDS,licenseExpiry);
  const renewed=await db.prepare(`UPDATE cs2_sessions SET expires_at=?,license_expires_at=?,provider_checked_at=?
   WHERE token_hash=? AND instance_id=? AND expires_at>? RETURNING expires_at`)
   .bind(until,licenseExpiry,checked,tokenHash,body.instanceId,now).first();
  if(!renewed)fail('SESSION_EXPIRED');
  return reply({success:true,expiresAt:renewed.expires_at,serverTime:now,heartbeatAfter:HEARTBEAT_SECONDS});
 }catch(error){return reply({success:false,code:error.code||'UNAVAILABLE'},error.status||503);}
}

// Jobs can only be queued through the owner's D1 administration access, never an HTTP request body.
export async function processPolicyJob(env) {
 const now=Math.floor(Date.now()/1000),db=env.LICENSE_DB;
 if(!db||!env.LICENSEGATE_API_KEY)return;
 const job=await db.prepare(`UPDATE cs2_policy_jobs SET lease_until=?,updated_at=?
  WHERE id='cs2-single-session-v1' AND status IN ('PENDING','RUNNING') AND lease_until<=? RETURNING *`)
  .bind(now+35,now,now).first();
 if(!job)return;
 try{
  if(job.phase==='DISCOVER'){
   const list=await provider(env,'?take=100&skip='+job.cursor+'&includeLogs=false');
   if(!Array.isArray(list.licenses)||!Number.isFinite(list.count))fail('INVALID_PROVIDER_LIST',503);
   const selected=list.licenses.filter(l=>[LEGACY_SCOPE,CS2_SCOPE].includes(l.licenseScope));
   if(selected.length)await db.batch(selected.map(l=>db.prepare(`INSERT OR IGNORE INTO cs2_policy_items
    (provider_id,previous_scope,previous_ip_limit,expiration_date) VALUES(?,?,?,?)`).bind(l.id,l.licenseScope,l.ipLimit,l.expirationDate)));
   const cursor=job.cursor+list.licenses.length;
   await db.prepare(`UPDATE cs2_policy_jobs SET status='RUNNING',phase=?,cursor=?,lease_until=0,updated_at=? WHERE id=?`)
    .bind(cursor>=list.count||!list.licenses.length?'MIGRATE':'DISCOVER',cursor,now,job.id).run();
  }else{
   const result=await db.prepare("SELECT provider_id FROM cs2_policy_items WHERE status='PENDING' ORDER BY provider_id LIMIT 5").all();
   for(const row of result.results||[]){
    try{const license=await provider(env,'/'+row.provider_id);await migrateLicense(env,license);
     await db.prepare("UPDATE cs2_policy_items SET status='DONE',updated_at=?,error=NULL WHERE provider_id=?").bind(now,row.provider_id).run();}
    catch(error){await db.prepare("UPDATE cs2_policy_items SET status='FAILED',updated_at=?,error=? WHERE provider_id=?")
     .bind(now,error.code||'UNAVAILABLE',row.provider_id).run();}
   }
   const pending=await db.prepare("SELECT count(*) AS n FROM cs2_policy_items WHERE status='PENDING'").first();
   const failed=await db.prepare("SELECT count(*) AS n FROM cs2_policy_items WHERE status='FAILED'").first();
   await db.prepare('UPDATE cs2_policy_jobs SET status=?,lease_until=0,updated_at=? WHERE id=?')
    .bind(pending.n?'RUNNING':failed.n?'FAILED':'DONE',now,job.id).run();
  }
 }catch(error){await db.prepare("UPDATE cs2_policy_jobs SET status='FAILED',lease_until=0,updated_at=?,error=? WHERE id=?")
  .bind(now,error.code||'UNAVAILABLE',job.id).run();}
}
