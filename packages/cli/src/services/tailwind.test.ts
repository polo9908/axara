import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectTailwindConfig, loadTailwindTheme } from './tailwind.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'axaraaudit-tw-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('detectTailwindConfig', () => {
  it('trouve le config à la racine, .js en priorité', () => {
    writeFileSync(join(dir, 'tailwind.config.ts'), 'export default {}');
    writeFileSync(join(dir, 'tailwind.config.js'), 'export default {}');
    expect(detectTailwindConfig(dir)).toBe(join(dir, 'tailwind.config.js'));
  });

  it('retourne null sans config', () => {
    expect(detectTailwindConfig(dir)).toBeNull();
  });
});

describe('loadTailwindTheme', () => {
  it('charge un config ESM (.mjs) avec export default', async () => {
    const path = join(dir, 'tailwind.config.mjs');
    writeFileSync(path, 'export default { theme: { colors: { brand: "#123456" } } };\n');
    const load = await loadTailwindTheme(path);
    expect(load.ok).toBe(true);
    if (load.ok) {
      expect((load.theme as Record<string, unknown>)['colors']).toEqual({ brand: '#123456' });
    }
  });

  it('charge un config CJS (.cjs) avec module.exports', async () => {
    const path = join(dir, 'tailwind.config.cjs');
    writeFileSync(path, 'module.exports = { theme: { spacing: { 4: "1rem" } } };\n');
    const load = await loadTailwindTheme(path);
    expect(load.ok).toBe(true);
  });

  it('refuse un config .ts avec la raison ts-config', async () => {
    const path = join(dir, 'tailwind.config.ts');
    writeFileSync(path, 'export default { theme: {} };\n');
    const load = await loadTailwindTheme(path);
    expect(load).toMatchObject({ ok: false, reason: 'ts-config' });
  });

  it('encapsule une erreur de syntaxe en import-failed', async () => {
    const path = join(dir, 'tailwind.config.mjs');
    writeFileSync(path, 'export default { theme: {,};\n');
    const load = await loadTailwindTheme(path);
    expect(load).toMatchObject({ ok: false, reason: 'import-failed' });
  });

  it("répond no-theme quand la section manque", async () => {
    const path = join(dir, 'tailwind.config.mjs');
    writeFileSync(path, 'export default { content: [] };\n');
    const load = await loadTailwindTheme(path);
    expect(load).toMatchObject({ ok: false, reason: 'no-theme' });
  });
});
