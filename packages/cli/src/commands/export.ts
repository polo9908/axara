/**
 * `axaraaudit export [rapport.json]` — le rapport d'audit en PDF partageable.
 *
 * Deux modes, comme `push` : avec un rapport JSON existant (`--format json`
 * produit plus tôt, artefact CI), il est validé puis converti ; sans argument,
 * un audit frais est lancé. Le PDF est autonome (polices standard, zéro
 * réseau) — prêt pour un client, un ticket ou une déclaration.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { auditProject, type AuditPayload } from '@axaraaudit/core';
import { loadRc, ConfigError } from '../config/rc.js';
import { tr } from '../i18n.js';
import { validateAuditPayload } from './push.js';
import { renderPdf } from '../report/pdf.js';
import { createSpinner } from '../ui/spinner.js';
import { printTips } from '../ui/tips.js';
import { green, dim } from '../report/render.js';
import { CLI_NAME, CLI_VERSION } from '../version.js';
import { CLOUD_ENABLED } from '../cloud.js';

export interface ExportFlags {
  /** Rapport JSON existant ; sinon audit frais. */
  readonly file?: string;
  readonly out: string;
  readonly config?: string;
  readonly skipRgaa: boolean;
}

export function parseExportFlags(argv: readonly string[]): ExportFlags {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: {
      out: { type: 'string' },
      config: { type: 'string' },
      'skip-rgaa': { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });
  const file = positionals[0];
  const out = values.out ?? tr('rapport-axaraaudit.pdf', 'axaraaudit-report.pdf');
  if (!out.toLowerCase().endsWith('.pdf')) {
    throw new ConfigError(
      tr(`--out doit se terminer par .pdf (reçu : ${out})`, `--out must end with .pdf (got: ${out})`),
    );
  }
  return {
    ...(file !== undefined ? { file } : {}),
    out,
    ...(values.config !== undefined ? { config: values.config } : {}),
    skipRgaa: values['skip-rgaa'] ?? false,
  };
}

export async function runExport(argv: readonly string[]): Promise<number> {
  const flags = parseExportFlags(argv);
  const cwd = process.cwd();

  let payload: AuditPayload;
  if (flags.file !== undefined) {
    let raw: string;
    try {
      raw = readFileSync(flags.file, 'utf8');
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new ConfigError(
        tr(`Rapport illisible (${flags.file}) : ${reason}`, `Cannot read report (${flags.file}): ${reason}`),
      );
    }
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new ConfigError(tr(`${flags.file} n'est pas du JSON valide.`, `${flags.file} is not valid JSON.`));
    }
    payload = validateAuditPayload(data, flags.file);
  } else {
    const loaded = loadRc(cwd, flags.config);
    const spinner = createSpinner(
      tr('Audit avant export (design-system + RGAA)…', 'Auditing before export (design system + RGAA)…'),
    );
    spinner.start();
    try {
      const result = await auditProject({
        cwd,
        tool: CLI_NAME,
        toolVersion: CLI_VERSION,
        loaded,
        skipRgaa: flags.skipRgaa,
        ciMode: false,
      });
      payload = result.payload;
    } catch (error) {
      spinner.fail(tr('Audit interrompu', 'Audit aborted'));
      throw error;
    }
    spinner.succeed(
      tr(`Audit terminé — score ${payload.score}/100`, `Audit complete — score ${payload.score}/100`),
    );
  }

  const pdf = renderPdf(payload);
  try {
    writeFileSync(flags.out, pdf);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
      throw new ConfigError(
        tr(
          `Impossible d'écrire ${flags.out} — le fichier est probablement ouvert dans une visionneuse PDF. Fermez-le et réessayez, ou choisissez une autre destination avec --out.`,
          `Cannot write ${flags.out} — the file is likely open in a PDF viewer. Close it and try again, or pick another destination with --out.`,
        ),
      );
    }
    throw error;
  }
  process.stdout.write(
    green(tr(`✓ Rapport PDF écrit : ${flags.out}\n`, `✓ PDF report written: ${flags.out}\n`)),
  );
  process.stdout.write(
    dim(
      tr(
        `  ${Math.round(pdf.length / 1024)} Ko · score ${payload.score}/100 · ${payload.drift.issues.length} dérive(s) · ${payload.rgaa.aggregate.totalFindings} constat(s) RGAA\n`,
        `  ${Math.round(pdf.length / 1024)} KB · score ${payload.score}/100 · ${payload.drift.issues.length} drift(s) · ${payload.rgaa.aggregate.totalFindings} RGAA finding(s)\n`,
      ),
    ),
  );
  printTips([
    {
      cmd: 'axaraaudit fix --write',
      why: tr('applique les corrections sûres avant de partager', 'apply the safe fixes before sharing'),
    },
    // `push` : suggéré seulement quand Axara Cloud est actif (voir cloud.ts).
    ...(CLOUD_ENABLED
      ? [
          {
            cmd: 'axaraaudit push',
            why: tr('publie aussi le rapport sur le dashboard Pro', 'also publish the report to the Pro dashboard'),
          },
        ]
      : []),
  ]);
  return 0;
}
