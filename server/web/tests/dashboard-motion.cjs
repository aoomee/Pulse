// Browser regression test against a running Pulse build. No server data is
// mutated: API snapshots and the event stream are simulated in each tab.
// Requires Playwright; PULSE_PLAYWRIGHT_MODULE can point to a shared install.
// Optional: PULSE_TEST_BASE_URL, PULSE_BROWSER_EXECUTABLE.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PULSE_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.PULSE_TEST_BASE_URL || 'http://127.0.0.1:18080';
const fixture = [
  { id: 'ui-1', name: 'Alpha', time: '18d', cpu: 1.1, memory: 36.6, disk: 30.2, total_net_in_bytes: 70e9 },
  { id: 'ui-2', name: 'Beta', time: '256d', cpu: .9, memory: 25, disk: 20.5 },
  { id: 'ui-3', name: 'Host-C(IPV6)', time: '50d', cpu: 2.7, memory: 12.7, disk: 4.4,
    traffic_source: 'vnstat', monthly_net_in_bytes: 430e9, monthly_net_out_bytes: 70e9, traffic_limit_bytes: 1e12 }
];

(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PULSE_BROWSER_EXECUTABLE ? { executablePath: process.env.PULSE_BROWSER_EXECUTABLE } : {})
  });
  try {
    for (const scenario of [
      { name: 'normal', firstPush: 100, authDelay: 0 },
      { name: 'data-before-auth', firstPush: 100, authDelay: 800 },
      { name: 'fallback-then-SSE', firstPush: 3000, authDelay: 0 },
      { name: 'reduced-motion', firstPush: 100, authDelay: 0, reduced: true }
    ]) {
      const page = await browser.newPage({ viewport: { width: 840, height: 900 }, reducedMotion: scenario.reduced ? 'reduce' : 'no-preference' });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      let snapshot = structuredClone(fixture);
      await page.route('**/api/privacy/config', async route => {
        await new Promise(resolve => setTimeout(resolve, scenario.authDelay));
        await route.fulfill({ json: { enabled: false } });
      });
      await page.route('**/api/tcping/config', route => route.fulfill({ json: { targets: [] } }));
      await page.route('**/api/metrics', route => route.fulfill({ json: snapshot }));
      await page.addInitScript(({ initial, delay }) => {
        localStorage.setItem('preferred-language', 'zh');
        localStorage.setItem('theme', 'light');
        window.__fadeCalls = [];
        window.__rowAnimations = [];
        window.__splitPaints = 0;
        const animate = Element.prototype.animate;
        Element.prototype.animate = function (frames, options) {
          if (this.id === 'systems-body') window.__fadeCalls.push({ frames, options });
          return animate.call(this, frames, options);
        };
        document.addEventListener('animationstart', e => {
          if (e.target.closest('.system-row')) window.__rowAnimations.push(e.animationName);
        });
        let paints = 0;
        const sample = () => {
          const header = document.querySelector('#system-table-header-row');
          const loading = document.querySelector('#loading-indicator');
          if (header?.getClientRects().length && loading?.getClientRects().length) window.__splitPaints++;
          if (++paints < 300) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
        window.EventSource = class extends EventTarget {
          constructor() {
            super();
            window.__stream = this;
            this.timer = setTimeout(() => {
              this.dispatchEvent(new MessageEvent('connected', { data: '{}' }));
              window.__pushSnapshot(initial);
              window.__firstPushSent = true;
            }, delay);
          }
          close() { clearTimeout(this.timer); }
        };
        window.__pushSnapshot = systems => window.__stream.dispatchEvent(new MessageEvent('update', {
          data: JSON.stringify({ type: 'metric_updated', systems })
        }));
      }, { initial: snapshot, delay: scenario.firstPush });
      await page.goto(base);
      await page.waitForFunction(() => document.querySelectorAll('.system-metric-row').length === 3);
      await page.waitForFunction(() => !document.querySelector('#auth-check').classList.contains('hidden'));
      await page.waitForFunction(() => window.__firstPushSent === true);
      await page.waitForTimeout(350);
      const initialFades = await page.evaluate(() => window.__fadeCalls.length);
      assert.equal(initialFades, scenario.reduced || scenario.authDelay ? 0 : 1, `${scenario.name}: unexpected initial fade`);
      if (scenario.name === 'normal') {
        const identity = page.locator('.system-metric-row[data-system-id="ui-3"] .system-identity');
        const namePosition = () => identity.evaluate(cell => {
          const name = cell.querySelector('.system-name').getBoundingClientRect();
          const bounds = cell.getBoundingClientRect();
          return { x: name.left - bounds.left, y: name.top - bounds.top, width: name.width, height: name.height };
        });
        for (const width of [840, 720, 375, 320]) {
          await page.setViewportSize({ width, height: 900 });
          const before = await namePosition();
          await identity.hover();
          const after = await namePosition();
          assert.deepEqual(after, before, 'Hover moved the server name');
          const geometry = await identity.evaluate(cell => {
            const name = cell.querySelector('.system-name').getBoundingClientRect();
            const button = cell.querySelector('.copy-btn').getBoundingClientRect();
            const bounds = cell.getBoundingClientRect();
            return { gap: button.left - name.right, fits: button.right <= bounds.right + .1 && name.left >= bounds.left - .1 };
          });
          assert(geometry.gap >= 5.9, `${width}: copy button overlaps the server name`);
          assert(geometry.fits, `${width}: name or copy button leaves the service cell`);
        }
        await page.setViewportSize({ width: 840, height: 900 });
        await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: { writeText: async text => { window.__copiedName = text; } }
        }));
        await identity.locator('.copy-btn').click();
        assert.equal(await page.evaluate(() => window.__copiedName), 'Host-C(IPV6)');
        assert(await page.locator('[data-details-id="ui-3"]').evaluate(el => el.classList.contains('hidden')), 'Copy expanded the row');
      }
      await page.evaluate(() => { window.__originalRows = [...document.querySelectorAll('.system-row')]; });

      const push = async data => {
        snapshot = structuredClone(data);
        await page.evaluate(data => window.__pushSnapshot(data), snapshot);
      };
      // Repeated snapshots and a changed metric must update in place.
      await push(snapshot);
      const updated = snapshot.map(s => ({ ...s, cpu: 42.5 }));
      updated[2].monthly_net_in_bytes = 530e9;
      await push(updated);
      await page.waitForFunction(() => [...document.querySelectorAll('.system-metric-row')].every(row => row.children[3].textContent.trim() === '42.5%'));
      assert.equal(await page.locator('[data-traffic-used]').textContent(), '600 GB');
      assert.equal(await page.locator('[data-main-traffic-percent]').count(), 0);
      assert.equal(await page.locator('[data-main-traffic-track]').getAttribute('aria-valuenow'), '60');
      assert.equal(await page.locator('[data-main-traffic-bar]').evaluate(e => e.style.width), '60%');
      assert(await page.evaluate(() => window.__originalRows.every(row => row.isConnected)), 'Metric update replaced a row');

      // Reorder, a real row addition, filter-away/restore and conditional
      // markup rebuilds must not replay entrance animations.
      await push([...snapshot].reverse());
      await page.waitForFunction(() => document.querySelector('.system-metric-row').dataset.systemId === 'ui-3');
      await push([...snapshot, { id: 'ui-4', name: 'Delta', cpu: 7 }]);
      await page.waitForFunction(() => document.querySelectorAll('.system-metric-row').length === 4);
      await page.locator('#system-filter-input').fill('no-match-xyz');
      await page.waitForFunction(() => document.querySelectorAll('.system-metric-row').length === 0);
      await page.locator('#system-filter-input').fill('');
      await page.waitForFunction(() => document.querySelectorAll('.system-metric-row').length === 4);
      await push(snapshot.map(s => ({ ...s, hide_tcping: true })));
      await page.waitForTimeout(200);
      await push([]);
      await page.waitForFunction(() => document.querySelectorAll('.system-metric-row').length === 0);
      await push(fixture);
      await page.waitForFunction(() => document.querySelectorAll('.system-metric-row').length === 3);
      await page.waitForTimeout(350);
      const state = await page.evaluate(() => ({
        fades: window.__fadeCalls,
        rowAnimations: window.__rowAnimations,
        splitPaints: window.__splitPaints,
        mainTransform: getComputedStyle(document.querySelector('main')).transform,
        columnCounts: [...document.querySelectorAll('.system-metric-row')].map(row => row.children.length)
      }));
      assert.equal(state.fades.length, initialFades, 'Entrance fade replayed');
      assert.deepEqual(state.rowAnimations, [], 'Rows replayed CSS entrance animations');
      assert.equal(state.splitPaints, 0, 'Header painted before loading placeholder was removed');
      assert.equal(state.mainTransform, 'none');
      assert(state.columnCounts.every(n => n === 7));
      assert.deepEqual(errors, []);
      console.log(`PASS ${scenario.name}: one-time reveal, atomic first paint, live seven-column updates, no replay.`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
