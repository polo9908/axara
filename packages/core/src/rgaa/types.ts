/** RGAA report types produced from axe-core results. */

export type AxeImpact = 'minor' | 'moderate' | 'serious' | 'critical';

/**
 * Status of an automated check against a criterion:
 * - `failed`   : axe reported a violation (RGAA non-conforme).
 * - `cantTell` : axe could not decide (axe "incomplete") — needs manual review.
 */
export type RgaaStatus = 'failed' | 'cantTell';

export interface RgaaOccurrence {
  /** CSS selector path to the offending element. */
  readonly target: string;
  /** Outer HTML snippet of the element. */
  readonly html: string;
  /** axe's human-readable failure summary. */
  readonly failureSummary: string;
}

export interface RgaaFinding {
  readonly criterion: string;
  readonly theme: number;
  readonly themeLabel: string;
  readonly criterionTitle: string;
  readonly wcag: readonly string[];
  readonly axeRuleId: string;
  readonly impact: AxeImpact | null;
  readonly status: RgaaStatus;
  /** axe rule help text. */
  readonly description: string;
  readonly helpUrl: string;
  readonly occurrences: readonly RgaaOccurrence[];
}

export interface RgaaSummary {
  /** Distinct criteria with at least one `failed` finding. */
  readonly criteriaFailed: number;
  /** Distinct criteria flagged `cantTell` (manual review needed). */
  readonly criteriaToReview: number;
  readonly totalFindings: number;
  readonly byImpact: Readonly<Record<AxeImpact, number>>;
  readonly byTheme: Readonly<Record<number, number>>;
}

export interface RgaaReport {
  readonly summary: RgaaSummary;
  readonly findings: readonly RgaaFinding[];
  /** axe rule ids that have no RGAA mapping entry. */
  readonly unmappedRules: readonly string[];
}
