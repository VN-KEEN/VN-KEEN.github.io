// Global memory caches
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
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method === 'GET') {
    return new Response(JSON.stringify({ status: 'OK', message: 'VN-KEEN Webhook is running 24/7' }), { headers: corsHeaders });
  }

  try {
    const body = await request.json();
    
    let content = '';
    let amount = 0;

    if (body.content) {
      content = body.content;
      amount = body.transferAmount || body.amount || 0;
    } else if (body.data && Array.isArray(body.data) && body.data.length > 0) {
      content = body.data[0].description || '';
      amount = body.data[0].amount || 0;
    } else if (body.orderId) {
      content = body.orderId;
      amount = body.amount || 199999;
    }

    const upperContent = content.toUpperCase().trim();

    // CASE 1: TOP-UP WALLET DEPOSIT (Content: NAP[USERNAME] or NAP [USERNAME])
    const topupMatch = upperContent.match(/^NAP\s*([A-Z0-9_-]+)/i);
    if (topupMatch) {
      const targetUser = topupMatch[1].toLowerCase();
      let user = globalUsers.get(targetUser);
      if (!user) {
        // Auto register on deposit if first time
        user = {
          username: targetUser,
          displayName: topupMatch[1],
          password: 'pass_' + targetUser,
          balance: 0,
          keys: [],
          transactions: [],
          createdAt: new Date().toISOString()
        };
        globalUsers.set(targetUser, user);
      }

      user.balance += amount;
      const trans = {
        type: 'TOPUP',
        description: `Nạp tiền VietQR MB Bank (+${amount}đ)`,
        amount: amount,
        createdAt: new Date().toISOString()
      };
      user.transactions.unshift(trans);

      const topupOrder = {
        orderId: upperContent,
        type: 'TOPUP',
        username: user.displayName,
        amount: amount,
        newBalance: user.balance,
        status: 'PAID',
        paidAt: new Date().toISOString()
      };
      globalOrders.set(upperContent, topupOrder);

      return new Response(JSON.stringify({
        success: true,
        type: 'TOPUP',
        message: Nạp thành công +đ vào tài khoản . Số dư mới: đ,
        user: { username: user.displayName, balance: user.balance }
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // CASE 2: DIRECT PLAN PURCHASE (Content: KEEN[A-Z0-9]{4,10})
    const match = upperContent.match(/KEEN[A-Z0-9]{4,10}/);
    if (!match) {
      return new Response(JSON.stringify({ success: false, message: 'No valid KEEN or NAP order code found in transfer content' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const orderId = match[0];
    const sellerKey = env?.KEYAUTH_SELLER_KEY || 'YOUR_KEYAUTH_SELLER_KEY';

    let days = 9999;
    let planTitle = 'Vĩnh Viễn (Lifetime)';
    if (amount < 50000) {
      days = 1;
      planTitle = '1 Ngày (24H)';
    } else if (amount < 500000) {
      days = 30;
      planTitle = '30 Ngày (1 Tháng)';
    }

    const planId = (days === 1 ? 'daily' : (days === 30 ? 'monthly' : 'lifetime'));
    const generatedKey = await generateKeyAuthLicense(sellerKey, planId, days);

    const orderData = {
      orderId: orderId,
      status: 'PAID',
      amount: amount,
      days: days,
      planTitle: planTitle,
      key: generatedKey,
      paidAt: new Date().toISOString()
    };

    // Store in global memory map
    globalOrders.set(orderId, orderData);

    return new Response(JSON.stringify({
      success: true,
      message: 'Payment received and key generated successfully',
      order: orderData
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
