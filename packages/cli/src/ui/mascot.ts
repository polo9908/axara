/**
 * Axa, l'axolotl mascotte d'AXARA — sprite pixel-art 18×12.
 *
 * Pourquoi un axolotl ? Il régénère ce qui est abîmé, exactement comme
 * `axaraaudit fix` régénère un design-system qui dérive. Et il sourit
 * tout le temps, même face à 47 violations RGAA.
 *
 * Grille : `.` transparent, chaque lettre pointe vers la palette ci-dessous.
 */

import type { ColorLevel, Rgb } from './ansi.js';
import { renderPixels, type PixelPalette } from './pixel.js';

const PALETTE: PixelPalette = {
  p: { r: 255, g: 179, b: 199 }, // corps rose pastel
  P: { r: 248, g: 147, b: 180 }, // ombre du front
  g: { r: 255, g: 107, b: 157 }, // branchies corail
  r: { r: 250, g: 127, b: 165 }, // joues
  k: { r: 74, g: 35, b: 56 }, // yeux & bouche (prune)
  c: { r: 125, g: 211, b: 252 }, // goutte de sueur (mode choc)
} satisfies Record<string, Rgb>;

export type Mood = 'idle' | 'blink' | 'happy' | 'shocked';

const BASE: readonly string[] = [
  '...g..........g...',
  '..gg...PPPP...gg..',
  '.ggg..PppppP..ggg.',
  '..gg.PppppppP.gg..',
  '.gggPppppppppPggg.',
  '..ggppkppppkppgg..',
  '...gppkppppkppg...',
  '....prppkkpprp....',
  '....pppppppppp....',
  '.....pppppppp.....',
  '......pppppp......',
  '.....pp....pp.....',
];

function withRows(overrides: Readonly<Record<number, string>>): readonly string[] {
  return BASE.map((row, i) => overrides[i] ?? row);
}

const FRAMES: Readonly<Record<Mood, readonly string[]>> = {
  idle: BASE,
  // Paupières mi-closes : les yeux ne restent que sur la rangée basse.
  blink: withRows({ 5: '..ggppppppppppgg..' }),
  // Yeux ^ ^ et grand sourire — GATE PASSED.
  happy: withRows({
    5: '..ggpkpkppkpkpgg..',
    6: '...gppppppppppg...',
    7: '....prpkkkkprp....',
  }),
  // Yeux écarquillés, bouche « o », goutte de sueur — GATE FAILED.
  shocked: withRows({
    1: '..gg...PPPP.c.gg..',
    2: '.ggg..PppppPc.ggg.',
    7: '....prppkkpprp....',
    8: '....ppppkkpppp....',
  }),
};

/** Rend la mascotte (6 lignes de demi-blocs). Vide si les couleurs sont coupées. */
export function mascotLines(mood: Mood, level: ColorLevel): string[] {
  return renderPixels(FRAMES[mood], PALETTE, level);
}

export const MASCOT_WIDTH = 18;
export const MASCOT_NAME = 'Axa';
