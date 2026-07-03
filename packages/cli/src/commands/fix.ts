/**
 * `axaraaudit fix` — apply the fixes found by the drift analyzer.
 *
 * Dry-run by default; `--write` persists. Two levels:
 * - default: only exact-token matches (100% safe, position-verified);
 * - `--all` : also apply nearest-token suggestions whose confidence is at
 *   least `--min-confidence` (default 0.7).
 *
 * The report is exhaustive: everything NOT applied is listed with the reason
 * (near suggestion needing --all, no close token, RGAA out of scope), so the
 * user always knows what remains manual.
 */

import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { parseArgs } from 'node:util';
import { auditSources, fixFile, type DriftIssue, type SourceFile } from '@axaraaudit/core';
import { ConfigError, loadRc, resolveTokensPath } from '../config/rc.js';
import { collectFiles } from '../scan/walk.js';
import { bold, cyan, dim, green, red, yellow } from '../report/render.js';

export async function runFix(argv: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      config: { type: 'string' },
      tokens: { type: 'string' },
      write: { type: 'boolean', default: false },
      all: { type: 'boolean', default: false },
      'min-confidence': { type: 'string' },
    },
    allowPositionals: true,
  });
  const write = values.write ?? false;
  const all = values.all ?? false;

  const rawConfidence = values['min-confidence'];
  const minConfidence = rawConfidence === undefined ? 0.7 : Number(rawConfidence);
  if (Number.isNaN(minConfidence) || minConfidence < 0 || minConfidence > 1) {
    throw new ConfigError(`--min-confidence doit être un nombre entre 0 et 1 (reçu: ${rawConfidence}).`);
  }

  const loaded = loadRc(process.cwd(), values.config);
  const tokensJson = readFileSync(resolveTokensPath(loaded, values.tokens), 'utf8').replace(/^﻿/, '');
  const filePaths = collectFiles(
    loaded.rootDir,
    loaded.rc.include,
    loaded.rc.exclude,
    loaded.rc.extensions,
  );
  const files: SourceFile[] = filePaths.map((path) => ({
    path,
    content: readFileSync(path, 'utf8'),
  }));

  const report = auditSources(tokensJson, files, { remBasePx: loaded.rc.remBasePx });

  const byFile = new Map<string, DriftIssue[]>();
  for (const issue of report.issues) {
    const list = byFile.get(issue.file) ?? [];
    list.push(issue);
    byFile.set(issue.file, list);
  }

  const rel = (path: string): string => relative(loaded.rootDir, path);
  const out = (text: string): void => {
    process.stdout.write(text);
  };

  out(`\n${bold(write ? '  AUTO-FIX — ÉCRITURE' : '  AUTO-FIX — PRÉVISUALISATION (dry-run)')}`);
  out(all ? dim(`  (mode --all, confiance ≥ ${minConfidence})\n\n`) : '\n\n');

  let totalApplied = 0;
  const appliedKeys = new Set<string>();
  for (const [path, issues] of byFile) {
    const result = fixFile(path, issues, {
      dryRun: !write,
      onlyAutoFixable: !all,
      minConfidence,
    });
    totalApplied += result.applied.length;
    if (result.applied.length === 0) continue;

    out(`  ${cyan(rel(path))}\n`);
    for (const fix of result.applied) {
      appliedKeys.add(`${path}:${fix.line}:${fix.column}`);
      out(`    ${green('✓')} ${dim(`L${fix.line}`)}  ${fix.from} → ${green(fix.to)}\n`);
    }
  }
  if (totalApplied === 0) out(dim('  (aucune correction automatique applicable)\n'));

  // ── Exhaustive remainder: everything the fix did NOT handle ──
  const remaining = report.issues.filter(
    (issue) => !appliedKeys.has(`${issue.file}:${issue.line}:${issue.column}`),
  );
  const nearMisses = remaining.filter((issue) => issue.match === 'nearest-token');
  const noToken = remaining.filter((issue) => issue.match === 'no-token');
  const other = remaining.filter(
    (issue) => issue.match !== 'nearest-token' && issue.match !== 'no-token',
  );

  if (remaining.length > 0) {
    out(`\n${bold('  NON CORRIGÉ')} ${dim(`(${remaining.length})`)}\n`);
    if (nearMisses.length > 0) {
      out(yellow(`  Valeurs proches d'un token — vérifiez puis relancez avec --all :\n`));
      for (const issue of nearMisses) {
        const s = issue.suggestion;
        out(
          `    ${yellow('≈')} ${dim(`${rel(issue.file)}:L${issue.line}`)}  ${issue.value} → ${
            s !== undefined ? `${s.replacement} ${dim(`(confiance ${s.confidence})`)}` : ''
          }\n`,
        );
      }
    }
    if (noToken.length > 0) {
      out(red(`  Aucun token proche — décision manuelle (ou ajoutez un token) :\n`));
      for (const issue of noToken) {
        out(`    ${red('✖')} ${dim(`${rel(issue.file)}:L${issue.line}`)}  ${issue.property}: ${issue.value}\n`);
      }
    }
    if (other.length > 0) {
      out(dim(`  ${other.length} correction(s) sûres non appliquées (source modifiée entre-temps ?)\n`));
    }
  }

  out(`\n  ${green(String(totalApplied))} correction(s) ${write ? 'appliquée(s)' : 'applicable(s)'}`);
  out(`, ${String(remaining.length)} restante(s) à traiter manuellement\n`);
  if (!write && totalApplied > 0) {
    out(dim('  Relancez avec --write pour appliquer.\n'));
  }
  if (!all && nearMisses.length > 0) {
    out(dim('  Ajoutez --all pour inclure les suggestions proches (--min-confidence pour ajuster le seuil).\n'));
  }
  out(dim('  Rappel : les non-conformités RGAA (alt, labels, titres…) ne sont pas auto-corrigeables — voir `axaraaudit audit`.\n'));
  out('\n');
  return 0;
}
