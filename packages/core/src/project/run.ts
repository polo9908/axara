/**
 * Whole-project orchestration: config → file collection → tokens resolution →
 * drift analysis → RGAA pass → score/gate → payload. This single code path is
 * shared by the CLI (`axaraaudit audit` / `fix`) and the MCP server
 * (`audit_project` / `fix_drift`) so every surface reports the same findings
 * and the same score for a given project state.
 */

import { existsSync, readFileSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { analyzeSource, auditSources, type AuditReport, type SourceFile } from '../analyzer/audit.js';
import { jsxToHtml } from '../analyzer/jsx-to-html.js';
import { fixFile, type FixFileResult } from '../fix/apply.js';
import { auditHtmlRgaa, PAGE_SCOPED_RULES } from '../rgaa/runner.js';
import { parseDtcgString } from '../tokens/dtcg.js';
import type { RgaaFinding } from '../rgaa/types.js';
import type { DriftIssue } from '../types.js';
import { loadRc, mergeRc, type AuditorRc, type AuditorRcInput, type LoadedRc } from './rc.js';
import { buildAuditPayload, type AuditPayload } from './payload.js';
import { computeScore, evaluateGate, type FileRgaaFinding, type GateResult } from './score.js';
import { loadTokensSource, type TokensSource } from './tokens-source.js';
import { tr } from '../i18n.js';
import { collectFiles } from './walk.js';

const JSX_EXT = new Set(['.tsx', '.jsx']);
const HTML_EXT = new Set(['.html', '.htm']);

/**
 * Where the audited tokens came from (adds `inline` for Pro remote tokens and
 * `none` when `checkFiles` runs RGAA-only in a token-less project).
 */
export interface ResolvedTokensSource {
  readonly origin: TokensSource['origin'] | 'inline' | 'none';
  readonly detail: string;
  /** Set when origin === 'auto' — lets callers build a localized message. */
  readonly count?: number;
  readonly sourceFileCount?: number;
}

/** Propagate the zero-config counters when the source provides them. */
function resolveSource(source: ResolvedTokensSource): ResolvedTokensSource {
  return {
    origin: source.origin,
    detail: source.detail,
    ...(source.count !== undefined ? { count: source.count } : {}),
    ...(source.sourceFileCount !== undefined ? { sourceFileCount: source.sourceFileCount } : {}),
  };
}

export interface ProjectAuditOptions {
  /** Project root the audit runs against. */
  readonly cwd: string;
  /** Identity of the producing surface, stamped into the payload. */
  readonly tool: string;
  readonly toolVersion: string;
  /** Explicit `.auditorrc.json` path (else discovered in `cwd`). */
  readonly configPath?: string | undefined;
  /** Pre-loaded config (e.g. after a Pro remote merge). Takes precedence. */
  readonly loaded?: LoadedRc | undefined;
  /** Last-mile overrides merged on top of the config (e.g. `--fail-under`). */
  readonly rcOverrides?: AuditorRcInput | undefined;
  /** Explicit DTCG tokens file (overrides the config's `tokens`). */
  readonly tokensPath?: string | undefined;
  /** In-memory DTCG document (Pro remote tokens). Beats every file source. */
  readonly inlineTokensJson?: string | undefined;
  /** Skip the RGAA pass even when the config enables it. */
  readonly skipRgaa?: boolean | undefined;
  /** Mark the payload's gate as `evaluated` (CI semantics). */
  readonly ciMode?: boolean | undefined;
}

export interface ProjectAuditResult {
  readonly payload: AuditPayload;
  readonly gate: GateResult;
  readonly loaded: LoadedRc;
  /** Effective config after overrides. */
  readonly rc: AuditorRc;
  /** Absolute paths of every analyzed file. */
  readonly files: readonly string[];
  readonly tokensSource: ResolvedTokensSource;
  readonly drift: AuditReport;
  readonly rgaaFindings: readonly FileRgaaFinding[];
}

/** Run the full open-source audit pipeline on a project directory. */
export async function auditProject(options: ProjectAuditOptions): Promise<ProjectAuditResult> {
  const loaded = options.loaded ?? loadRc(options.cwd, options.configPath);
  const rc =
    options.rcOverrides === undefined ? loaded.rc : mergeRc(loaded.rc, options.rcOverrides);

  const filePaths = collectFiles(loaded.rootDir, rc.include, rc.exclude, rc.extensions);
  const files: SourceFile[] = filePaths.map((path) => ({
    path,
    content: readFileSync(path, 'utf8'),
  }));

  let tokensJson: string;
  let tokensSource: ResolvedTokensSource;
  if (options.inlineTokensJson !== undefined) {
    tokensJson = options.inlineTokensJson;
    tokensSource = {
      origin: 'inline',
      detail: tr('tokens fournis en mémoire (config distante)', 'tokens provided in memory (remote config)'),
    };
  } else {
    const source = loadTokensSource(loaded, options.tokensPath, files);
    tokensJson = source.json;
    tokensSource = resolveSource(source);
  }

  const drift = auditSources(tokensJson, files, { remBasePx: rc.remBasePx });

  const rgaaEnabled = rc.rgaa.enabled && options.skipRgaa !== true;
  const rgaaFindings: FileRgaaFinding[] = [];
  let rgaaFilesAudited = 0;
  if (rgaaEnabled) {
    for (const file of files) {
      const ext = extname(file.path).toLowerCase();
      let html: string | null = null;
      if (JSX_EXT.has(ext)) html = jsxToHtml(file.content);
      else if (HTML_EXT.has(ext)) html = file.content;
      if (html === null || html.trim() === '') continue;

      rgaaFilesAudited += 1;
      const report = await auditHtmlRgaa(html, {
        contrast: rc.rgaa.contrast,
        ...(rc.rgaa.scope === 'component' ? { disableRules: PAGE_SCOPED_RULES } : {}),
      });
      for (const finding of report.findings) {
        // Findings are file-relative in the payload (stable contract, diffable).
        rgaaFindings.push({ file: relative(loaded.rootDir, file.path), finding });
      }
    }
  }

  const score = computeScore(drift.summary, rgaaFindings);
  const gate = evaluateGate(score, rgaaFindings, {
    failUnder: rc.ci.failUnder,
    blockOnCritical: rc.ci.blockOnCritical,
    priority: rc.rgaa.priority,
  });
  const payload = buildAuditPayload({
    tool: options.tool,
    toolVersion: options.toolVersion,
    project: rc.project,
    drift,
    rgaaEnabled,
    rgaaFilesAudited,
    rgaaFindings,
    gate,
    ciMode: options.ciMode === true,
  });

  return { payload, gate, loaded, rc, files: filePaths, tokensSource, drift, rgaaFindings };
}

export interface ProjectFixOptions {
  readonly cwd: string;
  readonly configPath?: string | undefined;
  readonly tokensPath?: string | undefined;
  /** Persist the fixes to disk. Default: false (dry-run preview). */
  readonly write?: boolean | undefined;
  /** Also apply nearest-token suggestions above `minConfidence`. Default: false. */
  readonly all?: boolean | undefined;
  /** Confidence floor for nearest-token suggestions. Default: 0.7. */
  readonly minConfidence?: number | undefined;
}

export interface ProjectFixResult {
  readonly loaded: LoadedRc;
  readonly tokensSource: ResolvedTokensSource;
  /** The pre-fix drift report the pass was computed from. */
  readonly report: AuditReport;
  /** Absolute paths of every scanned file. */
  readonly files: readonly string[];
  /** Per-file results, only for files with at least one applied fix. */
  readonly fixed: readonly FixFileResult[];
  readonly totalApplied: number;
  /** Issues the mechanical pass could not solve (near-misses, no-token…). */
  readonly remaining: readonly DriftIssue[];
}

/** Run the mechanical (position-verified) fix pass on a project directory. */
export function fixProject(options: ProjectFixOptions): ProjectFixResult {
  const loaded = loadRc(options.cwd, options.configPath);
  const filePaths = collectFiles(
    loaded.rootDir,
    loaded.rc.include,
    loaded.rc.exclude,
    loaded.rc.extensions,
  );
  const files: SourceFile[] = filePaths.map((path) => ({
    path,
    content: readFileSync(path, 'utf8'),
  }));

  const source = loadTokensSource(loaded, options.tokensPath, files);
  const report = auditSources(source.json, files, { remBasePx: loaded.rc.remBasePx });

  const byFile = new Map<string, DriftIssue[]>();
  for (const issue of report.issues) {
    const list = byFile.get(issue.file) ?? [];
    list.push(issue);
    byFile.set(issue.file, list);
  }

  const write = options.write === true;
  const all = options.all === true;
  const minConfidence = options.minConfidence ?? 0.7;

  const fixed: FixFileResult[] = [];
  const appliedKeys = new Set<string>();
  let totalApplied = 0;
  for (const [path, issues] of byFile) {
    const result = fixFile(path, issues, {
      dryRun: !write,
      onlyAutoFixable: !all,
      minConfidence,
    });
    if (result.applied.length === 0) continue;
    totalApplied += result.applied.length;
    for (const fix of result.applied) {
      appliedKeys.add(`${path}:${fix.line}:${fix.column}`);
    }
    fixed.push(result);
  }

  const remaining = report.issues.filter(
    (issue) => !appliedKeys.has(`${issue.file}:${issue.line}:${issue.column}`),
  );

  return {
    loaded,
    tokensSource: resolveSource(source),
    report,
    files: filePaths,
    fixed,
    totalApplied,
    remaining,
  };
}

export interface ProjectCheckOptions {
  readonly cwd: string;
  /** Files to validate (absolute, or relative to `cwd`). */
  readonly files: readonly string[];
  readonly configPath?: string | undefined;
  readonly tokensPath?: string | undefined;
  /** Skip the RGAA pass even when the config enables it. */
  readonly skipRgaa?: boolean | undefined;
}

export interface FileCheckResult {
  /** Path relative to `cwd`. */
  readonly file: string;
  /** True when the file was missing or its extension is not analyzable. */
  readonly skipped: boolean;
  readonly drift: readonly DriftIssue[];
  readonly rgaa: readonly RgaaFinding[];
}

export interface ProjectCheckResult {
  readonly loaded: LoadedRc;
  readonly tokensSource: ResolvedTokensSource;
  readonly files: readonly FileCheckResult[];
  readonly summary: {
    readonly filesChecked: number;
    readonly filesSkipped: number;
    readonly driftIssues: number;
    readonly rgaaFailed: number;
    readonly rgaaToReview: number;
  };
  /** No drift at all and no failed RGAA criterion (cantTell doesn't block). */
  readonly conformant: boolean;
}

/**
 * Validate a handful of specific files (drift + RGAA) without walking the
 * whole project — the fast path for editor/agent hooks that fire on every
 * write. Same config, tokens resolution and analyzers as `auditProject`; the
 * project is only walked when the zero-config CSS token extraction is needed.
 */
export async function checkFiles(options: ProjectCheckOptions): Promise<ProjectCheckResult> {
  const loaded = loadRc(options.cwd, options.configPath);
  const rc = loaded.rc;

  // Tokens: cheap path first (declared/overridden DTCG file); walk the project
  // for the CSS custom-properties fallback only when there is no such file.
  // A project with no design system at all is still checkable — RGAA-only.
  let source: ResolvedTokensSource & { readonly json: string };
  try {
    source = loadTokensSource(loaded, options.tokensPath, []);
  } catch {
    try {
      const cssPaths = collectFiles(loaded.rootDir, rc.include, rc.exclude, rc.extensions);
      const cssFiles: SourceFile[] = cssPaths.map((path) => ({
        path,
        content: readFileSync(path, 'utf8'),
      }));
      source = loadTokensSource(loaded, options.tokensPath, cssFiles);
    } catch (error) {
      // An explicit tokensPath that cannot be loaded is a user error.
      if (options.tokensPath !== undefined) throw error;
      source = {
        json: '{}',
        origin: 'none',
        detail: tr(
          'aucun design system détecté — validation RGAA uniquement',
          'no design system detected — RGAA-only validation',
        ),
      };
    }
  }
  const index = parseDtcgString(source.json, { remBasePx: rc.remBasePx }).index;

  const analyzable = new Set(rc.extensions.map((ext) => ext.toLowerCase()));
  const rgaaEnabled = rc.rgaa.enabled && options.skipRgaa !== true;

  const results: FileCheckResult[] = [];
  for (const entry of options.files) {
    const abs = isAbsolute(entry) ? entry : resolve(options.cwd, entry);
    const rel = relative(options.cwd, abs);
    const ext = extname(abs).toLowerCase();
    if (!existsSync(abs) || !analyzable.has(ext)) {
      results.push({ file: rel, skipped: true, drift: [], rgaa: [] });
      continue;
    }

    const content = readFileSync(abs, 'utf8');
    // No design system → no meaningful drift baseline; RGAA still applies.
    const drift = source.origin === 'none' ? [] : analyzeSource({ path: abs, content }, index);

    let rgaa: readonly RgaaFinding[] = [];
    if (rgaaEnabled) {
      let html: string | null = null;
      if (JSX_EXT.has(ext)) html = jsxToHtml(content);
      else if (HTML_EXT.has(ext)) html = content;
      if (html !== null && html.trim() !== '') {
        const report = await auditHtmlRgaa(html, {
          contrast: rc.rgaa.contrast,
          ...(rc.rgaa.scope === 'component' ? { disableRules: PAGE_SCOPED_RULES } : {}),
        });
        rgaa = report.findings;
      }
    }

    results.push({ file: rel, skipped: false, drift, rgaa });
  }

  const driftIssues = results.reduce((n, r) => n + r.drift.length, 0);
  const rgaaFailed = results.reduce(
    (n, r) => n + r.rgaa.filter((f) => f.status === 'failed').length,
    0,
  );
  const rgaaToReview = results.reduce(
    (n, r) => n + r.rgaa.filter((f) => f.status === 'cantTell').length,
    0,
  );

  return {
    loaded,
    tokensSource: resolveSource(source),
    files: results,
    summary: {
      filesChecked: results.filter((r) => !r.skipped).length,
      filesSkipped: results.filter((r) => r.skipped).length,
      driftIssues,
      rgaaFailed,
      rgaaToReview,
    },
    conformant: driftIssues === 0 && rgaaFailed === 0,
  };
}
