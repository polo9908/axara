import { describe, expect, it } from 'vitest';
import type { AuditSummary, RgaaFinding } from '@axaraaudit/core';
import { computeScore, evaluateGate, type FileRgaaFinding } from './score.js';

const cleanDrift: AuditSummary = {
  filesScanned: 3,
  totalIssues: 0,
  errors: 0,
  warnings: 0,
  autoFixable: 0,
};

function finding(overrides: Partial<RgaaFinding>): FileRgaaFinding {
  return {
    file: 'components/Header.tsx',
    finding: {
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
      occurrences: [],
      ...overrides,
    },
  };
}

describe('computeScore', () => {
  it('returns 100 for a clean project', () => {
    expect(computeScore(cleanDrift, [])).toBe(100);
  });

  it('weights RGAA failures heavier than drift warnings', () => {
    const drifted: AuditSummary = { ...cleanDrift, totalIssues: 4, warnings: 4 };
    const withDrift = computeScore(drifted, []);
    const withRgaa = computeScore(cleanDrift, [finding({})]);
    expect(withDrift).toBeGreaterThan(withRgaa);
  });

  it('never goes below zero', () => {
    const findings = Array.from({ length: 30 }, () => finding({}));
    expect(computeScore(cleanDrift, findings)).toBe(0);
  });
});

describe('evaluateGate', () => {
  const options = { failUnder: 80, blockOnCritical: true, priority: [] as string[] };

  it('passes a clean run', () => {
    const gate = evaluateGate(100, [], options);
    expect(gate.passed).toBe(true);
    expect(gate.reasons).toHaveLength(0);
  });

  it('fails below the threshold even without blocking findings', () => {
    const gate = evaluateGate(79, [], options);
    expect(gate.passed).toBe(false);
    expect(gate.reasons[0]).toContain('79/100');
  });

  it('blocks on critical findings regardless of score', () => {
    const gate = evaluateGate(95, [finding({})], options);
    expect(gate.passed).toBe(false);
    expect(gate.blocking).toHaveLength(1);
  });

  it('does not block minor findings unless the criterion is priority', () => {
    const minor = finding({ impact: 'minor' });
    expect(evaluateGate(95, [minor], options).passed).toBe(true);
    expect(
      evaluateGate(95, [minor], { ...options, priority: ['1.1'] }).passed,
    ).toBe(false);
  });

  it('ignores cantTell findings for blocking', () => {
    const toReview = finding({ status: 'cantTell' });
    expect(evaluateGate(95, [toReview], { ...options, priority: ['1.1'] }).passed).toBe(true);
  });
});
