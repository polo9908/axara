/**
 * Compare Figma variables against the code's design tokens.
 *
 * Both sides are reduced to a canonical value (hex for colors, px for
 * dimensions) using the core utilities, then matched by dot path. The result
 * separates exact matches, value mismatches (design/code drift at the source of
 * truth), and tokens missing on either side.
 */

import {
  parseColor,
  parseDimension,
  toHex,
  type DesignToken,
} from '@axaraaudit/core';
import type { NormalizedFigmaToken } from './types.js';

export interface TokenMatch {
  readonly path: string;
  readonly value: string;
}

export interface TokenMismatch {
  readonly path: string;
  readonly figmaValue: string;
  readonly codeValue: string;
}

export interface FigmaComparison {
  readonly matches: readonly TokenMatch[];
  readonly mismatches: readonly TokenMismatch[];
  readonly missingInCode: readonly TokenMatch[];
  readonly missingInFigma: readonly TokenMatch[];
  readonly summary: {
    readonly matched: number;
    readonly mismatched: number;
    readonly missingInCode: number;
    readonly missingInFigma: number;
    readonly inSync: boolean;
  };
}

type Category = 'color' | 'dimension';

function canonical(category: Category, value: string): string {
  if (category === 'color') {
    const rgb = parseColor(value);
    return rgb ? toHex(rgb) : value.trim().toLowerCase();
  }
  const dim = parseDimension(value);
  return dim ? `${dim.px}px` : value.trim().toLowerCase();
}

export function compareTokens(
  figmaTokens: readonly NormalizedFigmaToken[],
  codeTokens: readonly DesignToken[],
): FigmaComparison {
  const codeByPath = new Map<string, { category: Category; value: string }>();
  for (const token of codeTokens) {
    if (token.category === 'color' || token.category === 'dimension') {
      codeByPath.set(token.path, { category: token.category, value: token.value });
    }
  }

  const matches: TokenMatch[] = [];
  const mismatches: TokenMismatch[] = [];
  const missingInCode: TokenMatch[] = [];
  const seenPaths = new Set<string>();

  for (const figma of figmaTokens) {
    seenPaths.add(figma.path);
    const code = codeByPath.get(figma.path);
    if (!code) {
      missingInCode.push({ path: figma.path, value: figma.value });
      continue;
    }
    const figmaCanonical = canonical(figma.type, figma.value);
    const codeCanonical = canonical(code.category, code.value);
    if (figmaCanonical === codeCanonical) {
      matches.push({ path: figma.path, value: figma.value });
    } else {
      mismatches.push({ path: figma.path, figmaValue: figma.value, codeValue: code.value });
    }
  }

  const missingInFigma: TokenMatch[] = [];
  for (const [path, code] of codeByPath) {
    if (!seenPaths.has(path)) missingInFigma.push({ path, value: code.value });
  }

  const summary = {
    matched: matches.length,
    mismatched: mismatches.length,
    missingInCode: missingInCode.length,
    missingInFigma: missingInFigma.length,
    inSync: mismatches.length === 0 && missingInCode.length === 0 && missingInFigma.length === 0,
  };

  return { matches, mismatches, missingInCode, missingInFigma, summary };
}
