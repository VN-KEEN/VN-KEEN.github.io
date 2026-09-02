// Global memory cache for serverless execution context
const globalOrders = globalThis.__VNKEEN_ORDERS || (globalThis.__VNKEEN_ORDERS = new Map());

// Helper function to call KeyAuth Seller API
async function generateKeyAuthLicense(sellerKey, days = 9999, mask = 'KEEN-****-****-****') {
  if (!sellerKey || sellerKey === 'YOUR_KEYAUTH_SELLER_KEY') {
    // Demo / fallback generated key if seller key not yet set in Cloudflare Env
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

  // Fallback if API fails
  const randomHex = () => Math.random().toString(36).substring(2, 6).toUpperCase();
  return KEEN---;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  
  try {
    const body = await request.json();
    
    // Support SePay / Casso / VietQR / Custom Webhook payload
    // SePay payload: { content: "KEEN8X4K", transferAmount: 999999, ... }
    // Casso payload: { data: [{ description: "KEEN8X4K", amount: 999999 }] }
    
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
      amount = body.amount || 999999;
    }

    // Extract Order Code matching KEEN[A-Z0-9]{4,10}
    const match = content.toUpperCase().match(/KEEN[A-Z0-9]{4,10}/);
    if (!match) {
      return new Response(JSON.stringify({ success: false, message: 'No valid KEEN order code found in transfer content' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const orderId = match[0];
    const sellerKey = env?.KEYAUTH_SELLER_KEY || 'YOUR_KEYAUTH_SELLER_KEY';

    // Generate Key via KeyAuth
    const generatedKey = await generateKeyAuthLicense(sellerKey, 9999, 'KEEN-****-****-****');

    const orderData = {
      orderId: orderId,
      status: 'PAID',
      amount: amount,
      key: generatedKey,
      paidAt: new Date().toISOString()
    };

    // Store in global memory map
    globalOrders.set(orderId, orderData);

    // If Cloudflare KV namespace is bound (e.g. env.ORDERS_KV)
    if (env?.ORDERS_KV) {
      await env.ORDERS_KV.put(orderId, JSON.stringify(orderData), { expirationTtl: 86400 * 30 });
    }

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
