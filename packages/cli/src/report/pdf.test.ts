import { describe, expect, it } from 'vitest';
import type { AuditPayload } from './payload.js';
import { renderPdf, toPdfString, wrapText } from './pdf.js';

const PAYLOAD: AuditPayload = {
  tool: 'axaraaudit',
  toolVersion: '0.0.0-test',
  payloadVersion: 2,
  generatedAt: '2026-07-10T10:00:00.000Z',
  project: 'demo-projet',
  score: 72,
  scores: { design: 97, rgaa: 74 },
  gate: { evaluated: true, passed: false, failUnder: 80, reasons: ['score 72 < 80'] },
  drift: {
    summary: { filesScanned: 3, totalIssues: 2, errors: 1, warnings: 1, autoFixable: 1 },
    tokenErrors: [],
    issues: [
      {
        file: 'src/Bouton.tsx',
        line: 12,
        column: 3,
        category: 'color',
        property: 'background-color',
        value: '#ff0000',
        severity: 'error',
        match: 'exact-token',
        message: 'valeur en dur',
        autoFixable: true,
        suggestion: {
          token: 'color.brand.primary',
          cssVar: '--color-brand-primary',
          tokenValue: '#ff0000',
          replacement: 'var(--color-brand-primary)',
          distance: 0,
          confidence: 1,
        },
        fingerprint: 'aaaa000011112222',
      },
      {
        file: 'src/Bouton.tsx',
        line: 20,
        column: 5,
        category: 'dimension',
        property: 'padding',
        value: '13px',
        severity: 'warning',
        match: 'no-token',
        message: 'valeur sans token',
        autoFixable: false,
        fingerprint: 'bbbb000011112222',
      },
    ],
  },
  rgaa: {
    enabled: true,
    aggregate: {
      filesAudited: 3,
      criteriaFailed: 1,
      criteriaToReview: 0,
      totalFindings: 1,
      byImpact: { critical: 1 },
    },
    findings: [
      {
        criterion: '1.1',
        theme: 1,
        themeLabel: 'Images',
        criterionTitle: 'Chaque image porteuse d’information a-t-elle une alternative textuelle ?',
        wcag: ['1.1.1'],
        axeRuleId: 'image-alt',
        impact: 'critical',
        status: 'failed',
        description: 'Images must have alternate text',
        helpUrl: 'https://example.test/image-alt',
        occurrences: [{ html: '<img src="x.png">', target: 'img', failureSummary: 'missing alt' }],
        file: 'src/Header.tsx',
        fingerprint: 'cccc000011112222',
      },
    ],
  },
} as unknown as AuditPayload;

describe('toPdfString', () => {
  it('encode les accents français en WinAnsi', () => {
    const bytes = toPdfString('été à ç œ');
    expect([...bytes]).toContain(0xe9); // é
    expect([...bytes]).toContain(0xe0); // à
    expect([...bytes]).toContain(0x9c); // œ (extension cp1252)
  });

  it('échappe les parenthèses et le backslash', () => {
    expect(toPdfString('(a)\\').toString('latin1')).toBe('\\(a\\)\\\\');
  });

  it('remplace les glyphes hors WinAnsi par un fallback lisible', () => {
    expect(toPdfString('a → b ✓').toString('latin1')).toBe('a -> b OK');
    expect(toPdfString('日本').toString('latin1')).toBe('??');
  });
});

describe('wrapText', () => {
  it('coupe aux mots et ne perd rien', () => {
    const lines = wrapText('un texte assez long pour être coupé en plusieurs lignes', 10, 120);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(' ')).toBe('un texte assez long pour être coupé en plusieurs lignes');
  });

  it('ne coupe jamais un mot isolé trop large', () => {
    expect(wrapText('supercalifragilistic', 10, 5)).toEqual(['supercalifragilistic']);
  });
});

describe('renderPdf', () => {
  const pdf = renderPdf(PAYLOAD);
  const raw = pdf.toString('latin1');

  it('produit un PDF structurellement valide', () => {
    expect(raw.startsWith('%PDF-1.4')).toBe(true);
    expect(raw.endsWith('%%EOF\n')).toBe(true);
    expect(raw).toContain('/Type /Catalog');
    expect(raw).toContain('/Type /Pages');
    expect(raw).toContain('/BaseFont /Helvetica');
    expect(raw).toContain('startxref');
  });

  it('contient le projet, le score et les sections', () => {
    expect(raw).toContain('demo-projet');
    expect(raw).toContain('72/100');
    expect(raw).toContain('src/Bouton.tsx');
    expect(raw).toContain('var\\(--color-brand-primary\\)');
  });

  it('les offsets xref pointent sur les objets', () => {
    const match = /startxref\n(\d+)\n%%EOF/.exec(raw);
    expect(match).not.toBeNull();
    const xrefAt = Number(match?.[1]);
    expect(raw.slice(xrefAt, xrefAt + 4)).toBe('xref');
    // Le premier objet déclaré doit bien commencer à l'offset annoncé.
    const first = /\n(\d{10}) 00000 n /.exec(raw);
    const firstOffset = Number(first?.[1]);
    expect(raw.slice(firstOffset, firstOffset + 8)).toBe('1 0 obj\n');
  });
});
