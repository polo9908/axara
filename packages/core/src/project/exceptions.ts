/**
 * Exceptions justifiées — la promesse CI : le build n'échoue JAMAIS sur une
 * violation couverte par une exception justifiée. Deux sources :
 *   - config `.auditorrc.json` : ciblée par empreinte, ou récurrente par
 *     règle (+ globs `files`) ;
 *   - inline dans le source : `// axara-ignore: <règle> raison="…"`
 *     (voir ignore.ts).
 * Les violations exceptées sortent du score et du gate mais restent tracées
 * intégralement (issue/constat + raison + origine) dans la section `excepted`
 * du payload — jamais un retrait silencieux.
 * Justified exceptions — the CI promise: the build NEVER fails on a violation
 * covered by a justified exception. Two sources: `.auditorrc.json` config
 * (fingerprint-targeted or rule+globs recurring) and inline source directives
 * (`// axara-ignore: <rule> reason="…"`, see ignore.ts). Excepted violations
 * leave the score and the gate but stay fully traced (issue/finding + reason
 * + origin) in the payload's `excepted` section — never a silent removal.
 */

import { tr } from '../i18n.js';
import type { RgaaFinding } from '../rgaa/types.js';
import type { DriftIssue } from '../types.js';
import {
  driftDirectiveMatches,
  matchesAnyGlob,
  parseIgnoreRule,
  rgaaDirectiveMatches,
  type IgnoreRule,
  type InlineDirective,
  type InvalidDirective,
} from './ignore.js';
import { ConfigError, type AuditExceptionEntry } from './rc.js';
import type { FileRgaaFinding } from './score.js';

/** Règle récurrente résolue depuis la config. */
export interface RuleException {
  readonly rule: IgnoreRule;
  /** Globs POSIX, ou null = tout le repo. */
  readonly files: readonly string[] | null;
  readonly reason: string;
}

export interface ResolvedConfigExceptions {
  /** empreinte → raison. */
  readonly byFingerprint: ReadonlyMap<string, string>;
  readonly byRule: readonly RuleException[];
}

/**
 * Valide les entrées de config et résout les exceptions actives. Une entrée
 * sans `reason` non vide, sans cible (`fingerprint` ou `rule`), avec les deux
 * cibles à la fois, ou avec une date invalide est une erreur de config
 * (exit 2) — la justification est le contrat. Les entrées expirées sont
 * ignorées (la violation redevient comptée).
 */
export function resolveConfigExceptions(
  entries: readonly AuditExceptionEntry[],
  now: Date = new Date(),
): ResolvedConfigExceptions {
  const byFingerprint = new Map<string, string>();
  const byRule: RuleException[] = [];
  for (const entry of entries) {
    const label = entry.fingerprint ?? entry.rule ?? '?';
    if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
      throw new ConfigError(
        tr(
          `Exception ${label} sans justification : le champ \`reason\` est obligatoire.`,
          `Exception ${label} lacks a justification: the \`reason\` field is mandatory.`,
        ),
      );
    }
    const hasFingerprint = typeof entry.fingerprint === 'string' && entry.fingerprint.trim() !== '';
    const hasRule = typeof entry.rule === 'string' && entry.rule.trim() !== '';
    if (hasFingerprint === hasRule) {
      throw new ConfigError(
        tr(
          `Exception « ${entry.reason} » : exactement un champ \`fingerprint\` OU \`rule\` est requis.`,
          `Exception "${entry.reason}": exactly one of \`fingerprint\` OR \`rule\` is required.`,
        ),
      );
    }
    if (entry.expires !== undefined) {
      const expires = new Date(entry.expires);
      if (Number.isNaN(expires.getTime())) {
        throw new ConfigError(
          tr(
            `Exception ${label} : date \`expires\` invalide (${entry.expires}).`,
            `Exception ${label}: invalid \`expires\` date (${entry.expires}).`,
          ),
        );
      }
      if (expires.getTime() < now.getTime()) continue;
    }
    if (hasFingerprint) {
      byFingerprint.set(entry.fingerprint as string, entry.reason);
    } else {
      byRule.push({
        rule: parseIgnoreRule((entry.rule as string).trim()),
        files: entry.files !== undefined ? entry.files.map((g) => g.replace(/\\/g, '/')) : null,
        reason: entry.reason,
      });
    }
  }
  return { byFingerprint, byRule };
}

export type ExceptionOrigin = 'inline' | 'config';

export type FingerprintedDriftIssue = DriftIssue & { readonly fingerprint: string };
export interface FingerprintedRgaaFinding {
  readonly file: string;
  readonly finding: RgaaFinding;
  readonly fingerprint: string;
}

export type ExceptedDriftIssue = FingerprintedDriftIssue & {
  readonly reason: string;
  readonly origin: ExceptionOrigin;
};
export type ExceptedRgaaFinding = FingerprintedRgaaFinding & {
  readonly reason: string;
  readonly origin: ExceptionOrigin;
};

/** Bloc de synthèse embarqué dans le payload quand des exceptions existent. */
export interface ExceptionsSummary {
  /** Entrées config actives + directives inline valides rencontrées. */
  readonly declared: number;
  /** Violations effectivement retirées du score/gate (tracées dans excepted). */
  readonly applied: number;
  /** Empreintes de config qui ne correspondent à aucune violation (stale). */
  readonly unmatched: readonly string[];
  /** Directives inline sans raison — ignorées, à corriger. */
  readonly invalid: readonly InvalidDirective[];
}

