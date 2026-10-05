import { creditDeposit } from './wallet-webhook.mjs';
const encoder = new TextEncoder();
const MAX_BODY_BYTES = 32768;
function reply(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }); }
function signatureText(data) { return Object.keys(data || {}).sort().map(key => { const value=data[key]; return `${key}=${value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : value}`; }).join('&'); }
async function hmacHex(secret, text) { const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']); const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(text))); return [...bytes].map(value=>value.toString(16).padStart(2,'0')).join(''); }
function safeEqual(left,right){if(typeof left!=='string'||typeof right!=='string'||left.length!==right.length)return false;let result=0;for(let i=0;i<left.length;i+=1)result|=left.charCodeAt(i)^right.charCodeAt(i);return result===0;}

export async function handlePayosWebhook(request, env, now = Math.floor(Date.now()/1000)) {
  if(request.method!=='POST') return reply({success:false,code:'METHOD_NOT_ALLOWED'},405);
  try {
    if(!env?.LICENSE_DB||!env.PAYOS_CHECKSUM_KEY) return reply({success:false,code:'NOT_CONFIGURED'},503);
    if(Number(request.headers.get('Content-Length')||0)>MAX_BODY_BYTES) return reply({success:false,code:'BODY_TOO_LARGE'},413);
    const text=await request.text(); if(encoder.encode(text).length>MAX_BODY_BYTES) return reply({success:false,code:'BODY_TOO_LARGE'},413);
    const body=JSON.parse(text); if(!body||typeof body!=='object'||Array.isArray(body)||!body.data||typeof body.data!=='object') return reply({success:false,code:'INVALID_JSON'},400);
    const expected=await hmacHex(env.PAYOS_CHECKSUM_KEY,signatureText(body.data));
    if(!safeEqual(String(body.signature||'').toLowerCase(),expected)) return reply({success:false,code:'INVALID_SIGNATURE'},401);
    if(body.success!==true||body.code!=='00'||body.data.code!=='00') return reply({success:true,ignored:true});
    const amount=Number(body.data.amount); const reference=String(body.data.reference||body.data.paymentLinkId||body.data.orderCode||'');
    if(!Number.isSafeInteger(amount)||amount<=0||!reference) return reply({success:false,code:'INVALID_TRANSACTION'},400);
    const shortCode=String(body.data.description||'').toUpperCase().match(/\bVNW[A-F0-9]{20}\b/)?.[0];
    if(!shortCode) return reply({success:true,reviewRequired:true,reason:'UNKNOWN_DEPOSIT_CODE'});
    const account=await env.LICENSE_DB.prepare('SELECT deposit_code FROM wallet_accounts WHERE substr(deposit_code,1,23)=?').bind(shortCode).first();
    if(!account?.deposit_code) return reply({success:true,reviewRequired:true,reason:'UNKNOWN_DEPOSIT_CODE'});
    return reply(await creditDeposit(env,{depositCode:account.deposit_code,amount,referenceId:`PAYOS:${reference}`},now));
  } catch { return reply({success:false,code:'SERVICE_UNAVAILABLE'},503); }
}

export async function createPayosLink(env, account, amount, now = Math.floor(Date.now()/1000)) {
  if(!env.PAYOS_CLIENT_ID||!env.PAYOS_API_KEY||!env.PAYOS_CHECKSUM_KEY) throw Object.assign(new Error('payOS chưa được cấu hình.'),{status:503,code:'PAYOS_NOT_CONFIGURED'});
  if(!Number.isSafeInteger(amount)||amount<1000||amount>10000000) throw Object.assign(new Error('Số tiền nạp phải từ 1.000đ đến 10.000.000đ.'),{status:400,code:'INVALID_TOPUP_AMOUNT'});
  const description=String(account.deposit_code||'').slice(0,23); if(!/^VNW[A-F0-9]{20}$/.test(description)) throw Object.assign(new Error('Mã nạp tiền không hợp lệ.'),{status:503,code:'INVALID_DEPOSIT_CODE'});
  const orderCode=now*1000+crypto.getRandomValues(new Uint16Array(1))[0]%1000;
  const returnUrl='https://vn-keen.pages.dev/?payment=success#pricing'; const cancelUrl='https://vn-keen.pages.dev/?payment=cancel#pricing';
  const payload={orderCode,amount,description,returnUrl,cancelUrl}; payload.signature=await hmacHex(env.PAYOS_CHECKSUM_KEY,signatureText(payload));
  let response; try { response=await fetch('https://api-merchant.payos.vn/v2/payment-requests',{method:'POST',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json','x-client-id':env.PAYOS_CLIENT_ID,'x-api-key':env.PAYOS_API_KEY},body:JSON.stringify(payload)}); } catch { throw Object.assign(new Error('Không kết nối được payOS.'),{status:503,code:'PAYOS_UNAVAILABLE'}); }
  let data; try{data=await response.json();}catch{data=null;} if(!response.ok||data?.code!=='00'||typeof data?.data?.checkoutUrl!=='string') throw Object.assign(new Error('payOS chưa tạo được yêu cầu thanh toán.'),{status:503,code:'PAYOS_CREATE_FAILED'});
  return {success:true,checkoutUrl:data.data.checkoutUrl,orderCode,amount,description};
}
