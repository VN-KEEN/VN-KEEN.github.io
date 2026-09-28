export const MODELS = ['gemini-3.5-flash-lite','gemini-3.1-flash-lite','gemma-4-26b-a4b-it','gemma-4-31b-it','gemini-3.5-flash','gemini-3.6-flash','gemini-3.7-flash','gemini-3.8-flash','gemini-3-flash-preview'];
const cooldowns = new Map();
let cursor = 0;
export async function routeChat(key, contents, instruction, fetcher = fetch) {
  const start = cursor++ % 4;
  const order = [...MODELS.slice(start,4),...MODELS.slice(0,start),...MODELS.slice(4)];
  const deadline = Date.now()+45000;
  let status = 503;
  for (const model of order) {
    if ((cooldowns.get(model)||0)>Date.now()) continue;
    if (Date.now()>=deadline) break;
    const controller = new AbortController();
    const timer = setTimeout(()=>controller.abort(),Math.min(8000,deadline-Date.now()));
    try {
      const payload = {contents,generationConfig:{maxOutputTokens:1024,temperature:0.5}};
      if (model.startsWith('gemma-')) payload.contents = [{role:'user',parts:[{text:instruction}]},{role:'model',parts:[{text:'Tôi sẽ hỗ trợ theo thông tin trên.'}]},...contents];
      else payload.systemInstruction = {parts:[{text:instruction}]};
      const res = await fetcher('https://generativelanguage.googleapis.com/v1beta/models/'+model+':generateContent',{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},body:JSON.stringify(payload),signal:controller.signal});
      const data = await res.json().catch(()=>({}));
      if (/location is not supported|user location/i.test(data.error?.message||'')) return {ok:false,geo_blocked:true};
      if (res.ok) {
        const text = data.candidates?.[0]?.content?.parts?.filter(p=>!p.thought).map(p=>p.text||'').join('').trim();
        if (text) return {ok:true,model,message:{role:'assistant',text}};
        if (data.promptFeedback?.blockReason || data.candidates?.[0]?.finishReason==='SAFETY') return {ok:false,status:400,error:'Không thể trả lời yêu cầu này.'};
      }
      status = res.ok ? 503 : res.status;
      if (![429,404,500,502,503,504].includes(status)) return {ok:false,status,error:'API key hoặc yêu cầu không hợp lệ.'};
      const retry = Number(res.headers.get('retry-after'));
      cooldowns.set(model,Date.now()+(status===404?3600000:Math.max(60,Number.isFinite(retry)?retry:60)*1000));
    } catch { cooldowns.set(model,Date.now()+60000); status=503; }
    finally { clearTimeout(timer); }
  }
  return {ok:false,status,error:'Các model hiện hết hạn mức, đang chờ hoặc quá tải. Vui lòng thử lại sau.'};
}
