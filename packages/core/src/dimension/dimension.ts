/**
 * Dimension (spacing) parsing & comparison.
 *
 * Design tokens express spacing in a handful of units; to compare a literal in
 * source (e.g. `0.5rem`) against a token (e.g. `8px`) we normalize everything
 * to pixels using a configurable root font size.
 */

export const DEFAULT_REM_BASE_PX = 16;

export interface Dimension {
  /** The numeric part as authored. */
  readonly value: number;
  /** The unit as authored (`px`, `rem`, `em`, `pt`, or `''` for unitless 0). */
  readonly unit: string;
  /** Normalized pixel value. */
  readonly px: number;
}

const SUPPORTED_UNITS = new Set(['px', 'rem', 'em', 'pt']);

/**
 * Parse a single CSS length token. Returns `null` for anything that is not a
 * standalone, comparable length (percentages, `auto`, calc(), multi-value
 * shorthands, …). A bare `0` is accepted as `0px`.
 */
export function parseDimension(
  input: string,
  remBasePx: number = DEFAULT_REM_BASE_PX,
): Dimension | null {
  const s = input.trim().toLowerCase();
  const match = /^(-?\d*\.?\d+)(px|rem|em|pt)?$/.exec(s);
  if (!match) return null;

  const value = Number(match[1]);
  if (Number.isNaN(value)) return null;
  const unit = match[2] ?? '';

  if (unit === '') {
    // Unitless is only meaningful as a length when it is exactly zero.
    if (value !== 0) return null;
    return { value: 0, unit: '', px: 0 };
  }
  if (!SUPPORTED_UNITS.has(unit)) return null;

  let px: number;
  switch (unit) {
    case 'px':
      px = value;
      break;
    case 'rem':
    case 'em':
      px = value * remBasePx;
      break;
    case 'pt':
      px = (value * 96) / 72;
      break;
    default:
      return null;
  }
  return { value, unit, px };
}

/** True when the string is a standalone, comparable CSS length. */
export function isDimension(input: string, remBasePx?: number): boolean {
  return parseDimension(input, remBasePx) !== null;
}

/** Absolute distance between two dimensions, in pixels. */
export function dimensionDistance(a: Dimension, b: Dimension): number {
  return Math.abs(a.px - b.px);
}
