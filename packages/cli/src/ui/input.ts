/**
 * Saisie de texte libre sur une ligne — zéro dépendance (node:readline).
 *
 * Réservée aux TTY interactifs : `canAskText()` fait foi, comme `canSelect()`.
 * Entrée vide ou Ctrl-C → null (l'appelant décide du repli).
 */

import { createInterface } from 'node:readline';
import { boldOn, paintFg, reset, stdoutLevel } from './ansi.js';
import { BRAND } from './theme.js';

export function canAskText(): boolean {
  return (
    process.stdin.isTTY === true && process.stdout.isTTY === true && process.env['CI'] === undefined
  );
}

/** Pose `prompt`, retourne la saisie trimée — null si vide ou interrompue. */
export function askText(prompt: string): Promise<string | null> {
  const level = stdoutLevel;
  const b = (t: string): string => (level === 'none' ? t : `${boldOn(level)}${t}${reset(level)}`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  return new Promise((resolveText) => {
    let settled = false;
    const finish = (value: string | null): void => {
      if (settled) return;
      settled = true;
      rl.close();
      resolveText(value);
    };
    rl.on('SIGINT', () => {
      process.stdout.write('\n');
      finish(null);
    });
    rl.question(`  ${paintFg('❯', BRAND.pink, level)} ${b(prompt)} `, (answer) => {
      const trimmed = answer.trim();
      finish(trimmed === '' ? null : trimmed);
    });
  });
}
