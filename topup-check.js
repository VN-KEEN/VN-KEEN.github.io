// Global memory caches
const globalUsers = globalThis.__VNKEEN_USERS || (globalThis.__VNKEEN_USERS = new Map());
const globalOrders = globalThis.__VNKEEN_ORDERS || (globalThis.__VNKEEN_ORDERS = new Map());

export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  const code = (url.searchParams.get('code') || '').toUpperCase().trim();
  const username = (url.searchParams.get('username') || '').toLowerCase().trim();

  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // 1. Check direct topup order by code
  if (code && globalOrders.has(code)) {
    const order = globalOrders.get(code);
    return new Response(JSON.stringify({
      success: true,
      paid: true,
      order: order
    }), { status: 200, headers: corsHeaders });
  }

  // 2. Check by username
  if (username && globalUsers.has(username)) {
    const user = globalUsers.get(username);
    return new Response(JSON.stringify({
      success: true,
      paid: false,
      user: {
        username: user.displayName,
        balance: user.balance,
        keys: user.keys
      }
    }), { status: 200, headers: corsHeaders });
  }

  return new Response(JSON.stringify({
    success: true,
    paid: false,
    message: 'Waiting for deposit...'
  }), { status: 200, headers: corsHeaders });
}
