/**
 * DTCG (Design Tokens Community Group) parser & index.
 *
 * Reads the DTCG JSON format: a tree of groups and tokens where a token is any
 * node carrying a `$value`, `$type` is inherited from the nearest ancestor that
 * declares it, and values may reference other tokens with the `{group.token}`
 * alias syntax. We flatten the tree, resolve aliases (with cycle detection) and
 * build value→token indexes used by the drift analyzer.
 */

import {
  colorDistance,
  parseColor,
  toHex,
  type Rgb,
} from '../color/color.js';
import {
  DEFAULT_REM_BASE_PX,
  dimensionDistance,
  parseDimension,
  type Dimension,
} from '../dimension/dimension.js';
import type { DesignToken, TokenCategory } from '../types.js';

export interface DtcgParseResult {
  readonly tokens: readonly DesignToken[];
  readonly index: TokenIndex;
  /** Non-fatal problems (unknown alias targets, cycles, malformed leaves). */
  readonly errors: readonly string[];
}

export interface ColorMatch {
  readonly token: DesignToken;
  readonly distance: number;
}

export interface DimensionMatch {
  readonly token: DesignToken;
  readonly distance: number;
}

interface RawLeaf {
  readonly path: string;
  readonly type: string;
  readonly rawValue: string;
  readonly description?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const ALIAS_RE = /^\{([^}]+)\}$/;

function pathToCssVar(path: string): string {
  return `--${path.replace(/\./g, '-').replace(/[^a-zA-Z0-9-]/g, '-')}`;
}

function collectLeaves(
  node: unknown,
  path: readonly string[],
  inheritedType: string | undefined,
  out: RawLeaf[],
  errors: string[],
): void {
  if (!isRecord(node)) return;

  const ownType = typeof node['$type'] === 'string' ? (node['$type'] as string) : undefined;
  const type = ownType ?? inheritedType;

  if ('$value' in node) {
    const raw = node['$value'];
    const here = path.join('.');
    if (typeof raw !== 'string') {
      // Composite tokens (shadows, typography, …) are not indexed in step 1;
      // they are kept out of the value indexes but not treated as fatal.
      return;
    }
    if (type === undefined) {
      errors.push(`Token "${here}" has no $type (and none inherited); skipped.`);
      return;
    }
    const description =
      typeof node['$description'] === 'string' ? (node['$description'] as string) : undefined;
    out.push(
      description === undefined
        ? { path: here, type, rawValue: raw }
        : { path: here, type, rawValue: raw, description },
    );
    return;
  }

  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith('$')) continue;
    collectLeaves(child, [...path, key], type, out, errors);
  }
}

function resolveAliases(
  leaves: readonly RawLeaf[],
  errors: string[],
): Map<string, string> {
  const byPath = new Map(leaves.map((l) => [l.path, l]));
  const resolved = new Map<string, string>();

  const resolve = (path: string, seen: Set<string>): string | null => {
    const cached = resolved.get(path);
    if (cached !== undefined) return cached;

    const leaf = byPath.get(path);
    if (!leaf) return null;

    const alias = ALIAS_RE.exec(leaf.rawValue);
    if (!alias) {
      resolved.set(path, leaf.rawValue);
      return leaf.rawValue;
    }
    const target = alias[1]!;
    if (seen.has(path)) {
      errors.push(`Alias cycle detected at "${path}".`);
      return null;
    }
    seen.add(path);
    const value = resolve(target, seen);
    if (value === null) {
      errors.push(`Token "${path}" references unknown token "${target}".`);
      return null;
    }
    resolved.set(path, value);
    return value;
  };

  for (const leaf of leaves) resolve(leaf.path, new Set());
  return resolved;
}

function categoryOf(type: string, value: string, remBasePx: number): TokenCategory | null {
  if (type === 'color') return parseColor(value) ? 'color' : null;
  if (type === 'dimension') return parseDimension(value, remBasePx) ? 'dimension' : null;
  // Fall back to value sniffing for untyped/odd tokens.
  if (parseColor(value)) return 'color';
  if (parseDimension(value, remBasePx)) return 'dimension';
  return null;
}

/** Value→token lookups plus nearest-neighbour search for suggestions. */
export class TokenIndex {
  private readonly colorByHex = new Map<string, DesignToken[]>();
  private readonly dimensionByPx = new Map<number, DesignToken[]>();
  private readonly colorList: Array<{ token: DesignToken; rgb: Rgb }> = [];
  private readonly dimensionList: Array<{ token: DesignToken; dim: Dimension }> = [];

