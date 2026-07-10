#!/usr/bin/env node
/**
 * axaraaudit — open-core CLI entry point.
 *
 * Open source : audit, fix, init (local, aucune donnée ne quitte la machine).
 * Pro gateway : login/logout/whoami, --remote (pull des règles), --upload
 * (push du rapport), --ci (gatekeeper de pipeline).
 */

import { ConfigError } from './config/rc.js';
import { ApiError } from './services/api.js';
import { runAudit } from './commands/audit.js';
import { runCheck } from './commands/check.js';
import { runFix } from './commands/fix.js';
import { runVoice } from './commands/voice.js';
import { runBlame, runHistory } from './commands/history.js';
import { runRoast } from './commands/roast.js';
import { runHello } from './commands/hello.js';
import { runInit } from './commands/init.js';
import { runLogin, runLogout, runWhoami } from './commands/login.js';
import { runPush } from './commands/push.js';
import { runCompletion } from './commands/completion.js';
import { runSettings } from './commands/settings.js';
import { runExport } from './commands/export.js';
import { didYouMean, findCommand, renderCommandHelp, renderHelp, runHelp } from './commands/help.js';
import { paletteAvailable, runPalette } from './ui/palette.js';
import { maybeNotifyUpdate } from './ui/update-check.js';
import { CLI_VERSION } from './version.js';
import { stripLangFlag, tr } from './i18n.js';
import { existsSync } from 'node:fs';
import { RC_FILENAME } from './config/rc.js';

async function dispatch(command: string, rest: readonly string[]): Promise<number> {
  // `axaraaudit <commande> --help` : aide ciblée avant que parseArgs ne
  // rejette l'option inconnue.
  if (rest.includes('--help') || rest.includes('-h')) {
    const spec = findCommand(command);
    if (spec !== undefined) {
      process.stdout.write(renderCommandHelp(spec));
      return 0;
    }
  }

  switch (command) {
    case 'audit':
      return runAudit(rest);
    case 'check':
      return runCheck(rest);
    case 'fix':
      return runFix(rest);
    case 'voice':
      return runVoice(rest);
    case 'history':
      return runHistory(rest);
    case 'blame':
      return runBlame(rest);
    case 'roast':
      return runRoast(rest);
    case 'init':
      return runInit(rest);
    case 'hello':
      return runHello(rest);
    case 'push':
      return runPush(rest);
    case 'login':
      return runLogin(rest);
    case 'logout':
      return runLogout();
    case 'whoami':
      return runWhoami();
    case 'completion':
      return runCompletion(rest);
    case 'settings':
    case 'config': // alias — mémoire musculaire git/npm
      return runSettings(rest);
    case 'export':
      return runExport(rest);
    default: {
      const suggestion = didYouMean(command);
      const hint =
        suggestion !== undefined
          ? tr(` — vouliez-vous dire \`axaraaudit ${suggestion}\` ?`, ` — did you mean \`axaraaudit ${suggestion}\`?`)
          : '';
      process.stderr.write(`${tr('Commande inconnue', 'Unknown command')}: ${command}${hint}\n`);
      process.stdout.write(renderHelp());
      return 2;
    }
  }
}

async function main(): Promise<number> {
  // `--lang fr|en` est global, résolu par i18n.ts à l'import — on le retire
  // pour que les parseArgs des commandes ne le rejettent pas.
  const argv = stripLangFlag(process.argv.slice(2));
  const first = argv[0];

  if (first === '--version' || first === '-v') {
    process.stdout.write(`${CLI_VERSION}\n`);
    return 0;
  }
  // Sans argument (ou avec `/filtre`, mémoire musculaire Claude Code) :
  // palette interactive sur TTY, aide statique sinon (pipes, CI).
  // La palette boucle comme une session : après chaque commande on y
  // revient, Échap/Ctrl-C termine (avec le code de la dernière commande).
  if (first === undefined || first.startsWith('/')) {
    if (paletteAvailable()) {
      // Projet déjà configuré → `audit` présélectionné, Entrée suffit.
      const paletteOpts = existsSync(RC_FILENAME)
        ? {
            preselect: 'audit',
            hint: tr(
              `${RC_FILENAME} détecté — Entrée lance l'audit`,
              `${RC_FILENAME} detected — Enter runs the audit`,
            ),
          }
        : {};
      let query = first ?? '';
      let lastCode = 0;
      for (;;) {
        const pick = await runPalette(query, paletteOpts);
        if (pick === null) return lastCode;
        lastCode = await dispatch(pick, []);
        query = '';
        process.stdout.write('\n');
      }
    }
    process.stdout.write(renderHelp());
    return 0;
  }
  if (first === '--help' || first === '-h') {
    process.stdout.write(renderHelp());
    return 0;
  }
  if (first === 'help') {
    return runHelp(argv.slice(1));
  }

  // `axaraaudit --ci` (sans sous-commande) ≡ `axaraaudit audit --ci`
  const [command, rest] = first.startsWith('-')
    ? (['audit', argv] as const)
    : ([first, argv.slice(1)] as const);
  return dispatch(command, rest);
}

main()
  .then((code) => {
    maybeNotifyUpdate();
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    if (error instanceof ConfigError || error instanceof ApiError) {
      process.stderr.write(`${tr('Erreur', 'Error')} : ${error.message}\n`);
      process.exitCode = 2;
    } else {
      process.stderr.write(`${tr('Erreur inattendue', 'Unexpected error')} : ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      process.exitCode = 2;
    }
  });
