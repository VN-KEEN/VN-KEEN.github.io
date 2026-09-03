// Global memory caches
const globalUsers = globalThis.__VNKEEN_USERS || (globalThis.__VNKEEN_USERS = new Map());
const globalOrders = globalThis.__VNKEEN_ORDERS || (globalThis.__VNKEEN_ORDERS = new Map());

// Helper function to call KeyAuth Seller API
async function generateKeyAuthLicense(sellerKey, days = 9999, mask = 'KEEN-****-****-****') {
  if (!sellerKey || sellerKey === 'YOUR_KEYAUTH_SELLER_KEY') {
    const randomHex = () => Math.random().toString(36).substring(2, 6).toUpperCase();
    return KEEN---;
  }

  try {
    const url = https://keyauth.win/api/seller/?sellerkey=&type=add&expiry=&mask=&level=1&amount=1&format=json;
    const res = await fetch(url);
    const data = await res.json();
    if (data.success && data.key) {
      return data.key;
    }
    console.error('KeyAuth Error:', data);
  } catch (err) {
    console.error('KeyAuth Fetch Error:', err);
  }

  const randomHex = () => Math.random().toString(36).substring(2, 6).toUpperCase();
  return KEEN---;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  
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
        description: Nạp tiền VietQR MB Bank (+đ),
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

    // Generate Key via KeyAuth
    const generatedKey = await generateKeyAuthLicense(sellerKey, days, 'KEEN-****-****-****');

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
