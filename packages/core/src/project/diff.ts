/**
 * Diff de deux rapports d'audit par empreintes stables — le cœur du
 * commentaire de PR : montrer uniquement ce qui change entre la branche de
 * base et la branche courante, jamais la liste complète.
 * Fingerprint-based diff of two audit payloads — the heart of the PR
 * comment: show only what changes between the base branch and the current
 * branch, never the full list.
 *
 * Les violations couvertes par une exception justifiée sont absentes des
 * payloads (voir exceptions.ts) : le diff les ignore naturellement.
 */

import type { AuditPayload } from './payload.js';

export interface DiffEntry {
  readonly kind: 'drift' | 'rgaa';
  readonly fingerprint: string;
  /** Chemin relatif POSIX. */
  readonly file: string;
  /** Libellé court : `propriété: valeur` (drift) ou `critère · règle axe` (rgaa). */
  readonly label: string;
  /** Sévérité drift (`error`/`warning`) ou impact axe (`critical`…, `à vérifier`). */
  readonly severity: string;
  /** Statut RGAA (`failed`/`cantTell`) — absent pour le drift. */
  readonly status?: string;
}

export interface AuditDiff {
  /** Violations présentes dans head mais pas dans base. */
  readonly added: readonly DiffEntry[];
  /** Violations présentes dans base mais plus dans head. */
  readonly fixed: readonly DiffEntry[];
  /** Violations présentes des deux côtés. */
  readonly persistent: readonly DiffEntry[];
  readonly base: { readonly score: number; readonly generatedAt: string };
  readonly head: {
    readonly score: number;
    readonly generatedAt: string;
    readonly gate: AuditPayload['gate'];
  };
}

function entriesOf(payload: AuditPayload): Map<string, DiffEntry> {
  const entries = new Map<string, DiffEntry>();
  for (const issue of payload.drift.issues) {
    entries.set(issue.fingerprint, {
      kind: 'drift',
      fingerprint: issue.fingerprint,
      file: issue.file.replace(/\\/g, '/'),
      label: `${issue.property}: ${issue.value}`,
      severity: issue.severity,
    });
  }
  for (const finding of payload.rgaa.findings) {
    entries.set(finding.fingerprint, {
      kind: 'rgaa',
      fingerprint: finding.fingerprint,
      file: finding.file.replace(/\\/g, '/'),
      label: `RGAA ${finding.criterion} · ${finding.axeRuleId}`,
      severity: finding.impact ?? 'unknown',
      status: finding.status,
    });
  }
  return entries;
}

/** Ordre d'affichage : les plus graves d'abord, puis par fichier (stable). */
const SEVERITY_RANK: Readonly<Record<string, number>> = {
  critical: 0,
  serious: 1,
  error: 2,
  moderate: 3,
  unknown: 3,
  warning: 4,
  minor: 4,
};

function bySeverityThenFile(a: DiffEntry, b: DiffEntry): number {
  const rank = (SEVERITY_RANK[a.severity] ?? 5) - (SEVERITY_RANK[b.severity] ?? 5);
  if (rank !== 0) return rank;
  return a.file < b.file ? -1 : a.file > b.file ? 1 : 0;
}

export function diffAuditPayloads(base: AuditPayload, head: AuditPayload): AuditDiff {
  const baseEntries = entriesOf(base);
  const headEntries = entriesOf(head);

  const added: DiffEntry[] = [];
  const persistent: DiffEntry[] = [];
  for (const [fingerprint, entry] of headEntries) {
    if (baseEntries.has(fingerprint)) persistent.push(entry);
    else added.push(entry);
  }
  const fixed = [...baseEntries.values()].filter((e) => !headEntries.has(e.fingerprint));

  return {
    added: added.sort(bySeverityThenFile),
    fixed: fixed.sort(bySeverityThenFile),
    persistent: persistent.sort(bySeverityThenFile),
    base: { score: base.score, generatedAt: base.generatedAt },
    head: { score: head.score, generatedAt: head.generatedAt, gate: head.gate },
  };
}
