/**
 * VN-KEEN AI Assistant API (Cloudflare Pages Function)
 * Route: /api/ai-chat & /api/chat
 * Powered by Google Gemini (Gemini 3.6 Flash / 3.5 Flash)
 */

const SYSTEM_INSTRUCTION = "Bạn là \"VN-KEEN AI\" — Trợ lý Trí tuệ Nhân tạo thông minh, Chuyên gia vũ khí & Mod Skin Counter-Strike 2 (CS2) chính thức của nền tảng VN-KEEN (vn-keen.pages.dev).\n\n🎯 PHẠM VI HỖ TRỢ VÀ KIẾN THỨC CHUYÊN SÂU CỦA BẠN:\n1. HỆ THỐNG MOD SKIN CS2 CỦA VN-KEEN:\n   - Kho hơn 14,000+ skins: Dao hiếm (Karambit Doppler, Butterfly Fade, M9 Bayonet, Skeleton, Talon, Stiletto...), Súng (AWP Dragon Lore, AK-47 Case Hardened Blue Gem #661, M4A4 Howl, Printstream), Găng tay (Sport Gloves Vice, Pandora's Box, Amphibious), Sticker Katowice 2014 Holo (Titan, iBUYPOWER), Móc khóa Charms, Thẻ bài StickerSlab, Agents, Music Kits.\n   - Cơ chế tùy biến: Tự do chỉnh Float 0.00001 (Factory New), Pattern Seed và StatTrak™ theo ý muốn.\n   - Tính năng độc quyền: Custom Sticker Placement dán tự do 5 sticker lên bất kỳ vị trí và góc xoay nào.\n   - An toàn tuyệt đối 100%: Hoạt động qua cơ chế Client-side Hook Source 2, chỉ hiển thị cục bộ trên máy tính người chơi, không can thiệp server hay bộ nhớ đối thủ, cam kết không bị VAC Ban.\n\n2. HƯỚNG DẪN MUA KEY VIP & NẠP TIỀN SEPAY:\n   - Bản quyền KeyAuth tự động kích hoạt ngay lập tức sau khi thanh toán quét mã QR qua ngân hàng / MoMo bằng cổng SePay.\n   - Nhận key và link tải trong vòng vài giây, có nhóm Telegram @VN_KEEN hỗ trợ 24/7.\n   - Các gói: VIP 1 Tháng, 3 Tháng, 6 Tháng, và Lifetime (Vĩnh Viễn) đa thiết bị.\n\n3. KỸ NĂNG & CHIẾN THUẬT CS2:\n   - Cài đặt đồ họa tối ưu FPS, cấu hình Crosshair (tâm ngắm), độ nhạy chuột (sensitivity/eDPI), vị trí ném Smoke/Flash/Molotov các map Mirage, Inferno, Nuke, Dust 2, Ancient, Anubis.\n   - Phân tích lối chơi và settings của các Pro Player (s1mple, m0NESY, ZywOo, NiKo, donk...).\n\n4. TRỢ LÝ TOÀN NĂNG:\n   - Ngoài CS2, bạn là một trợ lý thông minh sẵn sàng giải đáp mọi thắc mắc về lập trình, công nghệ, toán học, đời sống bằng tiếng Việt một cách lịch thiệp, dễ hiểu, hóm hỉnh và tràn đầy năng lượng gaming.\n\nPHONG CÁCH TRẢ LỜI:\n- Trả lời bằng Tiếng Việt tự nhiên, súc tích, định dạng markdown đẹp mắt (in đậm, danh sách gạch đầu dòng, icon gaming 🔪 🎯 ⚡).\n- Khi người dùng hỏi về mod skin hay mua key, hãy khuyên họ xem Kho 14K+ Skin tại trang web hoặc bấm nút \"Bảng Giá\" / \"Tải Miễn Phí\" ngay trên giao diện.";

