/**
 * `axaraaudit hello` — la vitrine de la charte graphique.
 *
 * Un écran statique photogénique (bannière, humeurs d'Axa, palette) pensé
 * pour la capture d'écran. `--demo` rejoue un audit scénarisé animé
 * (spinner → score) : parfait pour enregistrer un GIF marketing.
 */

import { parseArgs } from 'node:util';
import { tr } from '../i18n.js';
import { bg, boldOn, gradient, paintFg, reset, sleep, stdoutLevel, type Rgb } from '../ui/ansi.js';
import { renderBanner } from '../ui/banner.js';
import { mascotLines, MASCOT_NAME, type Mood } from '../ui/mascot.js';
import { canReveal, revealScore } from '../ui/reveal.js';
import { createSpinner } from '../ui/spinner.js';
import { BRAND } from '../ui/theme.js';

const MOODS: readonly { mood: Mood; label: string }[] = [
  { mood: 'idle', label: tr('audit en cours', 'audit in progress') },
  { mood: 'blink', label: tr('analyse…', 'analyzing…') },
  { mood: 'happy', label: tr('gate passed', 'gate passed') },
  { mood: 'shocked', label: tr('gate failed', 'gate failed') },
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
  lines.push(
    paintFg(
      tr(`  ${MASCOT_NAME}, la mascotte — quatre humeurs :`, `  ${MASCOT_NAME}, the mascot — four moods:`),
      BRAND.slate,
      level,
    ),
  );
  lines.push('');
  const sprites = MOODS.map(({ mood }) => mascotLines(mood, level));
  const spriteHeight = sprites[0]?.length ?? 0;
  for (let row = 0; row < spriteHeight; row += 1) {
    lines.push(`  ${sprites.map((s) => s[row] ?? ' '.repeat(18)).join('  ')}`);
  }
  lines.push(`  ${MOODS.map(({ label }) => paintFg(label.padEnd(18), BRAND.slate, level)).join('  ')}`);
  lines.push('');

  // — Palette —
  lines.push(paintFg(tr('  Charte graphique « nébuleuse » :', '  "Nebula" visual identity:'), BRAND.slate, level));
  lines.push('');
  lines.push(swatch(tr('violet', 'violet'), BRAND.violet));
  lines.push(swatch(tr('cyan', 'cyan'), BRAND.cyan));
  lines.push(swatch(tr('rose', 'pink'), BRAND.pink));
  lines.push(swatch(tr('succès', 'success'), BRAND.green));
  lines.push(swatch(tr('alerte', 'warning'), BRAND.amber));
  lines.push(swatch(tr('erreur', 'error'), BRAND.red));
  lines.push('');
  lines.push(
    `  ${gradient('✦ ✦ ✦', BRAND.violet, BRAND.cyan, level)}  ${paintFg(
      tr(
        'axaraaudit hello --demo  →  rejoue un audit animé (idéal GIF)',
        'axaraaudit hello --demo  →  replays an animated audit (perfect for GIFs)',
      ),
      BRAND.slate,
      level,
    )}`,
  );
  lines.push('');
  return lines.join('\n');
}

async function runDemo(): Promise<void> {
  process.stdout.write(renderBanner(stdoutLevel));

  const steps: readonly string[] = [
    tr('Analyse du design-system (tokens DTCG)…', 'Analyzing the design system (DTCG tokens)…'),
    tr('Vérification RGAA 4.1 (axe-core)…', 'Checking RGAA 4.1 (axe-core)…'),
    tr('Calcul du score de conformité…', 'Computing the compliance score…'),
  ];
  const spinner = createSpinner(steps[0] ?? '');
  spinner.start();
  for (const step of steps) {
    spinner.update(step);
    await sleep(900);
  }
  spinner.succeed(
    tr('Audit terminé — 128 fichiers, 3 dérives auto-fixables', 'Audit complete — 128 files, 3 auto-fixable drifts'),
  );

  if (canReveal()) {
    await revealScore(92, { evaluated: true, passed: true, failUnder: 80, reasons: [] });
  } else {
    process.stdout.write(tr('  SCORE 92/100 — GATE PASSED\n', '  SCORE 92/100 — GATE PASSED\n'));
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
