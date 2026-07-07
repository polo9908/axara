/**
 * Whole-project orchestration: config → file collection → tokens resolution →
 * drift analysis → RGAA pass → score/gate → payload. This single code path is
 * shared by the CLI (`axaraaudit audit` / `fix`) and the MCP server
 * (`audit_project` / `fix_drift`) so every surface reports the same findings
 * and the same score for a given project state.
 */

import { readFileSync } from 'node:fs';
import { extname, relative } from 'node:path';
import { auditSources, type AuditReport, type SourceFile } from '../analyzer/audit.js';
import { jsxToHtml } from '../analyzer/jsx-to-html.js';
import { fixFile, type FixFileResult } from '../fix/apply.js';
import { auditHtmlRgaa, PAGE_SCOPED_RULES } from '../rgaa/runner.js';
import type { DriftIssue } from '../types.js';
import { loadRc, mergeRc, type AuditorRc, type AuditorRcInput, type LoadedRc } from './rc.js';
import { buildAuditPayload, type AuditPayload } from './payload.js';
import { computeScore, evaluateGate, type FileRgaaFinding, type GateResult } from './score.js';
import { loadTokensSource, type TokensSource } from './tokens-source.js';
import { collectFiles } from './walk.js';

const JSX_EXT = new Set(['.tsx', '.jsx']);
const HTML_EXT = new Set(['.html', '.htm']);

/** Where the audited tokens came from (adds `inline` for Pro remote tokens). */
export interface ResolvedTokensSource {
  readonly origin: TokensSource['origin'] | 'inline';
  readonly detail: string;
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
    tokensSource = { origin: 'inline', detail: 'tokens fournis en mémoire (config distante)' };
  } else {
    const source = loadTokensSource(loaded, options.tokensPath, files);
    tokensJson = source.json;
    tokensSource = { origin: source.origin, detail: source.detail };
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
    tokensSource: { origin: source.origin, detail: source.detail },
    report,
    files: filePaths,
    fixed,
    totalApplied,
    remaining,
  };
}
