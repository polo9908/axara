/**
 * Headless focus-order audit.
 *
 * Mounts a component fragment in isolation between two sentinel buttons, focuses
 * the leading sentinel, then presses Tab up to `maxTabs` times, snapshotting
 * `document.activeElement` at each step. The sequence is handed to the pure
 * {@link analyzeFocusOrder} to detect keyboard traps (stuck / cycle) — reaching
 * the trailing sentinel proves focus can escape the component.
 */

import { chromium, type Browser } from 'playwright';
import { analyzeFocusOrder } from '../focus/trap.js';
import type { FocusOrderReport, FocusSnapshot } from '../focus/types.js';

const ENTER_ID = '__a11y_enter__';
const EXIT_ID = '__a11y_exit__';

export interface MountOptions {
  /** Maximum number of Tab presses. Default: 25. */
  readonly maxTabs?: number;
  /** Reuse an existing browser instead of launching one. */
  readonly browser?: Browser;
  /** Extra `<head>` markup (e.g. a stylesheet) for realistic focusability. */
  readonly head?: string;
}

export interface FocusAudit extends FocusOrderReport {
  readonly snapshots: readonly FocusSnapshot[];
}

function harness(componentHtml: string, head: string): string {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>a11yengine</title>${head}</head><body><button id="${ENTER_ID}">enter</button><div id="__a11y_root__">${componentHtml}</div><button id="${EXIT_ID}">exit</button></body></html>`;
}

/** Audit the keyboard focus order / trap behavior of a component fragment. */
export async function auditFocusOrder(
  componentHtml: string,
  options: MountOptions = {},
): Promise<FocusAudit> {
  const maxTabs = options.maxTabs ?? 25;
  const browser = options.browser ?? (await chromium.launch({ headless: true }));
  const ownsBrowser = options.browser === undefined;

  try {
    const page = await browser.newPage();
    await page.setContent(harness(componentHtml, options.head ?? ''), { waitUntil: 'load' });
    await page.focus(`#${ENTER_ID}`);

    const snapshots: FocusSnapshot[] = [];
    for (let i = 0; i < maxTabs; i += 1) {
      await page.keyboard.press('Tab');
      const described = await page.evaluate((exitId: string) => {
        const el = document.activeElement;
        if (!el) return null;
        const tag = el.tagName.toLowerCase();
        const id = el.id.length > 0 ? el.id : null;
        const role = el.getAttribute('role');
        const ariaLabel = el.getAttribute('aria-label');
        const text = (el.textContent ?? '').trim().slice(0, 40);
        const name = ariaLabel ?? (text.length > 0 ? text : null);
        let selector = tag;
        if (id) selector += `#${id}`;
        else if (role) selector += `[role=${role}]`;
        else if (name) selector += `:"${name}"`;
        return { tag, id, role, name, selector, isExit: id === exitId };
      }, EXIT_ID);

      if (!described) break;
      const snapshot: FocusSnapshot = {
        index: i,
        tag: described.tag,
        id: described.id,
        role: described.role,
        name: described.name,
        selector: described.selector,
        isExit: described.isExit,
      };
      snapshots.push(snapshot);
      if (snapshot.isExit) break;
    }

    const report = analyzeFocusOrder(snapshots, { exitId: EXIT_ID });
    return { ...report, snapshots };
  } finally {
    if (ownsBrowser) await browser.close();
  }
}

export { ENTER_ID, EXIT_ID };
