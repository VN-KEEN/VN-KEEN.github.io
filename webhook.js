// Global memory caches
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
  if (env?.LICENSEGATE_API_KEY) {
    try {
      const expirationDate = days >= 9999 ? '2099-12-31T23:59:59.000Z' : new Date(Date.now() + days * 86400 * 1000).toISOString();
      const res = await fetch('https://api.licensegate.io/admin/licenses', {
        method: 'POST',
        headers: {
          'Authorization': env.LICENSEGATE_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          active: true,
          name: 'ORDER-' + Date.now(),
          notes: 'VN-KEEN Webhook Order / ' + planId,
          licenseKey: licenseKey,
          licenseScope: 'VN-KEEN-SKIN',
          expirationDate: expirationDate,
          ipLimit: 1,
          validationPoints: 1000,
          validationLimit: 1000,
          replenishAmount: 1000,
          replenishInterval: 'DAY'
        })
      });
      if (res.ok) {
        const data = await res.json();
        return data.licenseKey || licenseKey;
      }
    } catch (err) {
      console.error('LicenseGate API error:', err);
    }
  }
  return licenseKey;
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
    const topupMatch = upperContent.match(/^NAP\s*([A-Z0-9]+)/i);
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
        message: `Nạp thành công +${amount}đ vào tài khoản ${user.displayName}. Số dư mới: ${user.balance}đ`,
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
    const generatedKey = await createLicenseGateLicense(env, planId, days);

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
