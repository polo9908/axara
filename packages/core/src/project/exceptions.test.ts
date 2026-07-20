import { describe, expect, it } from 'vitest';
import { applyExceptions, resolveConfigExceptions } from './exceptions.js';
import { parseInlineDirectives } from './ignore.js';
import { ConfigError } from './rc.js';
import type { DriftIssue } from '../types.js';
import type { FileRgaaFinding } from './score.js';
import type { RgaaFinding } from '../rgaa/types.js';

const NOW = new Date('2026-07-20T12:00:00Z');

function drift(
  value: string,
  overrides: Partial<DriftIssue & { relativeFile: string }> = {},
): DriftIssue & { relativeFile: string } {
  return {
    file: `C:/proj/src/a.css`,
    relativeFile: 'src/a.css',
    line: 1,
    column: 1,
    category: 'color',
    property: 'color',
    value,
    severity: 'error',
    match: 'exact',
    message: '',
    autoFixable: true,
    ...overrides,
  } as DriftIssue & { relativeFile: string };
}

function rgaa(criterion: string, file = 'src/b.tsx'): FileRgaaFinding {
  return {
    file,
    finding: { criterion, axeRuleId: 'image-alt', status: 'failed', impact: 'critical' } as unknown as RgaaFinding,
  };
}

describe('resolveConfigExceptions', () => {
  it('exige une justification non vide', () => {
    expect(() => resolveConfigExceptions([{ fingerprint: 'abcd', reason: '' }], NOW)).toThrow(ConfigError);
    expect(() => resolveConfigExceptions([{ rule: 'RGAA-3.2', reason: '   ' }], NOW)).toThrow(ConfigError);
  });

  it('exige exactement une cible : fingerprint OU rule', () => {
    expect(() => resolveConfigExceptions([{ reason: 'ok' }], NOW)).toThrow(ConfigError);
    expect(() =>
      resolveConfigExceptions([{ fingerprint: 'a', rule: 'color', reason: 'ok' }], NOW),
    ).toThrow(ConfigError);
  });

  it('ignore les entrées expirées, rejette une date invalide', () => {
    const resolved = resolveConfigExceptions(
      [
        { fingerprint: 'aaaa', reason: 'expirée', expires: '2026-01-01' },
        { fingerprint: 'bbbb', reason: 'active', expires: '2027-01-01' },
        { rule: 'RGAA-3.2', reason: 'récurrente' },
      ],
      NOW,
    );
    expect([...resolved.byFingerprint.keys()]).toEqual(['bbbb']);
    expect(resolved.byRule).toHaveLength(1);
    expect(() =>
      resolveConfigExceptions([{ fingerprint: 'x', reason: 'ok', expires: 'pas-une-date' }], NOW),
    ).toThrow(ConfigError);
  });

  it('résout les règles récurrentes avec leurs globs', () => {
    const resolved = resolveConfigExceptions(
      [{ rule: 'color', files: ['src\\legacy\\**'], reason: 'refonte Q4' }],
      NOW,
    );
    expect(resolved.byRule[0]).toMatchObject({
      rule: { kind: 'drift', target: 'color' },
      files: ['src/legacy/**'],
      reason: 'refonte Q4',
    });
  });
});

