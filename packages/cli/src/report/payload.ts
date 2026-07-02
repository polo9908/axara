/**
 * The stable JSON contract of an audit run. This exact shape is what
 * `--format json` prints and what gets POSTed to the Pro API: version it
 * carefully (bump `payloadVersion` on breaking changes).
 */

import type { AuditReport, DriftIssue, RgaaFinding } from '@axaraaudit/core';
import type { GateResult, FileRgaaFinding } from './score.js';
import { CLI_NAME, CLI_VERSION } from '../version.js';

export const PAYLOAD_VERSION = 1;

export interface RgaaAggregate {
  readonly filesAudited: number;
  readonly criteriaFailed: number;
  readonly criteriaToReview: number;
  readonly totalFindings: number;
  readonly byImpact: Readonly<Record<string, number>>;
}

export interface AuditPayload {
  readonly tool: string;
  readonly toolVersion: string;
  readonly payloadVersion: number;
  readonly generatedAt: string;
  readonly project: string;
  readonly score: number;
  readonly gate: {
    readonly evaluated: boolean;
    readonly passed: boolean;
    readonly failUnder: number;
    readonly reasons: readonly string[];
  };
  readonly drift: {
    readonly summary: AuditReport['summary'];
    readonly tokenErrors: readonly string[];
    readonly issues: readonly DriftIssue[];
  };
  readonly rgaa: {
    readonly enabled: boolean;
    readonly aggregate: RgaaAggregate;
    readonly findings: readonly (RgaaFinding & { readonly file: string })[];
  };
}

export function aggregateRgaa(
  filesAudited: number,
  findings: readonly FileRgaaFinding[],
): RgaaAggregate {
  const failedCriteria = new Set<string>();
  const reviewCriteria = new Set<string>();
  const byImpact: Record<string, number> = {};
  for (const { finding } of findings) {
    if (finding.status === 'failed') failedCriteria.add(finding.criterion);
    else reviewCriteria.add(finding.criterion);
    const impact = finding.impact ?? 'unknown';
    byImpact[impact] = (byImpact[impact] ?? 0) + 1;
  }
  return {
    filesAudited,
    criteriaFailed: failedCriteria.size,
    criteriaToReview: reviewCriteria.size,
    totalFindings: findings.length,
    byImpact,
  };
}

export function buildPayload(args: {
  readonly project: string;
  readonly drift: AuditReport;
  readonly rgaaEnabled: boolean;
  readonly rgaaFilesAudited: number;
  readonly rgaaFindings: readonly FileRgaaFinding[];
  readonly gate: GateResult;
  readonly ciMode: boolean;
}): AuditPayload {
  return {
    tool: CLI_NAME,
    toolVersion: CLI_VERSION,
    payloadVersion: PAYLOAD_VERSION,
    generatedAt: new Date().toISOString(),
    project: args.project,
    score: args.gate.score,
    gate: {
      evaluated: args.ciMode,
      passed: args.gate.passed,
      failUnder: args.gate.failUnder,
      reasons: args.gate.reasons,
    },
    drift: {
      summary: args.drift.summary,
      tokenErrors: args.drift.tokenErrors,
      issues: args.drift.issues,
    },
    rgaa: {
      enabled: args.rgaaEnabled,
      aggregate: aggregateRgaa(args.rgaaFilesAudited, args.rgaaFindings),
      findings: args.rgaaFindings.map(({ file, finding }) => ({ ...finding, file })),
    },
  };
}
