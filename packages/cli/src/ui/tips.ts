/**
 * Tips contextuels — le bloc « ET MAINTENANT ? » affiché en fin de commande.
 *
 * Chaque commande propose 1 à 3 prochaines étapes, choisies d'après son
 * résultat (drift trouvé → `fix`, violations RGAA → `fix --ai` + `voice`
 * sur le vrai fichier fautif…). Les commandes sont prêtes à copier-coller.
 *
 * Jamais affiché hors TTY (pipes, CI, --format json) ni si AXARA_NO_TIPS
 * est défini : le bloc guide l'humain, pas les machines.
 */

import { boldOn, paintFg, reset, stdoutLevel, type ColorLevel } from './ansi.js';
import { BRAND } from './theme.js';
import { tr } from '../i18n.js';

export interface Tip {
  /** Commande prête à copier, ex. `axaraaudit fix --write`. */
  readonly cmd: string;
  /** Pourquoi / ce que ça fait, en une demi-ligne. */
  readonly why: string;
}

/**
 * Le bloc ne s'affiche qu'en interactif : TTY, hors CI, hors AXARA_NO_TIPS.
 * `AXARA_COLOR=always` force l'affichage hors TTY (captures, tests) — même
 * convention que le moteur ANSI.
 */
export function tipsEnabled(): boolean {
  if (process.env['AXARA_NO_TIPS'] !== undefined) return false;
  if (process.env['AXARA_COLOR'] === 'always') return true;
  return process.stdout.isTTY === true && process.env['CI'] === undefined;
}

/**
 * Rend le bloc « ET MAINTENANT ? ». Retourne '' si tips vide.
 * L'appelant garde la main sur le flux (stdout) et sur l'opportunité
 * d'afficher (typiquement `if (tipsEnabled()) …`).
 */
export function renderTips(tips: readonly Tip[], level: ColorLevel = stdoutLevel): string {
  if (tips.length === 0) return '';
  const b = (t: string): string => (level === 'none' ? t : `${boldOn(level)}${t}${reset(level)}`);
  const cmdWidth = Math.max(...tips.map((t) => t.cmd.length));
  const lines: string[] = [];
  lines.push(`  ${paintFg('✦', BRAND.violet, level)} ${b(tr('ET MAINTENANT ?', 'WHAT NEXT?'))}`);
  for (const tip of tips) {
    const cmd = paintFg(tip.cmd.padEnd(cmdWidth), BRAND.cyan, level);
    lines.push(`    ${paintFg('▸', BRAND.pink, level)} ${cmd}  ${paintFg(tip.why, BRAND.slate, level)}`);
  }
  return `\n${lines.join('\n')}\n\n`;
}

/** Raccourci : écrit le bloc sur stdout si le contexte s'y prête. */
export function printTips(tips: readonly Tip[]): void {
  if (!tipsEnabled()) return;
  process.stdout.write(renderTips(tips));
}
