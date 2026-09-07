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
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname;
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
        const name = document.querySelector('.system-name').getBoundingClientRect();
        return Math.abs(icon.y + icon.height / 2 - name.y - name.height / 2);
      });
      assert(delta < 1, `New host name is not centered with edit icon: ${delta}px`);
    };
    await assertAligned();
    await page.evaluate(data => window.__push(data), [{ ...fixture[0], os: 'Debian', virtualization_type: 'KVM' }]);
    await page.locator('.system-secondary-info[data-empty="false"]').waitFor({ state: 'visible' });
    await page.evaluate(data => window.__push(data), fixture);
    await page.locator('.system-secondary-info').waitFor({ state: 'hidden' });
    await assertAligned();
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
    assert.deepEqual(errors, []);
    console.log('PASS responsive command box, modal reset, no JavaScript errors');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
