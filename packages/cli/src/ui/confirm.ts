/**
 * Confirmation oui/non à une touche — zéro dépendance (mode raw de stdin).
 *
 * Réservée aux TTY interactifs : ailleurs (pipe, CI), l'appelant ne doit pas
 * la proposer — `canConfirm()` fait foi. Réponse par défaut : non (Entrée,
 * Échap ou Ctrl-C refusent) ; `o`/`y` acceptent, quelle que soit la langue.
 */

import { boldOn, paintFg, reset, stdoutLevel } from './ansi.js';
import { BRAND } from './theme.js';
import { tr } from '../i18n.js';

const ESC = '';
const CTRL_C = '';

export function canConfirm(): boolean {
  return (
    process.stdin.isTTY === true && process.stdout.isTTY === true && process.env['CI'] === undefined
  );
}

/** Pose `question`, retourne true sur o/O/y/Y — false sur tout le reste. */
export function confirmYesNo(question: string): Promise<boolean> {
  const level = stdoutLevel;
  const b = (t: string): string => (level === 'none' ? t : `${boldOn(level)}${t}${reset(level)}`);
  const stdin = process.stdin;

  process.stdout.write(
    `  ${paintFg('❯', BRAND.pink, level)} ${b(question)} ${paintFg(tr('(o/N)', '(y/N)'), BRAND.slate, level)} `,
  );

  return new Promise((resolveAnswer) => {
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    const onKey = (key: string): void => {
      // Une seule touche suffit ; Entrée/Échap/Ctrl-C = réponse par défaut (non).
      stdin.off('data', onKey);
      stdin.setRawMode(false);
      stdin.pause();
      const yes = key === 'o' || key === 'O' || key === 'y' || key === 'Y';
      const echo = yes ? tr('oui', 'yes') : tr('non', 'no');
      process.stdout.write(`${paintFg(echo, yes ? BRAND.green : BRAND.slate, level)}\n`);
      if (key === CTRL_C || key === ESC) {
        resolveAnswer(false);
        return;
      }
      resolveAnswer(yes);
    };

    stdin.on('data', onKey);
  });
}
