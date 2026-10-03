import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const mainScript = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1])
  .find(script => script.includes('USER_API_BASE'));
assert(mainScript, 'wallet client script not found');
const walletStart = mainScript.indexOf('    // The server owns identity');
const walletEnd = mainScript.indexOf("    window.addEventListener('DOMContentLoaded'", walletStart);
assert(walletStart >= 0 && walletEnd > walletStart, 'wallet client section not found');
const walletSource = mainScript.slice(walletStart, walletEnd);
const productStart = mainScript.indexOf('    const PRODUCT_META =');
const productEnd = mainScript.indexOf('    const PLAN_META =', productStart);
const productSource = mainScript.slice(productStart, productEnd);
assert(productStart >= 0 && productEnd > productStart, 'product picker source missing');

function element(initial = {}) {
  const classes = new Set(initial.classes || []);
  return {
    ...initial,
    classList: {
      add: (...values) => values.forEach(value => classes.add(value)),
      remove: (...values) => values.forEach(value => classes.delete(value)),
      contains: value => classes.has(value)
    },
    replaceChildren() {},
    append() {},
    appendChild() {},
    removeAttribute(name) { delete this[name]; },
    setAttribute(name, value) { this[name] = value; },
    insertAdjacentHTML() {},
    addEventListener() {}
  };
}

function response(status, body) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

function makeHarness(hostname = 'vn-keen.github.io') {
  const storage = new Map();
  const elements = new Map();
  const ids = [
    'nav-guest-zone', 'nav-user-zone', 'nav-user-name', 'nav-user-balance', 'nav-key-badge',
    'auth-alert', 'topup-qr-img', 'topup-bank-display', 'topup-amount-display',
    'topup-content-display', 'topup-copy-code', 'topup-listen-status', 'topupModal',
    'buy-confirm-alert', 'buy-confirm-plan', 'buy-confirm-product', 'buy-confirm-price', 'buy-confirm-balance',
    'buy-confirm-remaining', 'btn-execute-buy', 'buyConfirmModal', 'my-keys-list',
    'my-keys-empty', 'my-keys-pending', 'myKeysModal', 'authModal', 'tab-login',
    'tab-register', 'form-login', 'form-register', 'login-password', 'reg-password',
    'btn-login-submit', 'btn-reg-submit', 'selected-product-label', 'selected-product-scope',
    'selected-product-note', 'selected-product-download', 'pricing-product-context',
    'pricing-scope-context', 'pricing-scope-note', 'pricing-selection-summary'
  ];
  for (const id of ids) elements.set(id, element({ id, textContent: '', value: '', classes: ['hidden'] }));
  elements.get('topup-qr-img').src = 'stale-previous-user-qr';
  let nextInterval = 1;
  const intervals = new Set();
  let fetchImpl = async () => response(500, { success: false });
  const context = {
    console,
    crypto: webcrypto,
    location: { hostname },
    navigator: { clipboard: { writeText: async () => {} } },
    sessionStorage: {
      getItem: key => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key),
      key: index => [...storage.keys()][index] ?? null,
      get length() { return storage.size; }
    },
    document: {
      getElementById: id => elements.get(id) || null,
      querySelectorAll: () => [],
      createElement: () => element()
    },
    window: { addEventListener() {} },
    fetch: (...args) => fetchImpl(...args),
    setInterval: callback => { const id = nextInterval++; intervals.add(id); return id; },
    clearInterval: id => intervals.delete(id),
    setTimeout: () => 0,
    formatVnd: value => `${Number(value).toLocaleString('vi-VN')}đ`,
    playSfx() {},
    showToast() {},
    copyData() {},
    switchAuthTab() {},
    openAuthModal() {},
    closeAuthModal() {}
  };
  const preamble = `
    const PLAN_META = {
      daily: { id: 'daily', name: 'Gói ngày', amount: 20000, price: '20.000đ' },
      monthly: { id: 'monthly', name: 'Gói tháng', amount: 300000, price: '300.000đ' },
      lifetime: { id: 'lifetime', name: 'Gói vĩnh viễn', amount: 2000000, price: '2.000.000đ' }
    };
    function formatVnd(n) { return Number(n).toLocaleString('vi-VN') + 'đ'; }
    function playSfx() {}
    function showToast() {}
    function copyData() {}
    function switchAuthTab() {}
    function openAuthModal() {}
    function closeAuthModal() {}
  `;
  const expose = `
    globalThis.__wallet = {
      get base() { return USER_API_BASE; },
      get state() { return { currentUser, currentProduct, sessionToken, pendingBuyPlan, pendingBuyProduct, sessionGeneration, topupCurrentContent, topupPollingInterval }; },
      selectProduct,
      get elementMap() { return undefined; },
      setFetcher(fn) { globalThis.__setFetcher(fn); },
      setUser: setServerUser,
      setToken: persistSessionToken,
      clear: clearServerSession,
      refresh: refreshCurrentUser,
      restore: restoreServerSession,
      execute: executeBuyWithBalance,
      prepare: prepareWalletPurchase,
      readRequest: readWalletRequest,
      writeRequest: writeWalletRequest,
      pending: pendingOrderSummary,
      topup: setTopupAmount,
      openTopup: openTopupModal,
      logout: logoutUser
    };
  `;
  context.__setFetcher = fn => { fetchImpl = fn; };
  vm.runInNewContext(`${preamble}\n${productSource}\n${walletSource}\n${expose}`, context, { filename: 'wallet-client.vm.js' });
  return { context, api: context.__wallet, storage, elements, intervals, setFetcher: fn => { fetchImpl = fn; } };
}

