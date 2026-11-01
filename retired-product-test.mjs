import assert from 'node:assert/strict';
import {handleUser} from './functions/wallet-service.mjs';
import {handle} from './licensegate-service.mjs';
let existing=null,writes=[];
const db={prepare(sql){return {bind(){return this},async first(){if(sql.includes('FROM wallet_sessions'))return {username:'audit-user',expires_at:9999999999,revoked_at:null};if(sql.includes('FROM wallet_orders'))return existing;throw Error('Unexpected SQL read')},async run(){writes.push(sql);if(!sql.startsWith('UPDATE wallet_sessions'))throw Error('Unexpected financial mutation');return {}}}}};
async function buy(product){const r=await handleUser(new Request('https://vn-keen.skin/api/user?action=buy_with_balance',{method:'POST',headers:{Authorization:'Bearer '+'A'.repeat(64)},body:JSON.stringify({product,plan:'daily',requestId:'audit-request-123'})}),{LICENSE_DB:db});return {status:r.status,...await r.json()};}
assert.equal((await buy('aim')).code,'PRODUCT_RETIRED');
assert.equal((await buy('skin')).code,'LICENSE_PROVIDER_NOT_CONFIGURED');
existing={request_id:'audit-request-123',username:'audit-user',product:'aim',plan:'daily',status:'FAILED',error_code:'PURCHASE_FAILED'};
assert.equal((await buy('aim')).code,'PURCHASE_FAILED');
const r=await handle(new Request('https://vn-keen.skin/api/licensegate/checkout',{method:'POST',body:JSON.stringify({product:'aim',plan:'daily'})}),{LICENSE_DB:db,LICENSEGATE_API_KEY:'test',SEPAY_WEBHOOK_SECRET:'test',SEPAY_ACCOUNT_NUMBER:'test',LICENSEGATE_USER_ID:'test',LICENSEGATE_CHECKOUT_ENABLED:'true'},'checkout');
assert.equal(r.status,410);assert.equal((await r.json()).code,'PRODUCT_RETIRED');
assert.ok(writes.every(s=>s.startsWith('UPDATE wallet_sessions')));
console.log('PASS: retired purchases rejected before financial writes; CS2 purchase and historical order handling preserved.');