export async function onRequest(context) {
  const { request, env } = context;
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Content-Type': 'application/json; charset=utf-8'
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method === 'GET') {
    return new Response(JSON.stringify({
      ok: true,
      service: 'VN-KEEN AI Assistant API',
      status: 'online',
      defaultModel: 'gemini-3.6-flash',
      availableModels: ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview', 'gemma-4-26b-a4b-it']
    }), { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed. Use POST.' }), {
      status: 405,
      headers: corsHeaders
    });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const message = (body.message || body.prompt || '').trim();
    if (!message) {
      return new Response(JSON.stringify({ ok: false, error: 'Tin nhắn không được để trống.' }), {
        status: 400,
        headers: corsHeaders
      });
    }

    let apiKey = (env?.GEMINI_API_KEY || '').trim();
    // Tự động làm sạch tiền tố và hậu tố rác (Bearer, dấu nháy, dấu chấm phẩy)
    apiKey = apiKey.replace(/^(Bearer\s+|GEMINI_API_KEY\s*[:=]\s*|["'])/i, '').replace(/["';\s]+$/g, '').trim();

    if (!apiKey) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'Chưa cấu hình biến môi trường GEMINI_API_KEY trong Cloudflare Pages.'
      }), {
        status: 500,
        headers: corsHeaders
      });
    }

    // Valid active Gemini models (verified)
    const VALID_MODELS = ['gemini-3.6-flash', 'gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview'];
    let requestedModel = body.model;
    if (!requestedModel || !VALID_MODELS.includes(requestedModel)) {
      requestedModel = 'gemini-3.6-flash';
    }

    const rawHistory = Array.isArray(body.history) ? body.history : [];
    const contents = [
      ...rawHistory.slice(-20).map((h) => ({
        role: h.role === 'assistant' || h.role === 'model' ? 'model' : 'user',
        parts: [{ text: String(h.text || h.content || '') }]
      })).filter(c => c.parts[0].text.trim()),
      {
        role: 'user',
        parts: [{ text: message }]
      }
    ];

    const isStream = body.stream === true;
    const keyParam = encodeURIComponent(apiKey);
    const apiUrl = isStream
      ? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(requestedModel)}:streamGenerateContent?key=${keyParam}&alt=sse`
      : `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(requestedModel)}:generateContent?key=${keyParam}`;

    const payload = {
      systemInstruction: {
        parts: [{ text: SYSTEM_INSTRUCTION }]
      },
      contents,
      generationConfig: {
        maxOutputTokens: 4096,
        temperature: 0.7
      }
    };

    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
        'origin': 'https://generativelanguage.googleapis.com'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errText = await res.text();
      let parsedErr;
      try { parsedErr = JSON.parse(errText); } catch {}
      const errMsg = parsedErr?.error?.message || errText || `Lỗi Gemini (${res.status})`;

      // Smart Fallback to stable models
      const fallbackModels = ['gemini-3.6-flash', 'gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview'];
      for (const fbModel of fallbackModels) {
        if (fbModel === requestedModel) continue;
        try {
          const fallbackUrl = `https://generativelanguage.googleapis.com/v1beta/models/${fbModel}:generateContent?key=${keyParam}`;
          const fbRes = await fetch(fallbackUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey, 'origin': 'https://generativelanguage.googleapis.com' },
            body: JSON.stringify(payload)
          });
          if (fbRes.ok) {
            const fbData = await fbRes.json();
            const fbText = fbData?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim();
            if (fbText) {
              return new Response(JSON.stringify({
                ok: true,
                model: fbModel,
                message: { role: 'assistant', text: fbText }
              }), { headers: corsHeaders });
            }
          }
        } catch {}
      }

      // If Cloudflare edge node is geo-blocked by Google (e.g. Hong Kong edge)
      if (errMsg.toLowerCase().includes('location is not supported') || errMsg.toLowerCase().includes('user location')) {
        return new Response(JSON.stringify({
          ok: false,
          geo_blocked: true,
          direct_key: apiKey,
          model: requestedModel,
          system_instruction: SYSTEM_INSTRUCTION
        }), {
          status: 200,
          headers: corsHeaders
        });
      }

      return new Response(JSON.stringify({
        ok: false,
        error: errMsg,
        status: res.status
      }), {
        status: res.status,
        headers: corsHeaders
      });
    }

    if (isStream) {
      return new Response(res.body, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    const data = await res.json();
    const answerText = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim() || 'Không nhận được câu trả lời từ AI.';

    return new Response(JSON.stringify({
      ok: true,
      model: requestedModel,
      message: {
        role: 'assistant',
        text: answerText
      }
    }), {
      status: 200,
      headers: corsHeaders
    });

  } catch (err) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'Lỗi xử lý máy chủ: ' + err.message
    }), {
      status: 500,
      headers: corsHeaders
    });
  }
}