function user(username, extra = {}) {
  return {
    username,
    balance: 500000,
    availableBalance: 500000,
    reservedBalance: 0,
    keys: [],
    transactions: [],
    pendingOrders: [],
    ...extra
  };
}

// Hosted GitHub pages must call the Pages API; local/deployed same-origin pages must not.
{
  const hosted = makeHarness('vn-keen.github.io');
  assert.equal(hosted.api.base, 'https://vn-keen.pages.dev/api/user?action=');
  const local = makeHarness('localhost');
  assert.equal(local.api.base, '/api/user?action=');
}

// Product selection updates the displayed scope and download together. The
// price tiers are shared, but the selected product is never implied to share
// a key or LicenseGate scope.
{
  const h = makeHarness();
  h.api.selectProduct('essentials');
  assert.equal(h.elements.get('selected-product-label').textContent, 'VN-KEEN-ESSENTIALS');
  assert.equal(h.elements.get('selected-product-scope').textContent, 'SCOPE VN-KEEN-AIM');
  assert.match(h.elements.get('selected-product-note').textContent, /không mở được VANTIX\/SKIN/);
  assert.equal(h.elements.get('selected-product-download').href, 'VN-KEEN-ESSENTIALS-20261003-LicenseGate.zip');
  assert.match(h.elements.get('pricing-scope-note').innerHTML, /VN-KEEN-AIM/);
  h.api.selectProduct('vantix');
  assert.equal(h.elements.get('selected-product-label').textContent, 'VN-KEEN-SKIN-VANTIX');
  assert.equal(h.elements.get('selected-product-scope').textContent, 'SCOPE VN-KEEN-SKIN');
  assert.equal(h.elements.get('selected-product-download').href, 'VN-KEEN-SKIN-VANTIX.zip');
}

// A timeout followed by PURCHASE_PENDING must retain the exact id and old plan.
{
  const h = makeHarness();
  h.api.setToken('token-a');
  h.api.setUser(user('alice_1'));
  h.setFetcher(async () => { throw new Error('timeout'); });
  await h.api.execute();
  const first = h.api.readRequest();
  assert(first?.requestId && first.plan === 'monthly');
  h.setFetcher(async () => response(409, {
    success: false,
    code: 'PURCHASE_PENDING',
    pendingOrder: { requestId: first.requestId, plan: 'monthly', status: 'PENDING' }
  }));
  await h.api.execute();
  assert.equal(JSON.stringify(h.api.readRequest()), JSON.stringify({ requestId: first.requestId, product: 'skin', plan: 'monthly', status: 'PENDING' }));
}

// A pending order returned by /me is recovered after a reload, even with no local id.
{
  const h = makeHarness();
  h.storage.set('vnkeen_session_token', 'token-b');
  h.setFetcher(async () => response(200, {
    success: true,
    user: user('bob_2', { pendingOrders: [{ requestId: 'srv-req-1234', plan: 'daily', status: 'PENDING' }] })
  }));
  await h.api.restore();
  assert.equal(JSON.stringify(h.api.readRequest()), JSON.stringify({ requestId: 'srv-req-1234', product: 'skin', plan: 'daily', status: 'PENDING' }));
  assert.equal(h.api.state.pendingBuyPlan, 'daily');
}

