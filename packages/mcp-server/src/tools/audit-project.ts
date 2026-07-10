/**
 * Tool: `audit_project`.
 * Runs the full AxaraAudit pipeline (design-token drift + RGAA) on a project
 * directory through the exact same core orchestration as `axaraaudit audit`,
 * so the score is identical whichever surface runs it.
 *
 * The tool result is deliberately compact (top findings only) to preserve the
 * calling agent's context window; the full payload is cached and served by the
 * `axara://report/latest` resource.
 */

import { resolve, relative } from 'node:path';
import { auditProject, type DriftIssue } from '@axaraaudit/core';
import { z } from 'zod';
import { setLastReport } from '../report-store.js';
import { SERVER_NAME, SERVER_VERSION } from '../version.js';

export const AUDIT_PROJECT_INPUT = {
  projectDir: z
    .string()
    .optional()
    .describe('Racine du projet à auditer (par défaut : répertoire courant du serveur).'),
  configPath: z
    .string()
    .optional()
    .describe('Chemin explicite du .auditorrc.json (sinon : découverte dans projectDir).'),
  tokensPath: z
    .string()
    .optional()
    .describe('Chemin du fichier DTCG (sinon : config, puis extraction zéro-config des variables CSS).'),
  skipRgaa: z.boolean().optional().describe('Ne lancer que la détection de drift (défaut : false).'),
  maxDriftIssues: z
    .number()
    .int()
    .min(0)
    .max(500)
    .optional()
    .describe('Nombre max de drifts détaillés dans la réponse (défaut : 30). Le reste est agrégé.'),
  maxRgaaFindings: z
    .number()
    .int()
    .min(0)
    .max(500)
    .optional()
    .describe('Nombre max de violations RGAA détaillées dans la réponse (défaut : 30).'),
};

const compactDriftIssueSchema = z.object({
  file: z.string().describe('Chemin relatif à projectDir.'),
  line: z.number(),
  column: z.number(),
  property: z.string(),
  value: z.string(),
  severity: z.enum(['error', 'warning']),
  autoFixable: z.boolean(),
  replacement: z.string().optional().describe('Remplacement var(--token) prêt à appliquer.'),
});

const compactRgaaFindingSchema = z.object({
  file: z.string(),
  criterion: z.string(),
  title: z.string(),
  impact: z.string().nullable(),
  status: z.enum(['failed', 'cantTell']),
  occurrences: z.number(),
  sample: z.string().optional().describe('Extrait HTML du premier élément fautif.'),
});

export const AUDIT_PROJECT_OUTPUT = {
  project: z.string(),
  projectDir: z.string(),
  score: z.number().describe('Score de conformité 0–100.'),
  scores: z
    .object({
      design: z.number().describe('Sous-score dérive design-tokens, 0–100.'),
      rgaa: z.number().describe('Sous-score RGAA, 0–100.'),
    })
    .describe('Sous-scores par source — la progression reste visible même quand le score global sature.'),
  gate: z.object({
    passed: z.boolean(),
    failUnder: z.number(),
    reasons: z.array(z.string()),
  }),
  tokensSource: z.object({
    origin: z.enum(['file', 'auto', 'inline']),
    detail: z.string(),
  }),
  filesScanned: z.number(),
  drift: z.object({
    summary: z.object({
      filesScanned: z.number(),
      totalIssues: z.number(),
      errors: z.number(),
      warnings: z.number(),
      autoFixable: z.number(),
    }),
    issues: z.array(compactDriftIssueSchema),
    truncated: z.number().describe('Drifts non détaillés ici (voir axara://report/latest).'),
  }),
  rgaa: z.object({
    enabled: z.boolean(),
    aggregate: z.object({
      filesAudited: z.number(),
      criteriaFailed: z.number(),
      criteriaToReview: z.number(),
      totalFindings: z.number(),
      byImpact: z.record(z.string(), z.number()),
    }),
    findings: z.array(compactRgaaFindingSchema),
    truncated: z.number(),
  }),
  guidance: z.string(),
};

