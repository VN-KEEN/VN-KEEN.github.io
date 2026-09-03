const globalOrders = globalThis.__VNKEEN_ORDERS || (globalThis.__VNKEEN_ORDERS = new Map());

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json();
    const orderId = (body.orderId || 'KEENTEST99').toUpperCase();
    
    // Generate test or KeyAuth license
    const randomHex = () => Math.random().toString(36).substring(2, 6).toUpperCase();
    const generatedKey = `KEEN-${randomHex()}-${randomHex()}-${randomHex()}`;

    const orderData = {
      orderId: orderId,
      status: 'PAID',
      amount: 999999,
      key: generatedKey,
      paidAt: new Date().toISOString()
    };

    globalOrders.set(orderId, orderData);

    if (env?.ORDERS_KV) {
      await env.ORDERS_KV.put(orderId, JSON.stringify(orderData), { expirationTtl: 86400 });
    }

    return new Response(JSON.stringify({
      success: true,
      message: 'Simulated payment succeeded',
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
