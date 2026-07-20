import { describe, expect, it } from 'vitest';
import { diffAuditPayloads } from './diff.js';
import type { AuditPayload } from './payload.js';

interface FakeViolation {
  readonly kind: 'drift' | 'rgaa';
  readonly fingerprint: string;
  readonly file?: string;
  readonly severity?: string;
}

/** Payload minimal mais conforme au contrat, piloté par une liste d'empreintes. */
function payload(score: number, violations: readonly FakeViolation[]): AuditPayload {
  const driftIssues = violations
    .filter((v) => v.kind === 'drift')
    .map((v) => ({
      file: v.file ?? 'src/a.css',
      line: 1,
      column: 1,
      category: 'color',
      property: 'color',
      value: '#fff',
      severity: v.severity ?? 'error',
      match: 'exact',
      message: '',
      autoFixable: true,
      fingerprint: v.fingerprint,
    }));
  const rgaaFindings = violations
    .filter((v) => v.kind === 'rgaa')
    .map((v) => ({
      criterion: '1.1',
      axeRuleId: 'image-alt',
      status: 'failed',
      impact: v.severity ?? 'critical',
      file: v.file ?? 'src/b.tsx',
      fingerprint: v.fingerprint,
    }));
  return {
    tool: 'test',
    toolVersion: '0.0.0',
    payloadVersion: 2,
    generatedAt: '2026-07-20T00:00:00.000Z',
    project: 'p',
    score,
    scores: { design: score, rgaa: score },
    gate: { evaluated: true, passed: score >= 80, failUnder: 80, reasons: [] },
    drift: {
      summary: {
        filesScanned: 1,
        totalIssues: driftIssues.length,
        errors: driftIssues.length,
        warnings: 0,
        autoFixable: 0,
      },
      tokenErrors: [],
      issues: driftIssues,
    },
    rgaa: {
      enabled: true,
      aggregate: {
        filesAudited: 1,
        criteriaFailed: 0,
        criteriaToReview: 0,
        totalFindings: rgaaFindings.length,
        byImpact: {},
      },
      findings: rgaaFindings,
    },
  } as unknown as AuditPayload;
}

describe('diffAuditPayloads', () => {
  it('classe nouvelle / corrigée / persistante par empreinte', () => {
    const base = payload(70, [
      { kind: 'drift', fingerprint: 'aaa' },
      { kind: 'rgaa', fingerprint: 'bbb' },
    ]);
    const head = payload(75, [
      { kind: 'rgaa', fingerprint: 'bbb' },
      { kind: 'drift', fingerprint: 'ccc' },
    ]);
    const diff = diffAuditPayloads(base, head);
    expect(diff.added.map((e) => e.fingerprint)).toEqual(['ccc']);
    expect(diff.fixed.map((e) => e.fingerprint)).toEqual(['aaa']);
    expect(diff.persistent.map((e) => e.fingerprint)).toEqual(['bbb']);
    expect(diff.base.score).toBe(70);
    expect(diff.head.score).toBe(75);
  });

  it('deux payloads identiques → tout persistant', () => {
    const p = payload(90, [{ kind: 'drift', fingerprint: 'aaa' }]);
    const diff = diffAuditPayloads(p, p);
    expect(diff.added).toHaveLength(0);
    expect(diff.fixed).toHaveLength(0);
    expect(diff.persistent).toHaveLength(1);
  });

  it('trie les nouvelles par gravité (critical avant warning)', () => {
    const base = payload(90, []);
    const head = payload(60, [
      { kind: 'drift', fingerprint: 'w1', severity: 'warning' },
      { kind: 'rgaa', fingerprint: 'c1', severity: 'critical' },
      { kind: 'drift', fingerprint: 'e1', severity: 'error' },
    ]);
    const diff = diffAuditPayloads(base, head);
    expect(diff.added.map((e) => e.fingerprint)).toEqual(['c1', 'e1', 'w1']);
  });

  it('normalise les chemins en POSIX et construit des libellés lisibles', () => {
    const base = payload(90, []);
    const head = payload(80, [
      { kind: 'drift', fingerprint: 'ddd', file: 'src\\ui\\a.css' },
      { kind: 'rgaa', fingerprint: 'eee' },
    ]);
    const diff = diffAuditPayloads(base, head);
    const driftEntry = diff.added.find((e) => e.kind === 'drift');
    const rgaaEntry = diff.added.find((e) => e.kind === 'rgaa');
    expect(driftEntry?.file).toBe('src/ui/a.css');
    expect(driftEntry?.label).toBe('color: #fff');
    expect(rgaaEntry?.label).toBe('RGAA 1.1 · image-alt');
  });
});
