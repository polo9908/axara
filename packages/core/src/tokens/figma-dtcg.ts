/**
 * Convert normalized Figma variables into a DTCG document.
 *
 * Keys are flat and hyphenated (`color.brand.primary` → `color-brand-primary`)
 * so the resulting tokens round-trip to `var(--color-brand-primary)` in drift
 * suggestions — the same convention as the CSS custom-properties extraction.
 */

import type { NormalizedFigmaToken } from '../figma/types.js';

export interface FigmaDtcgResult {
  /** DTCG document ready for `parseDtcg` / `JSON.stringify`. */
  readonly document: Record<string, unknown>;
  readonly count: number;
  /** Non-fatal notes (duplicate keys after flattening). */
  readonly warnings: readonly string[];
}

/** `color.Brand/Primary 2` → `color-brand-primary-2` */
function flatKey(path: string): string {
  return path
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function figmaTokensToDtcg(
  tokens: readonly NormalizedFigmaToken[],
  options: { readonly mode?: string } = {},
): FigmaDtcgResult {
  const warnings: string[] = [];
  const document: Record<string, unknown> = {
    $description:
      options.mode !== undefined
        ? `Imported from Figma variables (mode: ${options.mode})`
        : 'Imported from Figma variables',
  };

  let count = 0;
  for (const token of tokens) {
    const key = flatKey(token.path);
    if (key === '') continue;
    if (document[key] !== undefined) {
      // Last one wins (deterministic: input order), but tell the caller.
      warnings.push(`duplicate token key "${key}" (from "${token.figmaName}")`);
    } else {
      count += 1;
    }
    document[key] = { $type: token.type, $value: token.value };
  }

  return { document, count, warnings };
}
