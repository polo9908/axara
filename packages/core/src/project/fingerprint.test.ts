import { describe, expect, it } from 'vitest';
import type { DriftIssue } from '../types.js';
import type { RgaaFinding } from '../rgaa/types.js';
import {
  driftIdentity,
  fingerprintAll,
  normalizeFingerprintPath,
  rgaaIdentity,
} from './fingerprint.js';

function issue(overrides: Partial<DriftIssue> = {}): DriftIssue {
  return {
    file: 'src/Button.tsx',
    line: 10,
    column: 4,
    category: 'color',
    property: 'background-color',
    value: '#6366f1',
    severity: 'error',
    match: 'exact-token',
    message: 'peu importe / does not matter',
    autoFixable: true,
    ...overrides,
  };
}

function finding(overrides: Partial<RgaaFinding> = {}): RgaaFinding {
  return {
    criterion: '1.1',
    theme: 1,
    themeLabel: 'Images',
    criterionTitle: 'peu importe',
    wcag: ['1.1.1'],
    axeRuleId: 'image-alt',
    impact: 'critical',
    status: 'failed',
    description: 'localized text',
    helpUrl: 'https://example.test',
    occurrences: [],
    ...overrides,
  };
}

describe('fingerprintAll', () => {
  it('est déterministe : mêmes identités → mêmes empreintes', () => {
    const ids = [driftIdentity(issue(), 'src/Button.tsx')];
    expect(fingerprintAll(ids)).toEqual(fingerprintAll(ids));
    expect(fingerprintAll(ids)[0]).toMatch(/^[0-9a-f]{16}$/);
  });

  it('distingue les doublons exacts par rang d’apparition, de façon stable', () => {
    const ids = [
      driftIdentity(issue(), 'a.tsx'),
      driftIdentity(issue({ line: 99, column: 1 }), 'a.tsx'), // même violation, ailleurs
    ];
    const [first, second] = fingerprintAll(ids);
    expect(first).not.toBe(second);
    // Rejouer l'audit redonne les mêmes empreintes dans le même ordre.
    expect(fingerprintAll(ids)).toEqual([first, second]);
  });

  it('ne recolle pas les composants (séparateur non imprimable)', () => {
    const [a] = fingerprintAll([['drift', 'a b', 'c']]);
    const [b] = fingerprintAll([['drift', 'a', 'b c']]);
    expect(a).not.toBe(b);
  });
});

describe('driftIdentity', () => {
  it('ignore ligne, colonne, message et suggestion (stabilité au décalage)', () => {
    const moved = issue({ line: 42, column: 8, message: 'autre message', severity: 'warning' });
    expect(driftIdentity(issue(), 'src/Button.tsx')).toEqual(
      driftIdentity(moved, 'src/Button.tsx'),
    );
  });

  it('change quand la valeur fautive change', () => {
    expect(driftIdentity(issue(), 'a.tsx')).not.toEqual(
      driftIdentity(issue({ value: '#ff0000' }), 'a.tsx'),
    );
  });

  it('normalise les séparateurs Windows (empreinte identique inter-OS)', () => {
    expect(driftIdentity(issue(), 'src\\ui\\Button.tsx')).toEqual(
      driftIdentity(issue(), 'src/ui/Button.tsx'),
    );
  });
});

describe('rgaaIdentity', () => {
  it('repose sur fichier + critère + règle axe, pas sur les textes localisés', () => {
    const localized = finding({ description: 'texte français', criterionTitle: 'autre' });
    expect(rgaaIdentity(finding(), 'page.html')).toEqual(rgaaIdentity(localized, 'page.html'));
  });

  it('change quand le critère ou la règle change', () => {
    expect(rgaaIdentity(finding(), 'page.html')).not.toEqual(
      rgaaIdentity(finding({ criterion: '3.2' }), 'page.html'),
    );
    expect(rgaaIdentity(finding(), 'page.html')).not.toEqual(
      rgaaIdentity(finding({ axeRuleId: 'label' }), 'page.html'),
    );
  });
});

describe('normalizeFingerprintPath', () => {
  it('convertit les backslashes en slashes', () => {
    expect(normalizeFingerprintPath('src\\a\\b.tsx')).toBe('src/a/b.tsx');
  });
});
