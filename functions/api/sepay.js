export async function onRequest(context) {
  const { request } = context;
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const sepayRes = await fetch('https://my.sepay.vn/userapi/transactions/list?account_number=789789999888&limit=20', {
      headers: {
        'Authorization': 'Bearer KF2Q9YENXSPW5HW4LA93XVSIMJWDBCBWIBI0NXPNEAYTUQ6VRGVGYG0YZGSVCJHM'
      }
    });

    const data = await sepayRes.text();
    return new Response(data, {
      status: sepayRes.status,
      headers: corsHeaders
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: corsHeaders
    });
  }
}
