/**
 * Static TSX/JSX analyzer (TypeScript Compiler API).
 *
 * Two passes over the AST:
 *  1. Inline `style={{ … }}` objects — property names give us the CSS context,
 *     so both colors and spacing are checked with the right semantics (a bare
 *     numeric on a spacing prop is treated as `px`, matching React).
 *  2. Every other string / template literal — scanned for color literals only
 *     (catches styled-components, theme constants, class-variance maps, …),
 *     where there is no property context to justify a spacing check.
 */

import ts from 'typescript';
import type { TokenIndex } from '../tokens/dtcg.js';
import type { DriftIssue } from '../types.js';
import { isSpacingProperty } from './css.js';
import { evaluateColor, evaluateDimension, type LiteralOccurrence } from './evaluate.js';
import { extractColors, extractDimensions } from './extract.js';

/** `backgroundColor` → `background-color`; leading caps (Webkit…) kept as `-`. */
function camelToKebab(name: string): string {
  return name.replace(/([A-Z])/g, '-$1').toLowerCase();
}

export interface TsxAnalyzeOptions {
  readonly file?: string;
}

export function analyzeTsx(
  source: string,
  index: TokenIndex,
  options: TsxAnalyzeOptions = {},
): DriftIssue[] {
  const file = options.file ?? '<tsx>';
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const issues: DriftIssue[] = [];
  const consumed = new Set<ts.Node>();

  const positionAt = (node: ts.Node, charOffset: number): { line: number; column: number } => {
    const lc = sf.getLineAndCharacterOfPosition(node.getStart(sf) + charOffset);
    return { line: lc.line + 1, column: lc.character + 1 };
  };

  const pushColor = (node: ts.Node, quoteOffset: number, property: string, text: string): void => {
    for (const occ of extractColors(text)) {
      const pos = positionAt(node, quoteOffset + occ.offset);
      const occurrence: LiteralOccurrence = {
        file,
        line: pos.line,
        column: pos.column,
        property,
        value: occ.raw,
      };
      const issue = evaluateColor(occurrence, index);
      if (issue) issues.push(issue);
    }
  };

  const pushDimension = (
    node: ts.Node,
    quoteOffset: number,
    property: string,
    text: string,
  ): void => {
    for (const occ of extractDimensions(text)) {
      const pos = positionAt(node, quoteOffset + occ.offset);
      const occurrence: LiteralOccurrence = {
        file,
        line: pos.line,
        column: pos.column,
        property,
        value: occ.raw,
      };
      const issue = evaluateDimension(occurrence, index);
      if (issue) issues.push(issue);
    }
  };

  const getStyleObject = (node: ts.Node): ts.ObjectLiteralExpression | null => {
    if (
      ts.isJsxAttribute(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'style' &&
      node.initializer &&
      ts.isJsxExpression(node.initializer) &&
      node.initializer.expression &&
      ts.isObjectLiteralExpression(node.initializer.expression)
    ) {
      return node.initializer.expression;
    }
    return null;
  };

  const processStyleObject = (obj: ts.ObjectLiteralExpression): void => {
    for (const prop of obj.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const nameNode = prop.name;
      let key: string;
      if (ts.isIdentifier(nameNode)) key = nameNode.text;
      else if (ts.isStringLiteral(nameNode)) key = nameNode.text;
      else continue;

      const cssProp = camelToKebab(key);
      const spacing = isSpacingProperty(cssProp);
      const value = prop.initializer;

      if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
        consumed.add(value);
        pushColor(value, 1, cssProp, value.text);
        if (spacing) pushDimension(value, 1, cssProp, value.text);
      } else if (ts.isNumericLiteral(value) && spacing) {
        // React renders a bare number on a length property as pixels.
        pushDimension(value, 0, cssProp, `${value.text}px`);
      }
    }
  };

  // Pass 1: inline style objects.
  const visitStyles = (node: ts.Node): void => {
    const obj = getStyleObject(node);
    if (obj) processStyleObject(obj);
    ts.forEachChild(node, visitStyles);
  };
  visitStyles(sf);

  // Pass 2: every remaining string-like literal, colors only.
  const visitLiterals = (node: ts.Node): void => {
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      !consumed.has(node)
    ) {
      pushColor(node, 1, 'literal', node.text);
    }
    ts.forEachChild(node, visitLiterals);
  };
  visitLiterals(sf);

  return issues.sort((a, b) => a.line - b.line || a.column - b.column);
}
