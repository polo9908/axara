import { describe, expect, it, vi } from 'vitest';
import { runSettings } from './settings.js';

// Chemins d'erreur uniquement : aucun test ici ne doit écrire sur le disque.
describe('runSettings — validation des arguments', () => {
  it('rejette une langue inconnue (exit 2)', async () => {
    const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    expect(await runSettings(['set', 'lang', 'de'])).toBe(2);
    expect(err.mock.calls.join('')).toContain('fr');
    err.mockRestore();
  });

  it('rejette une clé inconnue (exit 2)', async () => {
    const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    expect(await runSettings(['set', 'theme', 'dark'])).toBe(2);
    err.mockRestore();
  });

  it('rejette un verbe MCP inconnu et un client inconnu (exit 2)', async () => {
    const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    expect(await runSettings(['mcp', 'upgrade', 'cursor'])).toBe(2);
    expect(await runSettings(['mcp', 'install', 'vscode'])).toBe(2);
    err.mockRestore();
  });

  it('rejette un argument inconnu (exit 2)', async () => {
    const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    expect(await runSettings(['bogus'])).toBe(2);
    err.mockRestore();
  });
});
