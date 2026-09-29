// Test payments must use a local fixture, never a production HTTP endpoint.
export function onRequest() {
  return new Response(JSON.stringify({ success: false, code: 'LEGACY_ENDPOINT_DISABLED' }), {
    status: 410,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}