describe('applyExceptions', () => {
  const noConfig = resolveConfigExceptions([], NOW);

  it('config par empreinte : retirée du comptage, tracée avec raison et origine', () => {
    const result = applyExceptions({
      driftIssues: [drift('#fff'), drift('#000')],
      driftFingerprints: ['fp-1', 'fp-2'],
      rgaaFindings: [rgaa('1.1')],
      rgaaFingerprints: ['fp-3'],
      config: resolveConfigExceptions(
        [
          { fingerprint: 'fp-2', reason: 'faux positif' },
          { fingerprint: 'fp-inconnu', reason: 'stale' },
        ],
        NOW,
      ),
      inline: new Map(),
      invalidDirectives: [],
    });
    expect(result.driftKept.map((i) => i.fingerprint)).toEqual(['fp-1']);
    expect(result.driftExcepted).toHaveLength(1);
    expect(result.driftExcepted[0]).toMatchObject({
      fingerprint: 'fp-2',
      reason: 'faux positif',
      origin: 'config',
    });
    expect(result.rgaaKept).toHaveLength(1);
    expect(result.summary).toMatchObject({ declared: 2, applied: 1, unmatched: ['fp-inconnu'] });
  });

  it('directive inline drift : ligne suivante, origine inline prioritaire', () => {
    const { directives } = parseInlineDirectives('// axara-ignore: color raison="marketing"\nx');
    const result = applyExceptions({
      driftIssues: [drift('#fff', { line: 2 }), drift('#000', { line: 9 })],
      driftFingerprints: ['fp-1', 'fp-2'],
      rgaaFindings: [],
      rgaaFingerprints: [],
      config: resolveConfigExceptions([{ fingerprint: 'fp-1', reason: 'config aussi' }], NOW),
      inline: new Map([['src/a.css', directives]]),
      invalidDirectives: [],
    });
    // fp-1 est couverte par l'inline ET la config : l'inline gagne.
    expect(result.driftExcepted[0]).toMatchObject({ reason: 'marketing', origin: 'inline' });
    expect(result.driftKept.map((i) => i.fingerprint)).toEqual(['fp-2']);
  });

  it('directive inline RGAA : critère à l’échelle du fichier, pas au-delà', () => {
    const { directives } = parseInlineDirectives('// axara-ignore: RGAA-1.1 raison="décoratif"');
    const result = applyExceptions({
      driftIssues: [],
      driftFingerprints: [],
      rgaaFindings: [rgaa('1.1', 'src/b.tsx'), rgaa('1.1', 'src/autre.tsx'), rgaa('3.2', 'src/b.tsx')],
      rgaaFingerprints: ['fp-1', 'fp-2', 'fp-3'],
      config: noConfig,
      inline: new Map([['src/b.tsx', directives]]),
      invalidDirectives: [],
    });
    expect(result.rgaaExcepted.map((f) => f.fingerprint)).toEqual(['fp-1']);
    expect(result.rgaaKept.map((f) => f.fingerprint)).toEqual(['fp-2', 'fp-3']);
  });

  it('règle récurrente config : limitée par globs', () => {
    const config = resolveConfigExceptions(
      [{ rule: 'RGAA-3.2', files: ['src/legacy/**'], reason: 'contrastes legacy assumés' }],
      NOW,
    );
    const result = applyExceptions({
      driftIssues: [],
      driftFingerprints: [],
      rgaaFindings: [rgaa('3.2', 'src/legacy/old.tsx'), rgaa('3.2', 'src/new.tsx')],
      rgaaFingerprints: ['fp-1', 'fp-2'],
      config,
      inline: new Map(),
      invalidDirectives: [],
    });
    expect(result.rgaaExcepted.map((f) => f.fingerprint)).toEqual(['fp-1']);
    expect(result.rgaaKept.map((f) => f.fingerprint)).toEqual(['fp-2']);
  });

  it('les directives invalides remontent dans la synthèse sans rien retirer', () => {
    const result = applyExceptions({
      driftIssues: [drift('#fff')],
      driftFingerprints: ['fp-1'],
      rgaaFindings: [],
      rgaaFingerprints: [],
      config: noConfig,
      inline: new Map(),
      invalidDirectives: [{ file: 'src/a.css', line: 3, rule: 'RGAA-3.2' }],
    });
    expect(result.driftKept).toHaveLength(1);
    expect(result.summary.applied).toBe(0);
    expect(result.summary.invalid).toEqual([{ file: 'src/a.css', line: 3, rule: 'RGAA-3.2' }]);
  });
});
