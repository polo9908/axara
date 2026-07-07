import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { auditProject, checkFiles, fixProject } from './run.js';

let dir: string;

const TOKENS = JSON.stringify({
  color: { $type: 'color', brand: { $value: '#3b82f6' } },
  space: { $type: 'dimension', sm: { $value: '8px' } },
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'axaraaudit-run-'));
  writeFileSync(join(dir, 'design-tokens.dtcg.json'), TOKENS);
  mkdirSync(join(dir, 'src'));
  // One exact-match drift (auto-fixable) and one RGAA violation (img without alt).
  writeFileSync(join(dir, 'src', 'app.css'), '.btn { color: #3b82f6; padding: 8px; }\n');
  writeFileSync(
    join(dir, 'src', 'App.tsx'),
    'export const App = () => <img src="logo.png" />;\n',
  );
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('auditProject', () => {
  it('runs the full pipeline and stamps the producing tool into the payload', async () => {
    const result = await auditProject({
      cwd: dir,
      tool: 'test-tool',
      toolVersion: '9.9.9',
    });
    expect(result.payload.tool).toBe('test-tool');
    expect(result.payload.toolVersion).toBe('9.9.9');
    expect(result.tokensSource.origin).toBe('file');
    expect(result.drift.summary.totalIssues).toBeGreaterThan(0);
    expect(result.rgaaFindings.some(({ finding }) => finding.criterion === '1.1')).toBe(true);
    expect(result.payload.score).toBeLessThan(100);
  });

  it('reports RGAA findings with root-relative file paths', async () => {
    const result = await auditProject({ cwd: dir, tool: 't', toolVersion: '0' });
    for (const { file } of result.rgaaFindings) {
      expect(file.startsWith(dir)).toBe(false);
      expect(file).toContain('App.tsx');
    }
  });

  it('honours skipRgaa and rc overrides', async () => {
    const result = await auditProject({
      cwd: dir,
      tool: 't',
      toolVersion: '0',
      skipRgaa: true,
      rcOverrides: { ci: { failUnder: 100 } },
    });
    expect(result.rgaaFindings).toHaveLength(0);
    expect(result.payload.rgaa.enabled).toBe(false);
    expect(result.gate.failUnder).toBe(100);
  });

  it('prefers inline tokens over the project file', async () => {
    const result = await auditProject({
      cwd: dir,
      tool: 't',
      toolVersion: '0',
      skipRgaa: true,
      inlineTokensJson: JSON.stringify({
        color: { $type: 'color', other: { $value: '#ffffff' } },
      }),
    });
    expect(result.tokensSource.origin).toBe('inline');
    // #3b82f6 no longer matches any token → still an issue, but not auto-fixable.
    expect(result.drift.summary.autoFixable).toBe(0);
  });
});

describe('checkFiles', () => {
  it('validates only the requested files (drift + RGAA)', async () => {
    const result = await checkFiles({ cwd: dir, files: ['src/App.tsx'] });
    expect(result.summary.filesChecked).toBe(1);
    expect(result.conformant).toBe(false);
    const tsx = result.files[0]!;
    expect(tsx.rgaa.some((f) => f.criterion === '1.1')).toBe(true);
    expect(tsx.drift).toHaveLength(0); // the drift lives in app.css, not checked here
  });

  it('reports drift with the same analyzer as the full audit', async () => {
    const result = await checkFiles({ cwd: dir, files: ['src/app.css'], skipRgaa: true });
    expect(result.files[0]!.drift.length).toBeGreaterThan(0);
    expect(result.files[0]!.drift.every((issue) => issue.autoFixable)).toBe(true);
  });

  it('skips missing files and non-analyzable extensions without failing', async () => {
    const result = await checkFiles({
      cwd: dir,
      files: ['nope.tsx', 'design-tokens.dtcg.json'],
    });
    expect(result.summary.filesSkipped).toBe(2);
    expect(result.summary.filesChecked).toBe(0);
    expect(result.conformant).toBe(true);
  });

  it('still checks RGAA in a project without any design system', async () => {
    const bare = mkdtempSync(join(tmpdir(), 'axaraaudit-bare-'));
    try {
      writeFileSync(join(bare, 'App.tsx'), 'export const A = () => <img src="a.png" />;\n');
      const result = await checkFiles({ cwd: bare, files: ['App.tsx'] });
      expect(result.tokensSource.origin).toBe('none');
      expect(result.files[0]!.drift).toHaveLength(0);
      expect(result.files[0]!.rgaa.some((f) => f.criterion === '1.1')).toBe(true);
      expect(result.conformant).toBe(false);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  it('is conformant on a clean file', async () => {
    writeFileSync(
      join(dir, 'src', 'Clean.tsx'),
      'export const C = () => <img src="a.png" alt="Logo" />;\n',
    );
    const result = await checkFiles({ cwd: dir, files: ['src/Clean.tsx'] });
    expect(result.conformant).toBe(true);
  });
});

describe('fixProject', () => {
  it('previews without touching files by default (dry-run)', () => {
    const before = readFileSync(join(dir, 'src', 'app.css'), 'utf8');
    const result = fixProject({ cwd: dir });
    expect(result.totalApplied).toBeGreaterThan(0);
    expect(result.fixed.every((f) => !f.written)).toBe(true);
    expect(readFileSync(join(dir, 'src', 'app.css'), 'utf8')).toBe(before);
  });

  it('writes exact-token fixes with write: true and reports the remainder', () => {
    const result = fixProject({ cwd: dir, write: true });
    expect(result.totalApplied).toBeGreaterThan(0);
    const css = readFileSync(join(dir, 'src', 'app.css'), 'utf8');
    expect(css).toContain('var(--color-brand)');
    expect(css).toContain('var(--space-sm)');
    // Every remaining issue is genuinely not auto-fixable.
    expect(result.remaining.every((issue) => !issue.autoFixable)).toBe(true);
  });
});
