/**
 * `axaraaudit ci` — l'intégration pipeline en deux gestes.
 * `axaraaudit ci` — pipeline integration in two moves.
 *
 *   ci comment  — commentaire de PR/MR sticky qui montre UNIQUEMENT le diff de
 *                 violations entre la branche de base et la branche courante
 *                 (empreintes stables, voir core/fingerprint.ts) — jamais la
 *                 liste complète à chaque push. GitHub Actions en priorité,
 *                 GitLab CI ensuite. Best-effort : un échec réseau avertit
 *                 mais ne fait jamais échouer le pipeline (le gate, lui, vit
 *                 dans `audit --ci`).
 *   ci init     — écrit un workflow prêt à l'emploi (GitHub Actions ou
 *                 GitLab CI) : audit + gate + commentaire de diff.
 *
 * Le gate reste `audit --ci --fail-under <seuil>` ; les exceptions justifiées
 * de `.auditorrc.json` (champ `exceptions`) n'y comptent jamais.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { auditProject, diffAuditPayloads, type AuditDiff, type AuditPayload, type DiffEntry } from '@axaraaudit/core';
import { ConfigError } from '../config/rc.js';
import { tr } from '../i18n.js';
import { dim, green, yellow } from '../report/render.js';
import { COMMENT_MARKER, detectPrContext, upsertPrComment } from '../services/ci-providers.js';
import { validateAuditPayload } from './push.js';
import { CLI_NAME, CLI_VERSION } from '../version.js';

const MAX_LISTED = 30;

function log(message: string): void {
  process.stderr.write(`${message}\n`);
}

// ── Rendu markdown du commentaire ──────────────────────────────────────────

function mdEscape(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/`/g, '’');
}

function entryRow(entry: DiffEntry): string {
  const severity = entry.status === 'cantTell' ? tr('à vérifier', 'to review') : entry.severity;
  return `| ${mdEscape(severity)} | \`${mdEscape(entry.file)}\` | ${mdEscape(entry.label)} |`;
}

function entriesTable(entries: readonly DiffEntry[]): string[] {
  const lines = [
    tr('| Sévérité | Fichier | Violation |', '| Severity | File | Violation |'),
    '| --- | --- | --- |',
    ...entries.slice(0, MAX_LISTED).map(entryRow),
  ];
  if (entries.length > MAX_LISTED) {
    lines.push('');
    lines.push(
      tr(
        `…et ${entries.length - MAX_LISTED} autre(s) — rapport complet : \`axaraaudit audit\`.`,
        `…and ${entries.length - MAX_LISTED} more — full report: \`axaraaudit audit\`.`,
      ),
    );
  }
  return lines;
}

export interface RenderCommentOptions {
  /** Rapport de base indisponible : synthèse sans diff, avec avertissement. */
  readonly baselineMissing?: boolean;
}

/**
 * Corps du commentaire de PR : le diff, rien que le diff. Les violations
 * persistantes sont comptées mais jamais listées — c'est la promesse.
 */
