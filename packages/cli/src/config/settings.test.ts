import { describe, expect, it } from 'vitest';
import { parseSettings } from './settings.js';

describe('parseSettings', () => {
  it('accepte les valeurs valides', () => {
    expect(parseSettings({ lang: 'fr', updateCheck: false, savedAt: 'x' })).toEqual({
      lang: 'fr',
      updateCheck: false,
      savedAt: 'x',
    });
  });

  it('ignore les valeurs invalides et les clés inconnues', () => {
    expect(parseSettings({ lang: 'de', updateCheck: 'non', mystery: 1 })).toEqual({});
  });

  it('tolère un JSON non-objet', () => {
    expect(parseSettings(null)).toEqual({});
    expect(parseSettings('fr')).toEqual({});
    expect(parseSettings(42)).toEqual({});
  });
});
