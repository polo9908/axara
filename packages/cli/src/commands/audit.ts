/**
 * `axaraaudit audit` — the main sensor run.
 *
 * Open-source path: local config → static drift analysis + RGAA (axe-core)
 * → pretty/JSON report. Pro path (token present): optional remote
 * config/tokens pull (`--remote`) and report upload (`--upload`).
 * `--ci` turns the run into a gatekeeper: exit code 1 when the gate fails.
 */

import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { auditProject } from '@axaraaudit/core';
import { loadRc, mergeRc, ConfigError } from '../config/rc.js';
import { resolveToken } from '../config/credentials.js';
import { tr } from '../i18n.js';
import { fetchRemoteConfig, uploadReport, ApiError } from '../services/api.js';
import { renderHtml } from '../report/html.js';
import { renderPretty, renderSubScores, dim, green, yellow } from '../report/render.js';
import { stderrLevel } from '../ui/ansi.js';
import { renderBanner } from '../ui/banner.js';
import { canReveal, revealScore } from '../ui/reveal.js';
import { createSpinner } from '../ui/spinner.js';
import { printTips, type Tip } from '../ui/tips.js';
import { CLI_NAME, CLI_VERSION } from '../version.js';

export interface AuditFlags {
  readonly config?: string;
  readonly tokens?: string;
  readonly format: 'pretty' | 'json' | 'html';
  readonly out?: string;
  readonly ci: boolean;
  readonly remote: boolean;
  readonly upload: boolean;
  readonly skipRgaa: boolean;
  readonly failUnder?: number;
}

export function parseAuditFlags(argv: readonly string[]): AuditFlags {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      config: { type: 'string' },
      tokens: { type: 'string' },
      format: { type: 'string', default: 'pretty' },
      out: { type: 'string' },
      ci: { type: 'boolean', default: false },
      remote: { type: 'boolean', default: false },
      upload: { type: 'boolean', default: false },
      'skip-rgaa': { type: 'boolean', default: false },
      'fail-under': { type: 'string' },
    },
    allowPositionals: true,
  });

  const format =
    values.format === 'json' ? 'json' : values.format === 'html' ? 'html' : 'pretty';
  const failUnderRaw = values['fail-under'];
  const failUnder = failUnderRaw === undefined ? undefined : Number(failUnderRaw);
  if (failUnder !== undefined && (Number.isNaN(failUnder) || failUnder < 0 || failUnder > 100)) {
    throw new ConfigError(
      tr(
        `--fail-under doit être un nombre entre 0 et 100 (reçu: ${failUnderRaw}).`,
        `--fail-under must be a number between 0 and 100 (got: ${failUnderRaw}).`,
      ),
    );
  }

  return {
    ...(values.config !== undefined ? { config: values.config } : {}),
    ...(values.tokens !== undefined ? { tokens: values.tokens } : {}),
    format,
    ...(values.out !== undefined ? { out: values.out } : {}),
    ci: values.ci ?? false,
    remote: values.remote ?? false,
    upload: values.upload ?? false,
    skipRgaa: values['skip-rgaa'] ?? false,
    ...(failUnder !== undefined ? { failUnder } : {}),
  };
}

function log(message: string): void {
  process.stderr.write(`${message}\n`);
}

