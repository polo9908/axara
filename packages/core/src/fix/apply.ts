/**
 * Safe, position-based auto-fix.
 *
 * Applies design-drift remediations by their exact (line, column) location
 * rather than by blind text replacement, so we never touch an identical literal
 * elsewhere (a comment, an unrelated rule, …). Before replacing, we *verify* that
 * the source slice at the recorded position equals the reported value; anything
 * that doesn't match byte-for-byte is skipped (e.g. a React numeric `padding: 8`
 * whose normalized value is `8px` but whose source text is `8`).
 *
 * By default only `autoFixable` issues (exact-token matches) are applied — the
 * uncertain "nearest-token" suggestions are never written automatically.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import type { DriftIssue } from '../types.js';

export interface AppliedFix {
  readonly line: number;
  readonly column: number;
  readonly from: string;
  readonly to: string;
}

export interface FixResult {
  /** The rewritten content. */
  readonly content: string;
  /** Fixes that were applied. */
  readonly applied: readonly AppliedFix[];
  /** Fixable issues whose source slice did not match and were left untouched. */
  readonly skipped: readonly DriftIssue[];
  readonly changed: boolean;
}

export interface ApplyFixesOptions {
  /** Only apply safe exact-token fixes. Default: true. */
  readonly onlyAutoFixable?: boolean;
  /**
   * When `onlyAutoFixable` is false, nearest-token suggestions below this
   * confidence (0–1) are skipped instead of applied. Default: 0.7.
   * Issues with no close token (`match: 'no-token'`) are never applied.
   */
  readonly minConfidence?: number;
}

/** Offset (0-based) of the start of each 1-based line. */
function lineStartOffsets(content: string): number[] {
  const starts = [0];
  for (let i = 0; i < content.length; i += 1) {
    if (content[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

interface Candidate {
  readonly offset: number;
  readonly length: number;
  readonly to: string;
  readonly issue: DriftIssue;
}

/** Apply auto-fixes to a single source string. Pure (no I/O). */
export function applyFixes(
  content: string,
  issues: readonly DriftIssue[],
  options: ApplyFixesOptions = {},
): FixResult {
  const onlyAutoFixable = options.onlyAutoFixable ?? true;
  const minConfidence = options.minConfidence ?? 0.7;
  const starts = lineStartOffsets(content);

  const candidates: Candidate[] = [];
  const skipped: DriftIssue[] = [];

  for (const issue of issues) {
    if (!issue.suggestion) continue;
    if (!issue.autoFixable) {
      if (onlyAutoFixable) continue;
      // Opt-in mode: apply near-match suggestions, but never wild guesses.
      if (issue.match !== 'nearest-token' || issue.suggestion.confidence < minConfidence) {
        skipped.push(issue);
        continue;
      }
    }

    const lineStart = starts[issue.line - 1];
    if (lineStart === undefined) {
      skipped.push(issue);
      continue;
    }
    const offset = lineStart + (issue.column - 1);
    const slice = content.slice(offset, offset + issue.value.length);
    // Verify the source actually holds the literal we think it does.
    if (slice !== issue.value) {
      skipped.push(issue);
      continue;
    }
    candidates.push({ offset, length: issue.value.length, to: issue.suggestion.replacement, issue });
  }

  // Apply from the end of the file backwards so earlier offsets stay valid.
  candidates.sort((a, b) => b.offset - a.offset);

  let result = content;
  const applied: AppliedFix[] = [];
  let lastOffset = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    // Guard against overlapping replacements.
    if (candidate.offset + candidate.length > lastOffset) {
      skipped.push(candidate.issue);
      continue;
    }
    result =
      result.slice(0, candidate.offset) + candidate.to + result.slice(candidate.offset + candidate.length);
    applied.push({
      line: candidate.issue.line,
      column: candidate.issue.column,
      from: candidate.issue.value,
      to: candidate.to,
    });
    lastOffset = candidate.offset;
  }

  applied.reverse(); // report in source order
  return { content: result, applied, skipped, changed: result !== content };
}

export interface FixFileResult extends FixResult {
  readonly path: string;
  /** True when changes were written to disk (false in dry-run). */
  readonly written: boolean;
}

export interface FixFileOptions extends ApplyFixesOptions {
  /** Preview only — do not write the file. Default: false. */
  readonly dryRun?: boolean;
}

/**
 * Apply fixes to a file on disk. `issues` must be the drift issues whose `file`
 * corresponds to `path` (their line/column refer to this file's content).
 */
export function fixFile(
  path: string,
  issues: readonly DriftIssue[],
  options: FixFileOptions = {},
): FixFileResult {
  const content = readFileSync(path, 'utf8');
  const result = applyFixes(content, issues, options);
  const dryRun = options.dryRun ?? false;
  let written = false;
  if (result.changed && !dryRun) {
    writeFileSync(path, result.content, 'utf8');
    written = true;
  }
  return { ...result, path, written };
}
