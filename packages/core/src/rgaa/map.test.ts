import type { AxeResults } from 'axe-core';
import { describe, expect, it } from 'vitest';
import { mapAxeResults } from './map.js';

interface FakeNode {
  html: string;
  target: string[];
  failureSummary?: string;
}

function rule(id: string, impact: string | null, nodes: FakeNode[]): unknown {
  return {
    id,
    impact,
    tags: [],
    description: `${id} description`,
    help: `${id} help`,
    helpUrl: `https://dequeuniversity.com/rules/axe/${id}`,
    nodes,
  };
}

function fakeResults(parts: {
  violations?: unknown[];
  incomplete?: unknown[];
}): AxeResults {
  return {
    testEngine: { name: 'axe-core', version: '4.x' },
    testRunner: { name: 'fake' },
    testEnvironment: {},
    timestamp: new Date().toISOString(),
    url: 'https://example.test/',
    toolOptions: {},
    passes: [],
    inapplicable: [],
    violations: parts.violations ?? [],
    incomplete: parts.incomplete ?? [],
  } as unknown as AxeResults;
}

const RESULTS = fakeResults({
  violations: [
    rule('image-alt', 'critical', [
      { html: '<img src="a.png">', target: ['img:nth-child(1)'], failureSummary: 'missing alt' },
      { html: '<img src="b.png">', target: ['img:nth-child(2)'], failureSummary: 'missing alt' },
    ]),
    rule('link-name', 'serious', [
      { html: '<a href="#"></a>', target: ['a'], failureSummary: 'empty link' },
    ]),
    rule('totally-unknown-rule', 'minor', [{ html: '<x>', target: ['x'] }]),
  ],
  incomplete: [
    rule('color-contrast', null, [{ html: '<p>x</p>', target: ['p'], failureSummary: 'cannot tell' }]),
  ],
});

describe('mapAxeResults', () => {
  it('maps axe rules to the right RGAA criteria', () => {
    const report = mapAxeResults(RESULTS);
    const criteria = report.findings.map((f) => f.criterion);
    expect(criteria).toContain('1.1'); // image-alt
    expect(criteria).toContain('6.1'); // link-name
    expect(criteria).toContain('3.2'); // color-contrast (incomplete)
  });

  it('carries theme metadata and occurrences', () => {
    const report = mapAxeResults(RESULTS);
    const imageFinding = report.findings.find((f) => f.axeRuleId === 'image-alt')!;
    expect(imageFinding.theme).toBe(1);
    expect(imageFinding.themeLabel).toBe('Images');
    expect(imageFinding.wcag).toContain('1.1.1');
    expect(imageFinding.occurrences).toHaveLength(2);
    expect(imageFinding.status).toBe('failed');
  });

  it('marks incomplete results as cantTell', () => {
    const report = mapAxeResults(RESULTS);
    const contrast = report.findings.find((f) => f.axeRuleId === 'color-contrast')!;
    expect(contrast.status).toBe('cantTell');
  });

  it('collects unmapped rules instead of dropping them silently', () => {
    const report = mapAxeResults(RESULTS);
    expect(report.unmappedRules).toContain('totally-unknown-rule');
    expect(report.findings.some((f) => f.axeRuleId === 'totally-unknown-rule')).toBe(false);
  });

  it('summarizes by impact, theme and criterion counts', () => {
    const report = mapAxeResults(RESULTS);
    expect(report.summary.criteriaFailed).toBe(2); // 1.1 and 6.1
    expect(report.summary.criteriaToReview).toBe(1); // 3.2
    expect(report.summary.byImpact.critical).toBe(1);
    expect(report.summary.byImpact.serious).toBe(1);
    expect(report.summary.byTheme[1]).toBe(2); // two image-alt occurrences
  });

  it('can exclude incomplete results', () => {
    const report = mapAxeResults(RESULTS, { includeIncomplete: false });
    expect(report.findings.some((f) => f.status === 'cantTell')).toBe(false);
    expect(report.summary.criteriaToReview).toBe(0);
  });
});
