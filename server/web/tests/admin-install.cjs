// Browser regression against a running build; all admin APIs are mocked.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PULSE_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.PULSE_TEST_BASE_URL || 'http://127.0.0.1:18080';
const fixture = [{ id: 'test-host', name: 'VMRACK', secret: "test-only-'quoted'", os: '', virtualization_type: '' }];

(async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.PULSE_BROWSER_EXECUTABLE ? { executablePath: process.env.PULSE_BROWSER_EXECUTABLE } : {}) });
  try {
    const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    let savedPayload;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/metrics' && route.request().method() === 'POST') savedPayload = route.request().postDataJSON();
      return route.fulfill({ json: path === '/api/metrics' ? fixture :
        path === '/api/auth/status' ? { set: true } :
        path === '/api/auth/verify' ? { valid: true } :
        path === '/api/privacy/config' ? { enabled: false } :
        path === '/api/tcping/config' ? { targets: [] } : {} });
    });
    await page.addInitScript(initial => {
      localStorage.setItem('admin_auth_token', 'ui-test-token');
      localStorage.setItem('preferred-language', 'zh');
      localStorage.setItem('theme', 'light');
      window.EventSource = class extends EventTarget {
        constructor() {
          super(); window.__stream = this;
          this.timer = setTimeout(() => window.__push(initial), 100);
        }
        close() { clearTimeout(this.timer); }
      };
      window.__push = systems => window.__stream.dispatchEvent(new MessageEvent('update', {
        data: JSON.stringify({ type: 'metric_updated', view: 'admin', systems })
      }));
    }, fixture);
    await page.goto(`${base}/admin/`);
    const edit = page.locator('.edit-btn').first();
    await edit.waitFor({ state: 'visible' });
    const assertAligned = async () => {
      const delta = await page.evaluate(() => {
        const icon = document.querySelector('.edit-btn').getBoundingClientRect();
        const name = document.querySelector('.admin-host-identity').getBoundingClientRect();
        return Math.abs(icon.y + icon.height / 2 - name.y - name.height / 2);
      });
      assert(delta < 1, `Host identity is not centered with edit icon at ${page.viewportSize().width}px: ${delta}px`);
      assert.equal(await edit.evaluate(el => getComputedStyle(el).borderRadius), '50%', 'Edit button must be circular');
    };
    await assertAligned();
    await page.evaluate(data => window.__push(data), [{ ...fixture[0], os: 'Debian', virtualization_type: 'KVM' }]);
    await page.locator('.system-secondary-info[data-empty="false"]').waitFor({ state: 'visible' });
    await page.evaluate(data => window.__push(data), fixture);
    await page.locator('.system-secondary-info').waitFor({ state: 'hidden' });
    await assertAligned();
    const populated = [{ ...fixture[0], name: 'DMIT PRO', os: 'Debian', virtualization_type: 'VPS', ipv4: '192.0.2.7', ipv6: '2001:db8:1234:5678:abcd:ef01:2345:6789',
      cpu_model: 'AMD EPYC-Rome Processor', traffic_source: 'vnstat', monthly_net_in_bytes: 2.39 * 1024 ** 3, monthly_net_out_bytes: 2.32 * 1024 ** 3 }];
    await page.evaluate(data => window.__push(data), populated);
    await page.locator('.copy-ip-btn').first().waitFor();
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    for (const width of [1100, 800, 640, 375]) {
      await page.setViewportSize({ width, height: 900 });
      await assertAligned();
      const geometry = await page.locator('.draggable-item').first().evaluate(row => {
        const bounds = row.getBoundingClientRect();
        const buttons = [...row.querySelectorAll('.copy-ip-btn')].filter(el => el.getClientRects().length);
        return { fits: row.scrollWidth <= row.clientWidth + 1,
          copies: buttons.map(button => {
            const b = button.getBoundingClientRect();
            const label = button.parentElement.querySelector('.system-ipv4, .system-ipv6').getBoundingClientRect();
            const icon = button.querySelector('.copy-icon').getBoundingClientRect();
            return { radius: getComputedStyle(button).borderRadius, square: b.width === b.height,
              aligned: Math.abs(b.top + b.height / 2 - label.top - label.height / 2) < 1,
              iconCentered: Math.abs(icon.top + icon.height / 2 - b.top - b.height / 2) < 1 && Math.abs(icon.left + icon.width / 2 - b.left - b.width / 2) < 1,
              fits: b.right <= bounds.right && label.right + 5 <= b.left };
          }) };
      });
      assert(geometry.fits, `${width}: admin row overflows`);
      assert(geometry.copies.every(b => b.radius === '50%' && b.square && b.aligned && b.iconCentered && b.fits), `${width}: copy controls not aligned: ${JSON.stringify(geometry)}`);
      if (process.env.PULSE_SCREENSHOT_DIR) await page.locator('.draggable-item').first().screenshot({ path: `${process.env.PULSE_SCREENSHOT_DIR}/admin-row-${width}.png` });
    }
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.locator('.copy-ip-btn[data-ip="192.0.2.7"]').click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '192.0.2.7');
    await page.locator('.copy-ip-btn[data-ip^="2001:"]').click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), populated[0].ipv6, 'Truncated IPv6 was copied instead of full address');
    await page.locator('#theme-btn').click();
    await page.waitForTimeout(400);
    if (process.env.PULSE_SCREENSHOT_DIR) await page.locator('.draggable-item').first().screenshot({ path: `${process.env.PULSE_SCREENSHOT_DIR}/admin-row-dark.png` });
    await page.reload();
    await edit.waitFor({ state: 'visible' });
    console.log('PASS centered circular IP copy controls, full IPv6 copying, and responsive admin row');
    await page.locator('.copy-linux-cmd-btn').first().click();
    const command = page.locator('#linux-install-command');
    await command.waitFor({ state: 'visible' });
    assert((await command.inputValue()).includes('| bash -s --'));
    await page.selectOption('#linux-install-user', 'sudo');
    assert((await command.inputValue()).includes('| sudo bash -s --'));
    await page.selectOption('#linux-install-user', 'root');
    await page.locator('label').filter({ has: page.locator('#linux-vnstat-toggle') }).click();
    assert(await page.locator('#linux-vnstat-toggle').isChecked());
    await page.fill('#linux-traffic-reset-day', '18');
    await page.fill('#linux-vnstat-interface', 'ens3');
    const expected = await command.inputValue();
    assert(expected.includes('--vnstat --traffic-reset-day 18'));
    assert(expected.includes("--vnstat-interface 'ens3'"));
    assert(expected.includes("'test-only-'\\''quoted'\\'''"), 'Secret is not shell-quoted');
    const copy = page.locator('#copy-linux-install-btn');
    // Real secure-context clipboard: verify an actual paste, not just a toast.
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await copy.click();
    await page.locator('#linux-copy-status[data-copied="true"]').waitFor();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), expected);
    assert(await command.isVisible(), 'Copy closed the manual command box');
    console.log('PASS real clipboard, root/sudo, vnStat preview and empty-host alignment');
    // HTTP fallback and denied Clipboard API both reach execCommand.
    for (const mode of ['missing', 'denied']) {
      await page.evaluate(mode => {
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: mode === 'missing' ? undefined :
          { writeText: async () => { throw new Error('Denied'); } } });
        document.execCommand = op => {
          const field = document.activeElement;
          window.__fallbackText = field.value.slice(field.selectionStart, field.selectionEnd);
          return op === 'copy';
        };
      }, mode);
      await copy.click();
      assert.equal(await page.evaluate(() => window.__fallbackText), expected);
      assert.equal(await page.locator('#linux-copy-status').getAttribute('data-copied'), 'true');
    }
    await page.evaluate(() => { document.execCommand = () => false; });
    await copy.click();
    assert.equal(await page.locator('#linux-copy-status').getAttribute('data-copied'), 'false');
    assert.equal((await copy.textContent()).trim(), '复制命令');
    assert((await page.locator('#linux-copy-status').textContent()).includes('Ctrl/Cmd+C'));
    assert.equal(await command.evaluate(el => el.selectionEnd - el.selectionStart), expected.length);
    console.log('PASS HTTP/denied clipboard fallback and manual-copy failure feedback');
    for (const width of [1100, 375, 320]) {
      await page.setViewportSize({ width, height: 900 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: page overflows`);
      assert(await command.evaluate(el => el.scrollWidth <= el.clientWidth), `${width}: command overflows`);
      await copy.scrollIntoViewIfNeeded();
      if (process.env.PULSE_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.PULSE_SCREENSHOT_DIR}/admin-install-${width}.png` });
    }
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    if (process.env.PULSE_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.PULSE_SCREENSHOT_DIR}/admin-install-dark.png` });
    await page.locator('#close-linux-install-modal-btn').click();
    await command.waitFor({ state: 'hidden' });
    assert.equal(await command.inputValue(), '');
    await page.locator('.copy-linux-cmd-btn').first().click();
    assert(!(await command.inputValue()).includes('--vnstat'));
    await page.locator('#close-linux-install-modal-btn').click();
    await command.waitFor({ state: 'hidden' });
    await edit.click();
    const settings = page.locator('#edit-system-form');
    await settings.locator('label').filter({ has: page.locator('input[name="traffic_billing_mode"][value="out"]') }).click();
    await settings.locator('[name="traffic_calibration"]').fill('854.71');
    await settings.locator('[name="traffic_limit"]').fill('1');
    await settings.locator('[name="traffic_limit_unit"]').selectOption('TB');
    for (const width of [1100, 375]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => document.documentElement.classList.remove('dark'));
      await settings.locator('.traffic-settings').scrollIntoViewIfNeeded();
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (process.env.PULSE_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.PULSE_SCREENSHOT_DIR}/traffic-settings-${width}.png` });
    }
    await settings.locator('button[type="submit"]').click();
    await page.waitForFunction(() => document.querySelector('#edit-system-modal').classList.contains('hidden'));
    assert.equal(savedPayload.traffic_billing_mode, 'out');
    assert.equal(savedPayload.traffic_calibrate_bytes, 854710000000);
    assert.equal(savedPayload.traffic_limit_bytes, 1e12);
    console.log('PASS billing settings UI and calibration request');
    assert.deepEqual(errors, []);
    console.log('PASS responsive command box, modal reset, no JavaScript errors');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
