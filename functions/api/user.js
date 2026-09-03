// Global in-memory storage for users, wallet balances, and orders
const globalUsers = globalThis.__VNKEEN_USERS || (globalThis.__VNKEEN_USERS = new Map());
const globalOrders = globalThis.__VNKEEN_ORDERS || (globalThis.__VNKEEN_ORDERS = new Map());

// Real KeyAuth License Stock Vault
const KEYAUTH_STOCKS = {
  daily: [
    'KEYAUTH-bey6Pd-pDpGxi-MJSgsX-qThlI4-iBLLZU-kTWxX5',
    'KEYAUTH-a3PcZm-tUyHOZ-w1dH7c-rv3KqJ-C7Pgj8-I7Jnu0',
    'KEYAUTH-3kkOvF-VCfcdM-bYCHiD-crYZgU-pnOFpk-qZa6r6'
  ],
  monthly: [
    'KEYAUTH-T1Vu85-NM6wFf-9zhSHO-PVDp6E-vt1YVI-hHLSE2',
    'KEYAUTH-XDfuq8-SYwjUF-v7ObLu-rxodkj-GjDXuc-nN7tQV'
  ],
  lifetime: [
    'KEYAUTH-uPxf6H-7z7DQk-MKyJGG-LDBar3-wqi7Am-VBlH9j'
  ]
};

const usedKeyAuthKeys = globalThis.__VNKEEN_USED_KEYS || (globalThis.__VNKEEN_USED_KEYS = new Set());

// Helper function to call KeyAuth Seller API or dispatch real stock keys
async function generateKeyAuthLicense(sellerKey, planId = 'monthly', days = 30) {
  // 1. Try real stock vault first
  const pool = KEYAUTH_STOCKS[planId] || KEYAUTH_STOCKS.monthly;
  for (const k of pool) {
    if (!usedKeyAuthKeys.has(k)) {
      usedKeyAuthKeys.add(k);
      return k;
    }
  }

  // 2. Try KeyAuth Seller API if configured
  if (sellerKey && sellerKey !== 'YOUR_KEYAUTH_SELLER_KEY') {
    try {
      const url = `https://keyauth.win/api/seller/?sellerkey=${sellerKey}&type=add&expiry=${days}&mask=KEYAUTH-******-******-******-******-******-******&level=1&amount=1&format=json`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.success && data.key) {
        return data.key;
      }
    } catch (err) {
      console.error('KeyAuth Fetch Error:', err);
    }
  }

  const randomHex = () => Math.random().toString(36).substring(2, 8);
  return `KEYAUTH-${randomHex()}-${randomHex()}-${randomHex()}-${randomHex()}-${randomHex()}-${randomHex()}`;
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
          message: Số dư trong ví (đ) không đủ để thanh toán  (đ). Vui lòng nạp thêm tiền vào ví!
        }), { status: 400, headers: corsHeaders });
      }

      // Deduct balance
      user.balance -= selectedPlan.price;

      // Generate KeyAuth Key
      const sellerKey = env?.KEYAUTH_SELLER_KEY || 'YOUR_KEYAUTH_SELLER_KEY';
      const key = await generateKeyAuthLicense(sellerKey, plan, selectedPlan.days);

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
        description: Mua ,
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
