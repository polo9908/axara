/**
 * `axaraaudit audit` — the main sensor run.
 *
 * Open-source path: local config → static drift analysis + RGAA (axe-core)
 * → pretty/JSON report. Pro path (token present): optional remote
 * config/tokens pull (`--remote`) and report upload (`--upload`).
 * `--ci` turns the run into a gatekeeper: exit code 1 when the gate fails.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { extname, relative } from 'node:path';
import { parseArgs } from 'node:util';
import {
  auditSources,
  auditHtmlRgaa,
  jsxToHtml,
  PAGE_SCOPED_RULES,
  type SourceFile,
} from '@axaraaudit/core';
import { loadRc, mergeRc, resolveTokensPath, ConfigError } from '../config/rc.js';
import { resolveToken } from '../config/credentials.js';
import { fetchRemoteConfig, uploadReport, ApiError } from '../services/api.js';
import { collectFiles } from '../scan/walk.js';
import { computeScore, evaluateGate, type FileRgaaFinding } from '../report/score.js';
import { buildPayload } from '../report/payload.js';
import { renderPretty, dim, green, yellow } from '../report/render.js';

const JSX_EXT = new Set(['.tsx', '.jsx']);
const HTML_EXT = new Set(['.html', '.htm']);

export interface AuditFlags {
  readonly config?: string;
  readonly tokens?: string;
  readonly format: 'pretty' | 'json';
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

  const format = values.format === 'json' ? 'json' : 'pretty';
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

  const rc = flags.failUnder === undefined
    ? loaded.rc
    : mergeRc(loaded.rc, { ci: { failUnder: flags.failUnder } });

  // ── Collect & analyse (open-source core) ──
  const tokensJson =
    inlineTokensJson ?? readFileSync(resolveTokensPath(loaded, flags.tokens), 'utf8').replace(/^﻿/, '');
  const filePaths = collectFiles(loaded.rootDir, rc.include, rc.exclude, rc.extensions);
  const files: SourceFile[] = filePaths.map((path) => ({
    path,
    content: readFileSync(path, 'utf8'),
  }));

  const drift = auditSources(tokensJson, files, { remBasePx: rc.remBasePx });

  const rgaaEnabled = rc.rgaa.enabled && !flags.skipRgaa;
  const rgaaFindings: FileRgaaFinding[] = [];
  let rgaaFilesAudited = 0;
  if (rgaaEnabled) {
    for (const file of files) {
      const ext = extname(file.path).toLowerCase();
      let html: string | null = null;
      if (JSX_EXT.has(ext)) html = jsxToHtml(file.content);
      else if (HTML_EXT.has(ext)) html = file.content;
      if (html === null || html.trim() === '') continue;

      rgaaFilesAudited += 1;
      const report = await auditHtmlRgaa(html, {
        contrast: rc.rgaa.contrast,
        ...(rc.rgaa.scope === 'component' ? { disableRules: PAGE_SCOPED_RULES } : {}),
      });
      for (const finding of report.findings) {
        rgaaFindings.push({ file: relative(loaded.rootDir, file.path), finding });
      }
    }
  }

  // ── Score, gate, report ──
  const score = computeScore(drift.summary, rgaaFindings);
  const gate = evaluateGate(score, rgaaFindings, {
    failUnder: rc.ci.failUnder,
    blockOnCritical: rc.ci.blockOnCritical,
    priority: rc.rgaa.priority,
  });
  const payload = buildPayload({
    project: rc.project,
    drift,
    rgaaEnabled,
    rgaaFilesAudited,
    rgaaFindings,
    gate,
    ciMode: flags.ci,
  });

  const json = JSON.stringify(payload, null, 2);
  if (flags.out !== undefined) {
    writeFileSync(flags.out, `${json}\n`, 'utf8');
    log(dim(`Rapport JSON écrit : ${flags.out}`));
  }
  if (flags.format === 'json') {
    process.stdout.write(`${json}\n`);
  } else {
    process.stdout.write(renderPretty(payload, loaded.rootDir));
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
