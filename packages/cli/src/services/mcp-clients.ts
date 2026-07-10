/**
 * Gestion des serveurs MCP — brancher AxaraAudit dans les clients IA.
 *
 * Le serveur `@axaraaudit/mcp-server` (5 tools, 3 resources) se déclare dans
 * le fichier de config de chaque client. On ne touche jamais qu'à NOTRE
 * entrée (`mcpServers.axaraaudit`) : le reste du fichier est préservé
 * octet pour octet côté données (re-sérialisé en JSON indenté 2).
 *
 * Clients gérés :
 *   - Claude Code (projet)  → `.mcp.json` à la racine du projet courant
 *   - Claude Desktop        → config utilisateur (chemin par plateforme)
 *   - Cursor                → `~/.cursor/mcp.json`
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { tr } from '../i18n.js';

export const MCP_SERVER_KEY = 'axaraaudit';

/** L'entrée écrite chez les clients : npx résout la dernière version publiée. */
export const MCP_SERVER_ENTRY = {
  command: 'npx',
  args: ['-y', '@axaraaudit/mcp-server'],
} as const;

export interface McpClient {
  readonly id: 'claude-code' | 'claude-desktop' | 'cursor';
  readonly label: string;
  /** Chemin du fichier de config du client. */
  readonly file: string;
  /** Portée : projet courant ou machine. */
  readonly scope: 'project' | 'user';
}

export interface McpClientStatus extends McpClient {
  readonly installed: boolean;
}

function claudeDesktopConfig(): string {
  const home = homedir();
  if (process.platform === 'win32') {
    return join(process.env['APPDATA'] ?? join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
  }
  if (process.platform === 'darwin') {
    return join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  return join(home, '.config', 'Claude', 'claude_desktop_config.json');
}

export function mcpClients(cwd: string = process.cwd()): readonly McpClient[] {
  return [
    {
      id: 'claude-code',
      label: tr('Claude Code (ce projet)', 'Claude Code (this project)'),
      file: join(cwd, '.mcp.json'),
      scope: 'project',
    },
    {
      id: 'claude-desktop',
      label: 'Claude Desktop',
      file: claudeDesktopConfig(),
      scope: 'user',
    },
    {
      id: 'cursor',
      label: 'Cursor',
      file: join(homedir(), '.cursor', 'mcp.json'),
      scope: 'user',
    },
  ];
}

function readConfig(file: string): Record<string, unknown> {
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    throw new Error(
      tr(`JSON invalide dans ${file} — corrigez-le avant de continuer.`, `Invalid JSON in ${file} — fix it before continuing.`),
    );
  }
}

function serversOf(config: Record<string, unknown>): Record<string, unknown> {
  const servers = config['mcpServers'];
  return typeof servers === 'object' && servers !== null ? (servers as Record<string, unknown>) : {};
}

/** Notre entrée est-elle déclarée dans ce fichier de config ? Exporté pour les tests. */
export function hasEntry(config: Record<string, unknown>): boolean {
  return MCP_SERVER_KEY in serversOf(config);
}

/** Ajoute `mcpServers.axaraaudit` en préservant le reste. Exporté pour les tests. */
export function withEntry(config: Record<string, unknown>): Record<string, unknown> {
  return { ...config, mcpServers: { ...serversOf(config), [MCP_SERVER_KEY]: MCP_SERVER_ENTRY } };
}

/** Retire notre entrée en préservant le reste. Exporté pour les tests. */
export function withoutEntry(config: Record<string, unknown>): Record<string, unknown> {
  const servers = { ...serversOf(config) };
  delete servers[MCP_SERVER_KEY];
  return { ...config, mcpServers: servers };
}

export function mcpStatus(cwd: string = process.cwd()): readonly McpClientStatus[] {
  return mcpClients(cwd).map((client) => {
    let installed = false;
    try {
      installed = hasEntry(readConfig(client.file));
    } catch {
      // JSON illisible → considéré non installé ; l'install échouera avec le vrai message.
    }
    return { ...client, installed };
  });
}

export function installMcp(client: McpClient): void {
  const config = withEntry(readConfig(client.file));
  mkdirSync(dirname(client.file), { recursive: true });
  writeFileSync(client.file, `${JSON.stringify(config, null, 2)}\n`);
}

export function uninstallMcp(client: McpClient): void {
  if (!existsSync(client.file)) return;
  writeFileSync(client.file, `${JSON.stringify(withoutEntry(readConfig(client.file)), null, 2)}\n`);
}
