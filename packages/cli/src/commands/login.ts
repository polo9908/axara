/**
 * `axaraaudit login | logout | whoami` — Pro authentication lifecycle.
 * Token comes from `--token` (or AUDITOR_TOKEN for zero-storage CI usage)
 * and is persisted to `~/.axaraaudit/credentials.json`.
 */

import { parseArgs } from 'node:util';
import {
  clearCredentials,
  maskToken,
  resolveToken,
  saveAnthropicKey,
  saveCredentials,
  TOKEN_ENV_VAR,
} from '../config/credentials.js';
import { DEFAULT_RC } from '../config/rc.js';
import { whoami, ApiError } from '../services/api.js';
import { dim, green, red, yellow } from '../report/render.js';

export async function runLogin(argv: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      token: { type: 'string' },
      'api-url': { type: 'string' },
      'anthropic-key': { type: 'string' },
    },
    allowPositionals: true,
  });

  // Anthropic key (AI fix pass) — independent of the Pro token.
  const anthropicKey = values['anthropic-key'];
  if (anthropicKey !== undefined) {
    if (anthropicKey.trim() === '') {
      process.stderr.write(red('Clé Anthropic vide.\n'));
      return 2;
    }
    const path = saveAnthropicKey(anthropicKey.trim());
    process.stdout.write(green('✓ Clé Anthropic enregistrée — `axaraaudit fix --ai` est maintenant disponible.\n'));
    process.stdout.write(dim(`Enregistrée dans : ${path}\n`));
    if (values.token === undefined) return 0;
  }

  const token = values.token ?? process.env[TOKEN_ENV_VAR];
  if (token === undefined || token.trim() === '') {
    process.stderr.write(
      `${red('Aucun jeton fourni.')}\n` +
        `Usage : axaraaudit login --token <jeton> [--api-url <url>]\n` +
        `        axaraaudit login --anthropic-key <clé>   (correction IA)\n` +
        `        (ou définissez ${TOKEN_ENV_VAR} dans l'environnement)\n`,
    );
    return 2;
  }

  const apiUrl = values['api-url'] ?? DEFAULT_RC.pro.apiUrl;

  // Best-effort validation: a down API must not prevent storing the token.
  try {
    const me = await whoami(apiUrl, token.trim());
    const who = me.organization ?? me.name ?? 'compte inconnu';
    process.stdout.write(green(`✓ Jeton validé — ${who}${me.plan !== undefined ? ` (plan ${me.plan})` : ''}\n`));
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      process.stderr.write(red(`✗ ${error.message}\n`));
      return 2;
    }
    process.stderr.write(yellow(`⚠ API non joignable, jeton enregistré sans validation.\n`));
  }

  const path = saveCredentials(token.trim(), apiUrl);
  process.stdout.write(dim(`Identifiants enregistrés : ${path}\n`));
  return 0;
}

export function runLogout(): number {
  if (clearCredentials()) {
    process.stdout.write(green('✓ Identifiants supprimés.\n'));
  } else {
    process.stdout.write(dim('Aucun identifiant enregistré.\n'));
  }
  return 0;
}

export async function runWhoami(): Promise<number> {
  const resolved = resolveToken();
  if (resolved === null) {
    process.stdout.write(
      `${dim('Non authentifié (mode open-source).')}\n` +
        dim(`Utilisez \`axaraaudit login --token <jeton>\` ou ${TOKEN_ENV_VAR}.\n`),
    );
    return 0;
  }
  const source = resolved.source === 'env' ? TOKEN_ENV_VAR : '~/.axaraaudit/credentials.json';
  process.stdout.write(`Jeton : ${maskToken(resolved.token)} ${dim(`(source : ${source})`)}\n`);

  const apiUrl = resolved.apiUrl ?? DEFAULT_RC.pro.apiUrl;
  try {
    const me = await whoami(apiUrl, resolved.token);
    const who = me.organization ?? me.name ?? 'compte inconnu';
    process.stdout.write(green(`✓ ${who}${me.plan !== undefined ? ` — plan ${me.plan}` : ''}\n`));
  } catch {
    process.stdout.write(dim('(API non joignable — identité non vérifiée)\n'));
  }
  return 0;
}
