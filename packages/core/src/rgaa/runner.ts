/**
 * Run axe-core against an HTML string and produce a RGAA report.
 *
 * axe-core is designed to execute inside the page under test. We reproduce that
 * contract headlessly by building a JSDOM realm, injecting the axe-core source
 * (`axe.source`) into it, and invoking `axe.run` from within — the same
 * technique `@axe-core/playwright` uses, but against JSDOM instead of a browser.
 *
 * Note: layout-dependent rules (notably `color-contrast`) cannot be fully
 * evaluated without real rendering, so JSDOM returns them as "incomplete"
 * (mapped to `cantTell`). The live, fully accurate contrast pass runs in
 * `@a11yengine/runtime` (Playwright) at step 4; the mapping/export here is shared
 * by both paths.
 */

import axe, { type AxeResults, type RunOptions } from 'axe-core';
import { JSDOM, VirtualConsole } from 'jsdom';
import { mapAxeResults, type MapOptions } from './map.js';
import type { RgaaReport } from './types.js';

/** Default WCAG tag scope aligned with RGAA (A + AA, WCAG 2.0/2.1). */
export const DEFAULT_AXE_TAGS: readonly string[] = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'best-practice',
];

interface AxeWindow {
  readonly eval: (code: string) => unknown;
  readonly document: Document;
  readonly close: () => void;
  readonly axe: { run: (context: Document, options: RunOptions) => Promise<AxeResults> };
}

export interface RunAxeOptions {
  /** Restrict to these axe tags. Defaults to {@link DEFAULT_AXE_TAGS}. */
  readonly tags?: readonly string[];
  /** Base URL for the JSDOM document. */
  readonly url?: string;
  /**
   * Evaluate contrast rules. Defaults to `false`: JSDOM has no real layout, so
   * `color-contrast` cannot be computed and only produces noise. The accurate
   * contrast pass belongs to the Playwright runtime (step 4).
   */
  readonly contrast?: boolean;
}

/** Contrast rules that require real rendering and are disabled under JSDOM. */
const CONTRAST_RULES = ['color-contrast', 'color-contrast-enhanced'] as const;

function wrapDocument(html: string): string {
  // If the snippet is already a full document, use it as-is; otherwise wrap it
  // so structural rules (lang, title, …) have a realistic context.
  if (/<html[\s>]/i.test(html)) return html;
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>A11yEngine</title></head><body>${html}</body></html>`;
}

/** Execute axe-core on an HTML string inside JSDOM and return raw axe results. */
export async function runAxeOnHtml(
  html: string,
  options: RunAxeOptions = {},
): Promise<AxeResults> {
  // JSDOM emits "Not implemented" errors for layout APIs axe probes (e.g.
  // getComputedStyle on pseudo-elements). They are expected and non-fatal, so we
  // route them to a silent virtual console instead of polluting stderr.
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', () => {
    /* swallowed: expected JSDOM layout limitations */
  });

  const dom = new JSDOM(wrapDocument(html), {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: options.url ?? 'https://a11yengine.local/',
    virtualConsole,
  });

  const win = dom.window as unknown as AxeWindow;
  try {
    // Inject the axe-core library into the JSDOM realm and run it there.
    win.eval(axe.source);
    const runOptions: RunOptions = {
      runOnly: { type: 'tag', values: [...(options.tags ?? DEFAULT_AXE_TAGS)] },
      resultTypes: ['violations', 'incomplete'],
    };
    if (options.contrast !== true) {
      runOptions.rules = Object.fromEntries(
        CONTRAST_RULES.map((id) => [id, { enabled: false }]),
      );
    }
    return await win.axe.run(win.document, runOptions);
  } finally {
    win.close();
  }
}

export interface AuditHtmlOptions extends RunAxeOptions, MapOptions {}

/** Run axe-core on HTML and return a RGAA-structured report. */
export async function auditHtmlRgaa(
  html: string,
  options: AuditHtmlOptions = {},
): Promise<RgaaReport> {
  const runOptions: RunAxeOptions = {
    ...(options.tags !== undefined ? { tags: options.tags } : {}),
    ...(options.url !== undefined ? { url: options.url } : {}),
    ...(options.contrast !== undefined ? { contrast: options.contrast } : {}),
  };
  const results = await runAxeOnHtml(html, runOptions);

  const mapOptions: MapOptions =
    options.includeIncomplete !== undefined
      ? { includeIncomplete: options.includeIncomplete }
      : {};
  return mapAxeResults(results, mapOptions);
}
