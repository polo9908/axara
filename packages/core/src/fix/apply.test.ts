import { describe, expect, it } from 'vitest';
import { analyzeCss } from '../analyzer/css.js';
import { analyzeTsx } from '../analyzer/tsx.js';
import { parseDtcg } from '../tokens/dtcg.js';
import { applyFixes } from './apply.js';

const { index } = parseDtcg({
  color: { $type: 'color', brand: { $value: '#3b82f6' }, white: { $value: '#ffffff' } },
  space: { $type: 'dimension', sm: { $value: '8px' } },
});

describe('applyFixes (CSS)', () => {
  it('replaces an exact-token color with its var() at the right place', () => {
    const css = '.btn { color: #3b82f6; }';
    const issues = analyzeCss(css, index, { file: 'a.css' });
    const { content, applied, changed } = applyFixes(css, issues);
    expect(changed).toBe(true);
    expect(content).toBe('.btn { color: var(--color-brand); }');
    expect(applied).toHaveLength(1);
    expect(applied[0]!.from).toBe('#3b82f6');
  });

  it('does not touch an identical literal elsewhere (e.g. in a comment)', () => {
    const css = '/* brand is #3b82f6 */\n.btn { color: #3b82f6; }';
    const issues = analyzeCss(css, index, { file: 'a.css' });
    const { content } = applyFixes(css, issues);
    // The comment keeps its literal; only the declaration is rewritten.
    expect(content).toBe('/* brand is #3b82f6 */\n.btn { color: var(--color-brand); }');
  });

  it('applies multiple fixes on one line without shifting positions', () => {
    const css = '.box { margin: 8px; color: #ffffff; }';
    const issues = analyzeCss(css, index, { file: 'a.css' });
    const { content, applied } = applyFixes(css, issues);
    expect(applied.length).toBe(2);
    expect(content).toBe('.box { margin: var(--space-sm); color: var(--color-white); }');
  });

  it('does not apply uncertain nearest-token fixes by default', () => {
    const css = '.btn { color: #3c83f7; }'; // near miss, not exact
    const issues = analyzeCss(css, index, { file: 'a.css' });
    const { changed, applied } = applyFixes(css, issues);
    expect(changed).toBe(false);
    expect(applied).toHaveLength(0);
  });
});

describe('applyFixes (TSX)', () => {
  it('fixes a hard-coded color inside a string literal, keeping the quotes', () => {
    const src = `const A = () => <span style={{ color: '#3b82f6' }} />;`;
    const issues = analyzeTsx(src, index, { file: 'A.tsx' });
    const { content } = applyFixes(src, issues);
    expect(content).toBe(`const A = () => <span style={{ color: 'var(--color-brand)' }} />;`);
  });

  it('safely skips a React numeric dimension (source `8` ≠ value `8px`)', () => {
    const src = `const A = () => <div style={{ padding: 8 }} />;`;
    const issues = analyzeTsx(src, index, { file: 'A.tsx' });
    const { content, applied, skipped } = applyFixes(src, issues);
    expect(applied).toHaveLength(0);
    expect(skipped.length).toBeGreaterThan(0);
    expect(content).toBe(src); // unchanged — no risky rewrite
  });
});

describe('applyFixes — naming references', () => {
  it('uses the token cssVar exactly', () => {
    const css = '.x { color: #ffffff; }';
    const issues = analyzeCss(css, index, { file: 'a.css' });
    expect(applyFixes(css, issues).content).toContain('var(--color-white)');
  });
});

describe('applyFixes (--all mode: nearest-token opt-in)', () => {
  it('applies a confident nearest-token suggestion when onlyAutoFixable is false', () => {
    const css = '.btn { color: #3c83f7; }'; // near miss of color.brand
    const issues = analyzeCss(css, index, { file: 'a.css' });
    const { content, applied } = applyFixes(css, issues, { onlyAutoFixable: false });
    expect(applied).toHaveLength(1);
    expect(content).toBe('.btn { color: var(--color-brand); }');
  });

  it('skips (and reports) suggestions below minConfidence', () => {
    const css = '.btn { color: #3c83f7; }';
    const issues = analyzeCss(css, index, { file: 'a.css' });
    const { applied, skipped } = applyFixes(css, issues, {
      onlyAutoFixable: false,
      minConfidence: 0.999,
    });
    expect(applied).toHaveLength(0);
    expect(skipped).toHaveLength(1);
  });

  it('never applies no-token issues even with onlyAutoFixable false', () => {
    const css = '.btn { color: #00ff99; }'; // far from every token
    const issues = analyzeCss(css, index, { file: 'a.css' });
    const noToken = issues.filter((i) => i.match === 'no-token');
    expect(noToken.length).toBeGreaterThan(0);
    const { applied } = applyFixes(css, issues, { onlyAutoFixable: false, minConfidence: 0 });
    expect(applied).toHaveLength(0);
  });
});