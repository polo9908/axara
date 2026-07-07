/**
 * Bannière de marque : Axa à gauche, logotype AXARA en dégradé
 * violet → cyan à droite, tagline et version dessous.
 *
 * Photogénique par construction : 62 colonnes max, fond transparent,
 * pensée pour la capture d'écran (README, réseaux sociaux).
 */

import type { ColorLevel } from './ansi.js';
import { boldOn, gradientBlock, paintFg, reset } from './ansi.js';
import { mascotLines, type Mood } from './mascot.js';
import { BRAND } from './theme.js';
import { CLI_NAME, CLI_VERSION } from '../version.js';

const WORDMARK: readonly string[] = [
  ' █████╗ ██╗  ██╗ █████╗ ██████╗  █████╗ ',
  '██╔══██╗╚██╗██╔╝██╔══██╗██╔══██╗██╔══██╗',
  '███████║ ╚███╔╝ ███████║██████╔╝███████║',
  '██╔══██║ ██╔██╗ ██╔══██║██╔══██╗██╔══██║',
  '██║  ██║██╔╝ ██╗██║  ██║██║  ██║██║  ██║',
  '╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝',
];

const TAGLINE = 'design-system + RGAA 4.1 — l’accessibilité, dès le terminal';

export function renderBanner(level: ColorLevel, mood: Mood = 'idle'): string {
  if (level === 'none') {
    return `\n${CLI_NAME} v${CLI_VERSION} — ${TAGLINE}\n\n`;
  }

  const mascot = mascotLines(mood, level);
  const mark = gradientBlock(WORDMARK, BRAND.violet, BRAND.cyan, level);
  const lines: string[] = [''];
  for (let i = 0; i < mark.length; i += 1) {
    lines.push(`  ${mascot[i] ?? ' '.repeat(18)}  ${mark[i] ?? ''}`);
  }
  lines.push(
    `  ${paintFg(`✦ ${TAGLINE}`, BRAND.slate, level)}  ` +
      `${boldOn(level)}${paintFg(`v${CLI_VERSION}`, BRAND.pink, level)}${reset(level)}`,
  );
  lines.push('');
  return `${lines.join('\n')}\n`;
}
