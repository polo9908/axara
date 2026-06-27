import { describe, expect, it } from 'vitest';
import { toAraDeclaration } from './ara.js';
import type { RgaaReport } from './types.js';

const REPORT: RgaaReport = {
  summary: {
    criteriaFailed: 2,
    criteriaToReview: 1,
    totalFindings: 3,
    byImpact: { minor: 0, moderate: 0, serious: 1, critical: 1 },
    byTheme: { 1: 2, 6: 1 },
  },
  findings: [
    {
      criterion: '1.1',
      theme: 1,
      themeLabel: 'Images',
      criterionTitle: 'alt',
      wcag: ['1.1.1'],
      axeRuleId: 'image-alt',
      impact: 'critical',
      status: 'failed',
      description: 'Images must have alternate text',
      helpUrl: 'https://x/image-alt',
      occurrences: [
        { target: 'img', html: '<img>', failureSummary: 's' },
        { target: 'img2', html: '<img>', failureSummary: 's' },
      ],
    },
    {
      criterion: '6.1',
      theme: 6,
      themeLabel: 'Liens',
      criterionTitle: 'link',
      wcag: ['2.4.4'],
      axeRuleId: 'link-name',
      impact: 'serious',
      status: 'failed',
      description: 'Links must have discernible text',
      helpUrl: 'https://x/link-name',
      occurrences: [{ target: 'a', html: '<a>', failureSummary: 's' }],
    },
    {
      criterion: '3.2',
      theme: 3,
      themeLabel: 'Couleurs',
      criterionTitle: 'contrast',
      wcag: ['1.4.3'],
      axeRuleId: 'color-contrast',
      impact: null,
      status: 'cantTell',
      description: 'contrast',
      helpUrl: 'https://x/color-contrast',
      occurrences: [{ target: 'p', html: '<p>', failureSummary: 's' }],
    },
  ],
  unmappedRules: [],
};

describe('toAraDeclaration', () => {
  it('declares failed criteria as NC and excludes cantTell', () => {
    const dec = toAraDeclaration(REPORT, { generatedAt: '2026-01-01T00:00:00.000Z' });
    expect(dec.referential).toBe('RGAA');
    expect(dec.referentialVersion).toBe('4.1');
    expect(dec.nonComplianceCount).toBe(2);
    expect(dec.criteria.map((c) => c.criterium)).toEqual(['1.1', '6.1']);
    expect(dec.criteria.every((c) => c.status === 'NC')).toBe(true);
  });

  it('maps axe impact to Ara user-impact levels', () => {
    const dec = toAraDeclaration(REPORT);
    const c11 = dec.criteria.find((c) => c.criterium === '1.1')!;
    const c61 = dec.criteria.find((c) => c.criterium === '6.1')!;
    expect(c11.userImpact).toBe('bloquant'); // critical
    expect(c61.userImpact).toBe('majeur'); // serious
  });

  it('aggregates occurrence counts and topic numbers', () => {
    const dec = toAraDeclaration(REPORT);
    const c11 = dec.criteria.find((c) => c.criterium === '1.1')!;
    expect(c11.topic).toBe(1);
    expect(c11.occurrenceCount).toBe(2);
    expect(c11.comment).toContain('axe: image-alt');
  });

  it('includes the honest manual-audit note', () => {
    const dec = toAraDeclaration(REPORT);
    expect(dec.note).toMatch(/audit manuel/i);
  });
});
