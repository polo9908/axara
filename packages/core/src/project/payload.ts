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
import type {
  ExceptedDriftIssue,
  ExceptedRgaaFinding,
  ExceptionOrigin,
  ExceptionsSummary,
} from './exceptions.js';
import { driftIdentity, fingerprintAll, normalizeFingerprintPath, rgaaIdentity } from './fingerprint.js';
import type { GateResult, FileRgaaFinding, ScoreBreakdown } from './score.js';

// v2 : courbe de score asymptotique (plus de clamp à 0) + sous-scores
// `scores.{design,rgaa}`. / v2: asymptotic score curve (no flat clamp at 0)
// plus `scores.{design,rgaa}` sub-scores.
// v2 additif : `designSystem { enabled, origin }` — quand `enabled` est false
// (projet sans design system, audit RGAA seul), `scores.design` reste à 100
// pour la stabilité du contrat. / v2 additive: `designSystem { enabled,
// origin }` — when `enabled` is false (no design system, RGAA-only audit),
// `scores.design` stays at 100 for contract stability.
// v2 additif (bis) : bloc `exceptions {declared, applied, unmatched}` quand la
// config déclare des exceptions justifiées ; les violations exceptées sont
// absentes des listes et du score. Les chemins des issues de drift sont
// désormais relatifs POSIX (comme les constats RGAA et les empreintes) — le
// payload est portable d'un checkout à l'autre. / v2 additive (bis):
// `exceptions {declared, applied, unmatched}` block when the config declares
// justified exceptions; excepted violations are absent from the lists and the
// score. Drift issue paths are now POSIX-relative (like RGAA findings and
// fingerprints) — the payload is portable across checkouts.
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
  /** Provenance du design system audité ; absent des payloads antérieurs. */
  readonly designSystem?: {
    readonly enabled: boolean;
    readonly origin: string;
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
  /** Présent quand des exceptions sont déclarées (config ou inline, additif). */
  readonly exceptions?: ExceptionsSummary;
  /**
   * Violations couvertes par une exception justifiée — section SÉPARÉE des
   * violations comptées : hors score et hors gate, mais tracées intégralement
   * (raison + origine). Jamais un retrait silencieux.
   */
  readonly excepted?: {
    readonly drift: readonly (DriftIssue & {
      readonly fingerprint: string;
      readonly reason: string;
      readonly origin: ExceptionOrigin;
    })[];
    readonly rgaa: readonly (RgaaFinding & {
      readonly file: string;
      readonly fingerprint: string;
      readonly reason: string;
      readonly origin: ExceptionOrigin;
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
  /** Provenance des tokens (origin de ResolvedTokensSource). */
  readonly tokensOrigin: string;
  /**
   * Empreintes précalculées, alignées sur `drift.issues` / `rgaaFindings`
   * (chemin exceptions : elles DOIVENT venir des listes complètes, avant
   * filtrage — les rangs des doublons en dépendent). Sinon calculées ici.
   */
  readonly driftFingerprints?: readonly string[];
  readonly rgaaFingerprints?: readonly string[];
  /** Synthèse des exceptions justifiées ; omise si aucune n'est déclarée. */
  readonly exceptions?: ExceptionsSummary;
  /** Violations exceptées, tracées dans la section `excepted` du payload. */
  readonly excepted?: {
    readonly drift: readonly ExceptedDriftIssue[];
    readonly rgaa: readonly ExceptedRgaaFinding[];
  };
}

/** Chemin d'issue de drift → forme relative POSIX du payload. */
export function payloadDriftFile(rootDir: string, file: string): string {
  return normalizeFingerprintPath(isAbsolute(file) ? relative(rootDir, file) : file);
}

export function buildAuditPayload(args: BuildAuditPayloadArgs): AuditPayload {
  // Drift issues carry absolute paths in-process (fix pass needs them); the
  // payload stores the POSIX root-relative form, same as fingerprints and
  // RGAA findings — portable across machines and checkouts.
  const driftFingerprints =
    args.driftFingerprints ??
    fingerprintAll(
      args.drift.issues.map((issue) =>
        driftIdentity(issue, payloadDriftFile(args.rootDir, issue.file)),
      ),
    );
  const rgaaFingerprints =
    args.rgaaFingerprints ??
    fingerprintAll(args.rgaaFindings.map(({ file, finding }) => rgaaIdentity(finding, file)));
  return {
    tool: args.tool,
    toolVersion: args.toolVersion,
    payloadVersion: PAYLOAD_VERSION,
    generatedAt: new Date().toISOString(),
    project: args.project,
    score: args.gate.score,
    scores: { design: args.scores.design, rgaa: args.scores.rgaa },
    designSystem: { enabled: args.tokensOrigin !== 'none', origin: args.tokensOrigin },
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
        file: payloadDriftFile(args.rootDir, issue.file),
        fingerprint: driftFingerprints[i] as string,
      })),
    },
    rgaa: {
      enabled: args.rgaaEnabled,
      aggregate: aggregateRgaa(args.rgaaFilesAudited, args.rgaaFindings),
      findings: args.rgaaFindings.map(({ file, finding }, i) => ({
        ...finding,
        file: normalizeFingerprintPath(file),
        fingerprint: rgaaFingerprints[i] as string,
      })),
    },
    ...(args.exceptions !== undefined ? { exceptions: args.exceptions } : {}),
    ...(args.excepted !== undefined
      ? {
          excepted: {
            drift: args.excepted.drift.map((issue) => ({
              ...issue,
              file: payloadDriftFile(args.rootDir, issue.file),
            })),
            rgaa: args.excepted.rgaa.map(({ file, finding, fingerprint, reason, origin }) => ({
              ...finding,
              file: normalizeFingerprintPath(file),
              fingerprint,
              reason,
              origin,
            })),
          },
        }
      : {}),
  };
}
