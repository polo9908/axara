/**
 * Import des variables Figma → document DTCG, prêt pour le wizard et
 * `init --from-figma`. Réseau via le FigmaClient de core (fetch injectable —
 * les tests restent hors ligne), timeout 10 s comme services/api.ts.
 */

import {
  FigmaClient,
  figmaTokensToDtcg,
  normalizeFigmaVariables,
  type FetchLike,
} from '@axaraaudit/core';
import { tr } from '../i18n.js';

const TIMEOUT_MS = 10_000;

/**
 * Extrait la clé de fichier d'une URL figma.com (`/file/<clé>/…` ou
 * `/design/<clé>/…`) — une clé brute passe telle quelle.
 */
export function parseFigmaRef(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  const fromUrl = /figma\.com\/(?:file|design)\/([A-Za-z0-9]+)/.exec(trimmed);
  if (fromUrl !== null) return fromUrl[1] ?? null;
  if (/^[A-Za-z0-9]+$/.test(trimmed)) return trimmed;
  return null;
}

export type FigmaImportResult =
  | {
      readonly ok: true;
      readonly document: Record<string, unknown>;
      readonly count: number;
      readonly warnings: readonly string[];
    }
  | { readonly ok: false; readonly message: string };

export async function importFigmaTokens(options: {
  readonly fileKey: string;
  readonly token: string;
  readonly mode?: string;
  readonly fetchImpl?: FetchLike;
}): Promise<FigmaImportResult> {
  const fetchImpl: FetchLike =
    options.fetchImpl ??
    ((input, init) =>
      fetch(input, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) }) as ReturnType<FetchLike>);

  const client = new FigmaClient({ token: options.token, fetchImpl });
  try {
    const response = await client.getLocalVariables(options.fileKey);
    const normalized = normalizeFigmaVariables(response.meta, {
      ...(options.mode !== undefined ? { mode: options.mode } : {}),
    });
    const converted = figmaTokensToDtcg(normalized.tokens, {
      ...(options.mode !== undefined ? { mode: options.mode } : {}),
    });
    return {
      ok: true,
      document: converted.document,
      count: converted.count,
      warnings: [...normalized.errors, ...converted.warnings],
    };
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    if (raw.includes('403')) {
      return {
        ok: false,
        message: tr(
          "Accès refusé (403) — l'API Variables de Figma exige un jeton d'une organisation Enterprise, et le scope `file_variables:read`.",
          'Access denied (403) — the Figma Variables API requires an Enterprise-org token with the `file_variables:read` scope.',
        ),
      };
    }
    if (raw.includes('404')) {
      return {
        ok: false,
        message: tr(
          'Fichier introuvable (404) — vérifiez la clé ou l’URL du fichier Figma.',
          'File not found (404) — check the Figma file key or URL.',
        ),
      };
    }
    if (raw.toLowerCase().includes('abort') || raw.toLowerCase().includes('timeout')) {
      return {
        ok: false,
        message: tr(
          `Délai dépassé (${TIMEOUT_MS / 1000} s) — vérifiez votre connexion réseau.`,
          `Timed out (${TIMEOUT_MS / 1000} s) — check your network connection.`,
        ),
      };
    }
    return { ok: false, message: raw };
  }
}
