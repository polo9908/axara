/**
 * Resolve and load the project's DTCG token file.
 *
 * Resolution order (first hit wins), for zero-config DX:
 *  1. an explicit path passed to the tool,
 *  2. the `A11YENGINE_TOKENS` environment variable,
 *  3. a conventional file name discovered in the working directory.
 */

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { parseDtcgString, type DesignToken, type TokenIndex } from '@axaraaudit/core';

const CONVENTIONAL_NAMES = [
  'design-tokens.dtcg.json',
  'tokens.dtcg.json',
  'design-tokens.json',
  'tokens.json',
];

export interface ResolvedTokens {
  readonly path: string;
  readonly tokens: readonly DesignToken[];
  readonly index: TokenIndex;
  readonly errors: readonly string[];
}

export interface ResolveOptions {
  /** Explicit token file path (absolute or relative to `cwd`). */
  readonly tokensPath?: string | undefined;
  /** Base directory for relative/conventional resolution. Defaults to `cwd`. */
  readonly cwd?: string;
}

/** Locate the token file path, or `null` when none can be found. */
export function resolveTokensPath(options: ResolveOptions = {}): string | null {
  const cwd = options.cwd ?? process.cwd();
  const candidates: string[] = [];

  if (options.tokensPath) {
    candidates.push(isAbsolute(options.tokensPath) ? options.tokensPath : resolve(cwd, options.tokensPath));
  }
  const fromEnv = process.env['A11YENGINE_TOKENS'];
  if (fromEnv) {
    candidates.push(isAbsolute(fromEnv) ? fromEnv : resolve(cwd, fromEnv));
  }
  for (const name of CONVENTIONAL_NAMES) candidates.push(resolve(cwd, name));

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

/** Load and parse the project's tokens. Throws if no token file is found. */
export function loadTokens(options: ResolveOptions = {}): ResolvedTokens {
  const path = resolveTokensPath(options);
  if (!path) {
    throw new Error(
      'No DTCG token file found. Pass `tokensPath`, set A11YENGINE_TOKENS, or add a design-tokens.dtcg.json to the working directory.',
    );
  }
  const json = readFileSync(path, 'utf8');
  const parsed = parseDtcgString(json);
  return { path, tokens: parsed.tokens, index: parsed.index, errors: parsed.errors };
}