// A legacy bare request id is never discarded or replayed with a guessed plan;
// the server must reconcile it through pendingOrders or a key carrying that id.
{
  const h = makeHarness();
  h.storage.set('vnkeen_session_token', 'token-legacy');
  h.storage.set('vnkeen_wallet_request:legacy_6', 'legacy-req-1234');
  h.setFetcher(async () => response(200, {
    success: true,
    user: user('legacy_6')
  }));
  await h.api.restore();
  assert.equal(h.storage.get('vnkeen_wallet_request:legacy_6'), 'legacy-req-1234');
  assert.equal(h.api.readRequest().plan, null);
  assert.equal(h.api.readRequest().product, 'skin');

  h.setFetcher(async () => response(200, {
    success: true,
    user: user('legacy_6', { keys: [{ id: 'legacy-req-1234', planId: 'daily', key: 'VN-KEEN-SKIN-B' }] })
  }));
  await h.api.refresh();
  assert.equal(h.api.readRequest(), null);
}

// Insufficient balance does not create/clear an order; its id remains reusable after top-up.
{
  const h = makeHarness();
  h.api.setToken('token-c');
  h.api.setUser(user('carol_3', { balance: 0, availableBalance: 0 }));
  h.setFetcher(async () => response(409, { success: false, code: 'INSUFFICIENT_BALANCE' }));
  await h.api.execute();
  const request = h.api.readRequest();
  assert(request?.requestId, 'request id should remain after insufficient funds');
  assert.equal(request.status, 'UNKNOWN');
}

// A known FULFILLED response clears exactly that request id.
{
  const h = makeHarness();
  h.api.setToken('token-d');
  h.api.setUser(user('dave_4'));
  const requestId = 'fulfill-1234';
  h.api.writeRequest({ requestId, plan: 'monthly', status: 'PENDING' });
  h.setFetcher(async () => response(200, {
    success: true,
    status: 'FULFILLED',
    requestId,
    key: 'VN-KEEN-SKIN-A',
    user: user('dave_4', { keys: [{ id: requestId, planId: 'monthly', plan: 'Gói tháng', key: 'VN-KEEN-SKIN-A' }] })
  }));
  await h.api.execute();
  assert.equal(h.api.readRequest(), null);
}

// Bank QR is removed, not replaced by stale content, when the server omits bank data.
{
  const h = makeHarness();
  h.api.setUser(user('erin_5', { bank: null, depositCode: '' }));
  h.api.topup(200000);
  const qr = h.elements.get('topup-qr-img');
  assert.equal(qr.src, undefined);
  assert.equal(qr.classList.contains('hidden'), true);
}

// A stale /me response from an old session cannot restore a logged-out or new user wallet.
{
  const h = makeHarness();
  h.api.setToken('token-old');
  h.api.setUser(user('old_user'));
  let resolveFetch;
  h.setFetcher(() => new Promise(resolve => { resolveFetch = resolve; }));
  const refresh = h.api.refresh();
  h.api.topup(200000);
  h.api.clear();
  assert.equal(h.api.state.currentUser, null);
  assert.equal(h.api.state.topupCurrentContent, '');
  h.api.setToken('token-new');
  h.api.setUser(user('new_user'));
  resolveFetch(response(200, { success: true, user: user('old_user', { balance: 999999 }) }));
  await refresh;
  assert.equal(h.api.state.currentUser.username, 'new_user');
  assert.notEqual(h.api.state.currentUser.balance, 999999);
}

// Logging out also stops top-up polling so the previous account cannot update
// the next account's UI.
{
  const h = makeHarness();
  h.api.setToken('token-topup');
  h.api.setUser(user('topup_7', {
    bank: { account: '123', bank: 'MB', name: 'TEST' },
    depositCode: 'NAP TOPUP_7'
  }));
  h.setFetcher(async () => response(200, { success: true, user: user('topup_7', {
    bank: { account: '123', bank: 'MB', name: 'TEST' }, depositCode: 'NAP TOPUP_7'
  }) }));
  await h.api.openTopup();
  assert.notEqual(h.api.state.topupPollingInterval, null);
  h.api.clear();
  assert.equal(h.api.state.topupPollingInterval, null);
  assert.equal(h.api.state.topupCurrentContent, '');
}

