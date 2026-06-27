/**
 * Color parsing & comparison.
 *
 * We parse the CSS color forms that actually appear in design-system source
 * (hex 3/4/6/8, rgb()/rgba(), hsl()/hsla(), the standard named colors and
 * `transparent`) into a canonical sRGB representation, then compare colors with
 * the "redmean" low-cost perceptual distance. No external color dependency: the
 * surface we need is small and fully testable.
 */

export interface Rgb {
  /** 0–255 */
  readonly r: number;
  /** 0–255 */
  readonly g: number;
  /** 0–255 */
  readonly b: number;
  /** 0–1 */
  readonly a: number;
}

/** The 16 base + the most common extended CSS named colors, as hex. */
const NAMED_COLORS: Readonly<Record<string, string>> = {
  black: '#000000',
  silver: '#c0c0c0',
  gray: '#808080',
  grey: '#808080',
  white: '#ffffff',
  maroon: '#800000',
  red: '#ff0000',
  purple: '#800080',
  fuchsia: '#ff00ff',
  magenta: '#ff00ff',
  green: '#008000',
  lime: '#00ff00',
  olive: '#808000',
  yellow: '#ffff00',
  navy: '#000080',
  blue: '#0000ff',
  teal: '#008080',
  aqua: '#00ffff',
  cyan: '#00ffff',
  orange: '#ffa500',
  pink: '#ffc0cb',
  gold: '#ffd700',
  indigo: '#4b0082',
  violet: '#ee82ee',
  crimson: '#dc143c',
  coral: '#ff7f50',
  salmon: '#fa8072',
  khaki: '#f0e68c',
  tomato: '#ff6347',
  orchid: '#da70d6',
  turquoise: '#40e0d0',
  slategray: '#708090',
  slategrey: '#708090',
  lightgray: '#d3d3d3',
  lightgrey: '#d3d3d3',
  darkgray: '#a9a9a9',
  darkgrey: '#a9a9a9',
  dimgray: '#696969',
  dimgrey: '#696969',
  whitesmoke: '#f5f5f5',
  gainsboro: '#dcdcdc',
  rebeccapurple: '#663399',
};

const clamp = (n: number, min: number, max: number): number =>
  n < min ? min : n > max ? max : n;

const round = (n: number): number => Math.round(n);

function parseHex(input: string): Rgb | null {
  const hex = input.startsWith('#') ? input.slice(1) : input;
  if (!/^[0-9a-fA-F]+$/.test(hex)) return null;

  let r: number;
  let g: number;
  let b: number;
  let a = 1;

  switch (hex.length) {
    case 3:
    case 4: {
      const ch = (i: number): number => parseInt(hex[i]! + hex[i]!, 16);
      r = ch(0);
      g = ch(1);
      b = ch(2);
      if (hex.length === 4) a = ch(3) / 255;
      break;
    }
    case 6:
    case 8: {
      const ch = (i: number): number => parseInt(hex.slice(i, i + 2), 16);
      r = ch(0);
      g = ch(2);
      b = ch(4);
      if (hex.length === 8) a = ch(6) / 255;
      break;
    }
    default:
      return null;
  }
  return { r, g, b, a };
}

/** Parse a single channel which may be a 0–255 number or a percentage. */
function channel(token: string): number | null {
  const t = token.trim();
  if (t.endsWith('%')) {
    const pct = Number(t.slice(0, -1));
    if (Number.isNaN(pct)) return null;
    return clamp(round((pct / 100) * 255), 0, 255);
  }
  const n = Number(t);
  if (Number.isNaN(n)) return null;
  return clamp(round(n), 0, 255);
}

function alpha(token: string): number | null {
  const t = token.trim();
  if (t.endsWith('%')) {
    const pct = Number(t.slice(0, -1));
    return Number.isNaN(pct) ? null : clamp(pct / 100, 0, 1);
  }
  const n = Number(t);
  return Number.isNaN(n) ? null : clamp(n, 0, 1);
}

