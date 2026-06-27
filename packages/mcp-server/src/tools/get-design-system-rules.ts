/**
 * Tool: `get_design_system_rules`.
 * Reads the project's DTCG tokens and returns them in a model-friendly shape,
 * including the `var(--token)` reference to use in generated code.
 */

import type { TokenCategory } from '@a11yengine/core';
import { loadTokens } from '../tokens-source.js';

export interface GetDesignSystemRulesInput {
  readonly tokensPath?: string | undefined;
}

export interface TokenRule {
  readonly path: string;
  readonly category: TokenCategory | null;
  readonly type: string;
  readonly value: string;
  readonly cssVar: string;
  /** Ready-to-use reference, e.g. `var(--color-brand-primary)`. */
  readonly reference: string;
  readonly description?: string;
}

export interface GetDesignSystemRulesResult {
  readonly tokensPath: string;
  readonly count: number;
  readonly colors: readonly TokenRule[];
  readonly dimensions: readonly TokenRule[];
  readonly other: readonly TokenRule[];
  readonly errors: readonly string[];
  readonly guidance: string;
}

export function getDesignSystemRules(
  input: GetDesignSystemRulesInput = {},
): GetDesignSystemRulesResult {
  const resolved = loadTokens(input.tokensPath !== undefined ? { tokensPath: input.tokensPath } : {});

  const colors: TokenRule[] = [];
  const dimensions: TokenRule[] = [];
  const other: TokenRule[] = [];

  for (const token of resolved.tokens) {
    const rule: TokenRule =
      token.description === undefined
        ? {
            path: token.path,
            category: token.category,
            type: token.type,
            value: token.value,
            cssVar: token.cssVar,
            reference: `var(${token.cssVar})`,
          }
        : {
            path: token.path,
            category: token.category,
            type: token.type,
            value: token.value,
            cssVar: token.cssVar,
            reference: `var(${token.cssVar})`,
            description: token.description,
          };
    if (token.category === 'color') colors.push(rule);
    else if (token.category === 'dimension') dimensions.push(rule);
    else other.push(rule);
  }

  return {
    tokensPath: resolved.path,
    count: resolved.tokens.length,
    colors,
    dimensions,
    other,
    errors: resolved.errors,
    guidance:
      'Réutilise ces tokens via leur `reference` (var(--…)). N’écris jamais une couleur ou un espacement en dur.',
  };
}
