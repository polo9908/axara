/**
 * `axaraaudit ci` interactif — l'intégration CI guidée, main dans la main.
 *
 * Même philosophie que `init` : ne jamais demander ce qu'on peut détecter.
 * Le wizard lit le remote git (GitHub ? GitLab ? pas encore de dépôt ?),
 * repère un workflow déjà installé, pose UNE question, puis accompagne la
 * suite en 2-3 lignes : connexion du dépôt si besoin, jeton, premier push.
 * UI volontairement sobre — un spinner, un sélecteur, des étapes numérotées.
 *
 * Interactive `axaraaudit ci` — guided CI integration, hand in hand. Same
 * philosophy as `init`: never ask what can be detected. The wizard reads the
 * git remote (GitHub? GitLab? no repo yet?), spots an already-installed
 * workflow, asks ONE question, then walks the user through the rest in 2-3
 * lines: repo connection if needed, token, first push. Deliberately quiet UI.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tr } from '../i18n.js';
import { dim, green, yellow } from '../report/render.js';
import { confirmYesNo, canConfirm } from '../ui/confirm.js';
import { selectOption, type SelectChoice } from '../ui/select.js';
import { createSpinner } from '../ui/spinner.js';

export type CiProvider = 'github' | 'gitlab';

export interface RepoDetection {
  /** Un dépôt git existe (répertoire ou worktree). */
  readonly hasGit: boolean;
  /** Forge reconnue depuis le remote `origin`, ou null (pas de remote / inconnue). */
  readonly provider: CiProvider | null;
  /** `owner/repo` (GitHub) ou `groupe/projet` (GitLab), si lisible. */
  readonly slug: string | null;
}

/**
 * Reconnaît la forge et le slug depuis une URL de remote git.
 * Formats couverts : ssh scp-like, ssh://, https:// — avec ou sans `.git`.
 */
export function parseGitRemote(url: string): { provider: CiProvider; slug: string } | null {
  const cleaned = url.trim();
  const match =
    /^(?:https?:\/\/|ssh:\/\/)?(?:[^@/]+@)?([^/:]+)[/:](.+?)(?:\.git)?\/?$/.exec(cleaned);
  if (match === null) return null;
  const host = (match[1] ?? '').toLowerCase();
  const slug = match[2] ?? '';
  if (slug === '' || slug.includes('..')) return null;
  // Auto-hébergé compris : tout hôte contenant « gitlab » est traité GitLab.
  if (host === 'github.com') return { provider: 'github', slug };
  if (host.includes('gitlab')) return { provider: 'gitlab', slug };
  return null;
}

/** Résout le chemin du répertoire git réel (`.git` fichier = worktree). */
function resolveGitDir(cwd: string): string | null {
  const dotGit = resolve(cwd, '.git');
  if (!existsSync(dotGit)) return null;
  try {
    const raw = readFileSync(dotGit, 'utf8');
    // `.git` fichier : `gitdir: /chemin/vers/le/vrai/.git`.
    const match = /^gitdir:\s*(.+)$/m.exec(raw);
    return match?.[1] !== undefined ? resolve(cwd, match[1].trim()) : null;
  } catch {
    // EISDIR : `.git` est un répertoire — le cas nominal.
    return dotGit;
  }
}

