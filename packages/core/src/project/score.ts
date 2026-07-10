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

/** Penalty above which the scale switches from linear to asymptotic. */
const LINEAR_PENALTY_LIMIT = 50;

/**
 * Penalty → score. Linear (`100 - penalty`, identical to the historical scale)
 * down to 50, then a hyperbolic tail (`2500 / penalty`): a heavily failing
 * project keeps a non-zero, still-moving score instead of being clamped flat
 * at 0 — fixing violations must always be visible. The two branches share the
 * same value and slope at the junction (C1-continuous).
 */
function penaltyToScore(penalty: number): number {
  const raw = penalty <= LINEAR_PENALTY_LIMIT ? 100 - penalty : 2500 / penalty;
  return Math.round(raw);
}

function driftPenalty(drift: AuditSummary): number {
  return drift.errors * DRIFT_ERROR_PENALTY + drift.warnings * DRIFT_WARNING_PENALTY;
}

function rgaaPenalty(rgaaFindings: readonly FileRgaaFinding[]): number {
  let penalty = 0;
  for (const { finding } of rgaaFindings) {
    if (finding.status === 'cantTell') {
      penalty += CANT_TELL_PENALTY;
    } else {
      penalty +=
        finding.impact === null ? UNKNOWN_IMPACT_PENALTY : IMPACT_PENALTY[finding.impact];
    }
  }
  return penalty;
}

/**
 * The global score plus one sub-score per pressure source, on the same scale.
 * Sub-scores make progress visible even when the global score saturates in
 * the exponential tail (e.g. fixing every drift while RGAA debt dominates).
 */
export interface ScoreBreakdown {
  readonly global: number;
  /** Design-token drift only. */
  readonly design: number;
  /** RGAA findings only. */
  readonly rgaa: number;
}

export function computeScoreBreakdown(
  drift: AuditSummary,
  rgaaFindings: readonly FileRgaaFinding[],
): ScoreBreakdown {
  const dp = driftPenalty(drift);
  const rp = rgaaPenalty(rgaaFindings);
  return {
    global: penaltyToScore(dp + rp),
    design: penaltyToScore(dp),
    rgaa: penaltyToScore(rp),
  };
}

export function computeScore(
  drift: AuditSummary,
  rgaaFindings: readonly FileRgaaFinding[],
): number {
  return computeScoreBreakdown(drift, rgaaFindings).global;
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
