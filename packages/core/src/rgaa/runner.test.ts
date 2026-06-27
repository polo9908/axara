import { describe, expect, it } from 'vitest';
import { toAraDeclaration } from './ara.js';
import { auditHtmlRgaa, runAxeOnHtml } from './runner.js';

// Integration: axe-core actually runs inside JSDOM. Slower than unit tests but
// proves the headless wiring end-to-end.
describe('runAxeOnHtml (integration)', () => {
  it('detects a missing image alt and maps it to RGAA 1.1', async () => {
    const report = await auditHtmlRgaa('<img src="logo.png">');
    const finding = report.findings.find((f) => f.axeRuleId === 'image-alt');
    expect(finding).toBeDefined();
    expect(finding!.criterion).toBe('1.1');
    expect(finding!.status).toBe('failed');
    expect(finding!.occurrences.length).toBeGreaterThan(0);
  }, 20_000);

  it('does not flag image-alt when alt is present', async () => {
    const report = await auditHtmlRgaa('<img src="logo.png" alt="Logo A11yEngine">');
    expect(report.findings.some((f) => f.axeRuleId === 'image-alt')).toBe(false);
  }, 20_000);

  it('flags an unlabeled form field as RGAA 11.1', async () => {
    const report = await auditHtmlRgaa('<form><input type="text" name="q"></form>');
    expect(report.findings.some((f) => f.criterion === '11.1')).toBe(true);
  }, 20_000);

  it('produces an Ara declaration from a live audit', async () => {
    const results = await runAxeOnHtml('<a href="#"></a>');
    expect(results.violations.length + results.incomplete.length).toBeGreaterThan(0);

    const report = await auditHtmlRgaa('<a href="#"></a>');
    const dec = toAraDeclaration(report);
    expect(dec.generator).toBe('A11yEngine');
    expect(dec.criteria.every((c) => c.status === 'NC')).toBe(true);
  }, 20_000);
});
