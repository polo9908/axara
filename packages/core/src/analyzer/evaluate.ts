/**
 * Turns a raw literal occurrence found in source into a {@link DriftIssue}.
 *
 * The static analyzers (CSS, TSX) are responsible for *locating* literals; this
 * module owns the *judgement*: is this literal an exact token, a near miss, or
 * unrelated to the design system — and what is the suggested remediation.
 */

import type { TokenIndex } from '../tokens/dtcg.js';
import type { DriftIssue, DriftSuggestion } from '../types.js';

/** Distance below which a non-exact color is still confidently suggested. */
const COLOR_NEAR_THRESHOLD = 40;
/** Distance (px) below which a non-exact dimension is confidently suggested. */
const DIMENSION_NEAR_THRESHOLD = 4;

export interface LiteralOccurrence {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly property: string;
  readonly value: string;
  /** Texte source quand il diffère de `value` (ex. `16` JSX pour `16px`). */
  readonly sourceText?: string;
  /** Entourer le remplacement de quotes (contexte JSX numérique). */
  readonly quoteFix?: boolean;
  /**
   * Contexte sans sémantique CSS garantie (chaîne JS/JSX quelconque) : l'issue
   * est rapportée mais jamais auto-fixée — `var(--x)` n'a de sens qu'en CSS.
   */
  readonly noAutoFix?: boolean;
}

/** Champs de fix propagés de l'occurrence vers l'issue. */
function fixCarriers(
  occurrence: LiteralOccurrence,
  replacement: string,
): Pick<DriftIssue, 'sourceText' | 'fixText'> {
  return {
    ...(occurrence.sourceText !== undefined ? { sourceText: occurrence.sourceText } : {}),
    ...(occurrence.quoteFix === true ? { fixText: `'${replacement}'` } : {}),
  };
}

function colorConfidence(distance: number): number {
  if (distance <= 0) return 1;
  // Smoothly decays to 0 around ~150 redmean units.
  return Math.max(0, Math.min(1, 1 - distance / 150));
}

function dimensionConfidence(distance: number): number {
  if (distance <= 0) return 1;
  return Math.max(0, Math.min(1, 1 - distance / 16));
}

/** Evaluate a color literal; returns `null` when the value isn't a real color. */
export function evaluateColor(
  occurrence: LiteralOccurrence,
  index: TokenIndex,
): DriftIssue | null {
  const { value } = occurrence;
  const exact = index.exactColor(value);
  if (exact) {
    const suggestion: DriftSuggestion = {
      token: exact.path,
      cssVar: exact.cssVar,
      tokenValue: exact.value,
      replacement: `var(${exact.cssVar})`,
      distance: 0,
      confidence: 1,
    };
    return {
      file: occurrence.file,
      line: occurrence.line,
      column: occurrence.column,
      category: 'color',
      property: occurrence.property,
      value,
      severity: 'warning',
      match: 'exact-token',
      message: `Hard-coded color "${value}" matches token ${exact.path}. Use ${suggestion.replacement}.`,
      autoFixable: occurrence.noAutoFix !== true,
      suggestion,
    };
  }

  const nearest = index.nearestColor(value);
  if (!nearest) {
    if (index.colorCount === 0) return null; // no color tokens to compare against
    return {
      file: occurrence.file,
      line: occurrence.line,
      column: occurrence.column,
      category: 'color',
      property: occurrence.property,
      value,
      severity: 'error',
      match: 'no-token',
      message: `Hard-coded color "${value}" has no matching design token.`,
      autoFixable: false,
    };
  }

  const suggestion: DriftSuggestion = {
    token: nearest.token.path,
    cssVar: nearest.token.cssVar,
    tokenValue: nearest.token.value,
    replacement: `var(${nearest.token.cssVar})`,
    distance: Number(nearest.distance.toFixed(2)),
    confidence: Number(colorConfidence(nearest.distance).toFixed(2)),
  };
  const near = nearest.distance <= COLOR_NEAR_THRESHOLD;
  return {
    file: occurrence.file,
    line: occurrence.line,
    column: occurrence.column,
    category: 'color',
    property: occurrence.property,
    value,
    severity: 'error',
    match: near ? 'nearest-token' : 'no-token',
    message: near
      ? `Hard-coded color "${value}" is not a token; closest is ${nearest.token.path} (${nearest.token.value}).`
      : `Hard-coded color "${value}" has no close design token (nearest: ${nearest.token.path}).`,
    autoFixable: false,
    suggestion,
  };
}

/** Evaluate a dimension literal; returns `null` when not a comparable length. */
export function evaluateDimension(
  occurrence: LiteralOccurrence,
  index: TokenIndex,
): DriftIssue | null {
  const { value } = occurrence;
  const exact = index.exactDimension(value);
  if (exact) {
    const suggestion: DriftSuggestion = {
      token: exact.path,
      cssVar: exact.cssVar,
      tokenValue: exact.value,
      replacement: `var(${exact.cssVar})`,
      distance: 0,
      confidence: 1,
    };
    return {
      file: occurrence.file,
      line: occurrence.line,
      column: occurrence.column,
      category: 'dimension',
      property: occurrence.property,
      value,
      severity: 'warning',
      match: 'exact-token',
      message: `Hard-coded spacing "${value}" matches token ${exact.path}. Use ${suggestion.replacement}.`,
      autoFixable: true,
      suggestion,
      ...fixCarriers(occurrence, suggestion.replacement),
    };
  }

  const nearest = index.nearestDimension(value);
  if (!nearest) {
    if (index.dimensionCount === 0) return null;
    return {
      file: occurrence.file,
      line: occurrence.line,
      column: occurrence.column,
      category: 'dimension',
      property: occurrence.property,
      value,
      severity: 'error',
      match: 'no-token',
      message: `Hard-coded spacing "${value}" has no matching design token.`,
      autoFixable: false,
    };
  }

  const suggestion: DriftSuggestion = {
    token: nearest.token.path,
    cssVar: nearest.token.cssVar,
    tokenValue: nearest.token.value,
    replacement: `var(${nearest.token.cssVar})`,
    distance: Number(nearest.distance.toFixed(2)),
    confidence: Number(dimensionConfidence(nearest.distance).toFixed(2)),
  };
  const near = nearest.distance <= DIMENSION_NEAR_THRESHOLD;
  return {
    file: occurrence.file,
    line: occurrence.line,
    column: occurrence.column,
    category: 'dimension',
    property: occurrence.property,
    value,
    severity: 'error',
    match: near ? 'nearest-token' : 'no-token',
    message: near
      ? `Hard-coded spacing "${value}" is not a token; closest is ${nearest.token.path} (${nearest.token.value}).`
      : `Hard-coded spacing "${value}" has no close design token (nearest: ${nearest.token.path}).`,
    autoFixable: false,
    suggestion,
    ...fixCarriers(occurrence, suggestion.replacement),
  };
}
