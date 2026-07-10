import { describe, expect, it } from 'vitest';
import type { AuditPayload } from './payload.js';
import { renderHtml } from './html.js';
import { tr } from '../i18n.js';

function payload(overrides: Partial<AuditPayload> = {}): AuditPayload {
  return {
    tool: 'axaraaudit',
    toolVersion: '0.0.0',
    payloadVersion: 2,
    generatedAt: '2026-07-03T12:00:00.000Z',
    project: 'demo',
    score: 76,
    scores: { design: 98, rgaa: 90 },
    gate: { evaluated: true, passed: false, failUnder: 80, reasons: ['Score 76/100 sous le seuil requis (80).'] },
    drift: {
      summary: { filesScanned: 3, totalIssues: 1, errors: 1, warnings: 0, autoFixable: 0 },
      tokenErrors: [],
      issues: [
        {
          file: 'src/App.css',
          line: 13,
          column: 4,
          category: 'color',
          property: 'background',
          value: '#123456',
          severity: 'error',
          match: 'no-token',
          message: 'no token',
          autoFixable: false,
        },
      ],
    },
    rgaa: {
      enabled: true,
      aggregate: {
        filesAudited: 2,
        criteriaFailed: 1,
        criteriaToReview: 0,
        totalFindings: 1,
        byImpact: { critical: 1 },
      },
      findings: [
        {
          file: 'src/Header.jsx',
          criterion: '1.1',
          theme: 1,
          themeLabel: 'Images',
          criterionTitle: 'Alternative textuelle',
          wcag: ['1.1.1'],
          axeRuleId: 'image-alt',
          impact: 'critical',
          status: 'failed',
          description: '',
          helpUrl: '',
          occurrences: [
            {
              target: 'img',
              html: '<img src="/logo.svg" onerror="alert(1)">',
              failureSummary: 'Images must have alternate text',
            },
          ],
        },
      ],
    },
    ...overrides,
  };
}

describe('renderHtml', () => {
  it('produces a self-contained document with the score and verdict stamp', () => {
    const html = renderHtml(payload());
    expect(html).toContain(`<html lang="${tr('fr', 'en')}">`);
    expect(html).toContain('>76<');
    expect(html).toContain(tr('Seuil non atteint', 'Threshold not met'));
    // No network dependency: no external scripts, styles, fonts or images.
    expect(html).not.toMatch(/src\s*=\s*"https?:/);
    expect(html).not.toMatch(/href\s*=\s*"https?:/);
    expect(html).not.toMatch(/@import|url\(\s*['"]?https?:/);
  });

  it('escapes occurrence HTML so snippets cannot execute', () => {
    const html = renderHtml(payload());
    expect(html).not.toContain('<img src="/logo.svg" onerror');
    expect(html).toContain('&lt;img src=&quot;/logo.svg&quot; onerror');
  });

  it('shows the passing stamp when the gate passes', () => {
    const html = renderHtml(
      payload({ score: 95, gate: { evaluated: true, passed: true, failUnder: 80, reasons: [] } }),
    );
    expect(html).toContain(tr('Seuil atteint', 'Threshold met'));
    expect(html).toContain('stamp ok');
  });
});
