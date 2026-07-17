/**
 * Minimal Figma REST client for local variables.
 *
 * The `fetch` implementation is injectable so the parsing/normalization logic
 * can be tested deterministically without network access.
 */

import type { FigmaVariablesResponse } from './types.js';

export type FetchLike = (
  input: string,
  init?: { headers?: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

export interface FigmaClientOptions {
  /** Personal access token (sent as the `X-Figma-Token` header). */
  readonly token: string;
  /** Override the fetch implementation (defaults to global `fetch`). */
  readonly fetchImpl?: FetchLike;
  /** Override the API base URL. */
  readonly baseUrl?: string;
}

const DEFAULT_BASE_URL = 'https://api.figma.com';

export class FigmaClient {
  private readonly token: string;
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;

  constructor(options: FigmaClientOptions) {
    if (!options.token) throw new Error('FigmaClient requires a personal access token.');
    this.token = options.token;
    const globalFetch = (globalThis as { fetch?: FetchLike }).fetch;
    const impl = options.fetchImpl ?? globalFetch;
    if (!impl) throw new Error('No fetch implementation available; pass `fetchImpl`.');
    this.fetchImpl = impl;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  }

  /** GET /v1/files/:fileKey/variables/local */
  async getLocalVariables(fileKey: string): Promise<FigmaVariablesResponse> {
    if (!fileKey) throw new Error('getLocalVariables requires a file key.');
    const url = `${this.baseUrl}/v1/files/${encodeURIComponent(fileKey)}/variables/local`;
    const response = await this.fetchImpl(url, { headers: { 'X-Figma-Token': this.token } });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Figma API error ${response.status}: ${body || 'request failed'}`);
    }
    const payload = (await response.json()) as FigmaVariablesResponse;
    if (payload.error === true) {
      throw new Error(`Figma API returned an error for file ${fileKey}.`);
    }
    if (!payload.meta || typeof payload.meta !== 'object') {
      throw new Error('Figma response is missing the expected `meta` payload.');
    }
    return payload;
  }
}
