import { describe, expect, it } from 'vitest';
import { parseDtcg } from '../tokens/dtcg.js';
import { analyzeTsx } from './tsx.js';

const { index } = parseDtcg({
  color: {
    $type: 'color',
    brand: { $value: '#3b82f6' },
  },
  space: {
    $type: 'dimension',
    sm: { $value: '8px' },
  },
});

describe('analyzeTsx', () => {
  it('flags a hard-coded color in an inline style object', () => {
    const src = `export const A = () => <button style={{ color: '#3b82f6' }}>x</button>;`;
    const issues = analyzeTsx(src, index);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.category).toBe('color');
    expect(issues[0]!.property).toBe('color');
    expect(issues[0]!.suggestion!.replacement).toBe('var(--color-brand)');
  });

  it('treats a bare numeric on a spacing prop as pixels', () => {
    const src = `export const A = () => <div style={{ padding: 8 }} />;`;
    const issues = analyzeTsx(src, index);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.category).toBe('dimension');
    expect(issues[0]!.value).toBe('8px');
    expect(issues[0]!.suggestion!.token).toBe('space.sm');
  });

  it('does not treat a bare numeric on a non-spacing prop as a dimension', () => {
    const src = `export const A = () => <div style={{ zIndex: 8, opacity: 1 }} />;`;
    expect(analyzeTsx(src, index)).toHaveLength(0);
  });

  it('flags color literals in ordinary strings (styled-components, constants)', () => {
    const src = "const theme = { primary: '#3b82f6' };";
    const issues = analyzeTsx(src, index);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.property).toBe('literal');
  });

  it('ignores string spacing values outside style objects', () => {
    const src = "const gap = '8px';";
    // colors only are scanned in generic strings, so a lone spacing string is ignored
    expect(analyzeTsx(src, index)).toHaveLength(0);
  });

  it('does not double-count style-object string values', () => {
    const src = `export const A = () => <span style={{ color: '#3b82f6' }} />;`;
    expect(analyzeTsx(src, index)).toHaveLength(1);
  });

  it('reports a plausible line and column', () => {
    const src = `const x = 1;\nexport const A = () => <i style={{ color: '#3b82f6' }} />;`;
    const issue = analyzeTsx(src, index, { file: 'A.tsx' })[0]!;
    expect(issue.file).toBe('A.tsx');
    expect(issue.line).toBe(2);
    expect(issue.column).toBeGreaterThan(0);
  });
});
