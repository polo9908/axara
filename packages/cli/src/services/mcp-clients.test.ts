import { describe, expect, it } from 'vitest';
import {
  hasEntry,
  MCP_SERVER_ENTRY,
  MCP_SERVER_KEY,
  mcpClients,
  withEntry,
  withoutEntry,
} from './mcp-clients.js';

describe('withEntry / withoutEntry', () => {
  it('ajoute notre serveur dans une config vide', () => {
    const next = withEntry({});
    expect(hasEntry(next)).toBe(true);
    expect((next['mcpServers'] as Record<string, unknown>)[MCP_SERVER_KEY]).toEqual(MCP_SERVER_ENTRY);
  });

  it('préserve les autres serveurs et clés du fichier', () => {
    const config = {
      mcpServers: { autre: { command: 'foo' } },
      theme: 'dark',
    };
    const next = withEntry(config);
    expect((next['mcpServers'] as Record<string, unknown>)['autre']).toEqual({ command: 'foo' });
    expect(next['theme']).toBe('dark');

    const removed = withoutEntry(next);
    expect(hasEntry(removed)).toBe(false);
    expect((removed['mcpServers'] as Record<string, unknown>)['autre']).toEqual({ command: 'foo' });
    expect(removed['theme']).toBe('dark');
  });

  it('withoutEntry est sans effet si absent', () => {
    expect(hasEntry(withoutEntry({}))).toBe(false);
  });
});

describe('mcpClients', () => {
  it('expose les trois clients, .mcp.json ancré sur le cwd fourni', () => {
    const clients = mcpClients('/tmp/projet');
    expect(clients.map((c) => c.id)).toEqual(['claude-code', 'claude-desktop', 'cursor']);
    expect(clients[0]?.file.replace(/\\/g, '/')).toBe('/tmp/projet/.mcp.json');
    expect(clients[0]?.scope).toBe('project');
  });
});
