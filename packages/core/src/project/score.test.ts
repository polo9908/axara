import { describe, expect, it } from 'vitest';
import type { AuditSummary } from '../analyzer/audit.js';
import type { RgaaFinding } from '../rgaa/types.js';
import {
  computeScore,
  computeScoreBreakdown,
  evaluateGate,
  type FileRgaaFinding,
} from './score.js';

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

  it('matches the historical linear scale while the penalty stays ≤ 50', () => {
    // 1 critique (10) + 5 avertissements (2.5) = 12.5 → round(87.5) = 88.
    const drifted: AuditSummary = { ...cleanDrift, totalIssues: 5, warnings: 5 };
    expect(computeScore(drifted, [finding({})])).toBe(88);
  });

  it('never clamps flat at zero: a heavily failing project keeps a moving score', () => {
    // 30 critiques = 300 de pénalité — l'ancienne échelle rendait 0.
    const findings = Array.from({ length: 30 }, () => finding({}));
    const heavy = computeScore(cleanDrift, findings);
    expect(heavy).toBeGreaterThan(0);
    // En corriger 10 doit se voir sur le score global.
    const lighter = computeScore(cleanDrift, findings.slice(0, 20));
    expect(lighter).toBeGreaterThan(heavy);
  });

  it('is continuous at the linear/hyperbolic junction (penalty 50)', () => {
    // 5 critiques = 50 pile : les deux branches valent 50.
    const findings = Array.from({ length: 5 }, () => finding({}));
    expect(computeScore(cleanDrift, findings)).toBe(50);
  });
});

describe('computeScoreBreakdown', () => {
  it('isolates each pressure source on its own sub-score', () => {
    const drifted: AuditSummary = { ...cleanDrift, totalIssues: 4, warnings: 4 };
    const findings = Array.from({ length: 12 }, () => finding({}));
    const breakdown = computeScoreBreakdown(drifted, findings);
    expect(breakdown.design).toBe(98); // 4 × 0.5 = 2 de pénalité
    expect(breakdown.rgaa).toBe(21); // 120 de pénalité → 2500/120
    expect(breakdown.global).toBeLessThan(breakdown.rgaa);
  });

  it('shows drift progress even when RGAA debt saturates the global score', () => {
    const findings = Array.from({ length: 25 }, () => finding({}));
    const drifted: AuditSummary = { ...cleanDrift, totalIssues: 8, warnings: 8 };
    const before = computeScoreBreakdown(drifted, findings);
    const after = computeScoreBreakdown(cleanDrift, findings);
    expect(after.design).toBe(100);
    expect(after.design).toBeGreaterThan(before.design);
  });

  it('global equals computeScore', () => {
    const drifted: AuditSummary = { ...cleanDrift, totalIssues: 3, errors: 3 };
    expect(computeScoreBreakdown(drifted, [finding({})]).global).toBe(
      computeScore(drifted, [finding({})]),
    );
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
