/**
 * Static CSS analyzer (PostCSS).
 *
 * Colors are inspected on every declaration (they appear inside shorthands,
 * gradients, shadows, …). Dimensions are inspected only on spacing-related
 * properties, since lengths like `font-size` or `border-radius` are legitimate
 * non-token values in many systems and would otherwise be noise.
 */

import postcss, { type Declaration } from 'postcss';
import type { TokenIndex } from '../tokens/dtcg.js';
import type { DriftIssue } from '../types.js';
import { evaluateColor, evaluateDimension, type LiteralOccurrence } from './evaluate.js';
import { extractColors, extractDimensions } from './extract.js';

const SPACING_PROP_RE =
  /^(?:margin|padding|inset)(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?$/;
const GAP_PROP_RE = /^(?:gap|row-gap|column-gap|grid-gap)$/;
const EDGE_PROP_RE = /^(?:top|right|bottom|left)$/;
const BORDER_WIDTH_RE = /^border(?:-(?:top|right|bottom|left))?-width$/;

export function isSpacingProperty(prop: string): boolean {
  return (
    SPACING_PROP_RE.test(prop) ||
    GAP_PROP_RE.test(prop) ||
    EDGE_PROP_RE.test(prop) ||
    BORDER_WIDTH_RE.test(prop)
  );
}

/** Advance a 1-based (line, column) position by consuming `text`. */
function advance(line: number, column: number, text: string): { line: number; column: number } {
  let l = line;
  let c = column;
  for (const ch of text) {
    if (ch === '\n') {
      l += 1;
      c = 1;
    } else {
      c += 1;
    }
  }
  return { line: l, column: c };
}

function locate(
  decl: Declaration,
  offsetInValue: number,
): { line: number; column: number } {
  const start = decl.source?.start ?? { line: 1, column: 1 };
  const between = decl.raws.between ?? ': ';
  const prefix = decl.prop + between + decl.value.slice(0, offsetInValue);
  return advance(start.line, start.column, prefix);
}

export interface CssAnalyzeOptions {
  /** Logical file name attached to issues. Defaults to `<css>`. */
  readonly file?: string;
}

/** Analyze a CSS source string against the token index. */
export function analyzeCss(
  css: string,
  index: TokenIndex,
  options: CssAnalyzeOptions = {},
): DriftIssue[] {
  const file = options.file ?? '<css>';
  const root = postcss.parse(css, { from: file });
  const issues: DriftIssue[] = [];

  root.walkDecls((decl) => {
    const prop = decl.prop.toLowerCase();

    for (const occ of extractColors(decl.value)) {
      const pos = locate(decl, occ.offset);
      const occurrence: LiteralOccurrence = {
        file,
        line: pos.line,
        column: pos.column,
        property: prop,
        value: occ.raw,
      };
      const issue = evaluateColor(occurrence, index);
      if (issue) issues.push(issue);
    }

    if (isSpacingProperty(prop)) {
      for (const occ of extractDimensions(decl.value)) {
        const pos = locate(decl, occ.offset);
        const occurrence: LiteralOccurrence = {
          file,
          line: pos.line,
          column: pos.column,
          property: prop,
          value: occ.raw,
        };
        const issue = evaluateDimension(occurrence, index);
        if (issue) issues.push(issue);
      }
    }
  });

  return issues;
}
