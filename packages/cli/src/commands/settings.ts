/**
 * `axaraaudit settings` — le centre de contrôle du CLI.
 *
 * Sur un TTY : panneau interactif dans la charte nébuleuse (↑↓ naviguer,
 * Entrée modifier/basculer, Suppr effacer, Échap quitter). Trois sections :
 *   🔑 Compte & jetons  — jeton Pro, clé Anthropic (saisie masquée)
 *   ⚙  Préférences      — langue, notification de mise à jour
 *   🔌 Serveurs MCP     — brancher AxaraAudit dans Claude Code / Desktop / Cursor
 *
 * Hors TTY (pipes, CI) ou en mode scripté :
 *   settings                         → état actuel, lisible en machine sobre
 *   settings set lang fr|en|auto     → langue persistée
 *   settings set update-check on|off → notification de mise à jour
 *   settings mcp install|remove <claude-code|claude-desktop|cursor>
 */

import { homedir } from 'node:os';
import { boldOn, cursor, gradient, paintFg, reset, stdoutLevel, type ColorLevel } from '../ui/ansi.js';
import { BRAND } from '../ui/theme.js';
import { tr } from '../i18n.js';
import {
  clearAnthropicKey,
  clearToken,
  maskToken,
  readStoredCredentials,
  resolveToken,
  saveAnthropicKey,
  saveCredentials,
  TOKEN_ENV_VAR,
} from '../config/credentials.js';
import { readSettings, saveSettings } from '../config/settings.js';
import {
  installMcp,
  mcpStatus,
  uninstallMcp,
  type McpClientStatus,
} from '../services/mcp-clients.js';

const ESC = '\u001b';
const CTRL_C = '\u0003';
const BACKSPACE = '\u007f';
const DELETE = `${ESC}[3~`;

