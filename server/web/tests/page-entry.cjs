// First-paint regression: no unstyled dashboard between loader and final page.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PULSE_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.PULSE_TEST_BASE_URL || 'http://127.0.0.1:18080';
(async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.PULSE_BROWSER_EXECUTABLE ? { executablePath: process.env.PULSE_BROWSER_EXECUTABLE } : {}) });
  try {
    for (const scenario of ['normal', 'slow-theme', 'broken-theme', 'slow-data', 'reduced-motion']) {
      const page = await browser.newPage({ viewport: { width: 1100, height: 780 }, reducedMotion: scenario === 'reduced-motion' ? 'reduce' : 'no-preference' });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      let configRequests = 0;
      await page.route('**/api/navbar/config', route => {
        configRequests++;
        return route.fulfill({ json: { text: 'Status', show_traffic: true, custom_js: '<script src="/test-theme.js"></script>' } });
      });
      await page.route('**/test-theme.js', async route => {
        if (scenario === 'slow-theme') await new Promise(resolve => setTimeout(resolve, 900));
        if (scenario === 'broken-theme') return route.abort();
        return route.fulfill({ contentType: 'text/javascript', body: `
          const apply = () => {
            const style = document.createElement('style');
            style.textContent = '#monitor-root { --test-theme-ready: 1; }';
            document.head.appendChild(style);
            window.__themeApplied = true;
          };
          if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply, {once:true}); else apply();
        ` });
      });
      await page.route('**/api/**', route => {
        // Earlier, specific routes must win for navbar config.
        if (new URL(route.request().url()).pathname === '/api/navbar/config') return route.fallback();
        const path = new URL(route.request().url()).pathname;
        return route.fulfill({ json: path.includes('tcping') ? { targets: [] } : path.includes('privacy') ? { enabled: false } : [{ id: 'vm', name: 'VMRACK', cpu: 4, memory: 20, disk: 6 }] });
      });
      await page.addInitScript(({ delay, expectTheme }) => {
        localStorage.setItem('preferred-language', 'zh');
        localStorage.setItem('preferred-theme', 'light');
        window.__badFrames = 0;
        window.__entryAnimations = [];
        document.addEventListener('animationstart', e => {
          if (e.target.closest('#auth-check')) window.__entryAnimations.push(e.animationName);
        });
        const sample = () => {
          const content = document.getElementById('auth-check');
          if (content && getComputedStyle(content).visibility !== 'hidden' && getComputedStyle(content).display !== 'none') {
            const overlay = document.getElementById('login-redirect');
            const exposed = getComputedStyle(overlay).display === 'none' || Number(getComputedStyle(overlay).opacity) < 1;
            if (exposed && expectTheme && !window.__themeApplied) window.__badFrames++;
          }
          window.__sample = requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
        window.EventSource = class extends EventTarget {
          constructor() {
            super();
            this.timer = setTimeout(() => this.dispatchEvent(new MessageEvent('update', { data: JSON.stringify({ type: 'metric_updated', systems: [{ id: 'vm', name: 'VMRACK', cpu: 4, memory: 20, disk: 6 }] }) })), delay);
          }
          close() { clearTimeout(this.timer); }
        };
      }, { delay: scenario === 'slow-data' ? 1400 : 100, expectTheme: scenario !== 'broken-theme' });
      await page.goto(base, { waitUntil: 'domcontentloaded' });
      if (process.env.PULSE_SCREENSHOT_DIR && scenario === 'slow-data') {
        await page.waitForTimeout(450);
        await page.screenshot({ path: `${process.env.PULSE_SCREENSHOT_DIR}/page-entry-waiting.png` });
      }
      await page.waitForFunction(() => document.documentElement.dataset.pulseReady === 'true');
      await page.waitForTimeout(250);
      assert.equal(await page.locator('#navbar-text').textContent(), 'Status');
      assert.equal(await page.evaluate(() => window.__badFrames), 0, 'Default dashboard flashed before custom theme');
      assert.deepEqual(await page.evaluate(() => window.__entryAnimations), [], 'Nested slide/stagger animations played');
      assert.equal(configRequests, 1, 'Duplicate configuration fetch');
      assert.equal(await page.locator('#login-redirect').isVisible(), false);
      assert.deepEqual(errors, []);
      if (process.env.PULSE_SCREENSHOT_DIR && scenario === 'normal') await page.screenshot({ path: `${process.env.PULSE_SCREENSHOT_DIR}/page-entry-settled.png` });
      // Refresh uses the same single reveal and never flashes fallback branding.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.documentElement.dataset.pulseReady === 'true');
      assert.equal(await page.evaluate(() => window.__badFrames), 0);
      assert.equal(configRequests, 2);
      console.log(`PASS entry ${scenario}: single reveal, no unstyled frames, refresh stable`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
