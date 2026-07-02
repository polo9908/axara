/**
 * `axaraaudit fix` — apply the safe auto-fixes found by the drift analyzer.
 * Dry-run by default; `--write` persists. Reuses the position-verified
 * `fixFile` from @axaraaudit/core (exact-token matches only).
 */

import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { parseArgs } from 'node:util';
import { auditSources, fixFile, type DriftIssue, type SourceFile } from '@axaraaudit/core';
import { loadRc, resolveTokensPath } from '../config/rc.js';
import { collectFiles } from '../scan/walk.js';
import { bold, cyan, dim, green, yellow } from '../report/render.js';

export async function runFix(argv: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      config: { type: 'string' },
      tokens: { type: 'string' },
      write: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });
  const write = values.write ?? false;

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

  process.stdout.write(
    `\n${bold(write ? '  AUTO-FIX — ÉCRITURE' : '  AUTO-FIX — PRÉVISUALISATION (dry-run)')}\n\n`,
  );

  let totalApplied = 0;
  let totalSkipped = 0;
  for (const [path, issues] of byFile) {
    const result = fixFile(path, issues, { dryRun: !write });
    totalApplied += result.applied.length;
    totalSkipped += result.skipped.length;
    if (result.applied.length === 0) continue;

    process.stdout.write(`  ${cyan(relative(loaded.rootDir, path))}\n`);
    for (const fix of result.applied) {
      process.stdout.write(
        `    ${green('✓')} ${dim(`L${fix.line}`)}  ${fix.from} → ${green(fix.to)}\n`,
      );
    }
  }

  process.stdout.write(
    `\n  ${green(String(totalApplied))} correction(s) ${write ? 'appliquée(s)' : 'applicable(s)'}` +
      `, ${yellow(String(totalSkipped))} ignorée(s) ${dim('(non auto-fixables)')}\n`,
  );
  if (!write && totalApplied > 0) {
    process.stdout.write(dim('  Relancez avec --write pour appliquer.\n'));
  }
  process.stdout.write('\n');
  return 0;
}
