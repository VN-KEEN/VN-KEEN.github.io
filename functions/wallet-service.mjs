import { createPayosLink } from './payos-service.mjs';
const encoder = new TextEncoder();
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const PROCESSING_LEASE_SECONDS = 60;
// Keep within the default Cloudflare Workers PBKDF2 ceiling while still using
// a per-account random salt and a deliberately expensive derivation.
const PASSWORD_ITERATIONS = 100000;
const MAX_BODY_BYTES = 8192;
const AUTH_WINDOW_SECONDS = 15 * 60;


export const PLANS = Object.freeze({
  daily: Object.freeze({ id: 'daily', name: 'Gói Thuê 1 Ngày (24H)', amount: 20000, days: 1 }),
  weekly: Object.freeze({ id: 'weekly', name: 'Gói Thuê 7 Ngày', amount: 100000, days: 7 }),
  monthly: Object.freeze({ id: 'monthly', name: 'Gói Thuê 30 Ngày (1 Tháng)', amount: 300000, days: 30 }),
  quarterly: Object.freeze({ id: 'quarterly', name: 'Gói Thuê 90 Ngày', amount: 800000, days: 90 }),
  lifetime: Object.freeze({ id: 'lifetime', name: 'Gói Bản Quyền Vĩnh Viễn', amount: 2000000, days: null })
});


export const PRODUCTS = Object.freeze({
  skin: Object.freeze({ id: 'skin', name: 'VN-KEEN-SKIN-VANTIX', scope: 'VN-KEEN-SKIN', prefix: 'VN-KEEN-SKIN' }),
  aim: Object.freeze({ id: 'aim', name: 'VN-KEEN-ESSENTIALS', scope: 'VN-KEEN-AIM', prefix: 'VN-KEEN-AIM' })
});


const ORIGINS = new Set(['https://vn-keen.github.io', 'https://vn-keen.pages.dev', 'https://vn-keen.skin', 'https://www.vn-keen.skin']);


function fail(status, code, message, details = {}) {
  throw Object.assign(new Error(message || code), { status, code, ...details });
}


function getDb(env) {
  if (!env?.LICENSE_DB) fail(503, 'NOT_CONFIGURED', 'Ví chưa được cấu hình trên máy chủ.');
  return env.LICENSE_DB;
}


function hex(bytes) {
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
