/**
 * Chargement du thème d'un tailwind.config.{js,mjs,cjs} — zéro dépendance.
 *
 * Le config est importé in-process via `import()` : c'est le code du projet de
 * l'utilisateur, exécuté à sa demande explicite (wizard ou --from-tailwind) —
 * même niveau de confiance qu'un script npm. Tout échec est encapsulé dans un
 * résultat typé, jamais un crash.
 *
 * Les configs `.ts` ne sont pas importables sans loader : on répond `ts-config`
 * et le wizard suggère la voie Tailwind v4 (`@theme` CSS, déjà couverte par
 * l'extraction de custom properties) ou un renommage en `.js`.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const CONFIG_NAMES = [
  'tailwind.config.js',
  'tailwind.config.mjs',
  'tailwind.config.cjs',
  'tailwind.config.ts',
];

/** Premier config Tailwind présent à la racine, chemin absolu — ou null. */
export function detectTailwindConfig(cwd: string): string | null {
  for (const name of CONFIG_NAMES) {
    const abs = resolve(cwd, name);
    if (existsSync(abs)) return abs;
  }
  return null;
}

export type TailwindLoad =
  | { readonly ok: true; readonly theme: unknown; readonly file: string }
  | {
      readonly ok: false;
      readonly reason: 'ts-config' | 'import-failed' | 'no-theme';
      readonly file: string;
      readonly detail?: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export async function loadTailwindTheme(configPath: string): Promise<TailwindLoad> {
  const abs = resolve(configPath);
  if (abs.endsWith('.ts')) {
    return { ok: false, reason: 'ts-config', file: abs };
  }
  let mod: unknown;
  try {
    // pathToFileURL est indispensable sur Windows (`C:\…` n'est pas une URL ESM).
    mod = await import(pathToFileURL(abs).href);
  } catch (error) {
    return {
      ok: false,
      reason: 'import-failed',
      file: abs,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  // Interop NodeNext : module.exports CJS atterrit sur `default`, et les
  // configs transpilés empilent parfois un second `default`.
  const record = isRecord(mod) ? mod : {};
  const level1 = isRecord(record['default']) ? record['default'] : record;
  const config = isRecord(level1['default']) ? level1['default'] : level1;
  const theme = isRecord(config) ? config['theme'] : undefined;
  if (!isRecord(theme)) {
    return { ok: false, reason: 'no-theme', file: abs };
  }
  return { ok: true, theme, file: abs };
}
