import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  detectDesignSystem,
  rcTemplate,
  runFromFigma,
  runFromTailwind,
  validateDtcgFile,
} from './init-wizard.js';
import { findCommand } from './help.js';
import { filterCommands } from '../ui/palette.js';

let dir: string;

const TOKENS = JSON.stringify({
  color: { $type: 'color', brand: { $value: '#3b82f6' } },
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'axaraaudit-wizard-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('rcTemplate', () => {
  it('sérialise un chemin de tokens', () => {
    const rc = JSON.parse(rcTemplate('demo', './tokens.dtcg.json')) as Record<string, unknown>;
    expect(rc['project']).toBe('demo');
    expect(rc['tokens']).toBe('./tokens.dtcg.json');
  });

  it('sérialise la porte de sortie "tokens": false', () => {
    const rc = JSON.parse(rcTemplate('demo', false)) as Record<string, unknown>;
    expect(rc['tokens']).toBe(false);
    expect((rc['rgaa'] as Record<string, unknown>)['enabled']).toBe(true);
  });
});

describe('detectDesignSystem', () => {
  it('trouve un fichier DTCG conventionnel valide à la racine', () => {
    writeFileSync(join(dir, 'design-tokens.dtcg.json'), TOKENS);
    const detection = detectDesignSystem(dir);
    expect(detection.dtcgCandidates).toContain('./design-tokens.dtcg.json');
  });

  it('trouve un fichier *.dtcg.json au nom non conventionnel', () => {
    writeFileSync(join(dir, 'ma-charte.dtcg.json'), TOKENS);
    const detection = detectDesignSystem(dir);
    expect(detection.dtcgCandidates).toContain('./ma-charte.dtcg.json');
  });

  it('ignore un candidat au JSON invalide ou sans token', () => {
    writeFileSync(join(dir, 'tokens.json'), '{ pas du json');
    writeFileSync(join(dir, 'design-tokens.json'), '{}');
    const detection = detectDesignSystem(dir);
    expect(detection.dtcgCandidates).toHaveLength(0);
  });

  it('compte les custom properties CSS du projet', () => {
    mkdirSync(join(dir, 'src'));
    writeFileSync(
      join(dir, 'src', 'vars.css'),
      ':root { --a: #111111; --b: #222222; --c: 4px; }\n',
    );
    const detection = detectDesignSystem(dir);
    expect(detection.extraction.count).toBe(3);
  });

  it('reste vide sur un projet nu', () => {
    const detection = detectDesignSystem(dir);
    expect(detection.dtcgCandidates).toHaveLength(0);
    expect(detection.extraction.count).toBe(0);
    expect(detection.tailwindConfig).toBeNull();
  });

  it('détecte un tailwind.config.js à la racine', () => {
    writeFileSync(join(dir, 'tailwind.config.js'), 'export default {}');
    expect(detectDesignSystem(dir).tailwindConfig).toBe(join(dir, 'tailwind.config.js'));
  });
});

describe('runFromTailwind (non interactif)', () => {
  it('importe le thème, écrit tokens + rc, exit 0', async () => {
    writeFileSync(
      join(dir, 'tailwind.config.mjs'),
      'export default { theme: { colors: { brand: "#123456" }, extend: { spacing: { 4: "1rem" } } } };\n',
    );
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      const code = await runFromTailwind({ cwd: dir, force: false });
      expect(code).toBe(0);
    } finally {
      process.chdir(cwd);
    }
    const tokens = JSON.parse(readFileSync(join(dir, 'design-tokens.dtcg.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(tokens['color-brand']).toEqual({ $type: 'color', $value: '#123456' });
    expect(tokens['spacing-4']).toEqual({ $type: 'dimension', $value: '1rem' });
    const rc = JSON.parse(readFileSync(join(dir, '.auditorrc.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(rc['tokens']).toBe('./design-tokens.dtcg.json');
  });

  it('exit 2 sans config Tailwind', async () => {
    expect(await runFromTailwind({ cwd: dir, force: false })).toBe(2);
  });

  it('préserve un rc existant en ne patchant que "tokens"', async () => {
    writeFileSync(
      join(dir, 'tailwind.config.mjs'),
      'export default { theme: { colors: { brand: "#123456" } } };\n',
    );
    writeFileSync(join(dir, '.auditorrc.json'), JSON.stringify({ project: 'garde', tokens: false }));
    expect(await runFromTailwind({ cwd: dir, force: false })).toBe(0);
    const rc = JSON.parse(readFileSync(join(dir, '.auditorrc.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(rc['project']).toBe('garde');
    expect(rc['tokens']).toBe('./design-tokens.dtcg.json');
  });
});

describe('runFromFigma (non interactif)', () => {
  it('exit 2 sans jeton', async () => {
    const saved = process.env['FIGMA_TOKEN'];
    delete process.env['FIGMA_TOKEN'];
    try {
      expect(await runFromFigma({ cwd: dir, ref: 'aBc123', force: false })).toBe(2);
    } finally {
      if (saved !== undefined) process.env['FIGMA_TOKEN'] = saved;
    }
  });

  it('exit 2 sur une référence invalide', async () => {
    expect(await runFromFigma({ cwd: dir, ref: 'pas une clé !', force: false })).toBe(2);
  });
});

describe('validateDtcgFile', () => {
  it('accepte un DTCG valide et compte les tokens', () => {
    const path = join(dir, 'ok.json');
    writeFileSync(path, TOKENS);
    expect(validateDtcgFile(path)).toEqual({ ok: true, count: 1 });
  });

  it('refuse un fichier manquant avec un message clair', () => {
    const verdict = validateDtcgFile(join(dir, 'nope.json'));
    expect(verdict.ok).toBe(false);
  });

  it('refuse un JSON invalide et un document sans token exploitable', () => {
    const broken = join(dir, 'broken.json');
    writeFileSync(broken, '{ nope');
    expect(validateDtcgFile(broken).ok).toBe(false);
    const empty = join(dir, 'empty.json');
    writeFileSync(empty, '{}');
    expect(validateDtcgFile(empty).ok).toBe(false);
  });

  it('tolère un BOM UTF-8', () => {
    const path = join(dir, 'bom.json');
    writeFileSync(path, `﻿${TOKENS}`);
    expect(validateDtcgFile(path)).toEqual({ ok: true, count: 1 });
  });
});

describe('catalogue & palette', () => {
  it('init documente --yes et le wizard', () => {
    const spec = findCommand('init');
    expect(spec?.usage).toContain('--yes');
    expect(spec?.options?.some(([flag]) => flag === '--yes')).toBe(true);
  });

  it('la palette trouve init par « design system »', () => {
    expect(filterCommands('design system').some((c) => c.name === 'init')).toBe(true);
  });
});