export interface ExceptionApplication {
  readonly driftKept: readonly FingerprintedDriftIssue[];
  readonly rgaaKept: readonly FingerprintedRgaaFinding[];
  readonly driftExcepted: readonly ExceptedDriftIssue[];
  readonly rgaaExcepted: readonly ExceptedRgaaFinding[];
  readonly summary: ExceptionsSummary;
}

export interface ApplyExceptionsArgs {
  /** Issues de drift complètes, avec leur chemin RELATIF POSIX. */
  readonly driftIssues: readonly (DriftIssue & { readonly relativeFile: string })[];
  /** Empreintes calculées sur la liste COMPLÈTE (rangs de doublons). */
  readonly driftFingerprints: readonly string[];
  readonly rgaaFindings: readonly FileRgaaFinding[];
  readonly rgaaFingerprints: readonly string[];
  readonly config: ResolvedConfigExceptions;
  /** Directives inline valides, par chemin relatif POSIX. */
  readonly inline: ReadonlyMap<string, readonly InlineDirective[]>;
  readonly invalidDirectives: readonly InvalidDirective[];
}

function ruleMatchesDrift(
  rule: RuleException,
  issue: { readonly category: string; readonly property: string },
  relativeFile: string,
): boolean {
  if (rule.rule.kind !== 'drift') return false;
  if (rule.files !== null && !matchesAnyGlob(relativeFile, rule.files)) return false;
  const { target } = rule.rule;
  return target === '*' || target === issue.category.toLowerCase() || target === issue.property.toLowerCase();
}

function ruleMatchesRgaa(rule: RuleException, criterion: string, relativeFile: string): boolean {
  if (rule.rule.kind !== 'rgaa' || rule.rule.criterion !== criterion) return false;
  return rule.files === null || matchesAnyGlob(relativeFile, rule.files);
}

/**
 * Applique exceptions config + directives inline. Priorité de la raison
 * retenue : inline > config par empreinte > config par règle.
 */
export function applyExceptions(args: ApplyExceptionsArgs): ExceptionApplication {
  const matchedFingerprints = new Set<string>();
  let inlineDeclared = 0;
  for (const directives of args.inline.values()) inlineDeclared += directives.length;

  const driftKept: FingerprintedDriftIssue[] = [];
  const driftExcepted: ExceptedDriftIssue[] = [];
  args.driftIssues.forEach((issue, i) => {
    const fingerprint = args.driftFingerprints[i] as string;
    const directives = args.inline.get(issue.relativeFile) ?? [];
    const inlineHit = directives.find((d) => driftDirectiveMatches(d, issue));
    const configReason = args.config.byFingerprint.get(fingerprint);
    const ruleHit =
      inlineHit === undefined && configReason === undefined
        ? args.config.byRule.find((r) => ruleMatchesDrift(r, issue, issue.relativeFile))
        : undefined;
    if (configReason !== undefined) matchedFingerprints.add(fingerprint);
    const { relativeFile: _unused, ...bare } = issue;
    if (inlineHit !== undefined) {
      driftExcepted.push({ ...bare, fingerprint, reason: inlineHit.reason, origin: 'inline' });
    } else if (configReason !== undefined) {
      driftExcepted.push({ ...bare, fingerprint, reason: configReason, origin: 'config' });
    } else if (ruleHit !== undefined) {
      driftExcepted.push({ ...bare, fingerprint, reason: ruleHit.reason, origin: 'config' });
    } else {
      driftKept.push({ ...bare, fingerprint });
    }
  });

  const rgaaKept: FingerprintedRgaaFinding[] = [];
  const rgaaExcepted: ExceptedRgaaFinding[] = [];
  args.rgaaFindings.forEach(({ file, finding }, i) => {
    const fingerprint = args.rgaaFingerprints[i] as string;
    const directives = args.inline.get(file) ?? [];
    const inlineHit = directives.find((d) => rgaaDirectiveMatches(d, finding));
    const configReason = args.config.byFingerprint.get(fingerprint);
    const ruleHit =
      inlineHit === undefined && configReason === undefined
        ? args.config.byRule.find((r) => ruleMatchesRgaa(r, finding.criterion, file))
        : undefined;
    if (configReason !== undefined) matchedFingerprints.add(fingerprint);
    if (inlineHit !== undefined) {
      rgaaExcepted.push({ file, finding, fingerprint, reason: inlineHit.reason, origin: 'inline' });
    } else if (configReason !== undefined) {
      rgaaExcepted.push({ file, finding, fingerprint, reason: configReason, origin: 'config' });
    } else if (ruleHit !== undefined) {
      rgaaExcepted.push({ file, finding, fingerprint, reason: ruleHit.reason, origin: 'config' });
    } else {
      rgaaKept.push({ file, finding, fingerprint });
    }
  });

  return {
    driftKept,
    rgaaKept,
    driftExcepted,
    rgaaExcepted,
    summary: {
      declared: args.config.byFingerprint.size + args.config.byRule.length + inlineDeclared,
      applied: driftExcepted.length + rgaaExcepted.length,
      unmatched: [...args.config.byFingerprint.keys()].filter((f) => !matchedFingerprints.has(f)),
      invalid: args.invalidDirectives,
    },
  };
}
