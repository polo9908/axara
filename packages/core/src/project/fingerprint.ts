/**
 * Empreintes stables par violation — l'identité qui permet au dashboard Pro
 * de faire du diff d'audits (nouvelle / persistante / corrigée) et des
 * tendances fiables.
 * Stable per-violation fingerprints — the identity that lets the Pro
 * dashboard diff audits (new / persistent / fixed) and chart reliable trends.
 *
 * Règles d'or / ground rules:
 * - Jamais de ligne/colonne : un simple décalage de code ne doit pas changer
 *   l'identité. / Never line/column: shifting code must not change identity.
 * - Jamais de chemin absolu ni de message localisé : l'empreinte doit être
 *   identique d'une machine (et d'une langue) à l'autre. / Never absolute
 *   paths or localized messages: fingerprints must match across machines and
 *   locales.
 * - Les doublons exacts (même fichier, même règle, même valeur) sont
 *   distingués par leur rang d'apparition, pas par leur position. / Exact
 *   duplicates are told apart by their occurrence rank, not their position.
 *
 * Changer l'un des composants d'identité casse la continuité des séries du
 * dashboard : bumper FINGERPRINT_SCHEME dans ce cas. / Changing any identity
 * component breaks dashboard series continuity: bump FINGERPRINT_SCHEME then.
 */

import { createHash } from 'node:crypto';
import type { RgaaFinding } from '../rgaa/types.js';
import type { DriftIssue } from '../types.js';

/** Versionne la recette de hachage, pas le payload. / Versions the hashing recipe, not the payload. */
export const FINGERPRINT_SCHEME = 'v1';

// NUL : impossible dans un chemin, une propriété CSS ou une valeur — aucune
// collision par recollage. / NUL: impossible in a path, CSS property or
// value — no gluing collisions.
const SEP = String.fromCharCode(0);
const HEX_LENGTH = 16;

/** Chemins toujours en séparateurs POSIX, quel que soit l'OS producteur. */
export function normalizeFingerprintPath(file: string): string {
  return file.replace(/\\/g, '/');
}

function hashIdentity(identity: readonly string[], ordinal: number): string {
  return createHash('sha256')
    .update([FINGERPRINT_SCHEME, ...identity, String(ordinal)].join(SEP))
    .digest('hex')
    .slice(0, HEX_LENGTH);
}

/**
 * Hache une liste d'identités dans l'ordre du rapport, en suffixant chaque
 * doublon par son rang d'apparition (0, 1, 2…). / Hashes identities in report
 * order, suffixing duplicates with their occurrence rank.
 */
export function fingerprintAll(identities: readonly (readonly string[])[]): string[] {
  const seen = new Map<string, number>();
  return identities.map((identity) => {
    const key = identity.join(SEP);
    const ordinal = seen.get(key) ?? 0;
    seen.set(key, ordinal + 1);
    return hashIdentity(identity, ordinal);
  });
}

/**
 * Identité d'une dérive : où (fichier relatif), quoi (catégorie + propriété)
 * et la valeur fautive elle-même. Ni la sévérité ni la suggestion : elles
 * peuvent changer avec la config ou le set de tokens sans que la violation
 * bouge. / Drift identity: where (relative file), what (category + property)
 * and the offending value itself. Not severity nor suggestion: both can vary
 * with config or token set while the violation itself is unchanged.
 */
export function driftIdentity(issue: DriftIssue, relativeFile: string): readonly string[] {
  return [
    'drift',
    normalizeFingerprintPath(relativeFile),
    issue.category,
    issue.property,
    issue.value,
  ];
}

/**
 * Identité d'un constat RGAA : fichier relatif, critère et règle axe. Pas le
 * titre/description (localisés) ni les occurrences (les sélecteurs CSS
 * générés bougent trop). / RGAA finding identity: relative file, criterion
 * and axe rule. Not title/description (localized) nor occurrences (generated
 * CSS selectors are too unstable).
 */
export function rgaaIdentity(finding: RgaaFinding, relativeFile: string): readonly string[] {
  return ['rgaa', normalizeFingerprintPath(relativeFile), finding.criterion, finding.axeRuleId];
}
