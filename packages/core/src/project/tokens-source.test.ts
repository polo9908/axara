import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigError, loadRc } from './rc.js';
import { loadTokensSource } from './tokens-source.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'axaraaudit-tokens-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const CSS_FILE = {
  path: 'src/tokens.css',
  content: ':root { --brand: #1A3C6E; --space-2: 8px; --space-4: 16px; }',
};

describe('loadTokensSource', () => {
  it('prefers the DTCG file when it exists', () => {
    writeFileSync(
      join(dir, 'design-tokens.dtcg.json'),
      JSON.stringify({ color: { $type: 'color', brand: { $value: '#ff0000' } } }),
    );
    const source = loadTokensSource(loadRc(dir), undefined, [CSS_FILE]);
    expect(source.origin).toBe('file');
    expect(source.json).toContain('#ff0000');
  });

  it('falls back to CSS custom properties when no tokens file exists', () => {
    const source = loadTokensSource(loadRc(dir), undefined, [CSS_FILE]);
    expect(source.origin).toBe('auto');
    expect(source.detail).toContain('3 tokens');
    const doc = JSON.parse(source.json) as Record<string, { $value: string }>;
    expect(doc['brand']?.$value).toBe('#1A3C6E');
  });

  it('still errors when too few variables are found (noise guard)', () => {
    const files = [{ path: 'a.css', content: ':root { --only-one: #fff; }' }];
    expect(() => loadTokensSource(loadRc(dir), undefined, files)).toThrow(ConfigError);
  });

  it('still errors on an explicit --tokens path that does not exist', () => {
    expect(() => loadTokensSource(loadRc(dir), './missing.json', [CSS_FILE])).toThrow(
      ConfigError,
    );
  });
});
