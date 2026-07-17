/**
 * Convert a Tailwind (v3) `theme` object into a DTCG document.
 *
 * Only the value sections a drift audit can exploit are read: colors and
 * dimension-like scales. Base and `theme.extend` are merged (extend wins),
 * nested objects are flattened into flat hyphenated keys (`primary.50` →
 * `color-primary-50`, `DEFAULT` dropped) so tokens round-trip to
 * `var(--color-primary-50)` like the CSS custom-properties extraction.
 * Non-string values (functions, plugins…) are skipped with a warning.
 */

import { parseColor } from '../color/color.js';
import { parseDimension } from '../dimension/dimension.js';

export interface TailwindConversion {
  readonly document: Record<string, unknown>;
  readonly count: number;
  readonly warnings: readonly string[];
}

/** Section du thème → préfixe de clé + catégorie DTCG. */
const SECTIONS: readonly { key: string; prefix: string; type: 'color' | 'dimension' }[] = [
  { key: 'colors', prefix: 'color', type: 'color' },
  { key: 'spacing', prefix: 'spacing', type: 'dimension' },
  { key: 'borderRadius', prefix: 'radius', type: 'dimension' },
  { key: 'fontSize', prefix: 'font-size', type: 'dimension' },
  { key: 'lineHeight', prefix: 'line-height', type: 'dimension' },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeSegment(segment: string): string {
  return segment
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Aplati récursivement une section : `{primary: {50: '#…', DEFAULT: '#…'}}`. */
function flatten(
  value: unknown,
  path: readonly string[],
  out: { key: string; raw: unknown }[],
): void {
  if (isRecord(value)) {
    for (const [k, v] of Object.entries(value)) {
      flatten(v, k === 'DEFAULT' ? path : [...path, k], out);
    }
    return;
  }
  out.push({ key: path.map(normalizeSegment).filter((s) => s !== '').join('-'), raw: value });
}

export function tailwindThemeToDtcg(theme: unknown): TailwindConversion {
  const warnings: string[] = [];
  const document: Record<string, unknown> = {
    $description: 'Imported from tailwind.config theme',
  };
  let count = 0;

  if (!isRecord(theme)) {
    return { document, count: 0, warnings: ['theme is not an object'] };
  }
  const extend = isRecord(theme['extend']) ? theme['extend'] : {};

  for (const section of SECTIONS) {
    const base = theme[section.key];
    const extension = (extend as Record<string, unknown>)[section.key];
    // Fusion superficielle : les clés d'extend écrasent celles de la base.
    const merged: Record<string, unknown> = {
      ...(isRecord(base) ? base : {}),
      ...(isRecord(extension) ? extension : {}),
    };
    if (Object.keys(merged).length === 0) continue;

    const flat: { key: string; raw: unknown }[] = [];
    flatten(merged, [section.prefix], flat);

    for (const { key, raw } of flat) {
      // fontSize accepte `['1rem', {lineHeight: …}]` — la taille est en tête.
      const candidate = Array.isArray(raw) ? raw[0] : raw;
      if (typeof candidate !== 'string') {
        warnings.push(`${key}: non-string value skipped`);
        continue;
      }
      const valid =
        section.type === 'color'
          ? parseColor(candidate) !== null
          : parseDimension(candidate) !== null;
      if (!valid) {
        warnings.push(`${key}: "${candidate}" is not a ${section.type}`);
        continue;
      }
      if (document[key] === undefined) count += 1;
      document[key] = { $type: section.type, $value: candidate };
    }
  }

  return { document, count, warnings };
}
