/**
 * `.auditorrc.json` — local configuration of the open-source auditor.
 *
 * The resolved config is always complete (defaults fill every gap) so callers
 * never deal with `undefined` sections. A remote Pro config, when enabled, is
 * merged on top of the local file with the same rules. Shared by every surface
 * (CLI, MCP server) so a project behaves identically whoever runs the audit.
 */

import { existsSync, readFileSync } from 'node:fs';
import { basename, isAbsolute, resolve } from 'node:path';
import { tr } from '../i18n.js';

export const RC_FILENAME = '.auditorrc.json';

/** Raised for any unusable configuration; the CLI exits with code 2. */
export class ConfigError extends Error {}

export interface RgaaConfig {
  /** Run the axe-core → RGAA pass on JSX/HTML files. */
  readonly enabled: boolean;
  /** `component` disables page-level rules (h1, landmarks…) for snippets. */
  readonly scope: 'component' | 'page';
  /** Evaluate contrast rules (needs real layout; noisy under JSDOM). */
  readonly contrast: boolean;
  /**
   * RGAA criteria audited in priority (e.g. `["1.1", "11.1"]`). A failed
   * finding on one of these blocks the CI gate regardless of axe impact.
   */
  readonly priority: readonly string[];
}

export interface CiConfig {
  /** Gate fails when the 0–100 conformity score drops below this. */
  readonly failUnder: number;
  /** Gate fails on any critical/serious RGAA violation. */
  readonly blockOnCritical: boolean;
}

/**
 * Exception justifiée : une violation acceptée (dette assumée, faux positif,
 * dérogation art. 47). Elle ne compte plus dans le score ni dans le gate CI —
 * le build ne doit JAMAIS échouer sur un critère couvert par une exception
 * justifiée — mais elle reste tracée dans la section `excepted` du rapport.
 * `reason` est obligatoire et non vide : pas de justification, pas
 * d'exception. Deux formes, exclusives :
 *   - ciblée   : `{ "fingerprint": "…" }` — une violation précise (empreinte
 *     stable du rapport JSON) ;
 *   - récurrente : `{ "rule": "RGAA-3.2" | "color" | "margin" | "drift",
 *     "files": ["src/legacy/**"] }` — une règle à l'échelle du repo,
 *     optionnellement restreinte par globs (`files` absent = partout).
 * Justified exception: an accepted violation (assumed debt, false positive,
 * art. 47 derogation). It no longer counts toward the score or the CI gate —
 * the build must NEVER fail on a criterion covered by a justified exception —
 * but it stays traced in the report's `excepted` section. `reason` is
 * mandatory and non-empty. Two mutually exclusive forms: targeted
 * (`fingerprint`) or recurring (`rule` + optional `files` globs).
 */
export interface AuditExceptionEntry {
  /** Empreinte de la violation (`fingerprint` du rapport JSON). */
  readonly fingerprint?: string;
  /** Règle récurrente : critère RGAA, catégorie/propriété drift, ou `drift`. */
  readonly rule?: string;
  /** Globs POSIX limitant la règle (défaut : tout le repo). */
  readonly files?: readonly string[];
  /** Justification humaine — obligatoire, tracée dans le rapport. */
  readonly reason: string;
  /** Date ISO (AAAA-MM-JJ) après laquelle l'exception expire. */
  readonly expires?: string;
}

/** Pro gateway settings. The auditor stays a sensor: endpoints only, no SaaS logic. */
export interface ProConfig {
  readonly apiUrl: string;
  /** Push the JSON report to the Pro API after each audit. */
  readonly upload: boolean;
  /** Pull rules/tokens from the Pro API instead of the local files. */
  readonly remoteConfig: boolean;
}

export interface AuditorRc {
  readonly project: string;
  /**
   * Path to the DTCG design-tokens document, relative to the rc file.
   * `false` = no design system: drift is skipped, the audit runs RGAA-only.
   */
  readonly tokens: string | false;
  readonly include: readonly string[];
  readonly exclude: readonly string[];
  readonly extensions: readonly string[];
  readonly remBasePx: number;
  readonly rgaa: RgaaConfig;
  readonly ci: CiConfig;
  readonly pro: ProConfig;
  /** Violations acceptées, par empreinte — voir AuditExceptionEntry. */
  readonly exceptions: readonly AuditExceptionEntry[];
}

/** Deep-partial shape accepted from `.auditorrc.json` and the remote API. */
export interface AuditorRcInput {
  readonly project?: string;
  readonly tokens?: string | false;
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
  readonly extensions?: readonly string[];
  readonly remBasePx?: number;
  readonly rgaa?: Partial<RgaaConfig>;
  readonly ci?: Partial<CiConfig>;
  readonly pro?: Partial<ProConfig>;
  readonly exceptions?: readonly AuditExceptionEntry[];
}