  constructor(private readonly remBasePx: number = DEFAULT_REM_BASE_PX) {}

  add(token: DesignToken): void {
    if (token.category === 'color') {
      const rgb = parseColor(token.value);
      if (!rgb) return;
      const key = toHex(rgb);
      const bucket = this.colorByHex.get(key);
      if (bucket) bucket.push(token);
      else this.colorByHex.set(key, [token]);
      this.colorList.push({ token, rgb });
    } else if (token.category === 'dimension') {
      const dim = parseDimension(token.value, this.remBasePx);
      if (!dim) return;
      const bucket = this.dimensionByPx.get(dim.px);
      if (bucket) bucket.push(token);
      else this.dimensionByPx.set(dim.px, [token]);
      this.dimensionList.push({ token, dim });
    }
  }

  get colorCount(): number {
    return this.colorList.length;
  }

  get dimensionCount(): number {
    return this.dimensionList.length;
  }

  /** Exact color token whose value equals `literal`, if any. */
  exactColor(literal: string): DesignToken | null {
    const rgb = parseColor(literal);
    if (!rgb) return null;
    return this.colorByHex.get(toHex(rgb))?.[0] ?? null;
  }

  /** Closest color token to `literal` by perceptual distance, if any exist. */
  nearestColor(literal: string): ColorMatch | null {
    const rgb = parseColor(literal);
    if (!rgb || this.colorList.length === 0) return null;
    let best: { token: DesignToken; rgb: Rgb } | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const entry of this.colorList) {
      const d = colorDistance(rgb, entry.rgb);
      if (d < bestDistance) {
        bestDistance = d;
        best = entry;
      }
    }
    return best ? { token: best.token, distance: bestDistance } : null;
  }

  exactDimension(literal: string): DesignToken | null {
    const dim = parseDimension(literal, this.remBasePx);
    if (!dim) return null;
    return this.dimensionByPx.get(dim.px)?.[0] ?? null;
  }

  nearestDimension(literal: string): DimensionMatch | null {
    const dim = parseDimension(literal, this.remBasePx);
    if (!dim || this.dimensionList.length === 0) return null;
    let best: { token: DesignToken; dim: Dimension } | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const entry of this.dimensionList) {
      const d = dimensionDistance(dim, entry.dim);
      if (d < bestDistance) {
        bestDistance = d;
        best = entry;
      }
    }
    return best ? { token: best.token, distance: bestDistance } : null;
  }
}

export interface ParseDtcgOptions {
  /** Root font size for rem/em normalization. Defaults to 16. */
  readonly remBasePx?: number;
}

/** Parse a DTCG document (already `JSON.parse`d) into resolved tokens + index. */
export function parseDtcg(document: unknown, options: ParseDtcgOptions = {}): DtcgParseResult {
  const remBasePx = options.remBasePx ?? DEFAULT_REM_BASE_PX;
  const errors: string[] = [];

  if (!isRecord(document)) {
    return {
      tokens: [],
      index: new TokenIndex(remBasePx),
      errors: ['DTCG document root must be a JSON object.'],
    };
  }

  const leaves: RawLeaf[] = [];
  collectLeaves(document, [], undefined, leaves, errors);

  const resolved = resolveAliases(leaves, errors);

  const tokens: DesignToken[] = [];
  const index = new TokenIndex(remBasePx);

  for (const leaf of leaves) {
    const value = resolved.get(leaf.path);
    if (value === undefined) continue; // unresolved alias; already reported
    const category = categoryOf(leaf.type, value, remBasePx);
    const token: DesignToken =
      leaf.description === undefined
        ? {
            path: leaf.path,
            cssVar: pathToCssVar(leaf.path),
            type: leaf.type,
            category,
            value,
            originalValue: leaf.rawValue,
          }
        : {
            path: leaf.path,
            cssVar: pathToCssVar(leaf.path),
            type: leaf.type,
            category,
            value,
            originalValue: leaf.rawValue,
            description: leaf.description,
          };
    tokens.push(token);
    index.add(token);
  }

  return { tokens, index, errors };
}

/** Convenience: parse a DTCG JSON string. */
export function parseDtcgString(json: string, options?: ParseDtcgOptions): DtcgParseResult {
  let document: unknown;
  try {
    document = JSON.parse(json);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      tokens: [],
      index: new TokenIndex(options?.remBasePx ?? DEFAULT_REM_BASE_PX),
      errors: [`Invalid DTCG JSON: ${message}`],
    };
  }
  return parseDtcg(document, options);
}