export function renderPrComment(
  head: AuditPayload,
  diff: AuditDiff | null,
  options: RenderCommentOptions = {},
): string {
  const lines: string[] = [COMMENT_MARKER, ''];
  const gate = head.gate;
  const gateBadge = gate.passed ? '✅' : '❌';
  const scorePart =
    diff !== null && diff.base.score !== diff.head.score
      ? `${diff.base.score} → **${diff.head.score}**/100`
      : `**${head.score}**/100`;

  lines.push(`## AxaraAudit ${gateBadge}`);
  lines.push('');
  lines.push(
    tr(
      `Score : ${scorePart} · seuil : ${gate.failUnder} · gate : ${gate.passed ? 'passé' : 'échoué'}`,
      `Score: ${scorePart} · threshold: ${gate.failUnder} · gate: ${gate.passed ? 'passed' : 'failed'}`,
    ),
  );

  if (options.baselineMissing === true || diff === null) {
    lines.push('');
    lines.push(
      tr(
        '> ⚠ Rapport de la branche de base indisponible — diff impossible sur ce run.',
        '> ⚠ Base branch report unavailable — no diff for this run.',
      ),
    );
  } else {
    lines.push('');
    lines.push(
      tr(
        `**${diff.added.length} nouvelle(s)** · **${diff.fixed.length} corrigée(s)** · ${diff.persistent.length} persistante(s) (non listées)`,
        `**${diff.added.length} new** · **${diff.fixed.length} fixed** · ${diff.persistent.length} persistent (not listed)`,
      ),
    );

    if (diff.added.length > 0) {
      lines.push('');
      lines.push(tr(`### Nouvelles violations (${diff.added.length})`, `### New violations (${diff.added.length})`));
      lines.push('');
      lines.push(...entriesTable(diff.added));
    }

    if (diff.fixed.length > 0) {
      lines.push('');
      lines.push('<details>');
      lines.push(
        `<summary>${tr(`✔ ${diff.fixed.length} violation(s) corrigée(s)`, `✔ ${diff.fixed.length} fixed violation(s)`)}</summary>`,
      );
      lines.push('');
      lines.push(...entriesTable(diff.fixed));
      lines.push('');
      lines.push('</details>');
    }

    if (diff.added.length === 0 && diff.fixed.length === 0) {
      lines.push('');
      lines.push(
        tr(
          'Aucun changement de violations sur cette PR. ✨',
          'No violation changes in this PR. ✨',
        ),
      );
    }
  }

  if (head.exceptions !== undefined && head.exceptions.applied > 0) {
    lines.push('');
    lines.push(
      tr(
        `_${head.exceptions.applied} violation(s) couverte(s) par une exception justifiée (\`.auditorrc.json\`) — jamais bloquantes._`,
        `_${head.exceptions.applied} violation(s) covered by a justified exception (\`.auditorrc.json\`) — never blocking._`,
      ),
    );
  }
  if (gate.reasons.length > 0) {
    lines.push('');
    lines.push(tr('**Raisons du gate :**', '**Gate reasons:**'));
    for (const reason of gate.reasons) lines.push(`- ${mdEscape(reason)}`);
  }

  lines.push('');
  lines.push(`<sub>${CLI_NAME} v${CLI_VERSION}</sub>`);
  lines.push('');
  return lines.join('\n');
}

// ── ci comment ─────────────────────────────────────────────────────────────

interface CommentFlags {
  readonly base?: string;
  readonly head?: string;
  readonly dryRun: boolean;
  readonly config?: string;
  readonly skipRgaa: boolean;
}

function parseCommentFlags(argv: readonly string[]): CommentFlags {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      base: { type: 'string' },
      head: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      config: { type: 'string' },
      'skip-rgaa': { type: 'boolean', default: false },
    },
  });
  return {
    ...(values.base !== undefined ? { base: values.base } : {}),
    ...(values.head !== undefined ? { head: values.head } : {}),
    dryRun: values['dry-run'] ?? false,
    ...(values.config !== undefined ? { config: values.config } : {}),
    skipRgaa: values['skip-rgaa'] ?? false,
  };
}

/** Lit un rapport JSON, tolérant : null si absent/invalide (avec warning). */
function readReportLenient(path: string, role: string): AuditPayload | null {
  if (!existsSync(path)) {
    log(yellow(tr(`⚠ Rapport ${role} introuvable : ${path}`, `⚠ ${role} report not found: ${path}`)));
    return null;
  }
  try {
    return validateAuditPayload(JSON.parse(readFileSync(path, 'utf8')), path);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    log(yellow(`⚠ ${reason}`));
    return null;
  }
}

