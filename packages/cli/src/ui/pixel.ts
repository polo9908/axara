/**
 * Rendu pixel-art en demi-blocs : chaque caractère `▀` porte deux pixels
 * (avant-plan = pixel du haut, arrière-plan = pixel du bas), soit une
 * résolution verticale doublée. Fond transparent : le sprite s'affiche
 * proprement sur n'importe quel thème de terminal.
 */

import type { ColorLevel, Rgb } from './ansi.js';
import { bg, fg, reset } from './ansi.js';

export type PixelPalette = Readonly<Record<string, Rgb>>;

const TOP = '▀';
const BOTTOM = '▄';

/** Convertit une grille de caractères (`.` = transparent) en lignes ANSI. */
export function renderPixels(
  grid: readonly string[],
  palette: PixelPalette,
  level: ColorLevel,
): string[] {
  if (level === 'none') return [];
  const lines: string[] = [];
  for (let y = 0; y < grid.length; y += 2) {
    const topRow = grid[y] ?? '';
    const bottomRow = grid[y + 1] ?? '';
    const width = Math.max(topRow.length, bottomRow.length);
    let line = '';
    for (let x = 0; x < width; x += 1) {
      const top = palette[topRow[x] ?? '.'];
      const bottom = palette[bottomRow[x] ?? '.'];
      if (top === undefined && bottom === undefined) {
        line += ' ';
      } else if (top !== undefined && bottom !== undefined) {
        line += `${fg(top, level)}${bg(bottom, level)}${TOP}${reset(level)}`;
      } else if (top !== undefined) {
        line += `${fg(top, level)}${TOP}${reset(level)}`;
      } else if (bottom !== undefined) {
        line += `${fg(bottom, level)}${BOTTOM}${reset(level)}`;
      }
    }
    lines.push(line);
  }
  return lines;
}
