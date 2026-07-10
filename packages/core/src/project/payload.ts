/**
 * The stable JSON contract of an audit run. This exact shape is what the CLI's
 * `--format json` prints, what the MCP `audit_project` tool caches, and what
 * gets POSTed to the Pro API: version it carefully (bump `payloadVersion` on
 * breaking changes). The producing surface identifies itself via `tool` /
 * `toolVersion`.
 */

import { isAbsolute, relative } from 'node:path';
import type { AuditReport } from '../analyzer/audit.js';
import type { RgaaFinding } from '../rgaa/types.js';
import type { DriftIssue } from '../types.js';
import { driftIdentity, fingerprintAll, rgaaIdentity } from './fingerprint.js';
import type { GateResult, FileRgaaFinding, ScoreBreakdown } from './score.js';

// v2 : courbe de score asymptotique (plus de clamp à 0) + sous-scores
// `scores.{design,rgaa}`. / v2: asymptotic score curve (no flat clamp at 0)
// plus `scores.{design,rgaa}` sub-scores.
export const PAYLOAD_VERSION = 2;

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
  /** Sous-scores par source de pression, même échelle que `score`. */
  readonly scores: {
    readonly design: number;
    readonly rgaa: number;
  };
  readonly gate: {
    readonly evaluated: boolean;
    readonly passed: boolean;
    readonly failUnder: number;
    readonly reasons: readonly string[];
  };
  readonly drift: {
    readonly summary: AuditReport['summary'];
    readonly tokenErrors: readonly string[];
    readonly issues: readonly (DriftIssue & { readonly fingerprint: string })[];
  };
  readonly rgaa: {
    readonly enabled: boolean;
    readonly aggregate: RgaaAggregate;
    readonly findings: readonly (RgaaFinding & {
      readonly file: string;
      readonly fingerprint: string;
    })[];
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

export interface BuildAuditPayloadArgs {
  /** Identity of the producing surface, e.g. `axaraaudit` or `a11yengine-mcp`. */
  readonly tool: string;
  readonly toolVersion: string;
  readonly project: string;
  /**
   * Project root, used to relativize drift file paths before fingerprinting
   * (fingerprints must be identical across machines and checkouts).
   */
  readonly rootDir: string;
  readonly drift: AuditReport;
  readonly rgaaEnabled: boolean;
  readonly rgaaFilesAudited: number;
  readonly rgaaFindings: readonly FileRgaaFinding[];
  readonly gate: GateResult;
  readonly scores: ScoreBreakdown;
  readonly ciMode: boolean;
}

export function buildAuditPayload(args: BuildAuditPayloadArgs): AuditPayload {
  // Drift issues carry absolute paths (fix pass needs them); fingerprints hash
  // the root-relative form. RGAA findings are already root-relative.
  const driftFingerprints = fingerprintAll(
    args.drift.issues.map((issue) =>
      driftIdentity(issue, isAbsolute(issue.file) ? relative(args.rootDir, issue.file) : issue.file),
    ),
  );
  const rgaaFingerprints = fingerprintAll(
    args.rgaaFindings.map(({ file, finding }) => rgaaIdentity(finding, file)),
  );
  return {
    tool: args.tool,
    toolVersion: args.toolVersion,
    payloadVersion: PAYLOAD_VERSION,
    generatedAt: new Date().toISOString(),
    project: args.project,
    score: args.gate.score,
    scores: { design: args.scores.design, rgaa: args.scores.rgaa },
    gate: {
      evaluated: args.ciMode,
      passed: args.gate.passed,
      failUnder: args.gate.failUnder,
      reasons: args.gate.reasons,
    },
    drift: {
      summary: args.drift.summary,
      tokenErrors: args.drift.tokenErrors,
      issues: args.drift.issues.map((issue, i) => ({
        ...issue,
        fingerprint: driftFingerprints[i] as string,
      })),
    },
    rgaa: {
      enabled: args.rgaaEnabled,
      aggregate: aggregateRgaa(args.rgaaFilesAudited, args.rgaaFindings),
      findings: args.rgaaFindings.map(({ file, finding }, i) => ({
        ...finding,
        file,
        fingerprint: rgaaFingerprints[i] as string,
      })),
    },
  };
}
