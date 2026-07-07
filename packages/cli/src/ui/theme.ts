/**
 * Charte graphique AXARA — la source de vérité des couleurs du CLI.
 *
 * Identité « nébuleuse » : un dégradé violet → cyan pour la marque,
 * le rose axolotl pour la mascotte et les accents chaleureux.
 * Les états (succès / avertissement / erreur) restent lisibles sur fond
 * sombre comme clair (contraste ≥ 4.5:1 sur #1E1E1E et #FFFFFF… on est
 * un auditeur d'accessibilité, on se doit d'être exemplaire).
 */

import type { Rgb } from './ansi.js';

export const BRAND = {
  /** Violet nébuleuse — départ du dégradé de marque. */
  violet: { r: 139, g: 92, b: 246 } satisfies Rgb,
  /** Cyan aurore — arrivée du dégradé de marque. */
  cyan: { r: 34, g: 211, b: 238 } satisfies Rgb,
  /** Rose axolotl — mascotte et accents. */
  pink: { r: 255, g: 143, b: 177 } satisfies Rgb,
  /** Succès. */
  green: { r: 52, g: 211, b: 153 } satisfies Rgb,
  /** Avertissement. */
  amber: { r: 251, g: 191, b: 36 } satisfies Rgb,
  /** Erreur. */
  red: { r: 248, g: 113, b: 113 } satisfies Rgb,
  /** Texte secondaire. */
  slate: { r: 148, g: 163, b: 184 } satisfies Rgb,
} as const;

/** Étoiles du mode célébration (GATE PASSED). */
export const SPARKLES = ['✦', '✧', '⋆', '·'] as const;
