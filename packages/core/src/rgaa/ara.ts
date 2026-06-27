/**
 * Export a {@link RgaaReport} to a DINUM/Ara-compatible declaration shape.
 *
 * Ara (https://ara.numerique.gouv.fr) records, per RGAA criterion, a status and
 * a user-impact level. Automated tooling can only assert **non-compliance**
 * (`NC`) for the criteria it manages to fail — declaring a criterion *compliant*
 * (`C`) or *not applicable* (`NA`) requires the full manual RGAA grid. We
 * therefore emit the criteria we detected as failing, with an honest note that
 * the global conformance rate must be completed by a human audit.
 */

import { RGAA_VERSION } from './criteria.js';
import type { AxeImpact, RgaaReport } from './types.js';

/** Ara criterion result status: Conforme / Non conforme / Non applicable. */
export type AraStatus = 'C' | 'NC' | 'NA';

/** Ara user-impact levels (French). */
export type AraUserImpact = 'mineur' | 'majeur' | 'bloquant';

export interface AraCriterionResult {
  /** RGAA theme/topic number, 1–13. */
  readonly topic: number;
  /** RGAA criterion id, e.g. `"1.1"`. */
  readonly criterium: string;
  readonly status: AraStatus;
  readonly userImpact: AraUserImpact;
  /** Aggregated, human-readable explanation of the failure(s). */
  readonly comment: string;
  /** Number of DOM occurrences across the criterion's findings. */
  readonly occurrenceCount: number;
}

export interface AraDeclaration {
  readonly generator: 'A11yEngine';
  readonly generatedAt: string;
  readonly referential: 'RGAA';
  readonly referentialVersion: typeof RGAA_VERSION;
  /** Only `NC` criteria are derivable automatically — see module docs. */
  readonly criteria: readonly AraCriterionResult[];
  readonly nonComplianceCount: number;
  readonly note: string;
}

const IMPACT_RANK: Record<AxeImpact, number> = {
  minor: 0,
  moderate: 1,
  serious: 2,
  critical: 3,
};

function toAraImpact(impact: AxeImpact | null): AraUserImpact {
  switch (impact) {
    case 'critical':
      return 'bloquant';
    case 'serious':
    case 'moderate':
      return 'majeur';
    default:
      return 'mineur';
  }
}

export interface ToAraOptions {
  /** ISO timestamp to stamp the declaration with. Defaults to `now`. */
  readonly generatedAt?: string;
}

/** Build an Ara-compatible declaration from a RGAA report. */
export function toAraDeclaration(report: RgaaReport, options: ToAraOptions = {}): AraDeclaration {
  // One Ara entry per criterion that has at least one hard failure.
  const byCriterion = new Map<
    string,
    { topic: number; worst: AxeImpact | null; comments: Set<string>; occurrences: number }
  >();

  for (const finding of report.findings) {
    if (finding.status !== 'failed') continue;
    const entry = byCriterion.get(finding.criterion) ?? {
      topic: finding.theme,
      worst: null,
      comments: new Set<string>(),
      occurrences: 0,
    };
    if (
      finding.impact &&
      (entry.worst === null || IMPACT_RANK[finding.impact] > IMPACT_RANK[entry.worst])
    ) {
      entry.worst = finding.impact;
    }
    entry.comments.add(`${finding.description} (axe: ${finding.axeRuleId})`);
    entry.occurrences += finding.occurrences.length;
    byCriterion.set(finding.criterion, entry);
  }

  const criteria: AraCriterionResult[] = [...byCriterion.entries()]
    .map(([criterium, entry]) => ({
      topic: entry.topic,
      criterium,
      status: 'NC' as const,
      userImpact: toAraImpact(entry.worst),
      comment: [...entry.comments].join(' ; '),
      occurrenceCount: entry.occurrences,
    }))
    .sort(
      (a, b) =>
        a.topic - b.topic ||
        a.criterium.localeCompare(b.criterium, undefined, { numeric: true }),
    );

  return {
    generator: 'A11yEngine',
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    referential: 'RGAA',
    referentialVersion: RGAA_VERSION,
    criteria,
    nonComplianceCount: criteria.length,
    note: "Export automatisé : seuls les critères non conformes détectés par analyse automatique sont déclarés (NC). Le taux de conformité global et les critères conformes (C) ou non applicables (NA) doivent être complétés par un audit manuel RGAA.",
  };
}
