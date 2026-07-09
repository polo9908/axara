import { describe, expect, it } from 'vitest';
import { PAYLOAD_VERSION } from '@axaraaudit/core';
import { ConfigError } from '../config/rc.js';
import { parsePushFlags, validateAuditPayload } from './push.js';

describe('parsePushFlags', () => {
  it('sans argument : audit frais, envoi réel', () => {
    expect(parsePushFlags([])).toEqual({ skipRgaa: false, dryRun: false });
  });

  it('capture le fichier positionnel et les flags', () => {
    expect(parsePushFlags(['report.json', '--dry-run', '--skip-rgaa'])).toEqual({
      file: 'report.json',
      skipRgaa: true,
      dryRun: true,
    });
  });

  it('propage --config', () => {
    expect(parsePushFlags(['--config', 'custom.json']).config).toBe('custom.json');
  });
});

describe('validateAuditPayload', () => {
  const valid = {
    tool: 'axaraaudit',
    toolVersion: '0.0.0',
    payloadVersion: PAYLOAD_VERSION,
    generatedAt: '2026-01-01T00:00:00.000Z',
    project: 'demo',
    score: 92,
    gate: { evaluated: false, passed: true, failUnder: 80, reasons: [] },
    drift: { summary: {}, tokenErrors: [], issues: [] },
    rgaa: { enabled: true, aggregate: { totalFindings: 0 }, findings: [] },
  };

  it('accepte un rapport conforme au contrat', () => {
    expect(validateAuditPayload(valid, 'report.json').project).toBe('demo');
  });

  it('rejette un JSON qui n’est pas un objet', () => {
    expect(() => validateAuditPayload([1, 2], 'report.json')).toThrow(ConfigError);
    expect(() => validateAuditPayload('oops', 'report.json')).toThrow(ConfigError);
  });

  it.each(['payloadVersion', 'project', 'score', 'gate', 'drift', 'rgaa'] as const)(
    'rejette un rapport sans `%s`',
    (key) => {
      const { [key]: _removed, ...rest } = valid;
      expect(() => validateAuditPayload(rest, 'report.json')).toThrow(ConfigError);
    },
  );

  it('rejette un payloadVersion plus récent que le CLI', () => {
    expect(() =>
      validateAuditPayload({ ...valid, payloadVersion: PAYLOAD_VERSION + 1 }, 'report.json'),
    ).toThrow(/payloadVersion/);
  });
});
