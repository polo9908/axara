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
import { tr } from '../i18n.js';
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
      process.stderr.write(red(tr('Clé Anthropic vide.\n', 'Empty Anthropic key.\n')));
      return 2;
    }
    const path = saveAnthropicKey(anthropicKey.trim());
    process.stdout.write(
      green(
        tr(
          '✓ Clé Anthropic enregistrée — `axaraaudit fix --ai` est maintenant disponible.\n',
          '✓ Anthropic key saved — `axaraaudit fix --ai` is now available.\n',
        ),
      ),
    );
    process.stdout.write(dim(tr(`Enregistrée dans : ${path}\n`, `Saved to: ${path}\n`)));
    if (values.token === undefined) return 0;
  }

  const token = values.token ?? process.env[TOKEN_ENV_VAR];
  if (token === undefined || token.trim() === '') {
    process.stderr.write(
      `${red(tr('Aucun jeton fourni.', 'No token provided.'))}\n` +
        tr(
          `Usage : axaraaudit login --token <jeton> [--api-url <url>]\n`,
          `Usage: axaraaudit login --token <token> [--api-url <url>]\n`,
        ) +
        tr(
          `        axaraaudit login --anthropic-key <clé>   (correction IA)\n`,
          `        axaraaudit login --anthropic-key <key>   (AI fix)\n`,
        ) +
        tr(
          `        (ou définissez ${TOKEN_ENV_VAR} dans l'environnement)\n`,
          `        (or set ${TOKEN_ENV_VAR} in the environment)\n`,
        ),
    );
    return 2;
  }

  const apiUrl = values['api-url'] ?? DEFAULT_RC.pro.apiUrl;

  // Best-effort validation: a down API must not prevent storing the token.
  try {
    const me = await whoami(apiUrl, token.trim());
    const who = me.organization ?? me.name ?? tr('compte inconnu', 'unknown account');
    process.stdout.write(
      green(
        tr(
          `✓ Jeton validé — ${who}${me.plan !== undefined ? ` (plan ${me.plan})` : ''}\n`,
          `✓ Token validated — ${who}${me.plan !== undefined ? ` (${me.plan} plan)` : ''}\n`,
        ),
      ),
    );
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      process.stderr.write(red(`✗ ${error.message}\n`));
      return 2;
    }
    process.stderr.write(
      yellow(
        tr(
          `⚠ API non joignable, jeton enregistré sans validation.\n`,
          `⚠ API unreachable, token saved without validation.\n`,
        ),
      ),
    );
  }

  const path = saveCredentials(token.trim(), apiUrl);
  process.stdout.write(dim(tr(`Identifiants enregistrés : ${path}\n`, `Credentials saved: ${path}\n`)));
  return 0;
}

export function runLogout(): number {
  if (clearCredentials()) {
    process.stdout.write(green(tr('✓ Identifiants supprimés.\n', '✓ Credentials removed.\n')));
  } else {
    process.stdout.write(dim(tr('Aucun identifiant enregistré.\n', 'No credentials stored.\n')));
  }
  return 0;
}

export async function runWhoami(): Promise<number> {
  const resolved = resolveToken();
  if (resolved === null) {
    process.stdout.write(
      `${dim(tr('Non authentifié (mode open-source).', 'Not authenticated (open-source mode).'))}\n` +
        dim(
          tr(
            `Utilisez \`axaraaudit login --token <jeton>\` ou ${TOKEN_ENV_VAR}.\n`,
            `Use \`axaraaudit login --token <token>\` or ${TOKEN_ENV_VAR}.\n`,
          ),
        ),
    );
    return 0;
  }
  const source = resolved.source === 'env' ? TOKEN_ENV_VAR : '~/.axaraaudit/credentials.json';
  process.stdout.write(
    `${tr('Jeton :', 'Token:')} ${maskToken(resolved.token)} ${dim(tr(`(source : ${source})`, `(source: ${source})`))}\n`,
  );

  const apiUrl = resolved.apiUrl ?? DEFAULT_RC.pro.apiUrl;
  try {
    const me = await whoami(apiUrl, resolved.token);
    const who = me.organization ?? me.name ?? tr('compte inconnu', 'unknown account');
    process.stdout.write(
      green(
        tr(
          `✓ ${who}${me.plan !== undefined ? ` — plan ${me.plan}` : ''}\n`,
          `✓ ${who}${me.plan !== undefined ? ` — ${me.plan} plan` : ''}\n`,
        ),
      ),
    );
  } catch {
    process.stdout.write(dim(tr('(API non joignable — identité non vérifiée)\n', '(API unreachable — identity not verified)\n')));
  }
  return 0;
}
