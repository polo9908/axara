/**
 * Transform raw axe-core results into a RGAA-structured report.
 *
 * axe groups findings by rule; RGAA reasons in criteria. We re-key violations
 * (and, optionally, axe "incomplete" results) onto RGAA criteria, preserving the
 * originating rule and every DOM occurrence, and aggregate a summary.
 */

import type { AxeResults, Result, NodeResult } from 'axe-core';
import { getCriterion } from './criteria.js';
import { criteriaForRule } from './mapping.js';
import type {
  AxeImpact,
  RgaaFinding,
  RgaaOccurrence,
  RgaaReport,
  RgaaStatus,
  RgaaSummary,
} from './types.js';

export interface MapOptions {
  /** Also map axe "incomplete" results as `cantTell` findings. Default: true. */
  readonly includeIncomplete?: boolean;
}

function toTarget(node: NodeResult): string {
  const target = node.target as unknown;
  if (Array.isArray(target)) {
    return target.map((part) => (Array.isArray(part) ? part.join(' ') : String(part))).join(' ');
  }
  return String(target);
}

function toOccurrences(result: Result): RgaaOccurrence[] {
  return result.nodes.map((node) => ({
    target: toTarget(node),
    html: node.html,
    failureSummary: node.failureSummary ?? '',
  }));
}

function normalizeImpact(impact: Result['impact']): AxeImpact | null {
  switch (impact) {
    case 'minor':
    case 'moderate':
    case 'serious':
    case 'critical':
      return impact;
    default:
      return null;
  }
}

const EMPTY_IMPACT: Record<AxeImpact, number> = {
  minor: 0,
  moderate: 0,
  serious: 0,
  critical: 0,
};

export function mapAxeResults(results: AxeResults, options: MapOptions = {}): RgaaReport {
  const includeIncomplete = options.includeIncomplete ?? true;
  const findings: RgaaFinding[] = [];
  const unmapped = new Set<string>();

  const consume = (result: Result, status: RgaaStatus): void => {
    const criteria = criteriaForRule(result.id);
    if (!criteria) {
      unmapped.add(result.id);
      return;
    }
    const occurrences = toOccurrences(result);
    const impact = normalizeImpact(result.impact);
    for (const criterionId of criteria) {
      const meta = getCriterion(criterionId);
      findings.push({
        criterion: meta.id,
        theme: meta.theme,
        themeLabel: meta.themeLabel,
        criterionTitle: meta.title,
        wcag: meta.wcag,
        axeRuleId: result.id,
        impact,
        status,
        description: result.help,
        helpUrl: result.helpUrl,
        occurrences,
      });
    }
  };

  for (const violation of results.violations) consume(violation, 'failed');
  if (includeIncomplete) {
    for (const incomplete of results.incomplete) consume(incomplete, 'cantTell');
  }

  findings.sort(
    (a, b) =>
      a.theme - b.theme ||
      a.criterion.localeCompare(b.criterion, undefined, { numeric: true }) ||
      a.axeRuleId.localeCompare(b.axeRuleId),
  );

  return {
    summary: summarize(findings),
    findings,
    unmappedRules: [...unmapped].sort(),
  };
}

function summarize(findings: readonly RgaaFinding[]): RgaaSummary {
  const failedCriteria = new Set<string>();
  const reviewCriteria = new Set<string>();
  const byImpact: Record<AxeImpact, number> = { ...EMPTY_IMPACT };
  const byTheme: Record<number, number> = {};

  for (const finding of findings) {
    if (finding.status === 'failed') failedCriteria.add(finding.criterion);
    else reviewCriteria.add(finding.criterion);
    if (finding.impact) byImpact[finding.impact] += 1;
    byTheme[finding.theme] = (byTheme[finding.theme] ?? 0) + finding.occurrences.length;
  }

  return {
    criteriaFailed: failedCriteria.size,
    criteriaToReview: reviewCriteria.size,
    totalFindings: findings.length,
    byImpact,
    byTheme,
  };
}
