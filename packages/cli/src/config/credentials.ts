/**
 * Pro credentials resolution. Precedence: `AUDITOR_TOKEN` env var (CI-friendly,
 * never written to disk) > `~/.axaraaudit/credentials.json` (written by
 * `axaraaudit login`). The token is only ever printed masked.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const TOKEN_ENV_VAR = 'AUDITOR_TOKEN';
export const FIGMA_TOKEN_ENV_VAR = 'FIGMA_TOKEN';

const CREDENTIALS_DIR = join(homedir(), '.axaraaudit');
const CREDENTIALS_FILE = join(CREDENTIALS_DIR, 'credentials.json');

export interface StoredCredentials {
  readonly token?: string;
  readonly apiUrl?: string;
  /** Anthropic API key for the opt-in AI fix pass (`fix --ai`). */
  readonly anthropicKey?: string;
  /** Figma personal access token for `init --from-figma` / the wizard import. */
  readonly figmaToken?: string;
  readonly savedAt: string;
}

export interface ResolvedToken {
  readonly token: string;
  readonly source: 'env' | 'file';
  readonly apiUrl?: string;
}

export function readStoredCredentials(): StoredCredentials | null {
  if (!existsSync(CREDENTIALS_FILE)) return null;
  try {
    const parsed = JSON.parse(readFileSync(CREDENTIALS_FILE, 'utf8')) as Partial<StoredCredentials>;
    return {
      ...(typeof parsed.token === 'string' && parsed.token !== '' ? { token: parsed.token } : {}),
      ...(typeof parsed.apiUrl === 'string' ? { apiUrl: parsed.apiUrl } : {}),
      ...(typeof parsed.anthropicKey === 'string' && parsed.anthropicKey !== ''
        ? { anthropicKey: parsed.anthropicKey }
        : {}),
      ...(typeof parsed.figmaToken === 'string' && parsed.figmaToken !== ''
        ? { figmaToken: parsed.figmaToken }
        : {}),
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : '',
    };
  } catch {
    return null;
  }
}

/** Resolve the Pro token, or null when running in pure open-source mode. */
export function resolveToken(env: NodeJS.ProcessEnv = process.env): ResolvedToken | null {
  const fromEnv = env[TOKEN_ENV_VAR];
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') {
    return { token: fromEnv.trim(), source: 'env' };
  }
  const stored = readStoredCredentials();
  if (stored !== null && stored.token !== undefined) {
    return {
      token: stored.token,
      source: 'file',
      ...(stored.apiUrl !== undefined ? { apiUrl: stored.apiUrl } : {}),
    };
  }
  return null;
}

/** Anthropic key for `fix --ai`: ANTHROPIC_API_KEY env var > credentials file. */
export function resolveAnthropicKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const fromEnv = env['ANTHROPIC_API_KEY'];
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim();
  return readStoredCredentials()?.anthropicKey ?? null;
}

/** Figma token for the variables import: FIGMA_TOKEN env var > credentials file. */
export function resolveFigmaToken(env: NodeJS.ProcessEnv = process.env): string | null {
  const fromEnv = env[FIGMA_TOKEN_ENV_VAR];
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim();
  return readStoredCredentials()?.figmaToken ?? null;
}

function writeCredentials(payload: StoredCredentials): string {
  mkdirSync(CREDENTIALS_DIR, { recursive: true });
  writeFileSync(CREDENTIALS_FILE, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  return CREDENTIALS_FILE;
}

type SecretField = 'token' | 'anthropicKey' | 'figmaToken';
const SECRET_FIELDS: readonly SecretField[] = ['token', 'anthropicKey', 'figmaToken'];

/**
 * Réécrit le fichier avec `patch` fusionné sur l'existant (undefined = champ
 * supprimé). Le fichier disparaît quand plus aucun secret ne subsiste.
 */
function updateCredentials(
  patch: Partial<Record<SecretField | 'apiUrl', string | undefined>>,
): string {
  const existing = readStoredCredentials() ?? { savedAt: '' };
  const merged: Record<string, string> = {};
  for (const field of [...SECRET_FIELDS, 'apiUrl'] as const) {
    const value = field in patch ? patch[field] : existing[field];
    if (value !== undefined) merged[field] = value;
  }
  if (SECRET_FIELDS.every((field) => merged[field] === undefined)) {
    clearCredentials();
    return CREDENTIALS_FILE;
  }
  return writeCredentials({ ...merged, savedAt: new Date().toISOString() });
}

export function saveCredentials(token: string, apiUrl?: string): string {
  return updateCredentials({ token, ...(apiUrl !== undefined ? { apiUrl } : {}) });
}

export function saveAnthropicKey(anthropicKey: string): string {
  return updateCredentials({ anthropicKey });
}

export function saveFigmaToken(figmaToken: string): string {
  return updateCredentials({ figmaToken });
}

/** Efface uniquement le jeton Pro, en préservant les autres secrets. */
export function clearToken(): boolean {
  if (readStoredCredentials()?.token === undefined) return false;
  updateCredentials({ token: undefined });
  return true;
}

/** Efface uniquement la clé Anthropic, en préservant les autres secrets. */
export function clearAnthropicKey(): boolean {
  if (readStoredCredentials()?.anthropicKey === undefined) return false;
  updateCredentials({ anthropicKey: undefined });
  return true;
}

/** Efface uniquement le jeton Figma, en préservant les autres secrets. */
export function clearFigmaToken(): boolean {
  if (readStoredCredentials()?.figmaToken === undefined) return false;
  updateCredentials({ figmaToken: undefined });
  return true;
}

export function clearCredentials(): boolean {
  if (!existsSync(CREDENTIALS_FILE)) return false;
  rmSync(CREDENTIALS_FILE);
  return true;
}

/** `axa_secret1234` → `axa_****1234` — safe for logs. */
export function maskToken(token: string): string {
  if (token.length <= 8) return '****';
  return `${token.slice(0, 4)}****${token.slice(-4)}`;
}
