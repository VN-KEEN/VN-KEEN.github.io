export async function onRequestPost({env}) {
  if(!env.PAYOS_CLIENT_ID||!env.PAYOS_API_KEY) return new Response(JSON.stringify({success:false,code:'NOT_CONFIGURED'}),{status:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  try {
    const response=await fetch('https://api-merchant.payos.vn/confirm-webhook',{method:'POST',headers:{'Content-Type':'application/json','x-client-id':env.PAYOS_CLIENT_ID,'x-api-key':env.PAYOS_API_KEY},body:JSON.stringify({webhookUrl:'https://vn-keen.pages.dev/api/payos-webhook'}),signal:AbortSignal.timeout(10000)});
    const data=await response.json();
    return new Response(JSON.stringify({success:response.ok&&data?.code==='00',code:data?.code||'PAYOS_ERROR'}),{status:response.ok?200:502,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  }catch{return new Response(JSON.stringify({success:false,code:'PAYOS_UNAVAILABLE'}),{status:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});}
}
