const globalOrders = globalThis.__VNKEEN_ORDERS || (globalThis.__VNKEEN_ORDERS = new Map());

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const orderId = url.searchParams.get('orderId')?.toUpperCase();

  if (!orderId) {
    return new Response(JSON.stringify({ success: false, message: 'Missing orderId parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  // 1. Check in Cloudflare KV if available
  let order = null;
  if (env?.ORDERS_KV) {
    const raw = await env.ORDERS_KV.get(orderId);
    if (raw) {
      try { order = JSON.parse(raw); } catch (e) {}
    }
  }

  // 2. Check in global memory cache
  if (!order && globalOrders.has(orderId)) {
    order = globalOrders.get(orderId);
  }

  if (order && order.status === 'PAID') {
    return new Response(JSON.stringify({
      success: true,
      status: 'PAID',
      orderId: order.orderId,
      key: order.key,
      plan: 'Lifetime Multi-Device',
      paidAt: order.paidAt
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  // Default: Pending
  return new Response(JSON.stringify({
    success: true,
    status: 'PENDING',
    orderId: orderId,
    message: 'Waiting for payment confirmation...'
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
