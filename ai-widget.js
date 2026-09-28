/**
 * VN-KEEN AI Assistant Floating Widget
 * Seamlessly integrates with vn-keen.pages.dev and catalog.html
 */
(function() {
  if (document.getElementById('vnkeen-ai-widget-root')) return;

  // 1. Inject Styles
  const style = document.createElement('style');
  style.textContent = `
    #vnkeen-ai-widget-root {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 99999;
      font-family: 'Inter', 'Be Vietnam Pro', sans-serif;
    }
    .vnk-ai-btn {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 18px;
      border-radius: 9999px;
      background: linear-gradient(135deg, rgba(7, 10, 18, 0.95), rgba(15, 23, 42, 0.95));
      border: 1.5px solid rgba(0, 229, 238, 0.6);
      box-shadow: 0 0 25px rgba(0, 229, 238, 0.35), 0 10px 30px rgba(0, 0, 0, 0.5);
      color: #f8fafc;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.05em;
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      backdrop-filter: blur(12px);
      user-select: none;
    }
    .vnk-ai-btn:hover {
      transform: translateY(-3px) scale(1.03);
      border-color: #00e5ee;
      box-shadow: 0 0 35px rgba(0, 229, 238, 0.6), 0 15px 35px rgba(0, 0, 0, 0.6);
    }
    .vnk-ai-btn .vnk-icon-wrap {
      position: relative;
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      background: linear-gradient(135deg, #00e5ee, #a855f7);
      color: #000;
      font-size: 14px;
    }
    .vnk-ai-btn .vnk-badge {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #10b981;
      box-shadow: 0 0 8px #10b981;
      animation: vnkPing 2s infinite;
    }
    @keyframes vnkPing {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(1.3); }
    }
    .vnk-chat-box {
      position: absolute;
      bottom: calc(100% + 14px);
      right: 0;
      width: 400px;
      max-width: calc(100vw - 32px);
      height: 560px;
      max-height: calc(100vh - 120px);
      background: rgba(10, 15, 29, 0.95);
      border: 1.5px solid rgba(0, 229, 238, 0.4);
      border-radius: 20px;
      box-shadow: 0 0 40px rgba(0, 229, 238, 0.25), 0 25px 50px rgba(0, 0, 0, 0.8);
      backdrop-filter: blur(20px);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      opacity: 0;
      pointer-events: none;
      transform: translateY(20px) scale(0.95);
      transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .vnk-chat-box.open {
      opacity: 1;
      pointer-events: auto;
      transform: translateY(0) scale(1);
    }
    .vnk-chat-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 18px;
      background: rgba(15, 23, 42, 0.8);
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }
    .vnk-chat-title {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .vnk-chat-title img {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      object-fit: cover;
      border: 1px solid rgba(0, 229, 238, 0.5);
    }
    .vnk-chat-title h4 {
      margin: 0;
      font-size: 14px;
      font-weight: 800;
      letter-spacing: 0.05em;
      color: #f8fafc;
      font-family: 'Chakra Petch', sans-serif;
    }
    .vnk-chat-title p {
      margin: 0;
      font-size: 10px;
      color: #00e5ee;
      font-family: monospace;
    }
    .vnk-chat-actions {
      display: flex;
      gap: 6px;
    }
    .vnk-act-btn {
      background: rgba(255, 255, 255, 0.08);
      border: none;
      color: #94a3b8;
      width: 28px;
      height: 28px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.2s;
    }
    .vnk-act-btn:hover {
      background: rgba(239, 68, 68, 0.2);
      color: #ef4444;
    }
    .vnk-messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .vnk-messages::-webkit-scrollbar {
      width: 5px;
    }
    .vnk-messages::-webkit-scrollbar-thumb {
      background: rgba(0, 229, 238, 0.3);
      border-radius: 10px;
    }
    .vnk-msg {
      max-width: 85%;
      padding: 10px 14px;
      border-radius: 14px;
      font-size: 13px;
      line-height: 1.5;
      word-break: break-word;
    }
    .vnk-msg.user {
      align-self: flex-end;
      background: linear-gradient(135deg, #0284c7, #0369a1);
      color: #fff;
      border-bottom-right-radius: 4px;
      box-shadow: 0 4px 15px rgba(2, 132, 199, 0.3);
    }
    .vnk-msg.ai {
      align-self: flex-start;
      background: rgba(30, 41, 59, 0.85);
      color: #f1f5f9;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-bottom-left-radius: 4px;
    }
    .vnk-msg.ai strong {
      color: #00e5ee;
    }
    .vnk-msg.ai a {
      color: #f59e0b;
      text-decoration: underline;
    }
    .vnk-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 8px;
    }
    .vnk-chip {
      background: rgba(0, 229, 238, 0.1);
      border: 1px solid rgba(0, 229, 238, 0.3);
      color: #38bdf8;
      font-size: 11px;
      padding: 4px 10px;
      border-radius: 9999px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .vnk-chip:hover {
      background: rgba(0, 229, 238, 0.25);
      border-color: #00e5ee;
      color: #fff;
    }
    .vnk-input-zone {
      padding: 12px 14px;
      background: rgba(15, 23, 42, 0.9);
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .vnk-input {
      flex: 1;
      background: rgba(2, 6, 23, 0.7);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 12px;
      padding: 9px 12px;
      color: #fff;
      font-size: 13px;
      outline: none;
      transition: all 0.2s;
    }
    .vnk-input:focus {
      border-color: #00e5ee;
      box-shadow: 0 0 10px rgba(0, 229, 238, 0.3);
    }
    .vnk-send-btn {
      width: 38px;
      height: 38px;
      border-radius: 10px;
      background: linear-gradient(135deg, #00e5ee, #0284c7);
      border: none;
      color: #000;
      font-size: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.2s;
    }
    .vnk-send-btn:hover {
      transform: scale(1.05);
      box-shadow: 0 0 15px rgba(0, 229, 238, 0.5);
    }
    .vnk-typing {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 8px 12px;
    }
    .vnk-typing span {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #00e5ee;
      animation: vnkBounce 1.2s infinite ease-in-out;
    }
    .vnk-typing span:nth-child(2) { animation-delay: 0.2s; }
    .vnk-typing span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes vnkBounce {
      0%, 80%, 100% { transform: scale(0); opacity: 0.3; }
      40% { transform: scale(1); opacity: 1; }
    }
  `;
  document.head.appendChild(style);

  // 2. Inject HTML
  const root = document.createElement('div');
  root.id = 'vnkeen-ai-widget-root';
  root.innerHTML = `
    <div class="vnk-chat-box" id="vnkChatBox">
      <div class="vnk-chat-header">
        <div class="vnk-chat-title">
          <img src="images/VN-KEEN.jpg" alt="VN-KEEN AI" onerror="this.src='favicon.jpg'">
          <div>
            <h4>CHĂM SÓC KHÁCH HÀNG</h4>
            <p>Trả lời tự động · Liên hệ Admin khi cần</p>
          </div>
        </div>
        <div class="vnk-chat-actions">
          <a href="https://t.me/VN_KEEN" target="_blank" rel="noopener" class="vnk-act-btn" title="Liên hệ Admin qua Telegram" style="text-decoration:none;">
            <i class="fa-solid fa-up-right-from-square"></i>
          </a>
          <button class="vnk-act-btn" id="vnkClearBtn" title="Xóa lịch sử trò chuyện">
            <i class="fa-solid fa-rotate-right"></i>
          </button>
          <button class="vnk-act-btn" id="vnkCloseBtn" title="Thu nhỏ">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
      </div>
      <div class="vnk-messages" id="vnkMessages">
        <div class="vnk-msg ai">
          Chào bạn! Đây là kênh <strong>chăm sóc khách hàng VN-KEEN</strong>. Trợ lý AI hỗ trợ câu hỏi thường gặp; câu trả lời có thể cần kiểm tra lại. Với lỗi key hoặc thanh toán, hãy <a href="https://t.me/VN_KEEN" target="_blank" rel="noopener">liên hệ Admin qua Telegram</a>. Không gửi mật khẩu, mã OTP hoặc key tại đây.
          <div class="vnk-chips">
            <span class="vnk-chip" data-q="Combo Dao và Găng tay CS2 nào đẹp nhất?">🔪 Combo Dao + Găng</span>
            <span class="vnk-chip" data-q="Mod Skin tại VN-KEEN có bị VAC Ban không?">🛡️ Có bị VAC Ban không?</span>
            <span class="vnk-chip" data-q="Bảng giá VIP và cách nạp tiền quét QR SePay?">💎 Bảng giá & Nạp SePay</span>
            <span class="vnk-chip" data-q="Skin AK-47 và AWP nào xịn nhất?">⚡ AK-47 & AWP xịn</span>
          </div>
        </div>
      </div>
      <div class="vnk-input-zone">
        <input type="text" class="vnk-input" id="vnkInput" placeholder="Nhập câu hỏi về cài đặt, key hoặc hỗ trợ..." autocomplete="off">
        <button class="vnk-send-btn" id="vnkSendBtn" title="Gửi câu hỏi">
          <i class="fa-solid fa-paper-plane"></i>
        </button>
      </div>
    </div>
    <button class="vnk-ai-btn" id="vnkToggleBtn" title="Mở chăm sóc khách hàng VN-KEEN">
      <div class="vnk-icon-wrap">
        <i class="fa-solid fa-headset"></i>
      </div>
      <span>CHĂM SÓC KHÁCH HÀNG</span>
      <span class="vnk-badge"></span>
    </button>
  `;
  document.body.appendChild(root);

  // 3. Logic & Event Handlers
  const box = document.getElementById('vnkChatBox');
  const toggleBtn = document.getElementById('vnkToggleBtn');
  const closeBtn = document.getElementById('vnkCloseBtn');
  const clearBtn = document.getElementById('vnkClearBtn');
  const sendBtn = document.getElementById('vnkSendBtn');
  const input = document.getElementById('vnkInput');
  const messagesContainer = document.getElementById('vnkMessages');

  let history = [];
  let isThinking = false;

  function toggleBox() {
    box.classList.toggle('open');
    if (box.classList.contains('open')) {
      input.focus();
    }
  }

  toggleBtn.addEventListener('click', toggleBox);
  closeBtn.addEventListener('click', () => box.classList.remove('open'));

  clearBtn.addEventListener('click', () => {
    history = [];
    messagesContainer.innerHTML = `
      <div class="vnk-msg ai">
        Đã làm mới đoạn chat! Bạn cần trợ lý tự động hỗ trợ điều gì?
        <div class="vnk-chips">
          <span class="vnk-chip" data-q="Combo Dao và Găng tay CS2 nào đẹp nhất?">🔪 Combo Dao + Găng</span>
          <span class="vnk-chip" data-q="Mod Skin tại VN-KEEN có bị VAC Ban không?">🛡️ Có bị VAC Ban không?</span>
          <span class="vnk-chip" data-q="Bảng giá VIP và cách nạp tiền quét QR SePay?">💎 Bảng giá & Nạp SePay</span>
        </div>
      </div>
    `;
    bindChips();
  });

  function formatText(text) {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(new RegExp('\x60\x60\x60([\s\S]*?)\x60\x60\x60', 'g'), '<pre style="background:rgba(0,0,0,0.4);padding:8px;border-radius:6px;overflow-x:auto;"><code>$1</code></pre>')
      .replace(new RegExp('\x60([^\x60]+)\x60', 'g'), '<code style="background:rgba(255,255,255,0.1);padding:2px 4px;border-radius:4px;color:#00e5ee;">$1</code>')
      .replace(/\n/g, '<br>');
  }

  function appendMessage(role, text) {
    const div = document.createElement('div');
    div.className = 'vnk-msg ' + (role === 'user' ? 'user' : 'ai');
    div.innerHTML = formatText(text);
    messagesContainer.appendChild(div);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    return div;
  }

  function showTyping() {
    const div = document.createElement('div');
    div.className = 'vnk-msg ai vnk-typing-node';
    div.innerHTML = '<div class="vnk-typing"><span></span><span></span><span></span></div>';
    messagesContainer.appendChild(div);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    return div;
  }


  function supportFallback(text) {
    const q = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    let answer;
    if (/gia|nap|thanh toan|mua key/.test(q)) answer = 'Giá hiện tại: 20.000đ / 1 ngày, 300.000đ / 30 ngày, 2.000.000đ / vĩnh viễn. Xem Bảng giá trên trang chủ. Nếu đã thanh toán mà chưa nhận key, liên hệ Admin để kiểm tra giao dịch.';
    else if (/vac|ban|an toan/.test(q)) answer = 'Không thể đảm bảo tài khoản không bị hạn chế khi sử dụng phần mềm bên thứ ba. Hãy cân nhắc trước khi sử dụng; không có cam kết an toàn 100%.';
    else if (/ak-47|awp|skin.*dep|skin.*xin/.test(q)) answer = 'Một vài lựa chọn theo phong cách: AK-47 Asiimov (trắng/cam), Wild Lotus (hoa lá); AWP Dragon Lore (vàng) hoặc Gungnir (xanh). Bạn có thể xem ảnh ở Kho Skin để chọn theo sở thích.';
    else if (/combo|dao|gang/.test(q)) answer = 'Gợi ý phối màu: dao Doppler với găng Vice, hoặc dao Gamma Doppler với găng Hedge Maze. Xem hình trong Kho Skin để chọn combo theo sở thích.';
    else if (/cai|tai|khoi chay/.test(q)) answer = 'Bấm TẢI VN-KEEN-SKIN trên trang chủ, giải nén, mở VN-KEEN-SKIN.exe và nhập key còn hạn. Nếu có lỗi, gửi ảnh thông báo cho Admin; không gửi mật khẩu hoặc mã OTP.';
    else if (/key|hwid|het han/.test(q)) answer = 'Với lỗi key, hết hạn hoặc đổi máy/HWID, hãy liên hệ Admin để kiểm tra. Khung trả lời tự động không thể xác nhận hay thay đổi thông tin key của bạn.';
    else answer = 'Hiện chưa thể xử lý câu hỏi này tự động. Bạn vui lòng liên hệ Admin qua nút Telegram ở đầu khung để được hỗ trợ.';
    return 'AI hiện không khả dụng. Thông tin FAQ dự phòng:\n\n' + answer + '\n\nAdmin: https://t.me/VN_KEEN';
  }

  async function requestWithRetry(url, options) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        const data = await response.json().catch(() => ({}));
        if (![502, 503, 504].includes(response.status) || attempt === 2) {
          return { response, data };
        }
      } catch (error) {
        if (attempt === 2) throw error;
      } finally {
        clearTimeout(timer);
      }
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }

  async function handleSend(userText) {
    const text = (userText || input.value || '').trim();
    if (!text || isThinking) return;

    input.value = '';
    appendMessage('user', text);
    history.push({ role: 'user', text });

    isThinking = true;
    const typingNode = showTyping();

    try {
      // Xác định endpoint API (/api/ai-chat hoặc fallback tới /api/chat)
      const apiUrl = (window.location.hostname.endsWith('pages.dev') || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
        ? '/api/ai-chat'
        : 'https://vn-keen.pages.dev/api/ai-chat';
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 55000);
      let res, data;
      try {
        res = await fetch(apiUrl, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text, history: history.slice(0, -1).slice(-6) }),
          signal: controller.signal
        });
        data = await res.json();
      } finally { clearTimeout(timer); }
      if (data.geo_blocked && data.direct_key) {
        const { routeChat } = await import('./ai-router.mjs?v=rotation-1');
        data = await routeChat(data.direct_key, history.slice(-7).map(item => ({
          role: item.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: item.text }]
        })), data.system_instruction || '');
      }

      typingNode.remove();

      if (!res.ok || data.ok === false || data.geo_blocked) {
        appendMessage('ai', supportFallback(text));
        return;
      }

      const reply = data.message?.text || data.text || 'Đã nhận được phản hồi.';
      appendMessage('ai', reply);
      history.push({ role: 'assistant', text: reply });

    } catch (err) {
      typingNode.remove();
      appendMessage('ai', supportFallback(text));
    } finally {
      isThinking = false;
    }
  }

  sendBtn.addEventListener('click', () => handleSend());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  });

  function bindChips() {
    document.querySelectorAll('.vnk-chip').forEach(chip => {
      chip.onclick = () => {
        const q = chip.getAttribute('data-q');
        if (q) handleSend(q);
      };
    });
  }

  bindChips();
  // Quan sát khi có thêm chip mới được tạo
  const observer = new MutationObserver(bindChips);
  observer.observe(messagesContainer, { childList: true });
})();