/** `C:\Users\paul\.axaraaudit\…` → `~\.axaraaudit\…` — plus doux à l'œil. */
function tilde(path: string): string {
  const home = homedir();
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

// ── Modèle du panneau ──────────────────────────────────────────────────────

type RowAction =
  | { readonly kind: 'edit-token' }
  | { readonly kind: 'edit-anthropic' }
  | { readonly kind: 'cycle-lang' }
  | { readonly kind: 'toggle-update' }
  | { readonly kind: 'toggle-mcp'; readonly client: McpClientStatus };

interface Row {
  readonly label: string;
  /** Valeur affichée, déjà colorée. */
  readonly value: string;
  /** Ce que fait Suppr, ou undefined si rien à effacer. */
  readonly clearable: boolean;
  readonly action: RowAction;
}

interface Section {
  readonly icon: string;
  readonly title: string;
  readonly rows: readonly Row[];
}

function onOff(on: boolean, onText: string, offText: string, level: ColorLevel): string {
  return on ? paintFg(`✓ ${onText}`, BRAND.green, level) : paintFg(`— ${offText}`, BRAND.slate, level);
}

/** Construit l'état affiché — relu après chaque action pour rester fidèle au disque. */
function buildSections(level: ColorLevel): readonly Section[] {
  const stored = readStoredCredentials();
  const token = resolveToken();
  const settings = readSettings();

  const tokenValue =
    token === null
      ? paintFg(tr('— non configuré', '— not set'), BRAND.slate, level)
      : `${paintFg(maskToken(token.token), BRAND.green, level)} ${paintFg(
          token.source === 'env' ? `(${TOKEN_ENV_VAR})` : tr('(fichier)', '(file)'),
          BRAND.slate,
          level,
        )}`;
  const anthropicValue =
    stored?.anthropicKey !== undefined
      ? paintFg(maskToken(stored.anthropicKey), BRAND.green, level)
      : paintFg(tr('— non configurée', '— not set'), BRAND.slate, level);

  const langValue =
    settings.lang === undefined
      ? paintFg(tr('auto (locale système)', 'auto (system locale)'), BRAND.cyan, level)
      : paintFg(settings.lang === 'fr' ? 'français' : 'english', BRAND.cyan, level);

  return [
    {
      icon: '🔑',
      title: tr('COMPTE & JETONS', 'ACCOUNT & TOKENS'),
      rows: [
        {
          label: tr('Jeton Pro', 'Pro token'),
          value: tokenValue,
          clearable: stored?.token !== undefined,
          action: { kind: 'edit-token' },
        },
        {
          label: tr('Clé Anthropic', 'Anthropic key'),
          value: anthropicValue,
          clearable: stored?.anthropicKey !== undefined,
          action: { kind: 'edit-anthropic' },
        },
      ],
    },
    {
      icon: '⚙',
      title: tr('PRÉFÉRENCES', 'PREFERENCES'),
      rows: [
        {
          label: tr('Langue', 'Language'),
          value: langValue,
          clearable: false,
          action: { kind: 'cycle-lang' },
        },
        {
          label: tr('Alerte de mise à jour', 'Update notice'),
          value: onOff(
            settings.updateCheck !== false,
            tr('activée', 'enabled'),
            tr('désactivée', 'disabled'),
            level,
          ),
          clearable: false,
          action: { kind: 'toggle-update' },
        },
      ],
    },
    {
      icon: '🔌',
      title: tr('SERVEURS MCP', 'MCP SERVERS'),
      rows: mcpStatus().map((client) => ({
        label: client.label,
        value: onOff(
          client.installed,
          tr('installé', 'installed'),
          tr('non installé', 'not installed'),
          level,
        ),
        clearable: false,
        action: { kind: 'toggle-mcp', client },
      })),
    },
  ];
}

// ── Rendu ──────────────────────────────────────────────────────────────────

interface PanelState {
  selected: number;
  /** Message de confirmation sous le panneau (✓ jeton enregistré…). */
  status: string;
  /** Saisie en cours (jeton) ; null = navigation. */
  input: { prompt: string; value: string } | null;
}

function renderPanel(sections: readonly Section[], state: PanelState, level: ColorLevel): string {
  const b = (t: string): string => (level === 'none' ? t : `${boldOn(level)}${t}${reset(level)}`);
  const lines: string[] = [];
  lines.push(
    `  ${gradient('axaraaudit settings', BRAND.violet, BRAND.cyan, level)} ${paintFg(
      tr('— jetons, préférences et intégrations MCP', '— tokens, preferences and MCP integrations'),
      BRAND.slate,
      level,
    )}`,
  );
  lines.push(
    `  ${paintFg('✦', BRAND.violet, level)} ${paintFg(
      tr(
        '↑↓ naviguer · Entrée modifier / basculer · Suppr effacer · Échap quitter',
        '↑↓ navigate · Enter edit / toggle · Del clear · Esc quit',
      ),
      BRAND.slate,
      level,
    )}`,
  );

  const labelWidth = Math.max(
    ...sections.flatMap((s) => s.rows.map((r) => [...r.label].length)),
  );
  let index = 0;
  for (const section of sections) {
    lines.push('');
    lines.push(`  ${section.icon} ${b(paintFg(section.title, BRAND.violet, level))}`);
    for (const row of section.rows) {
      const active = index === state.selected && state.input === null;
      const marker = active ? paintFg('▸', BRAND.pink, level) : ' ';
      const label = paintFg(row.label.padEnd(labelWidth + 2), active ? BRAND.pink : BRAND.cyan, level);
      lines.push(`   ${marker} ${active ? b(label) : label} ${row.value}`);
      index += 1;
    }
  }

  lines.push('');
  if (state.input !== null) {
    const masked = '•'.repeat([...state.input.value].length);
    const caret = level === 'none' ? '_' : `${boldOn(level)}▌${reset(level)}`;
    lines.push(`  ${paintFg('❯', BRAND.pink, level)} ${paintFg(state.input.prompt, BRAND.cyan, level)} ${masked}${caret}`);
    lines.push(
      `    ${paintFg(tr('Entrée valider · Échap annuler (la saisie reste masquée)', 'Enter confirm · Esc cancel (input stays masked)'), BRAND.slate, level)}`,
    );
  } else if (state.status !== '') {
    lines.push(`  ${state.status}`);
  } else {
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

// ── Actions ────────────────────────────────────────────────────────────────

function cycleLang(level: ColorLevel): string {
  const current = readSettings().lang;
  const next = current === undefined ? 'fr' : current === 'fr' ? 'en' : undefined;
  saveSettings({ lang: next });
  const label = next === undefined ? tr('auto (locale système)', 'auto (system locale)') : next === 'fr' ? 'français' : 'english';
  return paintFg(
    tr(`✓ Langue : ${label} — prise en compte au prochain lancement.`, `✓ Language: ${label} — applied on next launch.`),
    BRAND.green,
    level,
  );
}

function toggleUpdate(level: ColorLevel): string {
  const next = !(readSettings().updateCheck !== false);
  saveSettings({ updateCheck: next });
  return paintFg(
    next
      ? tr('✓ Alerte de mise à jour activée.', '✓ Update notice enabled.')
      : tr('✓ Alerte de mise à jour désactivée.', '✓ Update notice disabled.'),
    BRAND.green,
    level,
  );
}

function toggleMcp(client: McpClientStatus, level: ColorLevel): string {
  try {
    if (client.installed) {
      uninstallMcp(client);
      return paintFg(
        tr(`✓ Serveur MCP retiré de ${client.label}.`, `✓ MCP server removed from ${client.label}.`),
        BRAND.green,
        level,
      );
    }
    installMcp(client);
    return paintFg(
      tr(
        `✓ Serveur MCP branché dans ${client.label} — redémarrez le client pour l'activer.`,
        `✓ MCP server wired into ${client.label} — restart the client to activate it.`,
      ),
      BRAND.green,
      level,
    );
  } catch (error) {
    return paintFg(`✗ ${error instanceof Error ? error.message : String(error)}`, BRAND.red, level);
  }
}

function saveToken(kind: 'edit-token' | 'edit-anthropic', value: string, level: ColorLevel): string {
  const trimmed = value.trim();
  if (trimmed === '') return '';
  if (kind === 'edit-token') {
    const path = saveCredentials(trimmed);
    return paintFg(
      tr(
        `✓ Jeton Pro enregistré (${tilde(path)}) — vérifiez avec \`axaraaudit whoami\`.`,
        `✓ Pro token saved (${tilde(path)}) — verify with \`axaraaudit whoami\`.`,
      ),
      BRAND.green,
      level,
    );
  }
  const path = saveAnthropicKey(trimmed);
  return paintFg(
    tr(
      `✓ Clé Anthropic enregistrée (${tilde(path)}) — \`fix --ai\` et \`roast\` sont disponibles.`,
      `✓ Anthropic key saved (${tilde(path)}) — \`fix --ai\` and \`roast\` are now available.`,
    ),
    BRAND.green,
    level,
  );
}

function clearRow(row: Row, level: ColorLevel): string {
  if (!row.clearable) return '';
  if (row.action.kind === 'edit-token' && clearToken()) {
    return paintFg(tr('✓ Jeton Pro effacé.', '✓ Pro token cleared.'), BRAND.green, level);
  }
  if (row.action.kind === 'edit-anthropic' && clearAnthropicKey()) {
    return paintFg(tr('✓ Clé Anthropic effacée.', '✓ Anthropic key cleared.'), BRAND.green, level);
  }
  return '';
}

// ── Panneau interactif ─────────────────────────────────────────────────────

function panelAvailable(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true && process.env['CI'] === undefined;
}

function runPanel(): Promise<number> {
  const level = stdoutLevel;
  const stdin = process.stdin;
  const state: PanelState = { selected: 0, status: '', input: null };
  let renderedLines = 0;

  const draw = (): void => {
    const sections = buildSections(level);
    const rowCount = sections.reduce((n, s) => n + s.rows.length, 0);
    if (state.selected >= rowCount) state.selected = Math.max(0, rowCount - 1);
    const frame = renderPanel(sections, state, level);
    const erase =
      renderedLines > 0 ? `${cursor.up(renderedLines)}${cursor.toColumn0}${cursor.eraseDown}` : '';
    process.stdout.write(`${erase}${frame}`);
    renderedLines = frame.split('\n').length - 1;
  };

  const rowAt = (i: number): Row | undefined =>
    buildSections(level).flatMap((s) => s.rows)[i];

  return new Promise((resolveCode) => {
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    process.stdout.write(`${cursor.hide}\n`);
    draw();

    const finish = (): void => {
      stdin.off('data', onKey);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write(`${cursor.show}\n`);
      resolveCode(0);
    };

    const onKey = (key: string): void => {
      if (key === CTRL_C) {
        finish();
        return;
      }

      // Mode saisie (jeton / clé) — masqué, Entrée valide, Échap annule.
      if (state.input !== null) {
        if (key === ESC) {
          state.input = null;
        } else if (key === '\r' || key === '\n') {
          const row = rowAt(state.selected);
          const value = state.input.value;
          state.input = null;
          if (row !== undefined && (row.action.kind === 'edit-token' || row.action.kind === 'edit-anthropic')) {
            state.status = saveToken(row.action.kind, value, level);
          }
        } else if (key === BACKSPACE || key === '\b') {
          state.input = { ...state.input, value: state.input.value.slice(0, -1) };
        } else if (key >= ' ' && !key.startsWith(ESC)) {
          // Collage inclus : un paste arrive en un seul chunk.
          state.input = { ...state.input, value: state.input.value + key.replace(/[\r\n]/g, '') };
        }
        draw();
        return;
      }

      if (key === ESC) {
        finish();
        return;
      }
      if (key === `${ESC}[A`) {
        state.selected = Math.max(0, state.selected - 1); // ↑
        state.status = '';
      } else if (key === `${ESC}[B`) {
        const rowCount = buildSections(level).reduce((n, s) => n + s.rows.length, 0);
        state.selected = Math.min(rowCount - 1, state.selected + 1); // ↓
        state.status = '';
      } else if (key === DELETE || key === 'x') {
        const row = rowAt(state.selected);
        if (row !== undefined) state.status = clearRow(row, level);
      } else if (key === '\r' || key === '\n') {
        const row = rowAt(state.selected);
        if (row !== undefined) {
          switch (row.action.kind) {
            case 'edit-token':
              state.input = { prompt: tr('Collez le jeton Pro :', 'Paste the Pro token:'), value: '' };
              state.status = '';
              break;
            case 'edit-anthropic':
              state.input = { prompt: tr('Collez la clé Anthropic :', 'Paste the Anthropic key:'), value: '' };
              state.status = '';
              break;
            case 'cycle-lang':
              state.status = cycleLang(level);
              break;
            case 'toggle-update':
              state.status = toggleUpdate(level);
              break;
            case 'toggle-mcp':
              state.status = toggleMcp(row.action.client, level);
              break;
          }
        }
      }
      draw();
    };

    stdin.on('data', onKey);
  });
}

// ── Mode scripté (pipes, CI, préférence non interactive) ───────────────────

function printSummary(): number {
  const level = stdoutLevel;
  const sections = buildSections(level);
  const lines: string[] = [''];
  lines.push(
    `  ${gradient('axaraaudit settings', BRAND.violet, BRAND.cyan, level)} ${paintFg(
      tr('— état actuel', '— current state'),
      BRAND.slate,
      level,
    )}`,
  );
  const labelWidth = Math.max(...sections.flatMap((s) => s.rows.map((r) => [...r.label].length)));
  for (const section of sections) {
    lines.push('');
    lines.push(`  ${section.icon} ${paintFg(section.title, BRAND.violet, level)}`);
    for (const row of section.rows) {
      lines.push(`     ${paintFg(row.label.padEnd(labelWidth + 2), BRAND.cyan, level)} ${row.value}`);
    }
  }
  lines.push('');
  lines.push(
    `  ${paintFg('✦', BRAND.violet, level)} ${paintFg(
      tr(
        'Modifier : `settings set lang fr|en|auto` · `settings set update-check on|off` · `settings mcp install <client>` · jetons via `login`',
        'Change: `settings set lang fr|en|auto` · `settings set update-check on|off` · `settings mcp install <client>` · tokens via `login`',
      ),
      BRAND.slate,
      level,
    )}`,
  );
  lines.push('');
  process.stdout.write(lines.join('\n'));
  return 0;
}

function usageError(message: string): number {
  process.stderr.write(`${message}\n`);
  process.stderr.write(
    tr(
      'Usage : axaraaudit settings [set lang fr|en|auto] [set update-check on|off] [mcp install|remove <claude-code|claude-desktop|cursor>]\n',
      'Usage: axaraaudit settings [set lang fr|en|auto] [set update-check on|off] [mcp install|remove <claude-code|claude-desktop|cursor>]\n',
    ),
  );
  return 2;
}

function runSet(key: string | undefined, value: string | undefined): number {
  if (key === 'lang') {
    if (value !== 'fr' && value !== 'en' && value !== 'auto') {
      return usageError(tr('Valeur attendue : fr, en ou auto.', 'Expected value: fr, en or auto.'));
    }
    saveSettings({ lang: value === 'auto' ? undefined : value });
    process.stdout.write(tr(`✓ Langue : ${value}\n`, `✓ Language: ${value}\n`));
    return 0;
  }
  if (key === 'update-check') {
    if (value !== 'on' && value !== 'off') {
      return usageError(tr('Valeur attendue : on ou off.', 'Expected value: on or off.'));
    }
    saveSettings({ updateCheck: value === 'on' });
    process.stdout.write(`✓ update-check: ${value}\n`);
    return 0;
  }
  return usageError(tr(`Clé inconnue : ${key ?? '(aucune)'}`, `Unknown key: ${key ?? '(none)'}`));
}

function runMcp(verb: string | undefined, clientId: string | undefined): number {
  if (verb !== 'install' && verb !== 'remove') {
    return usageError(tr('Verbe attendu : install ou remove.', 'Expected verb: install or remove.'));
  }
  const client = mcpStatus().find((c) => c.id === clientId);
  if (client === undefined) {
    return usageError(
      tr(
        `Client inconnu : ${clientId ?? '(aucun)'} — attendus : claude-code, claude-desktop, cursor.`,
        `Unknown client: ${clientId ?? '(none)'} — expected: claude-code, claude-desktop, cursor.`,
      ),
    );
  }
  try {
    if (verb === 'install') {
      installMcp(client);
      process.stdout.write(
        tr(`✓ Serveur MCP branché dans ${client.label} (${tilde(client.file)}).\n`, `✓ MCP server wired into ${client.label} (${tilde(client.file)}).\n`),
      );
    } else {
      uninstallMcp(client);
      process.stdout.write(
        tr(`✓ Serveur MCP retiré de ${client.label}.\n`, `✓ MCP server removed from ${client.label}.\n`),
      );
    }
    return 0;
  } catch (error) {
    process.stderr.write(`✗ ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

/** Point d'entrée de `axaraaudit settings` (alias : `config`). */
export async function runSettings(argv: readonly string[]): Promise<number> {
  const [first, ...rest] = argv;
  if (first === 'set') return runSet(rest[0], rest[1]);
  if (first === 'mcp') return runMcp(rest[0], rest[1]);
  if (first === '--list' || first === undefined) {
    if (first === undefined && panelAvailable()) return runPanel();
    return printSummary();
  }
  return usageError(tr(`Argument inconnu : ${first}`, `Unknown argument: ${first}`));
}
