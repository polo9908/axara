/**
 * Thin HTTP client for the Pro gateway. The CLI is a *sensor*: it only pulls
 * rules/tokens and pushes raw reports. All SaaS logic (dashboards, legal PDF
 * generation, scoring history…) lives server-side and is intentionally absent
 * from this codebase.
 */

import type { AuditorRcInput } from '../config/rc.js';
import { USER_AGENT } from '../version.js';
import { tr } from '../i18n.js';

const TIMEOUT_MS = 10_000;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** GET /v1/config — remote rules and (optionally) a full DTCG document. */
export interface RemoteConfigResponse {
  readonly config?: AuditorRcInput;
  /** Inline DTCG token document; bypasses the local tokens file entirely. */
  readonly tokens?: unknown;
}

/** POST /v1/reports — acknowledgement from the Pro API. */
export interface UploadAck {
  readonly id?: string;
  readonly url?: string;
}

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': USER_AGENT,
  };
}

async function request(url: string, token: string, init: RequestInit = {}): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { ...headers(token), ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ApiError(tr(`API injoignable (${url}) : ${reason}`, `API unreachable (${url}): ${reason}`));
  }
  if (!response.ok) {
    throw new ApiError(
      response.status === 401 || response.status === 403
        ? tr(
            `Jeton refusé par l'API (HTTP ${response.status}). Vérifiez AUDITOR_TOKEN ou relancez \`axaraaudit login\`.`,
            `Token rejected by the API (HTTP ${response.status}). Check AUDITOR_TOKEN or run \`axaraaudit login\` again.`,
          )
        : tr(
            `L'API a répondu HTTP ${response.status} sur ${url}.`,
            `The API answered HTTP ${response.status} on ${url}.`,
          ),
      response.status,
    );
  }
  const text = await response.text();
  if (text === '') return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(tr(`Réponse non-JSON reçue de ${url}.`, `Non-JSON response received from ${url}.`));
  }
}

export async function fetchRemoteConfig(
  apiUrl: string,
  token: string,
): Promise<RemoteConfigResponse> {
  const data = await request(`${apiUrl.replace(/\/$/, '')}/v1/config`, token);
  return data as RemoteConfigResponse;
}

export async function uploadReport(
  apiUrl: string,
  token: string,
  payload: unknown,
): Promise<UploadAck> {
  const data = await request(`${apiUrl.replace(/\/$/, '')}/v1/reports`, token, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return data as UploadAck;
}

/** GET /v1/me — identify the token owner (used by `axaraaudit whoami`). */
export async function whoami(
  apiUrl: string,
  token: string,
): Promise<{ readonly name?: string; readonly organization?: string; readonly plan?: string }> {
  const data = await request(`${apiUrl.replace(/\/$/, '')}/v1/me`, token);
  return data as { name?: string; organization?: string; plan?: string };
}
