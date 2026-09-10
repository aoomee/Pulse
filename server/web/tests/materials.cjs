// Cross-page material and accessibility regression, with no live API writes.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PULSE_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.PULSE_TEST_BASE_URL || 'http://127.0.0.1:18080';
const systems = [{ id: 'material-demo', name: 'MEGABOX PRO', time: '37d', cpu: 12.8, memory: 39.6, disk: 26.4,
  cpu_model: 'AMD EPYC-Rome Processor @ 2.60GHz · 2 Virtual Cores', memory_info: '811 MiB / 2 GiB', swap_info: '0 B / 0 B', disk_info: '13.20 GiB / 50 GiB',
  net_in_mb_s: 1.28, net_out_mb_s: .64, traffic_source: 'vnstat', traffic_reset_day: 18,
  traffic_cycle_start: '2026-08-18', traffic_cycle_end: '2026-09-18', monthly_net_in_bytes: 430e9, monthly_net_out_bytes: 431.05e9, traffic_limit_bytes: 1e12 }];
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PULSE_BROWSER_EXECUTABLE ? { executablePath: process.env.PULSE_BROWSER_EXECUTABLE } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/api/**', r => r.fulfill({ json: {
      '/api/metrics': systems, '/api/navbar/config': { show_glass: true, show_traffic: true, text: 'Pulse' },
      '/api/privacy/config': { enabled: false }, '/api/tcping/config': { targets: [] }
    }[new URL(r.request().url()).pathname] || {} }));
    await page.addInitScript(systems => {
      localStorage.setItem('preferred-language', 'zh'); localStorage.setItem('theme', 'light');
      window.EventSource = class extends EventTarget {
        constructor() { super(); this.timer = setTimeout(() => {
          this.dispatchEvent(new MessageEvent('connected', { data: '{}' }));
          this.dispatchEvent(new MessageEvent('update', { data: JSON.stringify({ type: 'metric_updated', systems }) }));
        }, 100); }
        close() { clearTimeout(this.timer); }
      };
    }, systems);
    await page.goto(base);
    await page.waitForFunction(() => document.documentElement.dataset.pulseReady === 'true');
    for (const glass of [false, true]) for (const dark of [false, true]) for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 800 });
      await page.evaluate(({ glass, dark }) => {
        document.documentElement.classList.toggle('glass-enabled', glass);
        for (const el of [document.documentElement, document.body]) {
          el.classList.toggle('dark', dark); el.classList.toggle('light', !dark);
        }
      }, { glass, dark });
      await page.waitForTimeout(550);
      for (const selector of ['.glass-nav', '.glass-card']) {
        const style = await page.locator(selector).first().evaluate(el => ({ bg: getComputedStyle(el).backgroundColor, blur: getComputedStyle(el).backdropFilter }));
        assert.equal(style.bg, glass ? (dark ? 'rgba(24, 26, 32, 0.3)' : 'rgba(255, 255, 255, 0.24)') : (dark ? 'rgb(28, 28, 28)' : 'rgb(255, 255, 255)'), selector);
        assert.equal(style.blur.includes('blur(28px)'), glass, selector);
      }
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Page horizontal overflow');
      await page.locator('#columns-btn').click();
      const menu = page.locator('#columns-dropdown');
      await menu.waitFor({ state: 'visible' });
      assert.equal(await menu.evaluate(el => getComputedStyle(el).borderRadius), '20px');
      assert.equal(await menu.evaluate(el => getComputedStyle(el).backgroundColor), glass ? (dark ? 'rgba(24, 26, 32, 0.7)' : 'rgba(255, 255, 255, 0.64)') : (dark ? 'rgb(28, 28, 28)' : 'rgb(255, 255, 255)'));
      await page.locator('#columns-btn').click();
      if (process.env.PULSE_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.PULSE_SCREENSHOT_DIR}/home-${glass ? 'glass' : 'solid'}-${dark ? 'dark' : 'light'}-${width}.png` });
      await page.locator('.system-metric-row').click();
      const dialog = page.locator('.server-details-dialog[open]');
      await dialog.waitFor(); await page.waitForTimeout(200);
      const styles = await dialog.evaluate(el => ({ bg: getComputedStyle(el).backgroundColor, blur: getComputedStyle(el).backdropFilter, fits: el.scrollWidth <= el.clientWidth + 1 }));
      assert.equal(styles.bg, glass ? (dark ? 'rgba(24, 26, 32, 0.7)' : 'rgba(255, 255, 255, 0.64)') : (dark ? 'rgb(28, 28, 28)' : 'rgb(255, 255, 255)'));
      assert.equal(styles.blur.includes('blur(28px)'), glass); assert(styles.fits);
      if (process.env.PULSE_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.PULSE_SCREENSHOT_DIR}/details-${glass ? 'glass' : 'solid'}-${dark ? 'dark' : 'light'}-${width}.png` });
      await page.keyboard.press('Escape');
    }
    // Real browser media emulation: reduced transparency must make even
    // native dialogs opaque, rather than leaving a disabled blur on clear glass.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
    await page.locator('.system-metric-row').click();
    assert.equal(await page.locator('.server-details-dialog[open]').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(28, 28, 28)');
    assert.equal(await page.locator('.server-details-dialog[open]').evaluate(el => getComputedStyle(el).backdropFilter), 'none');
    await page.keyboard.press('Escape');
    assert.deepEqual(errors, []);
    console.log('PASS shared materials: homepage, navigation, menu, details, both themes/styles, mobile, reduced transparency');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
