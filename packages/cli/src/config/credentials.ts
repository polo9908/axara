/**
 * Pro credentials resolution. Precedence: `AUDITOR_TOKEN` env var (CI-friendly,
 * never written to disk) > `~/.axaraaudit/credentials.json` (written by
 * `axaraaudit login`). The token is only ever printed masked.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const TOKEN_ENV_VAR = 'AUDITOR_TOKEN';

const CREDENTIALS_DIR = join(homedir(), '.axaraaudit');
const CREDENTIALS_FILE = join(CREDENTIALS_DIR, 'credentials.json');

export interface StoredCredentials {
  readonly token: string;
  readonly apiUrl?: string;
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
    if (typeof parsed.token !== 'string' || parsed.token === '') return null;
    return {
      token: parsed.token,
      ...(typeof parsed.apiUrl === 'string' ? { apiUrl: parsed.apiUrl } : {}),
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
  if (stored !== null) {
    return {
      token: stored.token,
      source: 'file',
      ...(stored.apiUrl !== undefined ? { apiUrl: stored.apiUrl } : {}),
    };
  }
  return null;
}

export function saveCredentials(token: string, apiUrl?: string): string {
  mkdirSync(CREDENTIALS_DIR, { recursive: true });
  const payload: StoredCredentials = {
    token,
    ...(apiUrl !== undefined ? { apiUrl } : {}),
    savedAt: new Date().toISOString(),
  };
  writeFileSync(CREDENTIALS_FILE, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  return CREDENTIALS_FILE;
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
