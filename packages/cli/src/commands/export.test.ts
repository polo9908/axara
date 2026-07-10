import { describe, expect, it, vi } from 'vitest';
import { PAYLOAD_VERSION } from '@axaraaudit/core';
import { ConfigError } from '../config/rc.js';
import { parseExportFlags } from './export.js';

describe('parseExportFlags', () => {
  it('destination par défaut', () => {
    expect(parseExportFlags([]).out).toMatch(/\.pdf$/);
  });

  it('capture le fichier positionnel et --out', () => {
    const flags = parseExportFlags(['report.json', '--out', 'audit.pdf']);
    expect(flags.file).toBe('report.json');
    expect(flags.out).toBe('audit.pdf');
  });

  it('rejette une destination qui ne finit pas par .pdf', () => {
    expect(() => parseExportFlags(['--out', 'audit.json'])).toThrow(ConfigError);
  });

  it('propage --skip-rgaa et --config', () => {
    const flags = parseExportFlags(['--skip-rgaa', '--config', 'custom.json']);
    expect(flags.skipRgaa).toBe(true);
    expect(flags.config).toBe('custom.json');
  });
});

describe('runExport — fichier verrouillé', () => {
  it('transforme EBUSY/EPERM/EACCES en message actionnable (pas de stack brute)', async () => {
    vi.resetModules();
    vi.doMock('node:fs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs')>();
      return {
        ...actual,
        readFileSync: actual.readFileSync,
        writeFileSync: vi.fn(() => {
          const err = new Error('EBUSY: resource busy or locked') as NodeJS.ErrnoException;
          err.code = 'EBUSY';
          throw err;
        }),
      };
    });

    const { runExport: mockedRunExport } = await import('./export.js');
    const payload = {
      tool: 'axaraaudit',
      toolVersion: '0.0.0',
      payloadVersion: PAYLOAD_VERSION,
      generatedAt: '2026-01-01T00:00:00.000Z',
      project: 'demo',
      score: 92,
      gate: { evaluated: false, passed: true, failUnder: 80, reasons: [] },
      drift: { summary: { filesScanned: 1, totalIssues: 0, errors: 0, warnings: 0, autoFixable: 0 }, tokenErrors: [], issues: [] },
      rgaa: { enabled: false, aggregate: { filesAudited: 1, criteriaFailed: 0, criteriaToReview: 0, totalFindings: 0, byImpact: {} }, findings: [] },
    };

    vi.doMock('./push.js', () => ({
      validateAuditPayload: () => payload,
    }));

    const fs = await import('node:fs');
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(payload));

    // `vi.resetModules()` + réimport dynamique donnent une instance de classe
    // `ConfigError` distincte de celle importée statiquement en haut de ce
    // fichier — on vérifie donc le message (actionnable, pas de stack brute)
    // plutôt que l'identité de classe.
    await expect(mockedRunExport(['report.json'])).rejects.toThrow(/ouvert|open/i);
    await expect(mockedRunExport(['report.json'])).rejects.not.toThrow(/EBUSY/);

    vi.doUnmock('node:fs');
    vi.doUnmock('./push.js');
    vi.resetModules();
  });
});
