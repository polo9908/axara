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
import { runFix } from './commands/fix.js';
import { runInit } from './commands/init.js';
import { runLogin, runLogout, runWhoami } from './commands/login.js';
import { CLI_NAME, CLI_VERSION } from './version.js';

const HELP = `
${CLI_NAME} v${CLI_VERSION} — audit design-system + RGAA 4.1

USAGE
  ${CLI_NAME} <commande> [options]

COMMANDES (open source)
  audit          Analyse le projet (défaut) : dérives de tokens + RGAA
  fix            Applique les corrections sûres (--write pour persister)
                 --all applique aussi les suggestions proches
                 (--min-confidence <0..1>, défaut 0.7)
  init           Génère un .auditorrc.json de démarrage

COMMANDES (passerelle Pro)
  login          Enregistre un jeton d'accès (--token <jeton>)
  logout         Supprime le jeton enregistré
  whoami         Affiche l'identité liée au jeton

OPTIONS D'AUDIT
  --config <chemin>     Fichier .auditorrc.json explicite
  --tokens <chemin>     Fichier de tokens DTCG (bypass de la config)
  --format pretty|json  Format de sortie (défaut : pretty)
  --out <fichier>       Écrit aussi le rapport JSON dans un fichier
  --ci                  Mode gatekeeper : exit 1 si le gate échoue
  --fail-under <n>      Seuil de score local (défaut : config ou 80)
  --skip-rgaa           Ne lance que l'analyse de dérive design
  --remote              Récupère règles/tokens depuis l'API (jeton requis)
  --upload              Envoie le rapport JSON à l'API (jeton requis)

ENVIRONNEMENT
  AUDITOR_TOKEN         Jeton Pro (prioritaire sur \`login\`, idéal en CI)

CODES DE SORTIE
  0  audit terminé (gate OK ou mode non-CI)
  1  gate CI échoué (score sous le seuil ou critère bloquant)
  2  erreur de configuration ou d'usage
`;

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const first = argv[0];

  if (first === '--version' || first === '-v') {
    process.stdout.write(`${CLI_VERSION}\n`);
    return 0;
  }
  if (first === undefined || first === 'help' || first === '--help' || first === '-h') {
    process.stdout.write(HELP);
    return 0;
  }

  // `axaraaudit --ci` (sans sous-commande) ≡ `axaraaudit audit --ci`
  const [command, rest] = first.startsWith('-')
    ? (['audit', argv] as const)
    : ([first, argv.slice(1)] as const);

  switch (command) {
    case 'audit':
      return runAudit(rest);
    case 'fix':
      return runFix(rest);
    case 'init':
      return runInit(rest);
    case 'login':
      return runLogin(rest);
    case 'logout':
      return runLogout();
    case 'whoami':
      return runWhoami();
    default:
      process.stderr.write(`Commande inconnue : ${command}\n${HELP}`);
      return 2;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    if (error instanceof ConfigError || error instanceof ApiError) {
      process.stderr.write(`Erreur : ${error.message}\n`);
      process.exitCode = 2;
    } else {
      process.stderr.write(`Erreur inattendue : ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      process.exitCode = 2;
    }
  });
