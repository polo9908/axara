/**
 * Préférences persistantes du CLI — `~/.axaraaudit/settings.json`.
 *
 * Écrites par `axaraaudit settings`, lues très tôt (i18n à l'import) :
 * ce module ne doit donc importer ni i18n ni quoi que ce soit de coûteux.
 * Les préférences complètent — sans jamais supplanter — les flags et
 * variables d'environnement (`--lang` > `AXARA_LANG` > settings > locale).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const SETTINGS_DIR = join(homedir(), '.axaraaudit');
export const SETTINGS_FILE = join(SETTINGS_DIR, 'settings.json');

export interface Settings {
  /** Langue de l'interface ; absent = suivre la locale système. */
  readonly lang?: 'fr' | 'en';
  /** Notification de mise à jour quotidienne ; absent = activée. */
  readonly updateCheck?: boolean;
  readonly savedAt?: string;
}

/** Valide un JSON arbitraire vers Settings — champs inconnus ignorés. Exporté pour les tests. */
export function parseSettings(raw: unknown): Settings {
  if (typeof raw !== 'object' || raw === null) return {};
  const obj = raw as Record<string, unknown>;
  return {
    ...(obj['lang'] === 'fr' || obj['lang'] === 'en' ? { lang: obj['lang'] } : {}),
    ...(typeof obj['updateCheck'] === 'boolean' ? { updateCheck: obj['updateCheck'] } : {}),
    ...(typeof obj['savedAt'] === 'string' ? { savedAt: obj['savedAt'] } : {}),
  };
}

export function readSettings(file: string = SETTINGS_FILE): Settings {
  if (!existsSync(file)) return {};
  try {
    return parseSettings(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return {};
  }
}

/** Fusionne et persiste — `undefined` supprime la clé. Retourne le chemin écrit. */
export function saveSettings(patch: {
  lang?: 'fr' | 'en' | undefined;
  updateCheck?: boolean | undefined;
}): string {
  const current = readSettings();
  const next: Settings = {
    ...('lang' in patch ? (patch.lang !== undefined ? { lang: patch.lang } : {}) : current.lang !== undefined ? { lang: current.lang } : {}),
    ...('updateCheck' in patch
      ? patch.updateCheck !== undefined
        ? { updateCheck: patch.updateCheck }
        : {}
      : current.updateCheck !== undefined
        ? { updateCheck: current.updateCheck }
        : {}),
    savedAt: new Date().toISOString(),
  };
  mkdirSync(SETTINGS_DIR, { recursive: true });
  writeFileSync(SETTINGS_FILE, `${JSON.stringify(next, null, 2)}\n`);
  return SETTINGS_FILE;
}
