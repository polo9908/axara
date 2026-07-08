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
});
