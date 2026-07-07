/**
 * Conformity score (0–100) and CI gate evaluation.
 *
 * The score is a pragmatic pressure signal, not a legal conformity rate: a
 * real RGAA declaration requires a manual audit. Weights favour accessibility
 * failures over cosmetic token drift. Lives in core so every surface (CLI,
 * MCP server, Pro API) computes the exact same number.
 */

import type { AuditSummary } from '../analyzer/audit.js';
import type { AxeImpact, RgaaFinding } from '../rgaa/types.js';

/** A RGAA finding attributed to the source file that produced it. */
export interface FileRgaaFinding {
  readonly file: string;
  readonly finding: RgaaFinding;
}

const IMPACT_PENALTY: Readonly<Record<AxeImpact, number>> = {
  critical: 10,
  serious: 7,
  moderate: 4,
  minor: 2,
};
const UNKNOWN_IMPACT_PENALTY = 4;
const CANT_TELL_PENALTY = 1;
const DRIFT_ERROR_PENALTY = 2;
const DRIFT_WARNING_PENALTY = 0.5;

export function computeScore(
  drift: AuditSummary,
  rgaaFindings: readonly FileRgaaFinding[],
): number {
  let penalty = drift.errors * DRIFT_ERROR_PENALTY + drift.warnings * DRIFT_WARNING_PENALTY;
  for (const { finding } of rgaaFindings) {
    if (finding.status === 'cantTell') {
      penalty += CANT_TELL_PENALTY;
    } else {
      penalty +=
        finding.impact === null ? UNKNOWN_IMPACT_PENALTY : IMPACT_PENALTY[finding.impact];
    }
  }
  return Math.max(0, Math.round(100 - penalty));
}

export interface GateOptions {
  readonly failUnder: number;
  readonly blockOnCritical: boolean;
  /** RGAA criteria that block on any failure, regardless of impact. */
  readonly priority: readonly string[];
}

export interface GateResult {
  readonly passed: boolean;
  readonly score: number;
  readonly failUnder: number;
  /** Findings that individually block the pipeline. */
  readonly blocking: readonly FileRgaaFinding[];
  /** Human-readable failure reasons (empty when passed). */
  readonly reasons: readonly string[];
}

export function evaluateGate(
  score: number,
  rgaaFindings: readonly FileRgaaFinding[],
  options: GateOptions,
): GateResult {
  const blocking = rgaaFindings.filter(({ finding }) => {
    if (finding.status !== 'failed') return false;
    if (options.priority.includes(finding.criterion)) return true;
    return (
      options.blockOnCritical &&
      (finding.impact === 'critical' || finding.impact === 'serious')
    );
  });

  const reasons: string[] = [];
  if (score < options.failUnder) {
    reasons.push(`Score ${score}/100 sous le seuil requis (${options.failUnder}).`);
  }
  for (const { file, finding } of blocking) {
    reasons.push(
      `RGAA ${finding.criterion} (${finding.impact ?? 'impact inconnu'}) — ${file}`,
    );
  }

  return {
    passed: reasons.length === 0,
    score,
    failUnder: options.failUnder,
    blocking,
    reasons,
  };
}
