// Real UI, mocked APIs: no production writes or Telegram requests.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PULSE_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.PULSE_TEST_BASE_URL || 'http://127.0.0.1:18080';
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PULSE_BROWSER_EXECUTABLE });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 1100 }, deviceScaleFactor: 2 });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', () => { throw new Error('Unexpected native alert'); });
    const unready = { id: 'demo', name: 'MEGABOX PRO', os: 'Debian', traffic_limit_bytes: 1e12 };
    const ready = { ...unready, traffic_source: 'vnstat', traffic_cycle_start: '2026-09-01', traffic_cycle_end: '2026-10-01', monthly_net_in_bytes: 0, monthly_net_out_bytes: 0 };
    let current = unready, failure = false;
    const writes = [];
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/metrics' && route.request().method() === 'POST') {
        writes.push(route.request().postDataJSON());
        return failure ? route.fulfill({ status: 400, body: 'invalid traffic settings: monthly data is not ready; wait for vnStat before calibrating' }) : route.fulfill({ json: {} });
      }
      const responses = {
        '/api/metrics': [current], '/api/auth/status': { set: true }, '/api/auth/verify': { valid: true },
        '/api/privacy/config': { enabled: false }, '/api/navbar/config': { text: 'Pulse', show_glass: true }, '/api/tcping/config': { targets: [] }
      };
      return route.fulfill({ json: responses[path] || {} });
    });
    await page.addInitScript(() => {
      localStorage.setItem('admin_auth_token', 'test-only');
      localStorage.setItem('preferred-language', 'zh');
      localStorage.setItem('theme', 'light');
      window.EventSource = class extends EventTarget { constructor() { super(); window.__stream = this; } close() {} };
      window.__push = systems => window.__stream.dispatchEvent(new MessageEvent('update', { data: JSON.stringify({ type: 'metric_updated', view: 'admin', systems }) }));
    });
    await page.goto(`${base}/admin/`);
    const open = async () => { await page.locator('.edit-btn').first().click(); await page.locator('#edit-system-modal').waitFor({ state: 'visible' }); };
    const push = async metric => { current = metric; await page.evaluate(metric => window.__push([metric]), metric); };
    const input = page.locator('#edit-traffic-calibration');
    const status = page.locator('#traffic-readiness');
    const submit = page.locator('#edit-system-form button[type="submit"]');
    const snapshot = async name => {
      if (!process.env.PULSE_SCREENSHOT_DIR) return;
      await page.locator('.traffic-settings').scrollIntoViewIfNeeded();
      await page.waitForTimeout(350);
      await page.locator('.traffic-settings').screenshot({ path: `${process.env.PULSE_SCREENSHOT_DIR}/${name}.png` });
    };
    await open();
    assert(await input.isDisabled());
    assert.equal(await input.inputValue(), '');
    assert.equal(await input.getAttribute('placeholder'), null, 'Calibration must not show an example amount');
    assert.equal((await submit.textContent()).trim(), '更新服务');
    await snapshot('calibration-waiting');
    await submit.click();
    await page.locator('#edit-system-modal').waitFor({ state: 'hidden' });
    assert(!('traffic_calibrate_bytes' in writes[0]), 'Unready ordinary save must omit calibration');
    await open();
    assert.equal((await submit.textContent()).trim(), '更新服务', 'Reopen lost translation');
    await page.locator('#edit-system-form [name="name"]').fill('My renamed host');
    await push(ready);
    await page.locator('#traffic-readiness[data-ready="true"]').waitFor();
    assert(await input.isEnabled(), 'Zero monthly usage should be ready');
    assert.equal(await page.locator('#edit-system-form [name="name"]').inputValue(), 'My renamed host');
    await input.fill('854.71');
    await snapshot('calibration-ready');
    await push(unready);
    await page.locator('#traffic-readiness[data-ready="false"]').waitFor();
    await submit.click();
    assert.equal(writes.length, 1, 'Readiness loss silently discarded entered calibration');
    assert.equal(await input.inputValue(), '854.71');
    await push(ready);
    await page.locator('#traffic-readiness[data-ready="true"]').waitFor();
    failure = true;
    await submit.click();
    await page.locator('#edit-form-message').filter({ hasText: '已填写内容已保留' }).waitFor();
    assert.equal((await submit.textContent()).trim(), '更新服务');
    assert.equal(await status.getAttribute('data-ready'), 'false');
    assert.equal(await input.inputValue(), '854.71');
    failure = false;
    await push(ready);
    await page.locator('#traffic-readiness[data-ready="true"]').waitFor();
    await submit.click();
    await page.locator('#edit-system-modal').waitFor({ state: 'hidden' });
    assert.equal(writes.at(-1).traffic_calibrate_bytes, 854710000000);
    await open();
    for (const width of [1100, 375, 320]) {
      await page.setViewportSize({ width, height: 1100 });
      for (const dark of [false, true]) for (const glass of [false, true]) {
        await page.evaluate(({ dark, glass }) => {
          document.documentElement.classList.toggle('dark', dark);
          document.documentElement.classList.toggle('light', !dark);
          document.documentElement.classList.toggle('glass-enabled', glass);
        }, { dark, glass });
        assert(await page.locator('.traffic-calibration-card').evaluate(el => el.scrollWidth <= el.clientWidth), `${width}: card overflow`);
      }
    }
    await page.evaluate(() => { localStorage.setItem('preferred-language', 'en'); window.dispatchEvent(new Event('languagechange')); });
    assert.equal((await status.textContent()).trim(), 'Ready to calibrate');
    assert((await submit.textContent()).includes('Update'));
    assert.deepEqual(errors, []);
    console.log('PASS readiness transitions, zero usage, preserved edits, ordinary saving, translated errors/buttons, successful calibration and responsive materials');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
