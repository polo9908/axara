/**
 * Révélation animée du score — le plan final « photogénique » de l'audit.
 *
 * Le compteur grimpe de 0 au score réel (easing cubique, ~1 s), la jauge
 * se remplit en dégradé de marque, puis Axa réagit au verdict : sourire
 * et étoiles si le gate passe, yeux écarquillés sinon.
 *
 * Uniquement sur TTY interactif ; ailleurs, la section SCORE textuelle
 * de `renderPretty` fait foi.
 */

import { boldOn, canAnimate, cursor, lerp, paintFg, reset, sleep, stdoutLevel } from './ansi.js';
import { mascotLines, type Mood } from './mascot.js';
import { BRAND, SPARKLES } from './theme.js';

export interface RevealGate {
  readonly evaluated: boolean;
  readonly passed: boolean;
  readonly failUnder: number;
  readonly reasons: readonly string[];
}

const BAR_CELLS = 26;

export function canReveal(): boolean {
  return canAnimate && process.stdout.isTTY === true && stdoutLevel !== 'none';
}

function bar(score: number): string {
  const filled = Math.round((score / 100) * BAR_CELLS);
  let out = '';
  for (let i = 0; i < BAR_CELLS; i += 1) {
    out +=
      i < filled
        ? paintFg('█', lerp(BRAND.violet, BRAND.cyan, i / (BAR_CELLS - 1)), stdoutLevel)
        : paintFg('░', BRAND.slate, stdoutLevel);
  }
  return out;
}

function frame(score: number, gate: RevealGate, mood: Mood, sparkleTick: number): string[] {
  const level = stdoutLevel;
  const m = mascotLines(mood, level);
  const ok = gate.evaluated ? gate.passed : score >= gate.failUnder;
  const scoreColor = ok ? BRAND.green : BRAND.red;
  const pad = (s: string): string => `  ${s}  `;

  const scoreText = `${boldOn(level)}${paintFg(String(score).padStart(3, ' '), scoreColor, level)}${reset(level)}${paintFg(' / 100', BRAND.slate, level)}`;
  const verdict = !gate.evaluated
    ? paintFg(`objectif ≥ ${gate.failUnder}`, BRAND.slate, level)
    : gate.passed
      ? `${boldOn(level)}${paintFg('GATE PASSED', BRAND.green, level)}${reset(level)}`
      : `${boldOn(level)}${paintFg('GATE FAILED', BRAND.red, level)}${reset(level)}`;

  // Étoiles scintillantes autour du verdict (célébration uniquement).
  const spark = (i: number): string =>
    gate.evaluated && gate.passed && mood === 'happy'
      ? paintFg(SPARKLES[(sparkleTick + i) % SPARKLES.length] ?? '✦', BRAND.pink, level)
      : ' ';

  const lines: string[] = [];
  lines.push('');
  lines.push(pad(`${m[0] ?? ''}`));
  lines.push(pad(`${m[1] ?? ''}   ${paintFg('SCORE', BRAND.slate, level)}  ${bar(score)}  ${scoreText}`));
  lines.push(pad(`${m[2] ?? ''}`));
  lines.push(pad(`${m[3] ?? ''}   ${spark(0)} ${verdict} ${spark(1)}`));
  const reason = gate.evaluated && !gate.passed ? gate.reasons[0] : undefined;
  lines.push(pad(`${m[4] ?? ''}   ${reason !== undefined ? paintFg(`· ${reason}`, BRAND.slate, level) : ''}`));
  lines.push(pad(`${m[5] ?? ''}`));
  lines.push('');
  return lines;
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

export async function revealScore(score: number, gate: RevealGate): Promise<void> {
  const out = process.stdout;
  const ok = gate.evaluated ? gate.passed : score >= gate.failUnder;
  const finalMood: Mood = ok ? 'happy' : 'shocked';

  if (!canReveal()) return;

  out.write(cursor.hide);
  const STEPS = 22;
  let height = 0;
  const draw = (lines: string[]): void => {
    if (height > 0) out.write(cursor.up(height));
    out.write(`${lines.map((l) => `${cursor.eraseLine}${l}`).join('\n')}\n`);
    height = lines.length;
  };

  for (let i = 0; i <= STEPS; i += 1) {
    const value = Math.round(easeOutCubic(i / STEPS) * score);
    const mood: Mood = i === STEPS ? finalMood : i % 8 === 7 ? 'blink' : 'idle';
    draw(frame(value, gate, mood, 0));
    await sleep(i === STEPS ? 0 : 40);
  }

  // Scintillement final (3 battements) quand le gate passe.
  if (ok && gate.evaluated) {
    for (let s = 1; s <= 6; s += 1) {
      await sleep(120);
      draw(frame(score, gate, 'happy', s));
    }
  }
  out.write(cursor.show);
}