export const DEFAULT_RC: AuditorRc = {
  project: '',
  tokens: './design-tokens.dtcg.json',
  include: ['.'],
  exclude: ['node_modules', 'dist', 'build', 'coverage', '.next', '.git'],
  extensions: ['.css', '.scss', '.less', '.tsx', '.jsx', '.ts', '.js', '.html'],
  remBasePx: 16,
  rgaa: { enabled: true, scope: 'component', contrast: false, priority: [] },
  ci: { failUnder: 80, blockOnCritical: true },
  pro: { apiUrl: 'https://api.axara.dev', upload: false, remoteConfig: false },
  exceptions: [],
};

/** Merge a partial config (local file or remote payload) over a base config. */
export function mergeRc(base: AuditorRc, input: AuditorRcInput): AuditorRc {
  return {
    project: input.project ?? base.project,
    tokens: input.tokens ?? base.tokens,
    include: input.include ?? base.include,
    exclude: input.exclude ?? base.exclude,
    extensions: input.extensions ?? base.extensions,
    remBasePx: input.remBasePx ?? base.remBasePx,
    rgaa: { ...base.rgaa, ...(input.rgaa ?? {}) },
    ci: { ...base.ci, ...(input.ci ?? {}) },
    pro: { ...base.pro, ...(input.pro ?? {}) },
    exceptions: input.exceptions ?? base.exceptions,
  };
}

export interface LoadedRc {
  readonly rc: AuditorRc;
  /** Absolute path of the rc file, or null when running on pure defaults. */
  readonly rcPath: string | null;
  /** Directory all relative paths (tokens, include) resolve against. */
  readonly rootDir: string;
}

function parseJsonLenient(raw: string, path: string): unknown {
  try {
    // Tolerate a UTF-8 BOM: Windows editors add one and JSON.parse rejects it.
    return JSON.parse(raw.replace(/^﻿/, ''));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ConfigError(
      tr(`${path} n'est pas un JSON valide : ${reason}`, `${path} is not valid JSON: ${reason}`),
    );
  }
}

/**
 * Load `.auditorrc.json` from `cwd` (or an explicit path) and resolve it
 * against the defaults. Missing rc file is fine; missing tokens file is not.
 */
export function loadRc(cwd: string, explicitPath?: string): LoadedRc {
  let rcPath: string | null = null;

  if (explicitPath !== undefined) {
    rcPath = isAbsolute(explicitPath) ? explicitPath : resolve(cwd, explicitPath);
    if (!existsSync(rcPath)) {
      throw new ConfigError(
        tr(`Fichier de configuration introuvable : ${rcPath}`, `Config file not found: ${rcPath}`),
      );
    }
  } else {
    const candidate = resolve(cwd, RC_FILENAME);
    if (existsSync(candidate)) rcPath = candidate;
  }

  let rc = DEFAULT_RC;
  if (rcPath !== null) {
    const parsed = parseJsonLenient(readFileSync(rcPath, 'utf8'), rcPath);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new ConfigError(
        tr(`${rcPath} doit contenir un objet JSON.`, `${rcPath} must contain a JSON object.`),
      );
    }
    rc = mergeRc(DEFAULT_RC, parsed as AuditorRcInput);
  }

  if (rc.project === '') {
    rc = mergeRc(rc, { project: basename(cwd) });
  }

  return { rc, rcPath, rootDir: cwd };
}

/** Absolute path of the tokens document declared by the config. */
export function resolveRcTokensPath(loaded: LoadedRc, override?: string): string {
  const raw = override ?? loaded.rc.tokens;
  if (raw === false) {
    throw new ConfigError(
      tr(
        `Design system désactivé ("tokens": false dans ${RC_FILENAME}).`,
        `Design system disabled ("tokens": false in ${RC_FILENAME}).`,
      ),
    );
  }
  const abs = isAbsolute(raw) ? raw : resolve(loaded.rootDir, raw);
  if (!existsSync(abs)) {
    throw new ConfigError(
      tr(
        `Fichier de tokens introuvable : ${abs}\n` +
          `Déclarez "tokens" dans ${RC_FILENAME} ou lancez \`axaraaudit init\`.`,
        `Tokens file not found: ${abs}\n` +
          `Declare "tokens" in ${RC_FILENAME} or run \`axaraaudit init\`.`,
      ),
    );
  }
  return abs;
}
