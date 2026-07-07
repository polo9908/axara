/**
 * Tool: `fix_drift`.
 * Applies the mechanical (position-verified) design-drift fixes through the
 * same core pipeline as `axaraaudit fix`. Dry-run by default: nothing touches
 * disk unless `write: true` is passed explicitly.
 */

import { resolve, relative } from 'node:path';
import { fixProject, type DriftIssue } from '@axaraaudit/core';
import { z } from 'zod';

export const FIX_DRIFT_INPUT = {
  projectDir: z
    .string()
    .optional()
    .describe('Racine du projet (par défaut : répertoire courant du serveur).'),
  configPath: z.string().optional().describe('Chemin explicite du .auditorrc.json.'),
  tokensPath: z.string().optional().describe('Chemin du fichier DTCG.'),
  write: z
    .boolean()
    .optional()
    .describe('Écrire les corrections sur disque (défaut : false = prévisualisation).'),
  includeNearMatches: z
    .boolean()
    .optional()
    .describe('Appliquer aussi les valeurs proches d’un token (défaut : false).'),
  minConfidence: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('Seuil de confiance pour les valeurs proches (défaut : 0.7).'),
};

const appliedFixSchema = z.object({
  line: z.number(),
  column: z.number(),
  from: z.string(),
  to: z.string(),
});

const remainingIssueSchema = z.object({
  file: z.string(),
  line: z.number(),
  property: z.string(),
  value: z.string(),
  match: z.enum(['exact-token', 'nearest-token', 'no-token']),
  replacement: z.string().optional(),
  confidence: z.number().optional(),
});

export const FIX_DRIFT_OUTPUT = {
  mode: z.enum(['dry-run', 'write']),
  totalApplied: z.number(),
  files: z.array(
    z.object({
      file: z.string().describe('Chemin relatif à projectDir.'),
      written: z.boolean(),
      fixes: z.array(appliedFixSchema),
    }),
  ),
  remaining: z.object({
    total: z.number(),
    nearMatches: z.number().describe('Corrigeables avec includeNearMatches: true.'),
    noToken: z.number().describe('Aucun token proche — décision humaine requise.'),
    issues: z.array(remainingIssueSchema),
    truncated: z.number(),
  }),
  guidance: z.string(),
};

export interface FixDriftInput {
  readonly projectDir?: string | undefined;
  readonly configPath?: string | undefined;
  readonly tokensPath?: string | undefined;
  readonly write?: boolean | undefined;
  readonly includeNearMatches?: boolean | undefined;
  readonly minConfidence?: number | undefined;
}

const MAX_REMAINING_DETAILED = 30;

function compactRemaining(issue: DriftIssue, rootDir: string) {
  return {
    file: relative(rootDir, issue.file),
    line: issue.line,
    property: issue.property,
    value: issue.value,
    match: issue.match,
    ...(issue.suggestion !== undefined
      ? { replacement: issue.suggestion.replacement, confidence: issue.suggestion.confidence }
      : {}),
  };
}

export function runFixDrift(input: FixDriftInput = {}) {
  const cwd = resolve(input.projectDir ?? process.cwd());
  const write = input.write === true;
  const result = fixProject({
    cwd,
    configPath: input.configPath,
    tokensPath: input.tokensPath,
    write,
    all: input.includeNearMatches,
    minConfidence: input.minConfidence,
  });

  const files = result.fixed.map((fileResult) => ({
    file: relative(cwd, fileResult.path),
    written: fileResult.written,
    fixes: fileResult.applied.map((fix) => ({
      line: fix.line,
      column: fix.column,
      from: fix.from,
      to: fix.to,
    })),
  }));

  const nearMatches = result.remaining.filter((issue) => issue.match === 'nearest-token').length;
  const noToken = result.remaining.filter((issue) => issue.match === 'no-token').length;
  const detailed = result.remaining
    .slice(0, MAX_REMAINING_DETAILED)
    .map((issue) => compactRemaining(issue, cwd));

  return {
    mode: write ? ('write' as const) : ('dry-run' as const),
    totalApplied: result.totalApplied,
    files,
    remaining: {
      total: result.remaining.length,
      nearMatches,
      noToken,
      issues: detailed,
      truncated: Math.max(0, result.remaining.length - detailed.length),
    },
    guidance: write
      ? 'Corrections écrites. Relance audit_project pour vérifier le nouveau score.'
      : 'Prévisualisation seulement — rien n’a été modifié. Relance avec write: true pour appliquer. ' +
        'Les valeurs proches d’un token nécessitent includeNearMatches: true ; ' +
        'les problèmes RGAA (alt, labels…) exigent une décision humaine ou une correction dans le code généré.',
  };
}