export interface AuditProjectInput {
  readonly projectDir?: string | undefined;
  readonly configPath?: string | undefined;
  readonly tokensPath?: string | undefined;
  readonly skipRgaa?: boolean | undefined;
  readonly maxDriftIssues?: number | undefined;
  readonly maxRgaaFindings?: number | undefined;
}

const SAMPLE_MAX_CHARS = 160;
const DEFAULT_MAX_ITEMS = 30;

function compactDrift(issue: DriftIssue, rootDir: string) {
  return {
    file: relative(rootDir, issue.file),
    line: issue.line,
    column: issue.column,
    property: issue.property,
    value: issue.value,
    severity: issue.severity,
    autoFixable: issue.autoFixable,
    ...(issue.suggestion !== undefined ? { replacement: issue.suggestion.replacement } : {}),
  };
}

export async function runAuditProject(input: AuditProjectInput = {}) {
  const cwd = resolve(input.projectDir ?? process.cwd());
  const result = await auditProject({
    cwd,
    tool: SERVER_NAME,
    toolVersion: SERVER_VERSION,
    configPath: input.configPath,
    tokensPath: input.tokensPath,
    skipRgaa: input.skipRgaa,
  });

  setLastReport(result.payload);

  const maxDrift = input.maxDriftIssues ?? DEFAULT_MAX_ITEMS;
  const maxRgaa = input.maxRgaaFindings ?? DEFAULT_MAX_ITEMS;

  // Errors before warnings, then source order — the agent sees the worst first.
  const orderedDrift = [...result.drift.issues].sort((a, b) =>
    a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1,
  );
  const IMPACT_RANK: Record<string, number> = { critical: 0, serious: 1, moderate: 2, minor: 3 };
  const orderedRgaa = [...result.rgaaFindings].sort(
    (a, b) =>
      (IMPACT_RANK[a.finding.impact ?? ''] ?? 4) - (IMPACT_RANK[b.finding.impact ?? ''] ?? 4),
  );

  const driftIssues = orderedDrift.slice(0, maxDrift).map((issue) => compactDrift(issue, cwd));
  const rgaaFindings = orderedRgaa.slice(0, maxRgaa).map(({ file, finding }) => ({
    file,
    criterion: finding.criterion,
    title: finding.criterionTitle,
    impact: finding.impact,
    status: finding.status,
    occurrences: finding.occurrences.length,
    ...(finding.occurrences[0] !== undefined
      ? { sample: finding.occurrences[0].html.slice(0, SAMPLE_MAX_CHARS) }
      : {}),
  }));

  const { aggregate } = result.payload.rgaa;
  return {
    project: result.payload.project,
    projectDir: cwd,
    score: result.payload.score,
    scores: { design: result.payload.scores.design, rgaa: result.payload.scores.rgaa },
    gate: {
      passed: result.gate.passed,
      failUnder: result.gate.failUnder,
      reasons: [...result.gate.reasons],
    },
    tokensSource: { origin: result.tokensSource.origin, detail: result.tokensSource.detail },
    filesScanned: result.drift.summary.filesScanned,
    drift: {
      summary: result.drift.summary,
      issues: driftIssues,
      truncated: Math.max(0, result.drift.issues.length - driftIssues.length),
    },
    rgaa: {
      enabled: result.payload.rgaa.enabled,
      aggregate,
      findings: rgaaFindings,
      truncated: Math.max(0, result.rgaaFindings.length - rgaaFindings.length),
    },
    guidance:
      'Corrige d’abord les violations RGAA critiques/sérieuses, puis le drift ' +
      '(`fix_drift` applique les remplacements sûrs ; dryRun par défaut). ' +
      'Rapport complet : resource axara://report/latest.',
  };
}
