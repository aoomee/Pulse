// Login appearance and authentication smoke checks against mock APIs only.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PULSE_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.PULSE_TEST_BASE_URL || 'http://127.0.0.1:18080';
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PULSE_BROWSER_EXECUTABLE ? { executablePath: process.env.PULSE_BROWSER_EXECUTABLE } : {}) });
  try {
    const page = await browser.newPage();
    const errors = [];
    let configured = true, accepted = false, loginCalls = 0, glass = true;
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/auth/login') loginCalls++;
      return route.fulfill({ json: {
        '/api/auth/status': { set: configured },
        '/api/navbar/config': { show_glass: glass },
        '/api/privacy/config': { enabled: false },
        '/api/auth/login': { success: accepted, token: accepted ? 'mock-login-token' : '' },
        '/api/auth/setup': { success: true }
      }[path] || {} });
    });
    await page.route(url => url.pathname === '/login-test-destination', route => route.fulfill({ contentType: 'text/html', body: '<p>Mock destination</p>' }));
    await page.addInitScript(() => {
      localStorage.setItem('preferred-language', 'zh');
      localStorage.setItem('preferred-theme', 'light');
    });
    await page.goto(`${base}/login/?redirect=/login-test-destination`);
    await page.locator('#confirm-password-field.hidden').waitFor({ state: 'attached' });
    for (const enabled of [false, true]) {
    glass = enabled;
    await page.reload();
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('glass-enabled')), glass);
    for (const width of [1100, 840, 375, 320]) for (const dark of [false, true]) {
      await page.setViewportSize({ width, height: width === 840 ? 620 : 800 });
      await page.evaluate(dark => {
        for (const el of [document.documentElement, document.body]) {
          el.classList.toggle('dark', dark);
          el.classList.toggle('light', !dark);
        }
      }, dark);
      await page.waitForTimeout(350);
      const styles = await page.evaluate(() => {
        const card = document.querySelector('#login-card'), field = document.querySelector('#password'), button = document.querySelector('#login-submit');
        return {
          radius: getComputedStyle(card).borderRadius,
          cardBg: getComputedStyle(card).backgroundColor,
          blur: getComputedStyle(card).backdropFilter,
          fieldRadius: getComputedStyle(field).borderRadius,
          fieldBg: getComputedStyle(field).backgroundColor,
          buttonRadius: getComputedStyle(button).borderRadius,
          buttonBg: getComputedStyle(button).backgroundImage,
          buttonInk: getComputedStyle(button).color,
          height: button.getBoundingClientRect().height,
          fits: document.documentElement.scrollWidth <= innerWidth,
          placeholders: [...document.querySelectorAll('input')].map(el => el.placeholder)
        };
      });
      assert.equal(styles.radius, width <= 520 ? '24px' : '26px');
      assert.equal(styles.fieldRadius, '18px');
      assert.equal(styles.cardBg, glass ? (dark ? 'rgba(24, 26, 32, 0.3)' : 'rgba(255, 255, 255, 0.24)') : (dark ? 'rgb(28, 28, 28)' : 'rgb(255, 255, 255)'));
      assert.equal(styles.fieldBg, glass ? (dark ? 'rgba(255, 255, 255, 0.07)' : 'rgba(255, 255, 255, 0.18)') : (dark ? 'rgb(37, 39, 42)' : 'rgb(246, 247, 248)'));
      assert.equal(styles.blur.includes('blur(28px)'), glass);
      assert.equal(styles.buttonRadius, '18px');
      assert(styles.buttonBg.startsWith('linear-gradient('));
      assert.equal(styles.buttonInk, glass && dark ? 'rgb(245, 245, 245)' : 'rgb(48, 54, 64)');
      assert.equal(styles.height, 44);
      assert(styles.fits);
      assert(styles.placeholders.every(value => value === ''));
      if (process.env.PULSE_SCREENSHOT_DIR && width !== 320) await page.screenshot({ path: `${process.env.PULSE_SCREENSHOT_DIR}/login-${glass ? 'glass' : 'solid'}-${width}-${dark ? 'dark' : 'light'}.png` });
    }
    }
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
    assert.equal(await page.locator('#login-card').evaluate(el => getComputedStyle(el).backdropFilter), 'none');
    assert.equal(await page.locator('#login-card').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(28, 28, 28)');
    await cdp.send('Emulation.setEmulatedMedia', { features: [] });
    await page.locator('#password').fill('mock-password');
    await page.locator('#login-submit').click();
    await page.locator('#login-error:not(.hidden)').waitFor();
    assert.equal(await page.locator('#login-submit').isEnabled(), true);
    accepted = true;
    await page.locator('#login-submit').click();
    await page.waitForURL(url => url.pathname === '/login-test-destination');
    assert.equal(await page.evaluate(() => localStorage.getItem('admin_auth_token')), 'mock-login-token');
    assert.equal(loginCalls, 2);
    configured = false;
    await page.goto(`${base}/login/`);
    await page.locator('#confirm-password').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#confirm-password').getAttribute('placeholder'), null);
    await page.locator('#password').fill('mock-password');
    await page.locator('#confirm-password').fill('different-password');
    await page.locator('#login-submit').click();
    await page.locator('#login-error:not(.hidden)').waitFor();
    assert.equal(await page.locator('#login-submit').isEnabled(), true);
    assert.equal(loginCalls, 2);
    assert.deepEqual(errors, []);
    console.log('PASS login: shared styles, mobile, light/dark, empty hints, failure/retry, redirect, setup validation');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
