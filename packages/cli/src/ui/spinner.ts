/**
 * Spinner de marque : rosace braille dont la teinte « respire » le long
 * du dégradé violet → cyan. Écrit sur stderr (stdout reste pipeable),
 * inerte hors TTY / en CI : seule la ligne finale ✓ / ✖ est émise.
 */

import { canAnimate, cursor, lerp, paintFg, stderrLevel } from './ansi.js';
import { BRAND } from './theme.js';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;
const INTERVAL_MS = 80;

export interface Spinner {
  start(): void;
  update(label: string): void;
  succeed(label: string): void;
  fail(label: string): void;
}

export function createSpinner(initialLabel: string): Spinner {
  let label = initialLabel;
  let tick = 0;
  let timer: NodeJS.Timeout | null = null;
  const out = process.stderr;

  const draw = (): void => {
    // Ping-pong sur le dégradé : violet → cyan → violet, période 20 frames.
    const t = Math.abs(((tick % 20) / 10) - 1);
    const frame = FRAMES[tick % FRAMES.length] ?? '⠋';
    const dot = paintFg(frame, lerp(BRAND.violet, BRAND.cyan, 1 - t), stderrLevel);
    out.write(`${cursor.toColumn0}${cursor.eraseLine}  ${dot} ${label}`);
    tick += 1;
  };

  const clear = (): void => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
      out.write(`${cursor.toColumn0}${cursor.eraseLine}${cursor.show}`);
    }
  };

  const finish = (mark: string, finalLabel: string): void => {
    clear();
    out.write(`  ${mark} ${finalLabel}\n`);
  };

  return {
    start(): void {
      if (!canAnimate) return;
      out.write(cursor.hide);
      draw();
      timer = setInterval(draw, INTERVAL_MS);
    },
    update(next: string): void {
      label = next;
    },
    succeed(finalLabel: string): void {
      finish(paintFg('✓', BRAND.green, stderrLevel), finalLabel);
    },
    fail(finalLabel: string): void {
      finish(paintFg('✖', BRAND.red, stderrLevel), finalLabel);
    },
  };
}
