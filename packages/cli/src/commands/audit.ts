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
import { fetchRemoteConfig, uploadReport, ApiError } from '../services/api.js';
import { renderHtml } from '../report/html.js';
import { renderPretty, dim, green, yellow } from '../report/render.js';
import { stderrLevel } from '../ui/ansi.js';
import { renderBanner } from '../ui/banner.js';
import { canReveal, revealScore } from '../ui/reveal.js';
import { createSpinner } from '../ui/spinner.js';
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
    throw new ConfigError(`--fail-under doit être un nombre entre 0 et 100 (reçu: ${failUnderRaw}).`);
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
          'La synchronisation distante (--remote) nécessite un jeton Pro. ' +
            'Définissez AUDITOR_TOKEN ou lancez `axaraaudit login --token <jeton>`.',
        );
      }
      log(yellow('⚠ pro.remoteConfig activé mais aucun jeton trouvé — configuration locale utilisée.'));
    } else {
      const apiUrl = token.apiUrl ?? loaded.rc.pro.apiUrl;
      const remote = await fetchRemoteConfig(apiUrl, token.token);
      if (remote.config !== undefined) {
        loaded = { ...loaded, rc: mergeRc(loaded.rc, remote.config) };
      }
      if (remote.tokens !== undefined) {
        inlineTokensJson = JSON.stringify(remote.tokens);
      }
      log(green(`✓ Règles synchronisées depuis ${apiUrl}`));
    }
  }

  // ── Collect, analyse, score (single shared pipeline in core) ──
  const spinner = createSpinner('Analyse du design-system + RGAA…');
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
    if (flags.format === 'pretty') spinner.fail('Audit interrompu');
    throw error;
  }
  const { payload, gate, rc } = result;
  if (flags.format === 'pretty') {
    spinner.succeed(
      `Audit terminé — ${payload.drift.summary.filesScanned} fichier(s) analysé(s)`,
    );
  }

  if (result.tokensSource.origin === 'auto') {
    log(green(`✓ Zéro-config : ${result.tokensSource.detail}.`));
    log(dim('  (aucun fichier de tokens déclaré — les custom properties CSS font foi)'));
  }

  const json = JSON.stringify(payload, null, 2);
  // Sur TTY, la section SCORE textuelle cède la place à la révélation animée.
  const animateScore = flags.format !== 'json' && canReveal();
  if (flags.format === 'html') {
    const outPath = flags.out ?? 'axara-report.html';
    writeFileSync(outPath, renderHtml(payload), 'utf8');
    process.stdout.write(renderPretty(payload, loaded.rootDir, { verdict: !animateScore }));
    if (animateScore) await revealScore(payload.score, payload.gate);
    log(green(`✓ Rapport HTML écrit : ${outPath}`));
    log(dim('  Ouvrez-le dans un navigateur — fichier autonome, partageable tel quel.'));
  } else {
    if (flags.out !== undefined) {
      writeFileSync(flags.out, `${json}\n`, 'utf8');
      log(dim(`Rapport JSON écrit : ${flags.out}`));
    }
    if (flags.format === 'json') {
      process.stdout.write(`${json}\n`);
    } else {
      process.stdout.write(renderPretty(payload, loaded.rootDir, { verdict: !animateScore }));
      if (animateScore) await revealScore(payload.score, payload.gate);
    }
  }

  // ── Pro: upload (explicit --upload or rc.pro.upload) ──
  if (flags.upload || rc.pro.upload) {
    if (token === null) {
      log(yellow('⚠ Upload demandé mais aucun jeton Pro — rapport non envoyé (fonctionnalité Pro).'));
    } else {
      const apiUrl = token.apiUrl ?? rc.pro.apiUrl;
      try {
        const ack = await uploadReport(apiUrl, token.token, payload);
        log(green(`✓ Rapport envoyé au dashboard${ack.url !== undefined ? ` : ${ack.url}` : '.'}`));
      } catch (error) {
        // A cloud outage must never break the local audit: warn, don't throw.
        const reason = error instanceof ApiError ? error.message : String(error);
        log(yellow(`⚠ Envoi du rapport impossible : ${reason}`));
      }
    }
  }

  if (flags.ci && !gate.passed) return 1;
  return 0;
}
