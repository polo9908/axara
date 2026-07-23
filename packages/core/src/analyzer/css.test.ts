import { describe, expect, it } from 'vitest';
import { parseDtcg } from '../tokens/dtcg.js';
import { analyzeCss } from './css.js';

const { index } = parseDtcg({
  color: {
    $type: 'color',
    brand: { $value: '#3b82f6' },
    text: { $value: '#111827' },
  },
  space: {
    $type: 'dimension',
    sm: { $value: '8px' },
    md: { $value: '16px' },
  },
});

describe('analyzeCss', () => {
  it('flags a hard-coded color that exactly matches a token as auto-fixable', () => {
    const issues = analyzeCss('.btn { color: #3b82f6; }', index);
    expect(issues).toHaveLength(1);
    const issue = issues[0]!;
    expect(issue.category).toBe('color');
    expect(issue.match).toBe('exact-token');
    expect(issue.autoFixable).toBe(true);
    expect(issue.suggestion!.replacement).toBe('var(--color-brand)');
  });

  it('suggests the nearest token for a near-miss color', () => {
    const issues = analyzeCss('.btn { color: #3c83f7; }', index);
    expect(issues).toHaveLength(1);
    const issue = issues[0]!;
    expect(issue.match).toBe('nearest-token');
    expect(issue.autoFixable).toBe(false);
    expect(issue.suggestion!.token).toBe('color.brand');
  });

  it('ignores colors already referenced via var()', () => {
    const issues = analyzeCss('.btn { color: var(--color-brand); }', index);
    expect(issues).toHaveLength(0);
  });

  it('flags hard-coded spacing on spacing properties', () => {
    const issues = analyzeCss('.card { padding: 8px; }', index);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.category).toBe('dimension');
    expect(issues[0]!.suggestion!.token).toBe('space.sm');
  });

  it('does not flag lengths on non-spacing properties', () => {
    const issues = analyzeCss('.card { font-size: 13px; border-radius: 3px; }', index);
    expect(issues).toHaveLength(0);
  });

  it('reports an accurate line and column', () => {
    const css = '.btn {\n  color: #3b82f6;\n}';
    const issue = analyzeCss(css, index, { file: 'btn.css' })[0]!;
    expect(issue.file).toBe('btn.css');
    expect(issue.line).toBe(2);
    // 1-based column of the `#` in `  color: #3b82f6;`
    expect(issue.column).toBe(10);
  });

  it('handles multiple literals in a shorthand', () => {
    const issues = analyzeCss('.box { margin: 8px 16px; }', index);
    expect(issues).toHaveLength(2);
    expect(issues.map((i) => i.suggestion!.token)).toEqual(['space.sm', 'space.md']);
  });

  it('skips unparseable preprocessor syntax instead of throwing', () => {
    const scss = '.icon-#{$name} { color: #123456; }';
    expect(() => analyzeCss(scss, index, { file: 'a.scss' })).not.toThrow();
    expect(analyzeCss(scss, index, { file: 'a.scss' })).toEqual([]);
  });
});
