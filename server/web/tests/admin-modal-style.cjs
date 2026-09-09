// Visual consistency checks with mock APIs only: never writes live settings.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PULSE_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.PULSE_TEST_BASE_URL || 'http://127.0.0.1:18080';
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PULSE_BROWSER_EXECUTABLE ? { executablePath: process.env.PULSE_BROWSER_EXECUTABLE } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname;
      const values = {
        '/api/metrics': [{ id: 'demo', name: 'MEGABOX PRO', os: 'Debian' }],
        '/api/auth/status': { set: true }, '/api/auth/verify': { valid: true },
        '/api/privacy/config': { enabled: false },
        '/api/navbar/config': { text: 'Pulse', show_traffic: true, show_glass: true, shared_secret: 'DEMO-NOT-A-REAL-KEY' },
        '/api/tcping/config': { interval: 60, targets: [{ name: '电信', address: 'example.com:443' }] },
        '/api/telegram/config': { config: { enabled: true, chat_id: '123456', offline_seconds: 60, excluded_ids: [], script: 'function sendEvent(event) { return true; }' }, has_token: true, default_script: '', last_error: '' }
      };
      return route.fulfill({ json: values[path] || {} });
    });
    await page.addInitScript(() => {
      localStorage.setItem('admin_auth_token', 'ui-test-only');
      localStorage.setItem('preferred-language', 'zh');
      localStorage.setItem('theme', 'light');
      window.EventSource = class extends EventTarget { close() {} };
    });
    await page.goto(`${base}/admin/`);
    const cases = [
      ['add-system-btn', 'add-system-modal', 'close-add-modal-btn'],
      ['privacy-config-btn', 'privacy-config-modal', 'close-privacy-config-modal-btn'],
      ['navbar-config-btn', 'navbar-config-modal', 'close-navbar-config-modal-btn'],
      ['change-password-btn', 'change-password-modal', 'close-change-password-modal-btn'],
      ['tcping-config-btn', 'tcping-config-modal', 'close-tcping-config-modal-btn'],
      ['telegram-settings-btn', 'telegram-settings', 'tg-close']
    ];
    for (const [trigger, id, close] of cases) {
      await page.locator(`#${trigger}`).click();
      const dialog = page.locator(`#${id}`);
      await dialog.waitFor({ state: 'visible' });
      if (id === 'telegram-settings') await page.locator('#tg-save:enabled').waitFor();
      await page.waitForTimeout(300);
      for (const width of [1100, 375, 320]) for (const dark of [false, true]) {
        await page.setViewportSize({ width, height: 1000 });
        // Include glass-enabled because legacy global styles also affect dialogs.
        await page.evaluate(dark => {
          document.documentElement.classList.toggle('dark', dark);
          document.documentElement.classList.toggle('light', !dark);
          document.documentElement.classList.add('glass-enabled');
        }, dark);
        await page.waitForTimeout(350); // Let theme color transitions finish before measuring/capturing.
        const result = await dialog.evaluate(el => {
          const panel = el.querySelector('[data-modal-content]') || el;
          const style = getComputedStyle(panel), bounds = panel.getBoundingClientRect();
          const fields = [...el.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=hidden]), select, textarea')].filter(f => f.getClientRects().length);
          const buttons = [...el.querySelectorAll('button[type=submit]')];
          const switches = [...el.querySelectorAll('input.peer:checked + div, #tg-enabled:checked')];
          return {
            radius: style.borderRadius, bg: style.backgroundColor,
            fits: panel.scrollWidth <= panel.clientWidth + 1 && bounds.left >= 0 && bounds.right <= innerWidth,
            fields: fields.map(f => ({ radius: getComputedStyle(f).borderRadius, bg: getComputedStyle(f).backgroundColor })),
            actions: buttons.map(b => ({ radius: getComputedStyle(b).borderRadius, bg: getComputedStyle(b).backgroundColor, height: b.getBoundingClientRect().height })),
            switches: switches.map(s => getComputedStyle(s).backgroundColor)
          };
        });
        assert.equal(result.radius, width <= 520 ? '24px' : '26px', id);
        assert.equal(result.bg, dark ? 'rgb(28, 28, 28)' : 'rgb(255, 255, 255)', `${id}: surface`);
        assert(result.fits, `${id}/${width}: horizontal overflow`);
        assert(result.fields.every(f => f.radius === '18px' && f.bg === (dark ? 'rgb(37, 39, 42)' : 'rgb(246, 247, 248)')), `${id}: field styles ${JSON.stringify(result.fields)}`);
        assert(result.actions.every(a => a.radius === '18px' && a.height === 44 && a.bg === 'rgb(5, 150, 105)'), `${id}: primary controls ${JSON.stringify(result.actions)}`);
        assert(result.switches.every(c => c === 'rgb(5, 150, 105)'), `${id}: switch colors ${result.switches}`);
        if (process.env.PULSE_SCREENSHOT_DIR && width !== 320) {
          await (width === 1100 ? dialog.locator('[data-modal-content]').or(page.locator(`#${id}:is(dialog)`)) : page.locator('body')).screenshot({ path: `${process.env.PULSE_SCREENSHOT_DIR}/${id}-${width}-${dark ? 'dark' : 'light'}.png` });
        }
      }
      await page.locator(`#${close}`).click();
      await dialog.waitFor({ state: 'hidden' });
      await page.setViewportSize({ width: 1100, height: 1000 });
    }
    assert.deepEqual(errors, []);
    console.log('PASS six admin dialogs: shared radii, neutral surfaces, green actions/switches, glass mode, desktop/mobile, light/dark');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
