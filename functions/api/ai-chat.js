import { MODELS, routeChat } from '../../ai-router.mjs';
const SYSTEM_INSTRUCTION = 'Bạn là trợ lý chăm sóc khách hàng VN-KEEN. Trả lời tiếng Việt ngắn gọn. Giá: 20.000đ/1 ngày, 300.000đ/30 ngày, 2.000.000đ/vĩnh viễn. Với giao dịch, key hoặc HWID, liên hệ Admin https://t.me/VN_KEEN; bạn không có quyền xem hay thay đổi giao dịch. Không yêu cầu mật khẩu, OTP hoặc key. Không cam kết an toàn 100% hay không bị VAC. Có thể gợi ý skin theo sở thích. Nếu không biết thì nói rõ.';
export async function onRequest({request,env}) {
  const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};
  const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
  if(request.method==='OPTIONS') return new Response(null,{headers});
  if(request.method==='GET') return json({ok:true,routing:'rotation-v1',availableModels:MODELS});
  if(request.method!=='POST') return json({ok:false},405);
  try {
    const body=await request.json();
    const message=typeof body.message==='string'?body.message.trim():'';
    if(!message || message.length>4000) return json({ok:false,error:'Nhập câu hỏi tối đa 4.000 ký tự.'},400);
    const key=(env.GEMINI_API_KEY||'').trim();
    if(!key) return json({ok:false,error:'Chưa cấu hình API key.'},503);
    const history=Array.isArray(body.history)?body.history:[];
    const contents=history.slice(-6).filter(h=>h && typeof h.text==='string' && h.text.trim()).map(h=>({role:h.role==='assistant'?'model':'user',parts:[{text:h.text.slice(0,4000)}]}));
    contents.push({role:'user',parts:[{text:message}]});
    const result=await routeChat(key,contents,SYSTEM_INSTRUCTION);
    // Browser compatibility path previously approved by the site owner.
    if(result.geo_blocked) return json({...result,direct_key:key,system_instruction:SYSTEM_INSTRUCTION});
    return json(result,result.ok?200:result.status||503);
  } catch {return json({ok:false,error:'Không xử lý được yêu cầu AI.'},503);}
}
