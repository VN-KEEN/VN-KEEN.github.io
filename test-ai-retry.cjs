const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync('ai-widget.js', 'utf8');
new vm.Script(source);
const helper = source.slice(source.indexOf('  async function requestWithRetry'), source.indexOf('  async function handleSend'));
async function check(statuses, expectedCalls, expectedStatus) {
  let calls = 0;
  const context = vm.createContext({ AbortController,
    setTimeout: (fn, ms) => ms === 15000 ? 0 : setTimeout(fn, 0), clearTimeout,
    fetch: async () => { const status = statuses[calls++]; return { status, json: async () => ({ status }) }; }
  });
  vm.runInContext(helper, context);
  const result = await context.requestWithRetry('https://test.invalid', {});
  assert.equal(calls, expectedCalls);
  assert.equal(result.response.status, expectedStatus);
}
(async () => {
  await check([503, 503, 200], 3, 200);
  await check([503, 503, 503], 3, 503);
  await check([403], 1, 403);
  await check([429], 1, 429);
  await check([200], 1, 200);
  console.log('PASS: recovery, bounded retries, permanent errors, immediate success');
})();