function innerArgs(input: string): string[] | null {
  const open = input.indexOf('(');
  const close = input.lastIndexOf(')');
  if (open === -1 || close === -1 || close < open) return null;
  // Support both the legacy comma syntax and the modern space syntax with a
  // slash-separated alpha: `rgb(255 0 0 / 50%)`.
  return input
    .slice(open + 1, close)
    .replace(/\//g, ' ')
    .split(/[\s,]+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function parseRgb(input: string): Rgb | null {
  const args = innerArgs(input);
  if (!args || args.length < 3) return null;
  const r = channel(args[0]!);
  const g = channel(args[1]!);
  const b = channel(args[2]!);
  if (r === null || g === null || b === null) return null;
  let a = 1;
  if (args.length >= 4) {
    const parsed = alpha(args[3]!);
    if (parsed === null) return null;
    a = parsed;
  }
  return { r, g, b, a };
}

function hueToRgb(p: number, q: number, t: number): number {
  let tt = t;
  if (tt < 0) tt += 1;
  if (tt > 1) tt -= 1;
  if (tt < 1 / 6) return p + (q - p) * 6 * tt;
  if (tt < 1 / 2) return q;
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
  return p;
}

function parseHsl(input: string): Rgb | null {
  const args = innerArgs(input);
  if (!args || args.length < 3) return null;

  const h = Number(args[0]!.replace(/deg$/, ''));
  const sToken = args[1]!;
  const lToken = args[2]!;
  if (!sToken.endsWith('%') || !lToken.endsWith('%')) return null;
  const s = Number(sToken.slice(0, -1)) / 100;
  const l = Number(lToken.slice(0, -1)) / 100;
  if (Number.isNaN(h) || Number.isNaN(s) || Number.isNaN(l)) return null;

  let a = 1;
  if (args.length >= 4) {
    const parsed = alpha(args[3]!);
    if (parsed === null) return null;
    a = parsed;
  }

  const hue = (((h % 360) + 360) % 360) / 360;
  if (s === 0) {
    const v = round(l * 255);
    return { r: v, g: v, b: v, a };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: clamp(round(hueToRgb(p, q, hue + 1 / 3) * 255), 0, 255),
    g: clamp(round(hueToRgb(p, q, hue) * 255), 0, 255),
    b: clamp(round(hueToRgb(p, q, hue - 1 / 3) * 255), 0, 255),
    a,
  };
}

/** Parse any supported CSS color string into sRGB, or `null` if unrecognized. */
export function parseColor(input: string): Rgb | null {
  const s = input.trim().toLowerCase();
  if (s.length === 0) return null;
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  const named = NAMED_COLORS[s];
  if (named !== undefined) return parseHex(named);
  if (s.startsWith('#')) return parseHex(s);
  if (s.startsWith('rgb')) return parseRgb(s);
  if (s.startsWith('hsl')) return parseHsl(s);
  return null;
}

/** True when the string is recognizable as a CSS color literal. */
export function isColor(input: string): boolean {
  return parseColor(input) !== null;
}

const hex2 = (n: number): string => clamp(round(n), 0, 255).toString(16).padStart(2, '0');

/** Canonical lowercase hex form. Includes the alpha pair only when a < 1. */
export function toHex(rgb: Rgb): string {
  const base = `#${hex2(rgb.r)}${hex2(rgb.g)}${hex2(rgb.b)}`;
  if (rgb.a >= 1) return base;
  return `${base}${hex2(rgb.a * 255)}`;
}

/**
 * "Redmean" perceptual color distance — a cheap, dependency-free approximation
 * of human color perception. Returns ~0 for identical colors; the practical
 * range for distinct colors is roughly 0–765. Alpha differences are folded in
 * so a solid and a translucent variant of the same hue do not read as equal.
 */
export function colorDistance(a: Rgb, b: Rgb): number {
  const rmean = (a.r + b.r) / 2;
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  const rgb = Math.sqrt(
    (2 + rmean / 256) * dr * dr +
      4 * dg * dg +
      (2 + (255 - rmean) / 256) * db * db,
  );
  const da = Math.abs(a.a - b.a) * 255;
  return Math.sqrt(rgb * rgb + da * da);
}
