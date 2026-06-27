/**
 * High-level audit orchestration: load tokens, route each source file to the
 * right analyzer by extension, and aggregate a single report. This is the
 * entry point the CLI and MCP server build on.
 */

import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { parseDtcgString } from '../tokens/dtcg.js';
import type { TokenIndex } from '../tokens/dtcg.js';
import type { DesignToken, DriftIssue } from '../types.js';
import { analyzeCss } from './css.js';
import { analyzeTsx } from './tsx.js';

const CSS_EXT = new Set(['.css', '.scss', '.less', '.pcss']);
const TSX_EXT = new Set(['.tsx', '.ts', '.jsx', '.js', '.mts', '.cts']);

export interface AuditSummary {
  readonly filesScanned: number;
  readonly totalIssues: number;
  readonly errors: number;
  readonly warnings: number;
  readonly autoFixable: number;
}

export interface AuditReport {
  readonly tokens: readonly DesignToken[];
  readonly tokenErrors: readonly string[];
  readonly issues: readonly DriftIssue[];
  readonly summary: AuditSummary;
}

export interface SourceFile {
  readonly path: string;
  readonly content: string;
}

export interface AuditOptions {
  readonly remBasePx?: number;
}

/** Analyze a single in-memory source file against an already-built index. */
export function analyzeSource(file: SourceFile, index: TokenIndex): DriftIssue[] {
  const ext = extname(file.path).toLowerCase();
  if (CSS_EXT.has(ext)) return analyzeCss(file.content, index, { file: file.path });
  if (TSX_EXT.has(ext)) return analyzeTsx(file.content, index, { file: file.path });
  return [];
}

function summarize(filesScanned: number, issues: readonly DriftIssue[]): AuditSummary {
  let errors = 0;
  let warnings = 0;
  let autoFixable = 0;
  for (const issue of issues) {
    if (issue.severity === 'error') errors += 1;
    else warnings += 1;
    if (issue.autoFixable) autoFixable += 1;
  }
  return { filesScanned, totalIssues: issues.length, errors, warnings, autoFixable };
}

/** Audit in-memory sources against an in-memory DTCG token document. */
export function auditSources(
  tokensJson: string,
  files: readonly SourceFile[],
  options: AuditOptions = {},
): AuditReport {
  const parsed = parseDtcgString(
    tokensJson,
    options.remBasePx === undefined ? {} : { remBasePx: options.remBasePx },
  );
  const issues: DriftIssue[] = [];
  for (const file of files) {
    issues.push(...analyzeSource(file, parsed.index));
  }
  return {
    tokens: parsed.tokens,
    tokenErrors: parsed.errors,
    issues,
    summary: summarize(files.length, issues),
  };
}

/** Audit files on disk against a DTCG token file on disk. */
export function auditPaths(
  tokensPath: string,
  filePaths: readonly string[],
  options: AuditOptions = {},
): AuditReport {
  const tokensJson = readFileSync(tokensPath, 'utf8');
  const files: SourceFile[] = filePaths.map((path) => ({
    path,
    content: readFileSync(path, 'utf8'),
  }));
  return auditSources(tokensJson, files, options);
}
