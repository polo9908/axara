/**
 * Human-readable terminal rendering. Colors honour `NO_COLOR` and are dropped
 * when stdout is not a TTY (piped output stays clean).
 */

import { relative } from 'node:path';
import type { DriftIssue } from '@axaraaudit/core';
import type { AuditPayload } from './payload.js';
import { gradient, stdoutLevel } from '../ui/ansi.js';
import { BRAND } from '../ui/theme.js';

const useColor = process.stdout.isTTY === true && process.env['NO_COLOR'] === undefined;
const ESC = String.fromCharCode(27);
const paint =
  (code: string) =>
  (text: string): string =>
    useColor ? `${ESC}[${code}m${text}${ESC}[0m` : text;

export const bold = paint('1');
export const dim = paint('2');
export const red = paint('31');
export const green = paint('32');
export const yellow = paint('33');
export const cyan = paint('36');

const RULE = '─'.repeat(64);

function relPath(rootDir: string, file: string): string {
  const rel = relative(rootDir, file);
  return rel === '' || rel.startsWith('..') ? file : rel;
}

function renderDriftIssue(issue: DriftIssue): string {
  const pos = dim(`L${issue.line}:${issue.column}`);
  const value = issue.severity === 'error' ? red(issue.value) : yellow(issue.value);
  const target =
    issue.suggestion !== undefined
      ? ` → ${green(issue.suggestion.replacement)}`
      : ` ${dim('(aucun token proche)')}`;
  const badge = issue.autoFixable ? green(' [auto-fix]') : '';
  return `    ${pos}  ${dim(issue.property)}  ${value}${target}${badge}`;
}

export interface RenderPrettyOptions {
  /** `false` quand la révélation animée du score prend le relais (TTY). */
  readonly verdict?: boolean;
}

export function renderPretty(
  payload: AuditPayload,
  rootDir: string,
  options: RenderPrettyOptions = {},
): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(
    `  ${bold(gradient('AXARA AUDIT', BRAND.violet, BRAND.cyan, stdoutLevel))} ${dim('—')} ${bold(payload.project)}`,
  );
  lines.push(
    dim(
      `  ${payload.generatedAt} · ${payload.drift.summary.filesScanned} fichier(s) analysé(s)`,
    ),
  );
  lines.push(RULE);

  // — Design drift —
  lines.push(bold('  DESIGN SYSTEM'));
  if (payload.drift.issues.length === 0) {
    lines.push(green('    ✓ Aucune dérive détectée'));
  } else {
    const byFile = new Map<string, DriftIssue[]>();
    for (const issue of payload.drift.issues) {
      const list = byFile.get(issue.file) ?? [];
      list.push(issue);
      byFile.set(issue.file, list);
    }
    for (const [file, issues] of byFile) {
      lines.push(`  ${cyan(relPath(rootDir, file))}`);
      for (const issue of issues) lines.push(renderDriftIssue(issue));
    }
    const s = payload.drift.summary;
    lines.push(
      dim(
        `    ${s.totalIssues} dérive(s) — ${s.errors} erreur(s), ${s.warnings} avertissement(s), ${s.autoFixable} auto-fixable(s)`,
      ),
    );
  }

  // — RGAA —
  lines.push(RULE);
  lines.push(bold('  RGAA 4.1'));
  if (!payload.rgaa.enabled) {
    lines.push(dim('    (désactivé)'));
  } else if (payload.rgaa.findings.length === 0) {
    lines.push(green('    ✓ Aucune non-conformité détectée automatiquement'));
  } else {
    for (const finding of payload.rgaa.findings) {
      const mark = finding.status === 'failed' ? red('✖') : yellow('?');
      const impact = finding.impact === null ? 'à qualifier' : finding.impact;
      lines.push(
        `    ${mark} ${bold(finding.criterion)} ${finding.criterionTitle} ${dim(`(${impact})`)}`,
      );
      lines.push(
        dim(
          `       ${relPath(rootDir, finding.file)} · ${finding.occurrences.length} occurrence(s)`,
        ),
      );
    }
    const agg = payload.rgaa.aggregate;
    lines.push(
      dim(
        `    ${agg.criteriaFailed} critère(s) non conforme(s), ${agg.criteriaToReview} à vérifier manuellement`,
      ),
    );
  }

  // — Score & gate (omis quand la révélation animée prend le relais) —
  if (options.verdict !== false) {
    lines.push(RULE);
    const scoreColor = payload.score >= payload.gate.failUnder ? green : red;
    lines.push(`  ${bold('SCORE')}  ${scoreColor(bold(`${payload.score}/100`))}`);
    if (payload.gate.evaluated) {
      if (payload.gate.passed) {
        lines.push(green(bold('  GATE   PASSED')));
      } else {
        lines.push(red(bold('  GATE   FAILED')));
        for (const reason of payload.gate.reasons) lines.push(red(`    · ${reason}`));
      }
    }
  } else {
    lines.push(RULE);
  }
  lines.push('');
  return lines.join('\n');
}