// AIM selection is sent to the API and survives a timeout/reload with the same id.
{
  const h = makeHarness();
  h.api.setToken('token-aim');
  h.api.setUser(user('aim_buyer'));
  h.api.selectProduct('essentials');
  h.setFetcher(async () => response(200, { success: true, user: user('aim_buyer') }));
  await h.api.prepare('daily');
  assert.equal(h.api.state.pendingBuyProduct, 'aim');
  assert.match(h.elements.get('buy-confirm-product').textContent, /ESSENTIALS/);
  let sent;
  let resolvePurchase;
  h.setFetcher((_url, options) => {
    sent = JSON.parse(options.body);
    return new Promise(resolve => { resolvePurchase = resolve; });
  });
  const purchase = h.api.execute();
  h.api.selectProduct('vantix');
  assert.equal(h.api.state.pendingBuyProduct, 'aim', 'picker must not change confirmed order');
  resolvePurchase(response(202, { success: false, code: 'LICENSE_PENDING', ...sent }));
  await purchase;
  assert.equal(sent.product, 'aim');
  assert.equal(sent.plan, 'daily');
  assert.equal(h.api.readRequest().product, 'aim');

  const reloaded = makeHarness();
  for (const [key, value] of h.storage) reloaded.storage.set(key, value);
  reloaded.setFetcher(async () => response(200, { success: true, user: user('aim_buyer', {
    pendingOrders: [{ ...sent, status: 'PENDING' }]
  }) }));
  await reloaded.api.restore();
  assert.equal(reloaded.api.state.currentProduct, 'essentials');
  assert.equal(reloaded.api.state.pendingBuyProduct, 'aim');
  reloaded.setFetcher(async (_url, options) => {
    const retry = JSON.parse(options.body);
    assert.deepEqual(retry, sent);
    return response(202, { success: false, code: 'LICENSE_PENDING', ...retry });
  });
  await reloaded.api.execute();
}

// Switching to AIM must first recover a legacy SKIN attempt, never relabel it.
{
  const h = makeHarness();
  h.api.setToken('token-old-skin');
  h.storage.set('vnkeen_wallet_request:old_skin', JSON.stringify({ requestId: 'old-skin-1234', plan: 'daily' }));
  h.api.setUser(user('old_skin'));
  h.api.selectProduct('essentials');
  h.setFetcher(async () => response(200, { success: true, user: user('old_skin') }));
  await h.api.prepare('monthly');
  assert.equal(h.api.state.pendingBuyProduct, 'skin');
  assert.equal(h.api.state.pendingBuyPlan, 'daily');
  assert.equal(h.api.state.currentProduct, 'vantix');
  h.setFetcher(async (_url, options) => {
    const sent = JSON.parse(options.body);
    assert.deepEqual(sent, { product: 'skin', plan: 'daily', requestId: 'old-skin-1234' });
    return response(202, { success: false, code: 'LICENSE_PENDING', ...sent });
  });
  await h.api.execute();
}

// A cross-tab pending conflict must display and retry the server's actual product.
{
  const h = makeHarness();
  h.api.setToken('token-conflict');
  h.api.setUser(user('conflict_buyer'));
  h.setFetcher(async () => response(409, { success: false, code: 'PURCHASE_PENDING',
    pendingOrder: { requestId: 'server-aim-1234', product: 'aim', plan: 'daily', status: 'PENDING' }
  }));
  await h.api.execute();
  assert.equal(h.api.readRequest().product, 'aim');
  assert.equal(h.api.state.pendingBuyProduct, 'aim');
  assert.match(h.elements.get('buy-confirm-product').textContent, /ESSENTIALS/);
  h.setFetcher(async (_url, options) => {
    const sent = JSON.parse(options.body);
    assert.deepEqual(sent, { product: 'aim', plan: 'daily', requestId: 'server-aim-1234' });
    return response(202, { success: false, code: 'LICENSE_PENDING', ...sent });
  });
  await h.api.execute();
}

console.log('wallet client tests passed');
