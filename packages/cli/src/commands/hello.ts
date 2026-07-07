/**
 * `axaraaudit hello` — la vitrine de la charte graphique.
 *
 * Un écran statique photogénique (bannière, humeurs d'Axa, palette) pensé
 * pour la capture d'écran. `--demo` rejoue un audit scénarisé animé
 * (spinner → score) : parfait pour enregistrer un GIF marketing.
 */

import { parseArgs } from 'node:util';
import { bg, boldOn, gradient, paintFg, reset, sleep, stdoutLevel, type Rgb } from '../ui/ansi.js';
import { renderBanner } from '../ui/banner.js';
import { mascotLines, MASCOT_NAME, type Mood } from '../ui/mascot.js';
import { canReveal, revealScore } from '../ui/reveal.js';
import { createSpinner } from '../ui/spinner.js';
import { BRAND } from '../ui/theme.js';

const MOODS: readonly { mood: Mood; label: string }[] = [
  { mood: 'idle', label: 'audit en cours' },
  { mood: 'blink', label: 'analyse…' },
  { mood: 'happy', label: 'gate passed' },
  { mood: 'shocked', label: 'gate failed' },
];

function swatch(name: string, c: Rgb): string {
  const level = stdoutLevel;
  const hex = `#${[c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
  const block = level === 'none' ? '' : `${bg(c, level)}      ${reset(level)} `;
  return `  ${block}${boldOn(level)}${name.padEnd(10)}${reset(level)}${paintFg(hex, BRAND.slate, level)}`;
}

function renderShowcase(): string {
  const level = stdoutLevel;
  const lines: string[] = [];
  lines.push(renderBanner(level));

  // — Les humeurs d'Axa, côte à côte —
  lines.push(paintFg(`  ${MASCOT_NAME}, la mascotte — quatre humeurs :`, BRAND.slate, level));
  lines.push('');
  const sprites = MOODS.map(({ mood }) => mascotLines(mood, level));
  const spriteHeight = sprites[0]?.length ?? 0;
  for (let row = 0; row < spriteHeight; row += 1) {
    lines.push(`  ${sprites.map((s) => s[row] ?? ' '.repeat(18)).join('  ')}`);
  }
  lines.push(`  ${MOODS.map(({ label }) => paintFg(label.padEnd(18), BRAND.slate, level)).join('  ')}`);
  lines.push('');

  // — Palette —
  lines.push(paintFg('  Charte graphique « nébuleuse » :', BRAND.slate, level));
  lines.push('');
  lines.push(swatch('violet', BRAND.violet));
  lines.push(swatch('cyan', BRAND.cyan));
  lines.push(swatch('rose', BRAND.pink));
  lines.push(swatch('succès', BRAND.green));
  lines.push(swatch('alerte', BRAND.amber));
  lines.push(swatch('erreur', BRAND.red));
  lines.push('');
  lines.push(`  ${gradient('✦ ✦ ✦', BRAND.violet, BRAND.cyan, level)}  ${paintFg('axaraaudit hello --demo  →  rejoue un audit animé (idéal GIF)', BRAND.slate, level)}`);
  lines.push('');
  return lines.join('\n');
}

async function runDemo(): Promise<void> {
  process.stdout.write(renderBanner(stdoutLevel));

  const steps: readonly string[] = [
    'Analyse du design-system (tokens DTCG)…',
    'Vérification RGAA 4.1 (axe-core)…',
    'Calcul du score de conformité…',
  ];
  const spinner = createSpinner(steps[0] ?? '');
  spinner.start();
  for (const step of steps) {
    spinner.update(step);
    await sleep(900);
  }
  spinner.succeed('Audit terminé — 128 fichiers, 3 dérives auto-fixables');

  if (canReveal()) {
    await revealScore(92, { evaluated: true, passed: true, failUnder: 80, reasons: [] });
  } else {
    process.stdout.write('  SCORE 92/100 — GATE PASSED\n');
  }
}

export async function runHello(argv: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: { demo: { type: 'boolean', default: false } },
    allowPositionals: false,
  });

  if (values.demo === true) {
    await runDemo();
  } else {
    process.stdout.write(`${renderShowcase()}\n`);
  }
  return 0;
}
