import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { getDesignSystemRules } from './get-design-system-rules.js';
import { validateComponentCode } from './validate-component-code.js';

const TOKENS = JSON.stringify({
  color: { $type: 'color', brand: { $value: '#3b82f6' } },
  space: { $type: 'dimension', sm: { $value: '8px' } },
});

const dir = mkdtempSync(join(tmpdir(), 'a11yengine-'));
const tokensPath = join(dir, 'design-tokens.dtcg.json');
writeFileSync(tokensPath, TOKENS, 'utf8');

afterAll(() => {
  /* tmp dir is cleaned by the OS */
});

describe('getDesignSystemRules', () => {
  it('returns tokens with var() references', () => {
    const result = getDesignSystemRules({ tokensPath });
    expect(result.count).toBe(2);
    expect(result.colors[0]!.reference).toBe('var(--color-brand)');
    expect(result.dimensions[0]!.path).toBe('space.sm');
  });

  it('throws a helpful error when no token file exists', () => {
    expect(() => getDesignSystemRules({ tokensPath: join(dir, 'missing.json') })).toThrow(
      /No DTCG token file/,
    );
  });
});

describe('validateComponentCode', () => {
  it('flags a missing image alt as RGAA 1.1 non-conformant', async () => {
    const result = await validateComponentCode({
      code: `const A = () => <img src="logo.png" />;`,
      checkDrift: false,
    });
    expect(result.framework).toBe('react');
    expect(result.normalizedHtml).toContain('<img');
    expect(result.verdict.conformant).toBe(false);
    expect(result.rgaa.findings.some((f) => f.criterion === '1.1')).toBe(true);
    expect(result.ara.criteria.some((c) => c.criterium === '1.1')).toBe(true);
  });

  it('passes a well-formed, labeled component', async () => {
    const result = await validateComponentCode({
      code: `const A = () => <label htmlFor="email">Email<input id="email" type="text" /></label>;`,
      checkDrift: false,
    });
    expect(result.rgaa.findings.some((f) => f.criterion === '11.1')).toBe(false);
  });

  it('detects design drift in a React snippet when tokens are available', async () => {
    const result = await validateComponentCode({
      code: `const A = () => <button style={{ color: '#3b82f6', padding: 8 }}>Go</button>;`,
      tokensPath,
    });
    expect(result.drift.length).toBeGreaterThan(0);
    expect(result.drift.some((d) => d.suggestion?.token === 'color.brand')).toBe(true);
  });

  it('handles Vue templates by stripping directives and interpolations', async () => {
    const result = await validateComponentCode({
      code: `<template><img :src="logo"></template>`,
      checkDrift: false,
    });
    expect(result.framework).toBe('vue');
    expect(result.normalizedHtml).toContain('<img');
    // missing alt → still caught by RGAA 1.1
    expect(result.rgaa.findings.some((f) => f.criterion === '1.1')).toBe(true);
  });
});
