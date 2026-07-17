/**
 * `axaraaudit init` — configure le projet.
 *
 * Sur un TTY interactif : wizard guidé (détection du design system, choix
 * adaptés, porte de sortie RGAA-seul) — voir init-wizard.ts. En pipe/CI ou
 * avec `--yes` : scaffold silencieux du `.auditorrc.json` historique.
 */

import { existsSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { RC_FILENAME } from '../config/rc.js';
import { tr } from '../i18n.js';
import { dim, green, red } from '../report/render.js';
import { canSelect } from '../ui/select.js';
import { printTips } from '../ui/tips.js';
import { rcTemplate, runFromFigma, runFromTailwind, runInitWizard } from './init-wizard.js';

export async function runInit(argv: readonly string[]): Promise<number> {
  // `--from-tailwind` nu (sans valeur) = auto-détection : parseArgs exige une
  // valeur pour les options string, on injecte donc la forme `=`.
  const args = argv.map((arg, i) =>
    arg === '--from-tailwind' && (argv[i + 1] === undefined || argv[i + 1]!.startsWith('-'))
      ? '--from-tailwind='
      : arg,
  );
  const { values } = parseArgs({
    args,
    options: {
      force: { type: 'boolean', default: false },
      yes: { type: 'boolean', default: false },
      // `--from-tailwind` nu = auto-détection ; une valeur = chemin du config.
      'from-tailwind': { type: 'string' },
      'from-figma': { type: 'string' },
    },
    allowPositionals: true,
  });

  const cwd = process.cwd();
  const force = values.force === true;

  // Chemins scriptables : import direct, sans wizard (TTY ou non).
  if (values['from-tailwind'] !== undefined) {
    return runFromTailwind({ cwd, configPath: values['from-tailwind'], force });
  }
  if (values['from-figma'] !== undefined) {
    if (values['from-figma'] === '') {
      process.stderr.write(
        red(
          tr(
            '--from-figma attend une URL ou une clé de fichier Figma.\n',
            '--from-figma expects a Figma file URL or key.\n',
          ),
        ),
      );
      return 2;
    }
    return runFromFigma({ cwd, ref: values['from-figma'], force });
  }

  if (canSelect() && values.yes !== true) {
    return runInitWizard({ cwd, force });
  }

  const target = resolve(cwd, RC_FILENAME);
  if (existsSync(target) && values.force !== true) {
    process.stderr.write(
      red(
        tr(
          `${RC_FILENAME} existe déjà. Utilisez --force pour l'écraser.\n`,
          `${RC_FILENAME} already exists. Use --force to overwrite it.\n`,
        ),
      ),
    );
    return 2;
  }

  writeFileSync(target, rcTemplate(basename(cwd), './design-tokens.dtcg.json'), 'utf8');
  process.stdout.write(green(tr(`✓ ${RC_FILENAME} créé.\n`, `✓ ${RC_FILENAME} created.\n`)));
  process.stdout.write(
    dim(
      tr(
        'Adaptez "tokens" au chemin de votre fichier DTCG.\n',
        'Point "tokens" at the path of your DTCG file.\n',
      ),
    ),
  );
  printTips([
    {
      cmd: 'axaraaudit audit',
      why: tr(
        'votre premier rapport avec cette configuration',
        'your first report with this configuration',
      ),
    },
    {
      cmd: 'axaraaudit help audit',
      why: tr(
        'toutes les options d\'audit (CI, HTML, seuil…)',
        'all audit options (CI, HTML, threshold…)',
      ),
    },
  ]);
  return 0;
}
