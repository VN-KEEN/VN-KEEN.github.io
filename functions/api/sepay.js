// Never expose the bank transaction feed or its provider credentials publicly.
export function onRequest() {
  return new Response(JSON.stringify({ success: false, code: 'LEGACY_ENDPOINT_DISABLED' }), {
    status: 410,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}
