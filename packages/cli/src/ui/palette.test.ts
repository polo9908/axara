import { describe, expect, it } from 'vitest';
import { tr } from '../i18n.js';
import { filterCommands } from './palette.js';

describe('filterCommands', () => {
  it('retourne tout le catalogue sur requête vide', () => {
    expect(filterCommands('').length).toBeGreaterThanOrEqual(10);
  });

  it('ignore le / initial (mémoire musculaire Claude Code)', () => {
    expect(filterCommands('/fix')[0]?.name).toBe('fix');
  });

  it('classe les préfixes avant les inclusions', () => {
    const names = filterCommands('h').map((c) => c.name);
    expect(names[0]).toBe('history');
    expect(names).toContain('hello');
    expect(names).toContain('help');
  });

  it('cherche aussi dans les définitions', () => {
    // Le brief de `voice` mentionne « lecteur d'écran » / "screen reader" selon la langue active.
    expect(filterCommands(tr('lecteur', 'screen reader')).map((c) => c.name)).toContain('voice');
  });

  it('retourne vide quand rien ne correspond', () => {
    expect(filterCommands('zzzzz')).toHaveLength(0);
  });

  it('trouve par mot-clé, dans les deux langues', () => {
    // « jeton » et "token" sont des keywords de settings…
    for (const query of ['jeton', 'token']) {
      const names = filterCommands(query).map((c) => c.name);
      expect(names).toContain('settings');
    }
    expect(filterCommands('mcp').map((c) => c.name)).toContain('settings');
    expect(filterCommands('rapport')[0]?.name).toBe('audit');
  });

  it('est insensible aux accents (clé ≈ cle)', () => {
    const accented = filterCommands('clé').map((c) => c.name);
    const plain = filterCommands('cle').map((c) => c.name);
    expect(accented).toEqual(plain);
    expect(plain).toContain('settings');
  });

  it('masque les commandes cloud tant qu’Axara Cloud est désactivé', () => {
    const all = filterCommands('').map((c) => c.name);
    for (const cloud of ['push', 'login', 'logout', 'whoami']) {
      expect(all).not.toContain(cloud);
    }
  });

  it('exige que chaque mot de la requête matche', () => {
    expect(filterCommands('jeton zzzzz')).toHaveLength(0);
    const names = filterCommands('jeton anthropic').map((c) => c.name);
    expect(names).toContain('settings');
  });
});
