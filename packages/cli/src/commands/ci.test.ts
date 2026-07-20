import { describe, expect, it } from 'vitest';
import type { AuditDiff, AuditPayload, DiffEntry } from '@axaraaudit/core';
import { githubWorkflowTemplate, gitlabTemplate, renderPrComment } from './ci.js';
import { COMMENT_MARKER, detectPrContext } from '../services/ci-providers.js';

function entry(fingerprint: string, overrides: Partial<DiffEntry> = {}): DiffEntry {
  return {
    kind: 'drift',
    fingerprint,
    file: 'src/a.css',
    label: 'color: #fff',
    severity: 'error',
    ...overrides,
  };
}

function head(overrides: Partial<AuditPayload> = {}): AuditPayload {
  return {
    tool: 'test',
    toolVersion: '0.0.0',
    payloadVersion: 2,
    generatedAt: '2026-07-20T00:00:00.000Z',
    project: 'p',
    score: 72,
    scores: { design: 72, rgaa: 72 },
    gate: { evaluated: true, passed: false, failUnder: 80, reasons: ['Score 72/100 sous le seuil requis (80).'] },
    drift: {
      summary: { filesScanned: 1, totalIssues: 0, errors: 0, warnings: 0, autoFixable: 0 },
      tokenErrors: [],
      issues: [],
    },
    rgaa: {
      enabled: true,
      aggregate: { filesAudited: 1, criteriaFailed: 0, criteriaToReview: 0, totalFindings: 0, byImpact: {} },
      findings: [],
    },
    ...overrides,
  } as unknown as AuditPayload;
}

function diff(added: DiffEntry[], fixed: DiffEntry[], persistent: DiffEntry[]): AuditDiff {
  return {
    added,
    fixed,
    persistent,
    base: { score: 67, generatedAt: '2026-07-19T00:00:00.000Z' },
    head: {
      score: 72,
      generatedAt: '2026-07-20T00:00:00.000Z',
      gate: { evaluated: true, passed: false, failUnder: 80, reasons: [] },
    },
  };
}

describe('renderPrComment', () => {
  it('contient le marqueur sticky et le diff, sans lister les persistantes', () => {
    const body = renderPrComment(
      head(),
      diff([entry('n1')], [entry('f1', { file: 'src/b.css' })], [entry('p1'), entry('p2')]),
    );
    expect(body).toContain(COMMENT_MARKER);
    expect(body).toContain('67 → **72**/100');
    expect(body).toMatch(/1 (nouvelle|new)/);
    expect(body).toMatch(/1 (corrigée|fixed)/);
    expect(body).toMatch(/2 persist/);
    // Les persistantes sont comptées mais jamais listées ligne à ligne.
    const rows = body.split('\n').filter((l) => l.startsWith('| '));
    expect(rows.filter((l) => l.includes('src/a.css'))).toHaveLength(1); // n1 seulement (p1/p2 exclues)
  });

  it('tronque au-delà de 30 nouvelles violations', () => {
    const added = Array.from({ length: 40 }, (_, i) => entry(`n${i}`, { file: `src/f${i}.css` }));
    const body = renderPrComment(head(), diff(added, [], []));
    expect(body).toMatch(/10 (autre|more)/);
    expect(body.split('\n').filter((l) => l.startsWith('| ')).length).toBeLessThanOrEqual(32);
  });

  it('signale une baseline manquante au lieu de faire semblant', () => {
    const body = renderPrComment(head(), null, { baselineMissing: true });
    expect(body).toMatch(/indisponible|unavailable/);
    expect(body).toContain('**72**/100');
  });

  it('mentionne les exceptions justifiées appliquées', () => {
    const body = renderPrComment(
      head({ exceptions: { declared: 2, applied: 2, unmatched: [], invalid: [] } } as Partial<AuditPayload>),
      diff([], [], []),
    );
    expect(body).toMatch(/exception/i);
    expect(body).toMatch(/jamais bloquantes|never blocking/);
  });

  it('échappe les pipes markdown dans les libellés', () => {
    const body = renderPrComment(head(), diff([entry('n1', { label: 'a | b' })], [], []));
    expect(body).toContain('a \\| b');
  });
});

describe('detectPrContext', () => {
  it('github : contexte complet depuis GITHUB_REF', () => {
    const ctx = detectPrContext({
      GITHUB_ACTIONS: 'true',
      GITHUB_REPOSITORY: 'polo9908/axara',
      GITHUB_REF: 'refs/pull/42/merge',
      GITHUB_TOKEN: 'ghs_x',
    });
    expect(ctx).toEqual({
      provider: 'github',
      apiUrl: 'https://api.github.com',
      repo: 'polo9908/axara',
      prNumber: 42,
      token: 'ghs_x',
    });
  });

  it('github : null sans token ou hors PR', () => {
    expect(
      detectPrContext({ GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'a/b', GITHUB_REF: 'refs/heads/main', GITHUB_TOKEN: 'x' }),
    ).toBeNull();
    expect(
      detectPrContext({ GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'a/b', GITHUB_REF: 'refs/pull/1/merge' }),
    ).toBeNull();
  });

  it('gitlab : exige un jeton API (pas le CI_JOB_TOKEN)', () => {
    const env = {
      GITLAB_CI: 'true',
      CI_API_V4_URL: 'https://gitlab.example.com/api/v4',
      CI_PROJECT_ID: '123',
      CI_MERGE_REQUEST_IID: '7',
    };
    expect(detectPrContext(env)).toBeNull();
    expect(detectPrContext({ ...env, GITLAB_TOKEN: 'glpat-x' })).toMatchObject({
      provider: 'gitlab',
      projectId: '123',
      mrIid: '7',
    });
  });

  it('hors CI : null', () => {
    expect(detectPrContext({})).toBeNull();
  });
});

describe('templates CI', () => {
  it('github : gate --ci --fail-under, permissions PR et commentaire de diff', () => {
    const yml = githubWorkflowTemplate();
    expect(yml).toContain('on:\n  pull_request:');
    expect(yml).toContain('pull-requests: write');
    expect(yml).toContain('audit --ci --fail-under 80');
    expect(yml).toContain('ci comment --base base-report.json --head head-report.json');
    expect(yml).toContain("if: steps.audit.outcome == 'failure'");
  });

  it('gitlab : règle merge_request_event et gate différé après le commentaire', () => {
    const yml = gitlabTemplate();
    expect(yml).toContain('merge_request_event');
    expect(yml).toContain('audit --ci --fail-under 80');
    expect(yml).toContain('ci comment --base base-report.json --head head-report.json');
    expect(yml).toContain('AXARA_GATE_FAILED');
  });
});
