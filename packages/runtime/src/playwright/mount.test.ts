import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { auditFocusOrder } from './mount.js';

/**
 * Real browser integration. Skips automatically when a Chromium binary is not
 * installed (`pnpm exec playwright install chromium`), so the suite stays green
 * in environments without browsers.
 */
let browser: Browser | null = null;
let available = false;

beforeAll(async () => {
  try {
    browser = await chromium.launch({ headless: true });
    available = true;
  } catch {
    available = false;
  }
});

afterAll(async () => {
  await browser?.close();
});

const TRAP_HTML = `
  <div id="dlg">
    <button id="t1">A</button>
    <button id="t2">B</button>
  </div>
  <script>
    const dlg = document.getElementById('dlg');
    const f = Array.prototype.slice.call(dlg.querySelectorAll('button'));
    dlg.addEventListener('keydown', function (e) {
      if (e.key === 'Tab') {
        e.preventDefault();
        const i = f.indexOf(document.activeElement);
        const n = e.shiftKey ? (i - 1 + f.length) % f.length : (i + 1) % f.length;
        f[n].focus();
      }
    });
  </script>
`;

describe('auditFocusOrder (Playwright)', () => {
  it('reports a clean tab order for a normal component', async (ctx) => {
    if (!available || !browser) return ctx.skip();
    const report = await auditFocusOrder('<button>One</button> <a href="#">Two</a>', {
      browser,
      maxTabs: 10,
    });
    expect(report.isTrap).toBe(false);
    expect(report.reachedExit).toBe(true);
    expect(report.focusableCount).toBe(2);
  });

  it('detects a keyboard focus trap (cycle)', async (ctx) => {
    if (!available || !browser) return ctx.skip();
    const report = await auditFocusOrder(TRAP_HTML, { browser, maxTabs: 10 });
    expect(report.isTrap).toBe(true);
    expect(report.trapKind).toBe('cycle');
    expect(report.reachedExit).toBe(false);
  });

  it('treats a non-interactive component as a clean pass', async (ctx) => {
    if (!available || !browser) return ctx.skip();
    const report = await auditFocusOrder('<p>Just text</p>', { browser, maxTabs: 5 });
    expect(report.isTrap).toBe(false);
    expect(report.reachedExit).toBe(true);
    expect(report.focusableCount).toBe(0);
  });
});