async function runCiComment(argv: readonly string[]): Promise<number> {
  const flags = parseCommentFlags(argv);

  // Rapport head : fichier fourni, sinon audit frais du répertoire courant.
  let head: AuditPayload | null;
  if (flags.head !== undefined) {
    head = readReportLenient(flags.head, tr('de la branche courante', 'current-branch'));
  } else {
    const result = await auditProject({
      cwd: process.cwd(),
      tool: CLI_NAME,
      toolVersion: CLI_VERSION,
      configPath: flags.config,
      skipRgaa: flags.skipRgaa,
      ciMode: true,
    });
    head = result.payload;
  }
  if (head === null) {
    // Best-effort : ne jamais faire échouer un pipeline pour un commentaire.
    log(
      yellow(
        tr(
          '⚠ Aucun rapport de branche courante — commentaire non publié.',
          '⚠ No current-branch report — comment not published.',
        ),
      ),
    );
    return 0;
  }

  const base = flags.base !== undefined ? readReportLenient(flags.base, tr('de base', 'base')) : null;
  if (flags.base === undefined) {
    log(
      yellow(
        tr(
          '⚠ Pas de --base fourni — le commentaire ne contiendra pas de diff.',
          '⚠ No --base provided — the comment will not contain a diff.',
        ),
      ),
    );
  }

  const diff = base !== null ? diffAuditPayloads(base, head) : null;
  const body = renderPrComment(head, diff, { baselineMissing: base === null });

  const context = detectPrContext();
  if (flags.dryRun || context === null) {
    if (!flags.dryRun) {
      log(
        yellow(
          tr(
            '⚠ Aucun contexte CI détecté (GITHUB_TOKEN / GITLAB_TOKEN + pipeline de PR) — markdown sur stdout.',
            '⚠ No CI context detected (GITHUB_TOKEN / GITLAB_TOKEN + PR pipeline) — markdown on stdout.',
          ),
        ),
      );
    }
    process.stdout.write(`${body}\n`);
    return 0;
  }

  try {
    const outcome = await upsertPrComment(context, body);
    log(
      green(
        outcome === 'created'
          ? tr('✓ Commentaire de PR publié.', '✓ PR comment published.')
          : tr('✓ Commentaire de PR mis à jour.', '✓ PR comment updated.'),
      ),
    );
  } catch (error) {
    // Une panne d'API de forge ne doit jamais casser le build.
    const reason = error instanceof Error ? error.message : String(error);
    log(yellow(tr(`⚠ Commentaire non publié : ${reason}`, `⚠ Comment not published: ${reason}`)));
  }
  return 0;
}

// ── ci init ────────────────────────────────────────────────────────────────

const GITHUB_WORKFLOW_PATH = '.github/workflows/axaraaudit.yml';
const GITLAB_SNIPPET_PATH = 'axaraaudit.gitlab-ci.yml';

/** Template GitHub Actions — prêt à copier-coller tel quel. */
export function githubWorkflowTemplate(): string {
  return `# AxaraAudit — audit design-system + RGAA sur chaque pull request.
# ${tr('Généré par `axaraaudit ci init github`. Seuil : ajustez --fail-under (ou ci.failUnder dans .auditorrc.json).', 'Generated by `axaraaudit ci init github`. Threshold: adjust --fail-under (or ci.failUnder in .auditorrc.json).')}
# ${tr('Les exceptions justifiées (champ `exceptions` de .auditorrc.json) ne font jamais échouer le build.', 'Justified exceptions (`exceptions` field of .auditorrc.json) never fail the build.')}
name: AxaraAudit

on:
  pull_request:

permissions:
  contents: read
  pull-requests: write # ${tr('commentaire de PR', 'PR comment')}

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20

      # 1) ${tr('Audit de la branche PR — le gate est relevé au pas 4.', 'PR branch audit — the gate is raised at step 4.')}
      - name: Audit
        id: audit
        continue-on-error: true
        run: npx -y axaraaudit audit --ci --fail-under 80 --format json --out head-report.json

      # 2) ${tr('Audit de la branche de base — sert uniquement au diff du commentaire.', 'Base branch audit — only feeds the comment diff.')}
      - name: ${tr('Audit de la base', 'Base audit')}
        continue-on-error: true
        run: |
          git fetch --depth=1 origin "$GITHUB_BASE_REF"
          git worktree add ../axara-base "origin/$GITHUB_BASE_REF"
          cd ../axara-base
          npx -y axaraaudit audit --format json --out "$GITHUB_WORKSPACE/base-report.json"

      # 3) ${tr('Commentaire sticky : uniquement le diff (nouvelles / corrigées).', 'Sticky comment: the diff only (new / fixed).')}
      - name: ${tr('Commentaire de PR', 'PR comment')}
        if: \${{ !cancelled() }}
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: npx -y axaraaudit ci comment --base base-report.json --head head-report.json

      # 4) Gate
      - name: Gate
        if: steps.audit.outcome == 'failure'
        run: |
          echo "AxaraAudit gate failed — ${tr('voir le commentaire de PR.', 'see the PR comment.')}"
          exit 1
`;
}