export async function runAudit(argv: readonly string[]): Promise<number> {
  const flags = parseAuditFlags(argv);
  const cwd = process.cwd();

  // Bannière de marque sur stderr : visible en interactif, absente des pipes.
  if (flags.format === 'pretty' && process.stderr.isTTY === true) {
    process.stderr.write(renderBanner(stderrLevel));
  }

  let loaded = loadRc(cwd, flags.config);
  const token = resolveToken();

  // ── Pro: remote config/tokens (explicit --remote or rc.pro.remoteConfig) ──
  let inlineTokensJson: string | null = null;
  const wantRemote = flags.remote || loaded.rc.pro.remoteConfig;
  if (wantRemote) {
    if (token === null) {
      if (flags.remote) {
        throw new ConfigError(
          tr(
            'La synchronisation distante (--remote) nécessite un jeton Pro. ' +
              'Définissez AUDITOR_TOKEN ou lancez `axaraaudit login --token <jeton>`.',
            'Remote sync (--remote) requires a Pro token. ' +
              'Set AUDITOR_TOKEN or run `axaraaudit login --token <token>`.',
          ),
        );
      }
      log(
        yellow(
          tr(
            '⚠ pro.remoteConfig activé mais aucun jeton trouvé — configuration locale utilisée.',
            '⚠ pro.remoteConfig is enabled but no token was found — using local configuration.',
          ),
        ),
      );
    } else {
      const apiUrl = token.apiUrl ?? loaded.rc.pro.apiUrl;
      const remote = await fetchRemoteConfig(apiUrl, token.token);
      if (remote.config !== undefined) {
        loaded = { ...loaded, rc: mergeRc(loaded.rc, remote.config) };
      }
      if (remote.tokens !== undefined) {
        inlineTokensJson = JSON.stringify(remote.tokens);
      }
      log(green(tr(`✓ Règles synchronisées depuis ${apiUrl}`, `✓ Rules synced from ${apiUrl}`)));
    }
  }

  // ── Collect, analyse, score (single shared pipeline in core) ──
  const spinner = createSpinner(
    tr('Analyse du design-system + RGAA…', 'Analyzing design system + RGAA…'),
  );
  if (flags.format === 'pretty') spinner.start();
  let result: Awaited<ReturnType<typeof auditProject>>;
  try {
    result = await auditProject({
      cwd,
      tool: CLI_NAME,
      toolVersion: CLI_VERSION,
      loaded,
      ...(flags.failUnder !== undefined
        ? { rcOverrides: { ci: { failUnder: flags.failUnder } } }
        : {}),
      ...(flags.tokens !== undefined ? { tokensPath: flags.tokens } : {}),
      ...(inlineTokensJson !== null ? { inlineTokensJson } : {}),
      skipRgaa: flags.skipRgaa,
      ciMode: flags.ci,
    });
  } catch (error) {
    if (flags.format === 'pretty') spinner.fail(tr('Audit interrompu', 'Audit aborted'));
    throw error;
  }
  const { payload, gate, rc } = result;
  if (flags.format === 'pretty') {
    spinner.succeed(
      tr(
        `Audit terminé — ${payload.drift.summary.filesScanned} fichier(s) analysé(s)`,
        `Audit complete — ${payload.drift.summary.filesScanned} file(s) analyzed`,
      ),
    );
  }

  if (result.tokensSource.origin === 'none' && flags.format === 'pretty') {
    log(
      yellow(
        tr(
          '⚠ Aucun design system — audit RGAA + tabulation uniquement.',
          '⚠ No design system — RGAA + keyboard audit only.',
        ),
      ),
    );
  }
  if (result.tokensSource.origin === 'auto') {
    // Reconstruit le détail depuis les compteurs structurés pour pouvoir le
    // localiser (core fournit `detail` en français, gardé en fallback).
    const { count, sourceFileCount } = result.tokensSource;
    const detail =
      count !== undefined && sourceFileCount !== undefined
        ? tr(
            `${count} tokens extraits de ${sourceFileCount} fichier(s) CSS`,
            `${count} tokens extracted from ${sourceFileCount} CSS file(s)`,
          )
        : result.tokensSource.detail;
    log(green(tr(`✓ Zéro-config : ${detail}.`, `✓ Zero-config: ${detail}.`)));
    log(
      dim(
        tr(
          '  (aucun fichier de tokens déclaré — les custom properties CSS font foi)',
          '  (no tokens file declared — CSS custom properties are the source of truth)',
        ),
      ),
    );
  }

  const json = JSON.stringify(payload, null, 2);
  // Sur TTY, la section SCORE textuelle cède la place à la révélation animée.
  const animateScore = flags.format !== 'json' && canReveal();
  if (flags.format === 'html') {
    const outPath = flags.out ?? 'axara-report.html';
    writeFileSync(outPath, renderHtml(payload), 'utf8');
    process.stdout.write(renderPretty(payload, loaded.rootDir, { verdict: !animateScore }));
    if (animateScore) await revealScore(payload.score, payload.gate, renderSubScores(payload));
    log(green(tr(`✓ Rapport HTML écrit : ${outPath}`, `✓ HTML report written: ${outPath}`)));
    log(
      dim(
        tr(
          '  Ouvrez-le dans un navigateur — fichier autonome, partageable tel quel.',
          '  Open it in a browser — self-contained file, shareable as is.',
        ),
      ),
    );
  } else {
    if (flags.out !== undefined) {
      writeFileSync(flags.out, `${json}\n`, 'utf8');
      log(dim(tr(`Rapport JSON écrit : ${flags.out}`, `JSON report written: ${flags.out}`)));
    }
    if (flags.format === 'json') {
      process.stdout.write(`${json}\n`);
    } else {
      process.stdout.write(renderPretty(payload, loaded.rootDir, { verdict: !animateScore }));
      if (animateScore) await revealScore(payload.score, payload.gate, renderSubScores(payload));
    }
  }

  // ── Pro: upload (explicit --upload or rc.pro.upload) ──
  if (flags.upload || rc.pro.upload) {
    if (token === null) {
      log(
        yellow(
          tr(
            '⚠ Upload demandé mais aucun jeton Pro — rapport non envoyé (fonctionnalité Pro).',
            '⚠ Upload requested but no Pro token — report not sent (Pro feature).',
          ),
        ),
      );
    } else {
      const apiUrl = token.apiUrl ?? rc.pro.apiUrl;
      try {
        const ack = await uploadReport(apiUrl, token.token, payload);
        log(
          green(
            tr(
              `✓ Rapport envoyé au dashboard${ack.url !== undefined ? ` : ${ack.url}` : '.'}`,
              `✓ Report sent to the dashboard${ack.url !== undefined ? `: ${ack.url}` : '.'}`,
            ),
          ),
        );
      } catch (error) {
        // A cloud outage must never break the local audit: warn, don't throw.
        const reason = error instanceof ApiError ? error.message : String(error);
        log(yellow(tr(`⚠ Envoi du rapport impossible : ${reason}`, `⚠ Could not send the report: ${reason}`)));
      }
    }
  }

  // ── Tips contextuels : la prochaine étape logique, prête à copier ──
  if (flags.format === 'pretty') {
    const tips: Tip[] = [];
    const driftCount = payload.drift.issues.length;
    const rgaaFailed = payload.rgaa.findings.filter((f) => f.status === 'failed');
    if (result.tokensSource.origin === 'none') {
      tips.push({
        cmd: 'axaraaudit init',
        why: tr(
          'configuration guidée de votre design system',
          'guided setup of your design system',
        ),
      });
    } else if (result.tokensSource.origin === 'auto') {
      tips.push({
        cmd: 'axaraaudit init',
        why: tr(
          'formaliser ces tokens en design system déclaré',
          'formalize these tokens as a declared design system',
        ),
      });
    }
    if (driftCount > 0) {
      tips.push({
        cmd: 'axaraaudit fix --write',
        why: tr(
          `applique les remplacements de tokens sûrs (${driftCount} dérive(s) détectée(s))`,
          `applies safe token replacements (${driftCount} drift(s) detected)`,
        ),
      });
    }
    if (rgaaFailed.length > 0) {
      tips.push({
        cmd: 'axaraaudit fix --ai --write',
        why: tr(
          'corrige le RGAA (alt, labels, titres…) via Claude — opt-in',
          'fixes RGAA issues (alt, labels, headings…) via Claude — opt-in',
        ),
      });
      const worstFile = rgaaFailed[0]?.file;
      if (worstFile !== undefined) {
        tips.push({
          cmd: `axaraaudit voice ${worstFile}`,
          why: tr(
            "entendez ce fichier comme un utilisateur de lecteur d'écran",
            'hear this file the way a screen-reader user does',
          ),
        });
      }
    }
    if (tips.length === 0) {
      tips.push(
        {
          cmd: `axaraaudit audit --ci --fail-under ${String(payload.gate.failUnder)}`,
          why: tr('verrouillez ce score dans votre pipeline CI', 'lock this score into your CI pipeline'),
        },
        {
          cmd: 'axaraaudit history',
          why: tr(
            "l'évolution du score sur les derniers commits",
            'how the score evolved over recent commits',
          ),
        },
      );
    } else if (flags.format === 'pretty' && flags.out === undefined) {
      tips.push({
        cmd: 'axaraaudit audit --format html',
        why: tr('rapport autonome à partager avec l\'équipe', 'self-contained report to share with the team'),
      });
    }
    printTips(tips.slice(0, 3));
  }

  if (flags.ci && !gate.passed) return 1;
  return 0;
}
