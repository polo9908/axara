import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectFiles } from './walk.js';

let dir: string;

function seed(relPath: string): void {
  const abs = join(dir, relPath);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, '/* seed */');
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'axaraaudit-walk-'));
  seed('src/App.tsx');
  seed('src/deep/Button.tsx');
  seed('styles/global.css');
  seed('node_modules/lib/index.css');
  seed('dist/bundle.css');
  seed('README.md');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('collectFiles', () => {
  it('walks include dirs recursively and filters by extension', () => {
    const files = collectFiles(dir, ['.'], ['dist'], ['.tsx', '.css']);
    const rel = files.map((f) => f.slice(dir.length + 1).replaceAll('\\', '/'));
    expect(rel).toEqual(['src/App.tsx', 'src/deep/Button.tsx', 'styles/global.css']);
  });

  it('always skips node_modules even when not excluded', () => {
    const files = collectFiles(dir, ['.'], [], ['.css']);
    expect(files.some((f) => f.includes('node_modules'))).toBe(false);
  });

  it('accepts a single file as include entry', () => {
    const files = collectFiles(dir, ['styles/global.css'], [], ['.css']);
    expect(files).toHaveLength(1);
  });

  it('deduplicates overlapping includes', () => {
    const files = collectFiles(dir, ['.', 'src'], ['dist'], ['.tsx']);
    expect(files).toHaveLength(2);
  });
});
