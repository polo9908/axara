/**
 * `axaraaudit push [rapport.json]` — envoie un rapport d'audit au dashboard Pro.
 * `axaraaudit push [report.json]` — sends an audit report to the Pro dashboard.
 *
 * Deux modes : avec un fichier (rapport `--format json` produit plus tôt, ex.
 * artefact CI), le payload est validé puis envoyé tel quel ; sans argument, un
 * audit frais est lancé puis envoyé. `--dry-run` montre ce qui partirait, sans
 * jeton ni réseau. Contrairement à `audit --upload` (best-effort), l'envoi est
 * ici le but de la commande : un échec réseau est une erreur (exit 2).
 * Contrat d'API : docs/open-core.md.
 */

import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { auditProject, PAYLOAD_VERSION, type AuditPayload } from '@axaraaudit/core';
import { loadRc, ConfigError, DEFAULT_RC } from '../config/rc.js';
import { resolveToken, TOKEN_ENV_VAR } from '../config/credentials.js';
import { tr } from '../i18n.js';
import { uploadReport } from '../services/api.js';
import { dim, green } from '../report/render.js';
import { createSpinner } from '../ui/spinner.js';
import { CLI_NAME, CLI_VERSION } from '../version.js';

export interface PushFlags {
  /** Rapport JSON existant à envoyer ; sinon un audit frais est lancé. */
  readonly file?: string;
  readonly config?: string;
  readonly skipRgaa: boolean;
  readonly dryRun: boolean;
}

export function parsePushFlags(argv: readonly string[]): PushFlags {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: {
      config: { type: 'string' },
      'skip-rgaa': { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });
  const file = positionals[0];
  return {
    ...(file !== undefined ? { file } : {}),
    ...(values.config !== undefined ? { config: values.config } : {}),
    skipRgaa: values['skip-rgaa'] ?? false,
    dryRun: values['dry-run'] ?? false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Garde-fou avant envoi : on ne POSTe jamais un JSON arbitraire. Vérifie la
 * silhouette du contrat (payload.ts, core) sans le revalider champ à champ —
 * l'API reste juge en dernier ressort.
 */
export function validateAuditPayload(data: unknown, source: string): AuditPayload {
  const fail = (fr: string, en: string): never => {
    throw new ConfigError(
      tr(`${source} n'est pas un rapport AxaraAudit : ${fr}`, `${source} is not an AxaraAudit report: ${en}`),
    );
  };
  if (!isRecord(data)) fail('JSON racine non-objet.', 'root JSON is not an object.');
  const record = data as Record<string, unknown>;
  const version = record['payloadVersion'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    fail('`payloadVersion` manquant ou invalide.', 'missing or invalid `payloadVersion`.');
  }
  if ((version as number) > PAYLOAD_VERSION) {
    throw new ConfigError(
      tr(
        `${source} a été produit par une version plus récente du CLI (payloadVersion ${String(version)} > ${PAYLOAD_VERSION}). Mettez à jour axaraaudit.`,
        `${source} was produced by a newer CLI version (payloadVersion ${String(version)} > ${PAYLOAD_VERSION}). Update axaraaudit.`,
      ),
    );
  }
  if (typeof record['project'] !== 'string' || record['project'] === '') {
    fail('`project` manquant.', 'missing `project`.');
  }
  if (typeof record['score'] !== 'number') {
    fail('`score` manquant.', 'missing `score`.');
  }
  for (const key of ['gate', 'drift', 'rgaa'] as const) {
    if (!isRecord(record[key])) fail(`section \`${key}\` manquante.`, `missing \`${key}\` section.`);
  }
  return data as unknown as AuditPayload;
}

function log(message: string): void {
  process.stderr.write(`${message}\n`);
}

export async function runPush(argv: readonly string[]): Promise<number> {
  const flags = parsePushFlags(argv);
  const cwd = process.cwd();

  // La config locale reste optionnelle en mode fichier (rapport déjà produit) :
  // elle ne sert alors qu'à résoudre pro.apiUrl.
  let loaded: ReturnType<typeof loadRc> | null = null;
  try {
    loaded = loadRc(cwd, flags.config);
  } catch (error) {
    if (flags.file === undefined) throw error;
  }

  let payload: AuditPayload;
  if (flags.file !== undefined) {
    let raw: string;
    try {
      raw = readFileSync(flags.file, 'utf8');
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new ConfigError(
        tr(`Rapport illisible (${flags.file}) : ${reason}`, `Cannot read report (${flags.file}): ${reason}`),
      );
    }
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new ConfigError(
        tr(`${flags.file} n'est pas du JSON valide.`, `${flags.file} is not valid JSON.`),
      );
    }
    payload = validateAuditPayload(data, flags.file);
  } else {
    const spinner = createSpinner(
      tr('Audit avant envoi (design-system + RGAA)…', 'Auditing before upload (design system + RGAA)…'),
    );
    spinner.start();
    try {
      const result = await auditProject({
        cwd,
        tool: CLI_NAME,
        toolVersion: CLI_VERSION,
        loaded: loaded as NonNullable<typeof loaded>,
        skipRgaa: flags.skipRgaa,
        ciMode: false,
      });
      payload = result.payload;
    } catch (error) {
      spinner.fail(tr('Audit interrompu', 'Audit aborted'));
      throw error;
    }
    spinner.succeed(
      tr(
        `Audit terminé — score ${payload.score}/100`,
        `Audit complete — score ${payload.score}/100`,
      ),
    );
  }

  const token = resolveToken();
  const apiUrl = token?.apiUrl ?? loaded?.rc.pro.apiUrl ?? DEFAULT_RC.pro.apiUrl;

  if (flags.dryRun) {
    const { aggregate } = payload.rgaa;
    process.stdout.write(
      `${tr('Rapport prêt à envoyer', 'Report ready to send')} (--dry-run)\n` +
        `  ${tr('projet', 'project')}      ${payload.project}\n` +
        `  score       ${payload.score}/100\n` +
        `  ${tr('dérives', 'drifts')}     ${payload.drift.issues.length}\n` +
        `  RGAA        ${aggregate.totalFindings} ${tr('constat(s)', 'finding(s)')}\n` +
        `  ${tr('destination', 'destination')} POST ${apiUrl.replace(/\/$/, '')}/v1/reports\n` +
        `  ${tr('jeton', 'token')}       ${token !== null ? tr('présent', 'present') : tr('absent', 'absent')}\n`,
    );
    return 0;
  }

  if (token === null) {
    process.stderr.write(
      tr(
        'Aucun jeton Pro — `push` envoie le rapport au dashboard (fonctionnalité Pro).\n' +
          `Définissez ${TOKEN_ENV_VAR} ou lancez \`axaraaudit login --token <jeton>\`.\n`,
        'No Pro token — `push` sends the report to the dashboard (Pro feature).\n' +
          `Set ${TOKEN_ENV_VAR} or run \`axaraaudit login --token <token>\`.\n`,
      ),
    );
    return 2;
  }

  // Un ApiError remonte à main() → message propre + exit 2.
  const ack = await uploadReport(apiUrl, token.token, payload);
  log(
    green(
      tr(
        `✓ Rapport envoyé au dashboard${ack.url !== undefined ? ` : ${ack.url}` : '.'}`,
        `✓ Report sent to the dashboard${ack.url !== undefined ? `: ${ack.url}` : '.'}`,
      ),
    ),
  );
  if (ack.id !== undefined) {
    log(dim(tr(`  id du rapport : ${ack.id}`, `  report id: ${ack.id}`)));
  }
  return 0;
}
