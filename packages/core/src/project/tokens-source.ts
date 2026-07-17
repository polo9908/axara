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
import { tr } from '../i18n.js';
import { extractCssVarTokens, type CssSource } from '../tokens/css-vars.js';
import { ConfigError, resolveRcTokensPath, type LoadedRc } from './rc.js';

const CSS_EXT = new Set(['.css', '.scss', '.less', '.pcss']);
/** Below this, the extracted set is probably noise, not a design system. */
const MIN_AUTO_TOKENS = 3;

export interface TokensSource {
  readonly json: string;
  readonly origin: 'file' | 'auto' | 'none';
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

/** Source used when the project explicitly or effectively has no design system. */
function noneSource(detail: string): TokensSource {
  return { json: '{}', origin: 'none', detail };
}

export function loadTokensSource(
  loaded: LoadedRc,
  override: string | undefined,
  files: readonly ScannedFile[],
): TokensSource {
  // Explicit opt-out ("tokens": false): no drift baseline, and no CSS-vars
  // auto-extraction either — the user said there is no design system.
  if (override === undefined && loaded.rc.tokens === false) {
    throw new ConfigError(
      tr(
        'Design system désactivé ("tokens": false).',
        'Design system disabled ("tokens": false).',
      ),
    );
  }
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

/**
 * Lenient variant: a project without any design system (no DTCG file, too few
 * CSS vars, or an explicit `"tokens": false`) degrades to an RGAA-only source
 * instead of failing. An explicit `--tokens` override that cannot be loaded
 * remains a user error and rethrows.
 */
export function resolveTokensSourceLenient(
  loaded: LoadedRc,
  override: string | undefined,
  files: readonly ScannedFile[],
): TokensSource {
  try {
    return loadTokensSource(loaded, override, files);
  } catch (error) {
    if (!(error instanceof ConfigError) || override !== undefined) throw error;
    return noneSource(
      loaded.rc.tokens === false
        ? tr(
            'design system désactivé ("tokens": false) — audit RGAA uniquement',
            'design system disabled ("tokens": false) — RGAA-only audit',
          )
        : tr(
            'aucun design system détecté — audit RGAA uniquement',
            'no design system detected — RGAA-only audit',
          ),
    );
  }
}
