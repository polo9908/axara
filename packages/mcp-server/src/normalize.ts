/**
 * Normalize a component snippet (React/Vue/HTML) into plain HTML suitable for
 * structural RGAA validation with axe-core.
 *
 * React/JSX uses the AST-based serializer from core. Vue templates are already
 * HTML-shaped, so we strip directives/interpolations with light text passes.
 */

import { jsxToHtml } from '@axaraaudit/core';

export type Framework = 'react' | 'vue' | 'html' | 'auto';

/** Heuristically detect the snippet's framework. */
export function detectFramework(code: string): Exclude<Framework, 'auto'> {
  const hasTemplateTag = /<template[\s>]/i.test(code);

  // React/JSX signals. Note `style={{â€¦}}` (JSX attribute expression) must not be
  // mistaken for a Vue `{{ }}` interpolation â€” hence the `=` lookbehind below.
  const reactSignals =
    /className=/.test(code) ||
    /htmlFor=/.test(code) ||
    /=>\s*[<(]/.test(code) ||
    /\breturn\s*\(/.test(code) ||
    /=\{\{?/.test(code); // JSX attribute expression: ={ or ={{
  if (reactSignals && !hasTemplateTag) return 'react';

  // Vue signals: <template>, v-directives, :prop/@event bindings, {{ }} (not ={{).
  const vueSignals =
    hasTemplateTag ||
    /\sv-[a-z]/i.test(code) ||
    /\s[:@][a-z][\w-]*=/.test(code) ||
    /(?<!=)\{\{[\s\S]*?\}\}/.test(code);
  if (vueSignals) return 'vue';

  if (/<[a-z][\s\S]*>/i.test(code)) return 'html';
  return 'html';
}

const DYNAMIC_TEXT = 'contenu dynamique';

/** Convert a Vue template/SFC snippet into structural HTML. */
export function vueToHtml(code: string): string {
  // Extract the <template> body if present (SFC), else use the whole snippet.
  const templateMatch = /<template[^>]*>([\s\S]*?)<\/template>/i.exec(code);
  let html = templateMatch?.[1] ?? code;

  // Mustache interpolations â†’ assumed-present text content.
  html = html.replace(/\{\{[\s\S]*?\}\}/g, DYNAMIC_TEXT);

  // Drop Vue directive / binding / event attributes, keep static a11y attributes.
  // Matches v-foo="...", :prop="...", @event="...", #slot, with or without value.
  html = html.replace(/\s(?:v-[a-z][\w-]*|[:@#][\w.-]+)(?:="[^"]*"|='[^']*')?/gi, '');

  return html.trim();
}

/** Normalize any supported snippet to HTML. */
export function toHtml(code: string, framework: Framework = 'auto'): { html: string; framework: Exclude<Framework, 'auto'> } {
  const resolved = framework === 'auto' ? detectFramework(code) : framework;
  switch (resolved) {
    case 'react':
      return { html: jsxToHtml(code), framework: 'react' };
    case 'vue':
      return { html: vueToHtml(code), framework: 'vue' };
    case 'html':
      return { html: code.trim(), framework: 'html' };
    default:
      return { html: code.trim(), framework: 'html' };
  }
}
