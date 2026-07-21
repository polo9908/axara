import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { detectRepo, nextSteps, parseGitRemote } from './ci-wizard.js';

describe('parseGitRemote', () => {
  it('reconnaît les formats GitHub usuels', () => {
    for (const url of [
      'git@github.com:polo9908/axara.git',
      'https://github.com/polo9908/axara.git',
      'https://github.com/polo9908/axara',
      'ssh://git@github.com/polo9908/axara.git',
    ]) {
      expect(parseGitRemote(url)).toEqual({ provider: 'github', slug: 'polo9908/axara' });
    }
  });

  it('reconnaît GitLab, sous-groupes et auto-hébergé compris', () => {
    expect(parseGitRemote('git@gitlab.com:groupe/sous/projet.git')).toEqual({
      provider: 'gitlab',
      slug: 'groupe/sous/projet',
    });
    expect(parseGitRemote('https://gitlab.example.com/equipe/app.git')).toEqual({
      provider: 'gitlab',
      slug: 'equipe/app',
    });
  });

  it('null sur les forges inconnues ou les URL invalides', () => {
    expect(parseGitRemote('https://bitbucket.org/a/b.git')).toBeNull();
    expect(parseGitRemote('')).toBeNull();
    expect(parseGitRemote('pas-une-url')).toBeNull();
  });
});

describe('detectRepo', () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('lit le remote origin depuis .git/config', () => {
    dir = mkdtempSync(join(tmpdir(), 'axara-ci-'));
    mkdirSync(join(dir, '.git'));
    writeFileSync(
      join(dir, '.git', 'config'),
      '[core]\n\tbare = false\n[remote "origin"]\n\turl = git@github.com:polo9908/axara.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n',
      'utf8',
    );
    expect(detectRepo(dir)).toEqual({ hasGit: true, provider: 'github', slug: 'polo9908/axara' });
  });

  it('dépôt sans remote : hasGit true, provider null', () => {
    dir = mkdtempSync(join(tmpdir(), 'axara-ci-'));
    mkdirSync(join(dir, '.git'));
    writeFileSync(join(dir, '.git', 'config'), '[core]\n\tbare = false\n', 'utf8');
    expect(detectRepo(dir)).toEqual({ hasGit: true, provider: null, slug: null });
  });

  it('pas de .git : tout est null', () => {
    dir = mkdtempSync(join(tmpdir(), 'axara-ci-'));
    expect(detectRepo(dir)).toEqual({ hasGit: false, provider: null, slug: null });
  });
});

describe('nextSteps', () => {
  const path = '.github/workflows/axaraaudit.yml';

  it('github + dépôt connecté : commit, push, jeton automatique — 3 lignes max', () => {
    const steps = nextSteps('github', { hasGit: true, provider: 'github', slug: 'a/b' }, path);
    expect(steps).toHaveLength(3);
    expect(steps.join('\n')).toContain('git push');
    expect(steps.join('\n')).toMatch(/GITHUB_TOKEN/);
  });

  it('github sans remote : accompagne la connexion du dépôt (github.com/new, remote add)', () => {
    const steps = nextSteps('github', { hasGit: true, provider: null, slug: null }, path);
    expect(steps.join('\n')).toContain('https://github.com/new');
    expect(steps.join('\n')).toContain('git remote add origin');
  });

  it('github sans dépôt git du tout : ajoute git init en étape 0', () => {
    const steps = nextSteps('github', { hasGit: false, provider: null, slug: null }, path);
    expect(steps[0]).toContain('git init');
  });

  it('gitlab : include + variable GITLAB_TOKEN', () => {
    const steps = nextSteps('gitlab', { hasGit: true, provider: 'gitlab', slug: 'g/p' }, 'axaraaudit.gitlab-ci.yml');
    expect(steps.join('\n')).toContain('include');
    expect(steps.join('\n')).toContain('GITLAB_TOKEN');
  });
});
