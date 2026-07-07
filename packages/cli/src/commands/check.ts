/**
 * `axaraaudit check <fichier...>` — targeted validation of specific files
 * (design drift + RGAA), without walking the whole project.
 *
 * Built for automation: editor save-hooks, AI-agent hooks (Claude Code
 * PostToolUse), pre-commit on staged files. `--format json` emits a stable,
 * compact machine contract; the exit code alone answers "may I ship this?".
 *
 * Exit codes: 0 conformant, 1 violations found, 2 configuration/usage error.
 */

import { parseArgs } from 'node:util';
import { checkFiles, type DriftIssue, type RgaaFinding } from '@axaraaudit/core';
import { ConfigError } from '../config/rc.js';
import { bold, cyan, dim, green, red, yellow } from '../report/render.js';
import { printTips, type Tip } from '../ui/tips.js';

export interface CheckFlags {
  readonly files: readonly string[];
  readonly config?: string;
  readonly tokens?: string;
  readonly format: 'pretty' | 'json';
  readonly skipRgaa: boolean;
}

export function parseCheckFlags(argv: readonly string[]): CheckFlags {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: {
      config: { type: 'string' },
      tokens: { type: 'string' },
      format: { type: 'string', default: 'pretty' },
      'skip-rgaa': { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });

  if (positionals.length === 0) {
    throw new ConfigError('check attend au moins un fichier : axaraaudit check src/App.tsx');
  }

  return {
    files: positionals,
    ...(values.config !== undefined ? { config: values.config } : {}),
    ...(values.tokens !== undefined ? { tokens: values.tokens } : {}),
    format: values.format === 'json' ? 'json' : 'pretty',
    skipRgaa: values['skip-rgaa'] ?? false,
  };
}

/** Stable JSON contract of a `check` run (consumed by hooks and agents). */
interface CheckPayload {
  readonly conformant: boolean;
  readonly summary: {
    readonly filesChecked: number;
    readonly filesSkipped: number;
    readonly driftIssues: number;
    readonly rgaaFailed: number;
    readonly rgaaToReview: number;
  };
  readonly files: readonly {
    readonly file: string;
    readonly skipped: boolean;
    readonly drift: readonly {
      readonly line: number;
      readonly column: number;
      readonly property: string;
      readonly value: string;
      readonly autoFixable: boolean;
      readonly replacement?: string;
    }[];
    readonly rgaa: readonly {
      readonly criterion: string;
      readonly title: string;
      readonly impact: string | null;
      readonly status: 'failed' | 'cantTell';
      readonly sample?: string;
    }[];
  }[];
}

const SAMPLE_MAX_CHARS = 160;

function compactDrift(issue: DriftIssue) {
  return {
    line: issue.line,
    column: issue.column,
    property: issue.property,
    value: issue.value,
    autoFixable: issue.autoFixable,
    ...(issue.suggestion !== undefined ? { replacement: issue.suggestion.replacement } : {}),
  };
}

function compactRgaa(finding: RgaaFinding) {
  return {
    criterion: finding.criterion,
    title: finding.criterionTitle,
    impact: finding.impact,
    status: finding.status,
    ...(finding.occurrences[0] !== undefined
      ? { sample: finding.occurrences[0].html.slice(0, SAMPLE_MAX_CHARS) }
      : {}),
  };
}

export async function runCheck(argv: readonly string[]): Promise<number> {
  const flags = parseCheckFlags(argv);

  const result = await checkFiles({
    cwd: process.cwd(),
    files: flags.files,
    configPath: flags.config,
    tokensPath: flags.tokens,
    skipRgaa: flags.skipRgaa,
  });

  const payload: CheckPayload = {
    conformant: result.conformant,
    summary: result.summary,
    files: result.files.map((file) => ({
      file: file.file,
      skipped: file.skipped,
      drift: file.drift.map(compactDrift),
      rgaa: file.rgaa.map(compactRgaa),
    })),
  };

  if (flags.format === 'json') {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return result.conformant ? 0 : 1;
  }

  // ── Pretty output ──
  const out = (text: string): void => {
    process.stdout.write(text);
  };
  out(`\n${bold(`  CHECK — ${result.summary.filesChecked} fichier(s)`)}\n\n`);
  for (const file of result.files) {
    if (file.skipped) {
      out(`  ${dim(`${file.file} (ignoré : extension non analysée ou fichier absent)`)}\n`);
      continue;
    }
    const clean = file.drift.length === 0 && file.rgaa.length === 0;
    out(`  ${cyan(file.file)}${clean ? green('  ✓') : ''}\n`);
    for (const finding of file.rgaa) {
      const mark = finding.status === 'failed' ? red('✖') : yellow('?');
      out(
        `    ${mark} RGAA ${finding.criterion} — ${finding.criterionTitle} ${dim(`(${finding.impact ?? 'impact inconnu'})`)}\n`,
      );
    }
    for (const issue of file.drift) {
      const suffix =
        issue.suggestion !== undefined ? ` → ${green(issue.suggestion.replacement)}` : '';
      out(`    ${yellow('≈')} ${dim(`L${issue.line}`)}  ${issue.property}: ${issue.value}${suffix}\n`);
    }
  }

  out('\n');
  if (result.conformant) {
    out(green('  ✓ Conforme — aucun drift, aucune violation RGAA bloquante.\n\n'));
    return 0;
  }
  const { driftIssues, rgaaFailed, rgaaToReview } = result.summary;
  out(
    red(
      `  ✖ ${rgaaFailed} violation(s) RGAA, ${driftIssues} drift(s)` +
        (rgaaToReview > 0 ? `, ${rgaaToReview} à vérifier manuellement` : '') +
        '\n',
    ),
  );
  out('\n');
  const tips: Tip[] = [];
  if (driftIssues > 0) {
    tips.push({ cmd: 'axaraaudit fix --write', why: 'corrige le drift (remplacements de tokens sûrs)' });
  }
  if (rgaaFailed > 0) {
    tips.push({
      cmd: 'axaraaudit fix --ai --write',
      why: 'le RGAA demande une correction dans le code — Claude peut la proposer',
    });
  }
  printTips(tips);
  return 1;
}