/** Template GitLab CI — à inclure depuis .gitlab-ci.yml. */
export function gitlabTemplate(): string {
  return `# AxaraAudit — ${tr('à inclure depuis votre .gitlab-ci.yml :', 'include from your .gitlab-ci.yml:')}
#   include:
#     - local: ${GITLAB_SNIPPET_PATH}
# ${tr('Variable CI/CD requise pour le commentaire de MR : GITLAB_TOKEN (PAT scope `api`).', 'Required CI/CD variable for the MR comment: GITLAB_TOKEN (PAT with `api` scope).')}
axaraaudit:
  image: node:20
  stage: test
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  script:
    - npx -y axaraaudit audit --ci --fail-under 80 --format json --out head-report.json || AXARA_GATE_FAILED=1
    - git fetch --depth=1 origin "$CI_MERGE_REQUEST_TARGET_BRANCH_NAME" || true
    - git worktree add ../axara-base "origin/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME" || true
    - (cd ../axara-base && npx -y axaraaudit audit --format json --out "$CI_PROJECT_DIR/base-report.json") || true
    - npx -y axaraaudit ci comment --base base-report.json --head head-report.json
    - if [ "$AXARA_GATE_FAILED" = "1" ]; then echo "AxaraAudit gate failed"; exit 1; fi
`;
}

function runCiInit(argv: readonly string[]): number {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: { force: { type: 'boolean', default: false } },
    allowPositionals: true,
  });
  const provider = positionals[0] ?? 'github';
  if (provider !== 'github' && provider !== 'gitlab') {
    throw new ConfigError(
      tr(
        `Fournisseur inconnu : ${provider} (attendu : github ou gitlab).`,
        `Unknown provider: ${provider} (expected: github or gitlab).`,
      ),
    );
  }

  const path = provider === 'github' ? GITHUB_WORKFLOW_PATH : GITLAB_SNIPPET_PATH;
  if (existsSync(path) && values.force !== true) {
    throw new ConfigError(
      tr(`${path} existe déjà — relancez avec --force pour l'écraser.`, `${path} already exists — re-run with --force to overwrite.`),
    );
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, provider === 'github' ? githubWorkflowTemplate() : gitlabTemplate(), 'utf8');

  log(green(tr(`✓ ${path} écrit.`, `✓ ${path} written.`)));
  if (provider === 'github') {
    log(
      dim(
        tr(
          '  Commitez le fichier : audit + gate + commentaire de diff sur chaque PR, sans autre réglage.',
          '  Commit the file: audit + gate + diff comment on every PR, no further setup.',
        ),
      ),
    );
  } else {
    log(
      dim(
        tr(
          `  Ajoutez \`include: - local: ${GITLAB_SNIPPET_PATH}\` à .gitlab-ci.yml et la variable GITLAB_TOKEN (PAT scope api).`,
          `  Add \`include: - local: ${GITLAB_SNIPPET_PATH}\` to .gitlab-ci.yml plus a GITLAB_TOKEN variable (PAT, api scope).`,
        ),
      ),
    );
  }
  return 0;
}

// ── Dispatch ───────────────────────────────────────────────────────────────

export async function runCi(argv: readonly string[]): Promise<number> {
  const sub = argv[0];
  if (sub === 'comment') return runCiComment(argv.slice(1));
  if (sub === 'init') return runCiInit(argv.slice(1));
  process.stderr.write(
    tr(
      'Usage : axaraaudit ci <comment|init>\n' +
        '  ci comment --base base.json --head head.json   commentaire de PR (diff uniquement)\n' +
        '  ci init [github|gitlab]                        écrit le workflow prêt à l’emploi\n',
      'Usage: axaraaudit ci <comment|init>\n' +
        '  ci comment --base base.json --head head.json   PR comment (diff only)\n' +
        '  ci init [github|gitlab]                        writes the ready-made workflow\n',
    ),
  );
  return 2;
}
