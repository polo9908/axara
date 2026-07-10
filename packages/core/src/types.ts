/** Public type surface shared across the static analysis pipeline. */

export type TokenCategory = 'color' | 'dimension';

/** A single resolved design token (one DTCG leaf). */
export interface DesignToken {
  /** Dot path of the token, e.g. `color.brand.primary`. */
  readonly path: string;
  /** Kebab CSS custom-property name, e.g. `--color-brand-primary`. */
  readonly cssVar: string;
  /** DTCG `$type` (may be inherited from an ancestor group). */
  readonly type: string;
  /** Category we were able to index this token under, if any. */
  readonly category: TokenCategory | null;
  /** The fully alias-resolved value, e.g. `#3b82f6` or `8px`. */
  readonly value: string;
  /** The value exactly as authored (may be an alias like `{color.brand}`). */
  readonly originalValue: string;
  /** Optional DTCG `$description`. */
  readonly description?: string;
}

export type DriftSeverity = 'error' | 'warning';

/**
 * How the offending literal relates to the token set:
 * - `exact-token`  : the literal equals a token value → a safe auto-fix exists.
 * - `nearest-token`: no exact match, but a close token is suggested.
 * - `no-token`     : no token of this category exists to compare against.
 */
export type DriftMatchKind = 'exact-token' | 'nearest-token' | 'no-token';

export interface DriftSuggestion {
  /** Suggested token path. */
  readonly token: string;
  /** Suggested token CSS variable name. */
  readonly cssVar: string;
  /** The token's resolved value. */
  readonly tokenValue: string;
  /** Ready-to-apply replacement, e.g. `var(--color-brand-primary)`. */
  readonly replacement: string;
  /** Distance between the literal and the token (0 = identical). */
  readonly distance: number;
  /** Confidence in the suggestion, 0–1. */
  readonly confidence: number;
}

export interface DriftIssue {
  readonly file: string;
  /** 1-based line. */
  readonly line: number;
  /** 1-based column. */
  readonly column: number;
  readonly category: TokenCategory;
  /** CSS property (kebab-case) the literal was found on, or `literal`. */
  readonly property: string;
  /** The offending literal as found in source. */
  readonly value: string;
  readonly severity: DriftSeverity;
  readonly match: DriftMatchKind;
  readonly message: string;
  /** Whether a safe, automatic fix is available. */
  readonly autoFixable: boolean;
  readonly suggestion?: DriftSuggestion;
  /**
   * Texte réellement présent dans le source quand il diffère de `value`
   * normalisée — ex. un `16` numérique JSX rapporté comme `16px`. C'est lui
   * que la passe de fix vérifie et remplace. / The literal exactly as written
   * in source when it differs from the normalized `value` — e.g. a JSX bare
   * numeric `16` reported as `16px`. This is what the fix pass verifies and
   * replaces.
   */
  readonly sourceText?: string;
  /**
   * Remplacement exact à écrire à la position quand `suggestion.replacement`
   * ne peut pas être inséré tel quel — ex. `'var(--x)'` quoté pour un
   * numérique JSX. / Exact text to write at the position when
   * `suggestion.replacement` cannot be inserted verbatim — e.g. a quoted
   * `'var(--x)'` for a JSX bare numeric.
   */
  readonly fixText?: string;
}
