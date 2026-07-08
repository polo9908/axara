/**
 * Langue de l'interface — bascule FR/EN de toute la sortie du CLI.
 *
 * Résolution (du plus prioritaire au moins) :
 *   1. flag global `--lang fr|en` (lu directement sur process.argv, car les
 *      catalogues de messages sont évalués à l'import des modules) ;
 *   2. variable d'environnement `AXARA_LANG=fr|en` ;
 *   3. locale système (LC_ALL / LANG sur POSIX, Intl sinon — Windows inclus).
 * Tout ce qui ne commence pas par « fr » tombe sur l'anglais.
 *
 * Usage : `tr('texte français', 'english text')` — le français d'abord,
 * partout, pour rester cohérent avec le code existant.
 */

function detect(): 'fr' | 'en' {
  const argv = process.argv;
  const at = argv.indexOf('--lang');
  const fromFlag =
    at >= 0 ? argv[at + 1] : argv.find((a) => a.startsWith('--lang='))?.slice('--lang='.length);
  const fromEnv = process.env['AXARA_LANG'];
  // Intl reflète la vraie locale de l'OS ; LANG/LC_ALL ne servent que de
  // secours (sous Windows, un LANG=en_US hérité de Git Bash est fréquent
  // et ne dit rien de la langue réelle de l'utilisateur).
  let system: string | undefined;
  try {
    system = Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    system = process.env['LC_ALL'] ?? process.env['LANG'];
  }
  const raw = (fromFlag ?? fromEnv ?? system ?? 'en').toLowerCase();
  return raw.startsWith('fr') ? 'fr' : 'en';
}

export const LANG: 'fr' | 'en' = detect();

// Propage la langue résolue (y compris `--lang`) au moteur @axaraaudit/core
// (qui lit AXARA_LANG paresseusement) et aux éventuels processus enfants.
process.env['AXARA_LANG'] = LANG;

/** Sélectionne la variante dans la langue active. */
export function tr(fr: string, en: string): string {
  return LANG === 'fr' ? fr : en;
}

/**
 * Retire `--lang <valeur>` / `--lang=<valeur>` d'un argv — le flag est global
 * et déjà consommé ici ; les parseArgs des commandes ne doivent pas le voir.
 */
export function stripLangFlag(argv: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === '--lang') {
      i += 1; // saute aussi la valeur
      continue;
    }
    if (arg.startsWith('--lang=')) continue;
    out.push(arg);
  }
  return out;
}
