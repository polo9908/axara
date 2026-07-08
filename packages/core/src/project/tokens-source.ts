/**
 * Tokens resolution with a zero-config fallback.
 *
 * Preferred source: the DTCG file declared in `.auditorrc.json` (or an explicit
 * override). When none exists, the design system is extracted automatically
 * from the CSS custom properties already present in the scanned files — so an
 * audit produces useful results on any repo with zero setup.
 */

import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { extractCssVarTokens, type CssSource } from '../tokens/css-vars.js';
import { ConfigError, resolveRcTokensPath, type LoadedRc } from './rc.js';

const CSS_EXT = new Set(['.css', '.scss', '.less', '.pcss']);
/** Below this, the extracted set is probably noise, not a design system. */
const MIN_AUTO_TOKENS = 3;

export interface TokensSource {
  readonly json: string;
  readonly origin: 'file' | 'auto';
  /** Human-readable description of where the tokens came from. */
  readonly detail: string;
  /** Set when origin === 'auto' — lets callers build a localized message. */
  readonly count?: number;
  readonly sourceFileCount?: number;
}

export interface ScannedFile {
  readonly path: string;
  readonly content: string;
}

export function loadTokensSource(
  loaded: LoadedRc,
  override: string | undefined,
  files: readonly ScannedFile[],
): TokensSource {
  try {
    const path = resolveRcTokensPath(loaded, override);
    return {
      json: readFileSync(path, 'utf8').replace(/^﻿/, ''),
      origin: 'file',
      detail: path,
    };
  } catch (error) {
    // An explicit --tokens that doesn't exist is a user error, not a fallback case.
    if (!(error instanceof ConfigError) || override !== undefined) throw error;

    const cssSources: CssSource[] = files.filter((file) =>
      CSS_EXT.has(extname(file.path).toLowerCase()),
    );
    const extraction = extractCssVarTokens(cssSources, { remBasePx: loaded.rc.remBasePx });
    if (extraction.count < MIN_AUTO_TOKENS) throw error;

    return {
      json: JSON.stringify(extraction.document),
      origin: 'auto',
      detail: `${extraction.count} tokens extraits de ${extraction.sourceFiles.length} fichier(s) CSS`,
      count: extraction.count,
      sourceFileCount: extraction.sourceFiles.length,
    };
  }
}
