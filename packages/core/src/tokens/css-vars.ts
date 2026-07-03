/**
 * Zero-config token extraction.
 *
 * Most real projects already declare their design system as CSS custom
 * properties (`:root { --color-primary: #1A3C6E; }`) without a DTCG file.
 * This module lifts those declarations into a DTCG document so the whole
 * pipeline (index, drift analysis, auto-fix) works with no configuration.
 *
 * Rules:
 * - only values that parse as a color or a dimension become tokens;
 * - `var(--other)` values are resolved as aliases (cycle-safe);
 * - the FIRST declaration of a name wins (later theme overrides are ignored);
 * - token paths mirror the var name, so `--color-primary` round-trips to
 *   `var(--color-primary)` in suggestions.
 */

import postcss from 'postcss';
import { parseColor } from '../color/color.js';
import { DEFAULT_REM_BASE_PX, parseDimension } from '../dimension/dimension.js';

export interface CssSource {
  readonly path: string;
  readonly content: string;
}

export interface CssVarExtraction {
  /** DTCG document ready for `parseDtcg` / `JSON.stringify`. */
  readonly document: Record<string, unknown>;
  /** Number of usable (color/dimension) tokens found. */
  readonly count: number;
  /** Files that contributed at least one token. */
  readonly sourceFiles: readonly string[];
  /** Non-fatal notes (unparseable files, unresolved aliases). */
  readonly warnings: readonly string[];
}

const VAR_ALIAS_RE = /^var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,[^)]*)?\)$/;

interface RawVar {
  readonly value: string;
  readonly file: string;
}

export interface ExtractCssVarOptions {
  readonly remBasePx?: number;
}

/** Extract design tokens from CSS custom properties across source files. */
export function extractCssVarTokens(
  sources: readonly CssSource[],
  options: ExtractCssVarOptions = {},
): CssVarExtraction {
  const remBasePx = options.remBasePx ?? DEFAULT_REM_BASE_PX;
  const warnings: string[] = [];
  const raw = new Map<string, RawVar>();

  for (const source of sources) {
    let root;
    try {
      root = postcss.parse(source.content, { from: source.path });
    } catch {
      warnings.push(`Fichier CSS non analysable : ${source.path}`);
      continue;
    }
    root.walkDecls((decl) => {
      if (!decl.prop.startsWith('--')) return;
      const name = decl.prop;
      if (raw.has(name)) return; // first declaration wins
      const value = decl.value.replace(/\s*!important\s*$/i, '').trim();
      if (value === '') return;
      raw.set(name, { value, file: source.path });
    });
  }

  // Resolve var() aliases against the collected set (cycle-safe).
  const resolved = new Map<string, RawVar>();
  const resolve = (name: string, seen: Set<string>): RawVar | null => {
    const cached = resolved.get(name);
    if (cached !== undefined) return cached;
    const entry = raw.get(name);
    if (entry === undefined) return null;
    const alias = VAR_ALIAS_RE.exec(entry.value);
    if (!alias) {
      resolved.set(name, entry);
      return entry;
    }
    if (seen.has(name)) {
      warnings.push(`Cycle d'alias détecté sur ${name}.`);
      return null;
    }
    seen.add(name);
    const target = resolve(alias[1]!, seen);
    if (target === null) {
      warnings.push(`${name} référence une variable inconnue (${alias[1]!}).`);
      return null;
    }
    const flattened: RawVar = { value: target.value, file: entry.file };
    resolved.set(name, flattened);
    return flattened;
  };
  for (const name of raw.keys()) resolve(name, new Set());

  // Keep only color/dimension values and emit a flat DTCG document.
  const document: Record<string, unknown> = {
    $description: 'Design tokens extraits automatiquement des custom properties CSS',
  };
  const contributors = new Set<string>();
  let count = 0;
  for (const [name, entry] of resolved) {
    let type: 'color' | 'dimension';
    if (parseColor(entry.value)) type = 'color';
    else if (parseDimension(entry.value, remBasePx)) type = 'dimension';
    else continue; // fonts, shadows, ratios… not comparable token categories

    // `--color-primary` → path `color-primary` → cssVar `--color-primary`.
    document[name.slice(2)] = { $type: type, $value: entry.value };
    contributors.add(entry.file);
    count += 1;
  }

  return { document, count, sourceFiles: [...contributors].sort(), warnings };
}