/** Détection sans exécuter git : lecture directe de `.git/config`. */
export function detectRepo(cwd: string): RepoDetection {
  const gitDir = resolveGitDir(cwd);
  if (gitDir === null) return { hasGit: false, provider: null, slug: null };
  let config = '';
  try {
    config = readFileSync(resolve(gitDir, 'config'), 'utf8');
  } catch {
    return { hasGit: true, provider: null, slug: null };
  }
  const section = /\[remote "origin"\][^[]*/.exec(config)?.[0] ?? '';
  const url = /^\s*url\s*=\s*(.+)$/m.exec(section)?.[1];
  if (url === undefined) return { hasGit: true, provider: null, slug: null };
  const parsed = parseGitRemote(url);
  return { hasGit: true, provider: parsed?.provider ?? null, slug: parsed?.slug ?? null };
}

/**
 * Prochaines étapes après l'écriture du workflow — numérotées, adaptées à
 * l'état du dépôt. C'est ici qu'on « tient la main » : jamais plus de trois
 * lignes, chaque ligne est une action copiable.
 */
export function nextSteps(provider: CiProvider, detection: RepoDetection, path: string): string[] {
  if (provider === 'github') {
    if (detection.provider === 'github') {
      // Dépôt déjà connecté : il ne reste que commit + PR. Jeton : automatique.
      return [
        tr(
          `1. git add ${path} && git commit -m "ci: axaraaudit"`,
          `1. git add ${path} && git commit -m "ci: axaraaudit"`,
        ),
        tr('2. git push, puis ouvrez une pull request', '2. git push, then open a pull request'),
        tr(
          '→ Jeton : rien à faire — GITHUB_TOKEN est fourni par Actions.',
          '→ Token: nothing to do — GITHUB_TOKEN is provided by Actions.',
        ),
      ];
    }
    // Pas (encore) de dépôt GitHub connecté : on accompagne la connexion.
    const steps = detection.hasGit
      ? []
      : [tr('0. git init && git add -A && git commit -m "init"', '0. git init && git add -A && git commit -m "init"')];
    return [
      ...steps,
      tr('1. Créez le dépôt : https://github.com/new', '1. Create the repo: https://github.com/new'),
      tr(
        '2. git remote add origin https://github.com/<vous>/<repo>.git && git push -u origin main',
        '2. git remote add origin https://github.com/<you>/<repo>.git && git push -u origin main',
      ),
      tr(
        '3. Ouvrez une PR — commentaire + gate arrivent tout seuls (jeton fourni par Actions).',
        '3. Open a PR — comment + gate run on their own (token provided by Actions).',
      ),
    ];
  }
  // GitLab : include + variable CI/CD (le CI_JOB_TOKEN ne peut pas poster).
  return [
    tr(
      `1. Ajoutez à .gitlab-ci.yml :  include: [{ local: ${path} }]`,
      `1. Add to .gitlab-ci.yml:  include: [{ local: ${path} }]`,
    ),
    tr(
      '2. Variable GITLAB_TOKEN (PAT scope api) : Settings → CI/CD → Variables',
      '2. GITLAB_TOKEN variable (PAT, api scope): Settings → CI/CD → Variables',
    ),
    tr(
      '3. Poussez, ouvrez une MR — commentaire + gate automatiques.',
      '3. Push, open an MR — comment + gate are automatic.',
    ),
  ];
}

function printSteps(steps: readonly string[]): void {
  for (const step of steps) process.stdout.write(dim(`    ${step}\n`));
}

export async function runCiWizard(options: {
  readonly cwd: string;
  readonly force: boolean;
}): Promise<number> {
  const { cwd, force } = options;
  const { GITHUB_WORKFLOW_PATH, GITLAB_SNIPPET_PATH, writeCiTemplate } = await import('./ci.js');

  const spinner = createSpinner(tr('Détection du dépôt…', 'Detecting the repository…'));
  spinner.start();
  const detection = detectRepo(cwd);
  spinner.succeed(
    detection.provider !== null
      ? tr(
          `Dépôt ${detection.provider === 'github' ? 'GitHub' : 'GitLab'} détecté${detection.slug !== null ? ` : ${detection.slug}` : ''}`,
          `${detection.provider === 'github' ? 'GitHub' : 'GitLab'} repository detected${detection.slug !== null ? `: ${detection.slug}` : ''}`,
        )
      : detection.hasGit
        ? tr('Dépôt git local — aucun remote reconnu', 'Local git repository — no recognized remote')
        : tr('Aucun dépôt git ici', 'No git repository here'),
  );

  // — UNE question ; l'ordre des choix suit la détection —
  const installedDetail = (path: string): string | undefined =>
    existsSync(resolve(cwd, path))
      ? tr('déjà installé — sera régénéré', 'already installed — will be regenerated')
      : undefined;
  const githubChoice: SelectChoice = {
    value: 'github',
    label: 'GitHub Actions',
    detail:
      installedDetail(GITHUB_WORKFLOW_PATH) ??
      (detection.provider === 'github'
        ? tr('recommandé — votre dépôt est sur GitHub', 'recommended — your repo is on GitHub')
        : tr('workflow PR : audit + gate + commentaire', 'PR workflow: audit + gate + comment')),
  };
  const gitlabChoice: SelectChoice = {
    value: 'gitlab',
    label: 'GitLab CI',
    detail:
      installedDetail(GITLAB_SNIPPET_PATH) ??
      (detection.provider === 'gitlab'
        ? tr('recommandé — votre dépôt est sur GitLab', 'recommended — your repo is on GitLab')
        : tr('snippet à inclure dans .gitlab-ci.yml', 'snippet to include from .gitlab-ci.yml')),
  };
  const choices: SelectChoice[] = [
    ...(detection.provider === 'gitlab' ? [gitlabChoice, githubChoice] : [githubChoice, gitlabChoice]),
    {
      value: 'preview',
      label: tr('Aperçu du commentaire de PR', 'Preview the PR comment'),
      detail: tr('markdown local — rien n’est publié', 'local markdown — nothing is published'),
    },
  ];

  for (;;) {
    const pick = await selectOption(tr('Intégration CI :', 'CI integration:'), choices);
    if (pick === null) {
      process.stdout.write(
        dim(tr('  Configuration annulée — rien n’a été écrit.\n', '  Setup cancelled — nothing was written.\n')),
      );
      return 0;
    }

    if (pick === 'preview') {
      // Audit frais + markdown sur stdout — la promesse « rien n'est publié ».
      process.stdout.write(
        dim(tr('  Aperçu (audit local, rien n’est publié) :\n\n', '  Preview (local audit, nothing is published):\n\n')),
      );
      const { runCi } = await import('./ci.js');
      await runCi(['comment', '--dry-run']);
      process.stdout.write('\n');
      continue; // retour au menu — l'aperçu est une étape, pas une fin.
    }

    const provider = pick as CiProvider;
    const path = provider === 'github' ? GITHUB_WORKFLOW_PATH : GITLAB_SNIPPET_PATH;
    let overwrite = force;
    if (existsSync(resolve(cwd, path)) && !overwrite) {
      if (!canConfirm()) {
        process.stdout.write(
          yellow(tr(`  ⚠ ${path} existe déjà — relancez avec --force.\n`, `  ⚠ ${path} already exists — rerun with --force.\n`)),
        );
        return 2;
      }
      overwrite = await confirmYesNo(tr(`${path} existe déjà — l'écraser ?`, `${path} already exists — overwrite it?`));
      if (!overwrite) continue; // retour au menu
    }
    writeCiTemplate(provider, overwrite);
    process.stdout.write(green(tr(`  ✓ ${path} écrit.\n`, `  ✓ ${path} written.\n`)));
    printSteps(nextSteps(provider, detection, path));
    return 0;
  }
}
