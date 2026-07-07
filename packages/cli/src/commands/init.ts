/**
 * `axaraaudit init` — scaffold a commented `.auditorrc.json` in the current
 * directory so teams start from a working baseline.
 */

import { existsSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { RC_FILENAME } from '../config/rc.js';
import { dim, green, red } from '../report/render.js';
import { printTips } from '../ui/tips.js';

const TEMPLATE = (project: string): string =>
  `${JSON.stringify(
    {
      project,
      tokens: './design-tokens.dtcg.json',
      include: ['src', 'components', 'styles'],
      exclude: ['node_modules', 'dist', 'build', '.next'],
      extensions: ['.css', '.scss', '.tsx', '.jsx', '.html'],
      remBasePx: 16,
      rgaa: {
        enabled: true,
        scope: 'component',
        contrast: false,
        priority: ['1.1', '3.2', '11.1'],
      },
      ci: {
        failUnder: 80,
        blockOnCritical: true,
      },
      pro: {
        apiUrl: 'https://api.axara.dev',
        upload: false,
        remoteConfig: false,
      },
    },
    null,
    2,
  )}\n`;

export function runInit(argv: readonly string[]): number {
  const { values } = parseArgs({
    args: [...argv],
    options: { force: { type: 'boolean', default: false } },
    allowPositionals: true,
  });

  const cwd = process.cwd();
  const target = resolve(cwd, RC_FILENAME);
  if (existsSync(target) && values.force !== true) {
    process.stderr.write(red(`${RC_FILENAME} existe déjà. Utilisez --force pour l'écraser.\n`));
    return 2;
  }

  writeFileSync(target, TEMPLATE(basename(cwd)), 'utf8');
  process.stdout.write(green(`✓ ${RC_FILENAME} créé.\n`));
  process.stdout.write(dim('Adaptez "tokens" au chemin de votre fichier DTCG.\n'));
  printTips([
    { cmd: 'axaraaudit audit', why: 'votre premier rapport avec cette configuration' },
    { cmd: 'axaraaudit help audit', why: 'toutes les options d\'audit (CI, HTML, seuil…)' },
  ]);
  return 0;
}
