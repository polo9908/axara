import { describe, expect, it } from 'vitest';
import { parseDtcg } from './dtcg.js';
import { extractCssVarTokens } from './css-vars.js';

const TOKENS_CSS = `
:root {
  --color-primary: #1A3C6E;
  --color-primary-hover: var(--color-primary);
  --space-4: 16px;
  --font-family: 'Inter', sans-serif;
  --line-height: 1.6;
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.06);
}
@media (prefers-color-scheme: dark) {
  :root { --color-primary: #99BBEE; }
}
`;

describe('extractCssVarTokens', () => {
  it('extracts colors and dimensions, skipping fonts/ratios/shadows', () => {
    const result = extractCssVarTokens([{ path: 'tokens.css', content: TOKENS_CSS }]);
    expect(result.count).toBe(3); // primary, primary-hover, space-4
    expect(result.document['color-primary']).toEqual({ $type: 'color', $value: '#1A3C6E' });
    expect(result.document['space-4']).toEqual({ $type: 'dimension', $value: '16px' });
    expect(result.document['font-family']).toBeUndefined();
    expect(result.document['line-height']).toBeUndefined();
  });

  it('resolves var() aliases to their concrete value', () => {
    const result = extractCssVarTokens([{ path: 'tokens.css', content: TOKENS_CSS }]);
    expect(result.document['color-primary-hover']).toEqual({
      $type: 'color',
      $value: '#1A3C6E',
    });
  });

  it('keeps the first declaration when a variable is redefined (theme override)', () => {
    const result = extractCssVarTokens([{ path: 'tokens.css', content: TOKENS_CSS }]);
    expect(result.document['color-primary']).toEqual({ $type: 'color', $value: '#1A3C6E' });
  });

  it('round-trips through parseDtcg with matching cssVar names', () => {
    const extraction = extractCssVarTokens([{ path: 'tokens.css', content: TOKENS_CSS }]);
    const { index, errors } = parseDtcg(extraction.document);
    expect(errors).toHaveLength(0);
    const exact = index.exactColor('#1A3C6E');
    expect(exact?.cssVar).toBe('--color-primary');
    expect(index.exactDimension('16px')?.cssVar).toBe('--space-4');
  });

  it('reports alias cycles as warnings instead of throwing', () => {
    const css = ':root { --a: var(--b); --b: var(--a); }';
    const result = extractCssVarTokens([{ path: 'x.css', content: css }]);
    expect(result.count).toBe(0);
    expect(result.warnings.some((w) => w.includes('Cycle'))).toBe(true);
  });

  it('merges variables across several files, first file wins', () => {
    const result = extractCssVarTokens([
      { path: 'a.css', content: ':root { --brand: #111111; }' },
      { path: 'b.css', content: ':root { --brand: #222222; --extra: 8px; }' },
    ]);
    expect(result.document['brand']).toEqual({ $type: 'color', $value: '#111111' });
    expect(result.count).toBe(2);
    expect(result.sourceFiles).toEqual(['a.css', 'b.css']);
  });
});

describe('analyzeCss ignores custom-property definitions', () => {
  it('does not flag the token definitions themselves as drift', async () => {
    const { analyzeCss } = await import('../analyzer/css.js');
    const extraction = extractCssVarTokens([{ path: 'tokens.css', content: TOKENS_CSS }]);
    const { index } = parseDtcg(extraction.document);
    // The definition file itself must produce zero issues.
    expect(analyzeCss(TOKENS_CSS, index, { file: 'tokens.css' })).toHaveLength(0);
    // …while a real usage still gets flagged.
    const usage = '.btn { color: #1A3C6E; padding: 16px; }';
    expect(analyzeCss(usage, index, { file: 'app.css' }).length).toBe(2);
  });
});
