const base = 'https://vn-keen.pages.dev/api/licensegate/';
const $ = id => document.getElementById(id);
const buttons = [...document.querySelectorAll('[data-plan]')];
let order, timer, busy = false;
const messages = {
  NOT_CONFIGURED: 'Thanh toán LicenseGate chưa được cấu hình. Chưa có đơn hoặc yêu cầu chuyển tiền.',
  CHECKOUT_NOT_ENABLED: 'Thanh toán LicenseGate đang được kiểm tra, chưa mở bán.',
  PRODUCT_NOT_CONFIGURED: 'Giá sản phẩm này chưa được cấu hình. Vui lòng liên hệ quản trị viên.',
  INVALID_ORDER_TOKEN: 'Không thể xác thực đơn hàng. Liên hệ quản trị viên kèm mã đơn.'
};
async function api(action, options) {
  const response = await fetch(base + action, { ...options, signal: AbortSignal.timeout(12000) });
  const data = await response.json();
  if (!response.ok) throw new Error(messages[data.code] || 'Chưa kết nối được máy chủ. Vui lòng thử lại.');
  return data;
}
function showOrder() {
  $('order').hidden = false; $('error').textContent = '';
  $('reference').textContent = order.orderId;
  $('details').textContent = `${order.product.toUpperCase()} · ${order.plan === 'daily' ? '1 ngày' : order.plan === 'monthly' ? '30 ngày' : 'Vĩnh viễn'} · ${order.amount.toLocaleString('vi-VN')}đ`;
  $('qr').src = `https://img.vietqr.io/image/${encodeURIComponent(order.bank.bank)}-${encodeURIComponent(order.bank.account)}-compact2.png?amount=${order.amount}&addInfo=${order.orderId}&accountName=${encodeURIComponent(order.bank.name)}`;
  $('qr').hidden = false; $('key').textContent = ''; $('copy').hidden = true;
  $('status').textContent = 'Chờ ngân hàng xác nhận thanh toán…';
}
async function poll() {
  try {
    const data = await api('status?orderId=' + order.orderId, { headers: { Authorization: 'Bearer ' + order.token } });
    if (data.status === 'FULFILLED' && data.key) {
      $('status').textContent = 'Đã nhận thanh toán. Key của bạn đã sẵn sàng.' +
        (data.expiresAt ? '\nHết hạn: ' + new Date(data.expiresAt * 1000).toLocaleString('vi-VN') : '\nThời hạn: Vĩnh viễn');
      $('key').textContent = data.key; $('copy').hidden = false; $('qr').hidden = true;
      return;
    }
    if (data.status === 'PAID') $('status').textContent = 'Đã nhận tiền, đang cấp key. Không chuyển tiền lại. Nếu chờ lâu, liên hệ quản trị viên kèm mã đơn.';
    else if (Date.now() / 1000 >= order.checkoutExpires) {
      $('qr').hidden = true;
      $('status').textContent = 'Đã hết thời gian chuyển khoản. Nếu đã trả tiền, giữ mã đơn và liên hệ quản trị viên; không chuyển thêm.';
      return;
    }
  } catch (e) { $('status').textContent = e.message + '\nĐơn vẫn được lưu trên máy này. Không chuyển tiền lại.'; }
  timer = setTimeout(poll, 5000);
}
for (const button of buttons) button.addEventListener('click', async () => {
  if (busy) return;
  if (order && !confirm('Tạo đơn mới? Nếu đã chuyển tiền cho đơn hiện tại, hãy giữ đơn đó để nhận key.')) return;
  busy = true; buttons.forEach(b => b.disabled = true);
  try {
    const next = await api('checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product: $('product').value, plan: button.dataset.plan }) });
    clearTimeout(timer); order = next;
    localStorage.setItem('vnkeen_licensegate_order', JSON.stringify(order));
    showOrder(); poll();
  } catch (e) { $('error').textContent = e.message; }
  finally { busy = false; buttons.forEach(b => b.disabled = false); }
});
$('copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('key').textContent); $('copy').textContent = 'ĐÃ SAO CHÉP'; }
  catch { $('error').textContent = 'Hãy chọn và sao chép key bên trên.'; }
});
try {
  const saved = JSON.parse(localStorage.getItem('vnkeen_licensegate_order') || 'null');
  if (saved && /^VNK[A-F0-9]{10}$/.test(saved.orderId) && /^[A-F0-9]{64}$/.test(saved.token)) {
    order = saved; showOrder(); poll();
  }
} catch { /* A missing or corrupt local receipt never marks a payment successful. */ }
