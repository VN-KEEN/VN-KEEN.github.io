// Global in-memory storage for users, wallet balances, and orders
const globalUsers = globalThis.__VNKEEN_USERS || (globalThis.__VNKEEN_USERS = new Map());
const globalOrders = globalThis.__VNKEEN_ORDERS || (globalThis.__VNKEEN_ORDERS = new Map());

function generateLicenseGateKey(prefix = 'VN-KEEN-SKIN') {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  const block = (start) => {
    let s = '';
    for (let i = 0; i < 4; i++) s += chars[buf[start + i] % chars.length];
    return s;
  };
  return `${prefix}-${block(0)}-${block(4)}-${block(8)}-${block(12)}`;
}

async function createLicenseGateLicense(env, planId = 'monthly', days = 30) {
  const licenseKey = generateLicenseGateKey('VN-KEEN-SKIN');
  if (!env?.LICENSEGATE_API_KEY) throw new Error('LICENSE_PROVIDER_NOT_CONFIGURED');
  const expirationDate = days >= 9999 ? '2099-12-31T23:59:59.000Z' : new Date(Date.now() + days * 86400 * 1000).toISOString();
  let res;
  try {
    res = await fetch('https://api.licensegate.io/admin/licenses', {
      method: 'POST',
      headers: {
        'Authorization': env.LICENSEGATE_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        active: true,
        name: 'WALLET-' + Date.now(),
        notes: 'VN-KEEN Wallet Buy / ' + planId,
        licenseKey,
        licenseScope: 'VN-KEEN-SKIN',
        expirationDate,
        ipLimit: 1,
        validationPoints: 1000,
        validationLimit: 1000,
        replenishAmount: 1000,
        replenishInterval: 'DAY'
      })
    });
  } catch (err) {
    console.error('LicenseGate API error:', err);
    throw new Error('LICENSE_PROVIDER_UNAVAILABLE');
  }
  if (!res.ok) {
    console.error('LicenseGate create failed:', res.status);
    throw new Error('LICENSE_PROVIDER_UNAVAILABLE');
  }
  const data = await res.json();
  if (data.licenseKey !== licenseKey || data.licenseScope !== 'VN-KEEN-SKIN' || data.active !== true) {
    throw new Error('LICENSE_PROVIDER_MISMATCH');
  }
  return licenseKey;
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // SYSTEM RESET: Reset all existing users in memory to 0đ balance
    if (!globalThis.__VNKEEN_GLOBAL_RESET_DONE_20260905) {
      for (const [k, u] of globalUsers.entries()) {
        if (u) {
          u.balance = 0;
          u.transactions = (u.transactions || []).filter(t => t.type !== 'TOPUP');
          u.balanceResetToZero = true;
        }
      }
      globalThis.__VNKEEN_GLOBAL_RESET_DONE_20260905 = true;
    }

    // 1. REGISTER
    if (action === 'register' && request.method === 'POST') {
      const { username, password, contact } = await request.json();
      if (!username || !password || username.length < 3) {
        return new Response(JSON.stringify({ success: false, message: 'Tên đăng nhập tối thiểu 3 ký tự và mật khẩu không được rỗng.' }), { status: 400, headers: corsHeaders });
      }

      const cleanUser = username.trim().toLowerCase();
      if (globalUsers.has(cleanUser)) {
        return new Response(JSON.stringify({ success: false, message: 'Tên tài khoản này đã tồn tại. Vui lòng chọn tên khác!' }), { status: 400, headers: corsHeaders });
      }

      const newUser = {
        username: cleanUser,
        displayName: username.trim(),
        password: password,
        contact: contact || '',
        balance: 0,
        keys: [],
        transactions: [],
        createdAt: new Date().toISOString()
      };

      globalUsers.set(cleanUser, newUser);

      return new Response(JSON.stringify({
        success: true,
        message: 'Đăng ký tài khoản thành công!',
        user: {
          username: newUser.displayName,
          balance: newUser.balance,
          keys: newUser.keys
        }
      }), { status: 200, headers: corsHeaders });
    }

    // 2. LOGIN
    if (action === 'login' && request.method === 'POST') {
      const { username, password } = await request.json();
      const cleanUser = (username || '').trim().toLowerCase();

      let user = globalUsers.get(cleanUser);
      if (!user) {
        // Auto create or check fallback demo
        if (password && username.length >= 3) {
          user = {
            username: cleanUser,
            displayName: username.trim(),
            password: password,
            contact: '',
            balance: 0,
            keys: [],
            transactions: [],
            createdAt: new Date().toISOString()
          };
          globalUsers.set(cleanUser, user);
        } else {
          return new Response(JSON.stringify({ success: false, message: 'Sai tên đăng nhập hoặc mật khẩu!' }), { status: 400, headers: corsHeaders });
        }
      } else if (user.password !== password) {
        return new Response(JSON.stringify({ success: false, message: 'Mật khẩu không chính xác!' }), { status: 400, headers: corsHeaders });
      }

      return new Response(JSON.stringify({
        success: true,
        message: 'Đăng nhập thành công!',
        user: {
          username: user.displayName,
          balance: user.balance,
          keys: user.keys,
          transactions: user.transactions
        }
      }), { status: 200, headers: corsHeaders });
    }

    // 3. GET PROFILE / BALANCE
    if (action === 'me' && request.method === 'GET') {
      const username = url.searchParams.get('username');
      const cleanUser = (username || '').trim().toLowerCase();
      const user = globalUsers.get(cleanUser);

      if (!user) {
        return new Response(JSON.stringify({ success: false, message: 'Tài khoản không tồn tại' }), { status: 404, headers: corsHeaders });
      }

      return new Response(JSON.stringify({
        success: true,
        user: {
          username: user.displayName,
          balance: user.balance,
          keys: user.keys,
          transactions: user.transactions
        }
      }), { status: 200, headers: corsHeaders });
    }

    // 4. BUY WITH BALANCE
    if (action === 'buy_with_balance' && request.method === 'POST') {
      const { username, plan } = await request.json();
      const cleanUser = (username || '').trim().toLowerCase();
      const user = globalUsers.get(cleanUser);

      if (!user) {
        return new Response(JSON.stringify({ success: false, message: 'Vui lòng đăng nhập trước khi mua!' }), { status: 401, headers: corsHeaders });
      }

      const PLANS = {
        daily: { name: 'Gói Thuê 1 Ngày (24H)', price: 19999, days: 1 },
        monthly: { name: 'Gói Thuê 30 Ngày (1 Tháng)', price: 199999, days: 30 },
        lifetime: { name: 'Gói Bản Quyền Vĩnh Viễn', price: 999999, days: 9999 }
      };

      const selectedPlan = PLANS[plan] || PLANS.monthly;
      if (user.balance < selectedPlan.price) {
        return new Response(JSON.stringify({
          success: false,
          message: 'Số dư trong ví không đủ để thanh toán gói này. Vui lòng nạp thêm tiền vào ví!'
        }), { status: 400, headers: corsHeaders });
      }

      // Create the provider-side license before charging the wallet. Never issue
      // a locally generated key when LicenseGate is unavailable.
      const key = await createLicenseGateLicense(env, plan, selectedPlan.days);
      user.balance -= selectedPlan.price;

      const keyRecord = {
        id: 'KEY_' + Date.now(),
        plan: selectedPlan.name,
        days: selectedPlan.days,
        price: selectedPlan.price,
        key: key,
        purchasedAt: new Date().toISOString()
      };

      user.keys.unshift(keyRecord);
      user.transactions.unshift({
        type: 'BUY_KEY',
        description: `Mua ${selectedPlan.name}`,
        amount: -selectedPlan.price,
        createdAt: new Date().toISOString()
      });

      return new Response(JSON.stringify({
        success: true,
        message: 'Thanh toán thành công! Key đã được thêm vào Kho Key của bạn.',
        key: key,
        plan: selectedPlan.name,
        newBalance: user.balance,
        keyRecord: keyRecord
      }), { status: 200, headers: corsHeaders });
    }

    return new Response(JSON.stringify({ success: false, message: 'Invalid action' }), { status: 400, headers: corsHeaders });

  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: corsHeaders });
  }
}
